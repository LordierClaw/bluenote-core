import path from "node:path"
import fs from "node:fs"

import { UsageError } from "../core/errors"
import { createNoteDescription } from "../domain/note-description"
import { assertPathInsideRoot, toRootRelativePath } from "../platform/path-safety"
import { createNoteRepository } from "../storage/note-repository"
import { serializePlainNote } from "../storage/plain-note"
import { createSidecarRepository } from "../storage/sidecar-repository"
import type { NoteSidecar } from "../storage/sidecar-schema"
import { getNormalNotesPath } from "../storage/root-layout"
import type {
  DownloadNoteBodyResponse,
  PullChangesRequest,
  PullChangesResponse,
  PushRequest,
  PushResponse,
  SyncChangeEntityType,
  SyncChangeView,
  SyncPushRecord,
} from "./protocol"
import {
  parseSyncMetadata,
  serializeSyncMetadata,
  type EnsureSyncDatabaseOptions,
  type SyncDatabaseHandle,
  withSyncDatabase,
} from "./sync-db"

export interface SyncServerAiWork {
  noteId: string
  reason: "sync-push"
}

export type SyncServerAiQueue = (work: SyncServerAiWork) => void | Promise<void>

export interface CreateSyncServerServiceOptions {
  rootPath: string
  workspaceId: string
  queueAiWork?: SyncServerAiQueue
}

export interface SyncServerPushRequest extends PushRequest {
  noteBodies?: Record<string, string>
}

export interface SyncServerService {
  acceptPush(request: SyncServerPushRequest): PushResponse
  getChanges(request: PullChangesRequest): PullChangesResponse
  downloadNoteBody(noteId: string): DownloadNoteBodyResponse
}

interface AppliedChange {
  entityType: SyncChangeEntityType
  entityId: string
  changeType: string
  serverRevision: number
  changedAt: string
  sourceReplicaId: string
  title: string | null
  relativePath: string | null
  bodyAvailable: boolean
  metadata: Record<string, unknown>
}

interface NoteMetadata {
  key: string
  title: string
  relativePath: string
  createdAt: string
  updatedAt: string
  contentHash?: string
  byteLength?: number
}

function stringMetadata(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key]
  return typeof value === "string" ? value : null
}

function numberMetadata(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function basenameKeyFromRelativePath(relativePath: string): string {
  return path.posix.basename(relativePath, ".md")
}

function normalizeRelativePath(relativePath: string, rootPath: string): string {
  const portableRelativePath = relativePath.replace(/\\/g, "/").replace(/^\.\//, "")
  if (!portableRelativePath.startsWith("note/") || !portableRelativePath.endsWith(".md")) {
    throw new UsageError(`Invalid sync note relativePath '${relativePath}'.`, {
      hint: "Note sync pushes must target Markdown files under note/.",
    })
  }

  const absolutePath = assertPathInsideRoot(rootPath, path.join(rootPath, portableRelativePath))
  return toRootRelativePath(rootPath, absolutePath)
}

function metadataWithoutBody(metadata: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (key !== "body") {
      clean[key] = value
    }
  }
  return clean
}

function noteMetadataFromPush(rootPath: string, record: SyncPushRecord): NoteMetadata {
  const metadata = metadataWithoutBody(record.metadata)
  const relativePath = normalizeRelativePath(
    stringMetadata(metadata, "relativePath") ?? `note/${record.entityId}.md`,
    rootPath,
  )
  const key = stringMetadata(metadata, "key") ?? basenameKeyFromRelativePath(relativePath)
  const title = stringMetadata(metadata, "title") ?? key
  const updatedAt = stringMetadata(metadata, "updatedAt") ?? record.clientUpdatedAt
  const createdAt = stringMetadata(metadata, "createdAt") ?? updatedAt
  const contentHash = record.bodyUpload?.contentHash ?? stringMetadata(metadata, "contentHash") ?? undefined
  const byteLength = record.bodyUpload?.byteLength ?? numberMetadata(metadata, "byteLength") ?? undefined

  if (key !== basenameKeyFromRelativePath(relativePath)) {
    throw new UsageError(`Invalid sync note metadata for '${record.entityId}'.`, {
      hint: "The note key must match the Markdown filename basename.",
    })
  }

  return { key, title, relativePath, createdAt, updatedAt, contentHash, byteLength }
}

function ensureNormalFolder(rootPath: string, relativePath: string): void {
  const folderRelativePath = path.posix.dirname(relativePath)
  const folderPath = assertPathInsideRoot(rootPath, path.join(rootPath, folderRelativePath))
  const normalNotesPath = getNormalNotesPath(rootPath)
  assertPathInsideRoot(normalNotesPath, folderPath)
  fs.mkdirSync(folderPath, { recursive: true })
}

function readSidecarIfExists(rootPath: string, noteId: string): NoteSidecar | null {
  const sidecars = createSidecarRepository(rootPath)
  if (!fs.existsSync(sidecars.getSidecarPathByNoteId(noteId))) {
    return null
  }
  return sidecars.readByNoteId(noteId)
}

function upsertNote(rootPath: string, record: SyncPushRecord, body: string): NoteMetadata {
  const metadata = noteMetadataFromPush(rootPath, record)
  const repository = createNoteRepository(rootPath)
  const sidecar = readSidecarIfExists(rootPath, record.entityId)

  ensureNormalFolder(rootPath, metadata.relativePath)

  if (sidecar === null) {
    repository.create({
      noteId: record.entityId,
      body,
      frontmatter: {
        id: metadata.key,
        schemaVersion: 1,
        title: metadata.title,
        mode: "plain",
        tags: [],
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
      },
      destination: { type: "normal", folderRelativePath: path.posix.dirname(metadata.relativePath) },
    })
  } else {
    const existingPath = assertPathInsideRoot(rootPath, path.join(rootPath, sidecar.relativePath))
    if (sidecar.relativePath !== metadata.relativePath || sidecar.key !== metadata.key) {
      const nextPath = assertPathInsideRoot(rootPath, path.join(rootPath, metadata.relativePath))
      fs.mkdirSync(path.dirname(nextPath), { recursive: true })
      fs.writeFileSync(nextPath, serializePlainNote({ body, sourcePath: metadata.relativePath }), "utf8")
      if (nextPath !== existingPath && fs.existsSync(existingPath)) {
        fs.rmSync(existingPath)
      }
      createSidecarRepository(rootPath).write({
        ...sidecar,
        key: metadata.key,
        title: metadata.title,
        description: createNoteDescription(body),
        relativePath: metadata.relativePath,
        updatedAt: metadata.updatedAt,
      })
    } else {
      repository.syncEditedNote(existingPath, {
        title: metadata.title,
        body,
        updatedAt: metadata.updatedAt,
      })
    }
  }

  return metadata
}

function deleteNote(rootPath: string, record: SyncPushRecord): { title: string | null; relativePath: string | null; metadata: Record<string, unknown> } {
  const pushedMetadata = metadataWithoutBody(record.metadata)
  const existingSidecar = readSidecarIfExists(rootPath, record.entityId)
  const title = stringMetadata(pushedMetadata, "title") ?? existingSidecar?.title ?? null
  const relativePath = stringMetadata(pushedMetadata, "relativePath") ?? existingSidecar?.relativePath ?? null

  if (existingSidecar !== null) {
    const notePath = assertPathInsideRoot(rootPath, path.join(rootPath, existingSidecar.relativePath))
    if (fs.existsSync(notePath)) {
      createNoteRepository(rootPath).delete(notePath)
    } else {
      const sidecarPath = createSidecarRepository(rootPath).getSidecarPathByNoteId(record.entityId)
      if (fs.existsSync(sidecarPath)) {
        fs.rmSync(sidecarPath)
      }
    }
  }

  return {
    title,
    relativePath,
    metadata: {
      deletedAt: record.clientUpdatedAt,
      previousRelativePath: relativePath,
      previousTitle: title,
    },
  }
}

function latestServerRevision(handle: SyncDatabaseHandle, entityType: string, entityId: string): number {
  const rows = handle.db.exec(
    "SELECT MAX(serverRevision) FROM server_changes WHERE entityType = ? AND entityId = ?",
    [entityType, entityId],
  )[0]?.values ?? []
  const value = rows[0]?.[0]
  return typeof value === "number" ? value : 0
}

function latestServerSequence(handle: SyncDatabaseHandle): number {
  const rows = handle.db.exec("SELECT MAX(sequence) FROM server_changes")[0]?.values ?? []
  const value = rows[0]?.[0]
  return typeof value === "number" ? value : 0
}

function insertServerChange(handle: SyncDatabaseHandle, workspaceId: string, change: AppliedChange): void {
  handle.db.run(
    `
      INSERT INTO server_changes (
        workspaceId,
        entityType,
        entityId,
        changeType,
        serverRevision,
        changedAt,
        sourceReplicaId,
        title,
        relativePath,
        bodyAvailable,
        metadataJson
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      workspaceId,
      change.entityType,
      change.entityId,
      change.changeType,
      change.serverRevision,
      change.changedAt,
      change.sourceReplicaId,
      change.title,
      change.relativePath,
      change.bodyAvailable ? 1 : 0,
      serializeSyncMetadata(change.metadata),
    ],
  )

  if (change.changeType === "delete") {
    handle.db.run(
      `
        INSERT INTO tombstones (
          entityType,
          entityId,
          deletedAt,
          serverRevision,
          sourceReplicaId,
          previousRelativePath,
          previousTitle
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(entityType, entityId) DO UPDATE SET
          deletedAt = excluded.deletedAt,
          serverRevision = excluded.serverRevision,
          sourceReplicaId = excluded.sourceReplicaId,
          previousRelativePath = excluded.previousRelativePath,
          previousTitle = excluded.previousTitle
      `,
      [
        change.entityType,
        change.entityId,
        stringMetadata(change.metadata, "deletedAt") ?? change.changedAt,
        change.serverRevision,
        change.sourceReplicaId,
        stringMetadata(change.metadata, "previousRelativePath") ?? change.relativePath,
        stringMetadata(change.metadata, "previousTitle") ?? change.title,
      ],
    )
  }
}

function toChangeView(row: unknown[]): SyncChangeView {
  const title = typeof row[6] === "string" ? row[6] : undefined
  const relativePath = typeof row[7] === "string" ? row[7] : undefined
  return {
    sequence: Number(row[0]),
    entityType: String(row[1]) as SyncChangeEntityType,
    entityId: String(row[2]),
    changeType: String(row[3]),
    serverRevision: Number(row[4]),
    changedAt: String(row[5]),
    ...(title === undefined ? {} : { title }),
    ...(relativePath === undefined ? {} : { relativePath }),
    bodyAvailable: row[8] === 1,
    metadata: parseSyncMetadata(typeof row[9] === "string" ? row[9] : null) ?? {},
  }
}

function assertWorkspace(expectedWorkspaceId: string, receivedWorkspaceId: string): void {
  if (receivedWorkspaceId !== expectedWorkspaceId) {
    throw new UsageError(`Sync workspaceId mismatch.`, {
      hint: `Expected workspaceId '${expectedWorkspaceId}' but received '${receivedWorkspaceId}'.`,
    })
  }
}

function queueAiWork(queueAiWork: SyncServerAiQueue | undefined, noteId: string): void {
  if (queueAiWork === undefined) {
    return
  }

  Promise.resolve()
    .then(() => queueAiWork({ noteId, reason: "sync-push" }))
    .catch(() => undefined)
}

export function createSyncServerService(options: CreateSyncServerServiceOptions): SyncServerService {
  const rootPath = path.resolve(options.rootPath)
  const dbIdentity: EnsureSyncDatabaseOptions = { role: "server", workspaceId: options.workspaceId }

  return {
    acceptPush(request) {
      assertWorkspace(options.workspaceId, request.workspaceId)
      const accepted = []
      const rejected = []
      const aiNoteIds: string[] = []
      const appliedChanges: AppliedChange[] = []

      for (const record of request.records) {
        try {
          const serverRevision = withSyncDatabase(rootPath, dbIdentity, (handle) => latestServerRevision(handle, record.entityType, record.entityId)) + 1
          const changedAt = new Date().toISOString()

          if (record.entityType === "note" && record.dirtyType === "upsert") {
            const body = request.noteBodies?.[record.entityId]
            if (typeof body !== "string") {
              throw new UsageError(`Missing note body for pushed note '${record.entityId}'.`, {
                hint: "Include noteBodies[noteId] when pushing note upserts to the in-process sync server.",
              })
            }
            const metadata = upsertNote(rootPath, record, body)
            const changeMetadata = metadataWithoutBody({
              ...record.metadata,
              ...(metadata.contentHash === undefined ? {} : { contentHash: metadata.contentHash }),
              ...(metadata.byteLength === undefined ? {} : { byteLength: metadata.byteLength }),
            })
            appliedChanges.push({
              entityType: "note",
              entityId: record.entityId,
              changeType: "upsert",
              serverRevision,
              changedAt,
              sourceReplicaId: request.replicaId,
              title: metadata.title,
              relativePath: metadata.relativePath,
              bodyAvailable: true,
              metadata: changeMetadata,
            })
            aiNoteIds.push(record.entityId)
          } else if (record.entityType === "note" && record.dirtyType === "delete") {
            const deletion = deleteNote(rootPath, record)
            appliedChanges.push({
              entityType: "note",
              entityId: record.entityId,
              changeType: "delete",
              serverRevision,
              changedAt,
              sourceReplicaId: request.replicaId,
              title: deletion.title,
              relativePath: deletion.relativePath,
              bodyAvailable: false,
              metadata: deletion.metadata,
            })
          } else {
            throw new UsageError(`Unsupported sync push record '${record.entityType}:${record.dirtyType}'.`, {
              hint: "Task 11 implements note upsert/delete server handling only.",
            })
          }

          accepted.push({ entityType: record.entityType, entityId: record.entityId, serverRevision })
        } catch (error) {
          rejected.push({
            entityType: record.entityType,
            entityId: record.entityId,
            code: "PUSH_REJECTED",
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }

      const serverSequence = withSyncDatabase(rootPath, dbIdentity, (handle) => {
        handle.db.run("BEGIN IMMEDIATE TRANSACTION")
        try {
          for (const change of appliedChanges) {
            insertServerChange(handle, options.workspaceId, change)
          }
          const latestSequence = latestServerSequence(handle)
          handle.db.run("COMMIT")
          return latestSequence
        } catch (error) {
          try {
            handle.db.run("ROLLBACK")
          } catch {
            // Preserve the original error.
          }
          throw error
        }
      }, { save: true })

      for (const noteId of aiNoteIds) {
        queueAiWork(options.queueAiWork, noteId)
      }

      return {
        accepted,
        replacedByServer: [],
        rejected,
        serverSequence,
      }
    },

    getChanges(request) {
      assertWorkspace(options.workspaceId, request.workspaceId)
      return withSyncDatabase(rootPath, dbIdentity, (handle) => {
        const rows = handle.db.exec(
          `
            SELECT sequence, entityType, entityId, changeType, serverRevision, changedAt, title, relativePath, bodyAvailable, metadataJson
            FROM server_changes
            WHERE workspaceId = ? AND sequence > ?
            ORDER BY sequence ASC
            LIMIT ?
          `,
          [options.workspaceId, request.sinceSequence, request.limit + 1],
        )[0]?.values ?? []
        const hasMore = rows.length > request.limit
        const visibleRows = hasMore ? rows.slice(0, request.limit) : rows
        const changes = visibleRows.map(toChangeView)
        const toSequence = changes.length === 0 ? request.sinceSequence : changes[changes.length - 1].sequence

        return {
          workspaceId: options.workspaceId,
          fromSequence: request.sinceSequence,
          toSequence,
          hasMore,
          changes,
        }
      })
    },

    downloadNoteBody(noteId) {
      const sidecar = createSidecarRepository(rootPath).readByNoteId(noteId)
      const notePath = assertPathInsideRoot(rootPath, path.join(rootPath, sidecar.relativePath))
      const body = createNoteRepository(rootPath).read(notePath).body
      const metadataRows = withSyncDatabase(rootPath, dbIdentity, (handle) => handle.db.exec(
        `
          SELECT metadataJson
          FROM server_changes
          WHERE workspaceId = ? AND entityType = 'note' AND entityId = ? AND changeType = 'upsert'
          ORDER BY sequence DESC
          LIMIT 1
        `,
        [options.workspaceId, noteId],
      )[0]?.values ?? [])
      const metadata = parseSyncMetadata(typeof metadataRows[0]?.[0] === "string" ? metadataRows[0][0] : null) ?? {}
      const contentHash = stringMetadata(metadata, "contentHash") ?? stringMetadata(metadata, "hash") ?? undefined
      const byteLength = numberMetadata(metadata, "byteLength") ?? undefined

      return {
        workspaceId: options.workspaceId,
        noteId,
        ...(contentHash === undefined ? {} : { contentHash }),
        ...(byteLength === undefined ? {} : { byteLength }),
        body,
      }
    },
  }
}
