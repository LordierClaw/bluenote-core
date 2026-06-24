import path from "node:path"
import fs from "node:fs"

import { STATE_NOTES_DIRECTORY } from "../config/root"
import { UsageError } from "../core/errors"
import { createNoteDescription } from "../domain/note-description"
import { assertPathInsideRoot, toRootRelativePath } from "../platform/path-safety"
import { createNoteRepository } from "../storage/note-repository"
import { serializePlainNote } from "../storage/plain-note"
import { createSidecarRepository } from "../storage/sidecar-repository"
import type { NoteSidecar } from "../storage/sidecar-schema"
import { getDraftNotesPath, getNormalNotesPath } from "../storage/root-layout"
import type {
  DownloadNoteBodyResponse,
  PullChangesRequest,
  PullChangesResponse,
  PushAcceptedRecord,
  PushRejectedRecord,
  PushRequest,
  PushResponse,
  SyncChangeEntityType,
  SyncChangeView,
  SyncPushRecord,
} from "./protocol"
import { isPullChangesRequest, isPushRequest } from "./protocol"
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
  downloadNoteBody(noteId: string, request?: { workspaceId?: string }): DownloadNoteBodyResponse
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

interface FileSnapshot {
  filePath: string
  existed: boolean
  content: Buffer | null
}

interface MutationResult<T> {
  value: T
  rollback: () => void
}

function stringMetadata(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key]
  return typeof value === "string" ? value : null
}

function numberMetadata(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function objectMetadata(metadata: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = metadata[key]
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function basenameKeyFromRelativePath(relativePath: string): string {
  return path.posix.basename(relativePath, ".md")
}

function normalizeRelativePath(relativePath: string, rootPath: string): string {
  const portableRelativePath = relativePath.replace(/\\/g, "/").replace(/^\.\//, "")
  const isSyncNotePath = portableRelativePath.startsWith("note/") || portableRelativePath.startsWith("draft/")
  if (!isSyncNotePath || !portableRelativePath.endsWith(".md")) {
    throw new UsageError(`Invalid sync note relativePath '${relativePath}'.`, {
      hint: "Note sync pushes must target Markdown files under note/ or draft/.",
    })
  }

  const absolutePath = assertPathInsideRoot(rootPath, path.join(rootPath, portableRelativePath))
  const allowedRoot = portableRelativePath.startsWith("draft/") ? getDraftNotesPath(rootPath) : getNormalNotesPath(rootPath)
  assertPathInsideRoot(allowedRoot, absolutePath)
  return toRootRelativePath(rootPath, absolutePath)
}

function normalizeFolderRelativePath(relativePath: string, rootPath: string): string {
  const portableRelativePath = relativePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/u, "")
  if (portableRelativePath !== "note" && !portableRelativePath.startsWith("note/")) {
    throw new UsageError(`Invalid sync folder relativePath '${relativePath}'.`, {
      hint: "Folder sync pushes must target folders under note/.",
    })
  }
  if (portableRelativePath.endsWith(".md")) {
    throw new UsageError(`Invalid sync folder relativePath '${relativePath}'.`, {
      hint: "Folder sync pushes must target directories, not Markdown note files.",
    })
  }

  const absolutePath = assertPathInsideRoot(rootPath, path.join(rootPath, portableRelativePath))
  const normalNotesPath = getNormalNotesPath(rootPath)
  assertPathInsideRoot(normalNotesPath, absolutePath)
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

function snapshotFiles(filePaths: string[]): FileSnapshot[] {
  const uniquePaths = Array.from(new Set(filePaths))
  return uniquePaths.map((filePath) => ({
    filePath,
    existed: fs.existsSync(filePath),
    content: fs.existsSync(filePath) ? fs.readFileSync(filePath) : null,
  }))
}

function restoreFileSnapshots(snapshots: FileSnapshot[]): void {
  for (const snapshot of [...snapshots].reverse()) {
    try {
      if (snapshot.existed) {
        fs.mkdirSync(path.dirname(snapshot.filePath), { recursive: true })
        fs.writeFileSync(snapshot.filePath, snapshot.content ?? Buffer.alloc(0))
      } else {
        fs.rmSync(snapshot.filePath, { force: true })
      }
    } catch {
      // Best-effort rollback: preserve the original sync error.
    }
  }
}

function assertExistingPathIsNotSymlink(filePath: string, relativeLabel: string): void {
  try {
    if (fs.lstatSync(filePath).isSymbolicLink()) {
      throw new UsageError(`Sync note path '${relativeLabel}' must not be a symlink.`, {
        hint: "Remove symlinks from BlueNote-managed note paths before syncing.",
      })
    }
  } catch (error) {
    if (error instanceof UsageError) {
      throw error
    }
    if (typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return
    }
    throw error
  }
}

function assertPathAndParentsAreNotSymlinks(rootPath: string, targetPath: string): void {
  const normalizedRootPath = path.resolve(rootPath)
  const normalizedTargetPath = assertPathInsideRoot(normalizedRootPath, targetPath)
  const relativePath = path.relative(normalizedRootPath, normalizedTargetPath)
  const parts = relativePath === "" ? [] : relativePath.split(path.sep).filter(Boolean)
  let currentPath = normalizedRootPath

  assertExistingPathIsNotSymlink(currentPath, path.relative(normalizedRootPath, currentPath) || ".")
  for (const part of parts) {
    currentPath = path.join(currentPath, part)
    assertExistingPathIsNotSymlink(currentPath, path.relative(normalizedRootPath, currentPath))
  }
}

function makeRollback(snapshots: FileSnapshot[]): () => void {
  return () => restoreFileSnapshots(snapshots)
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

function ensureSyncNoteFolder(rootPath: string, relativePath: string): void {
  if (relativePath.startsWith("draft/")) {
    assertPathAndParentsAreNotSymlinks(rootPath, getDraftNotesPath(rootPath))
    fs.mkdirSync(getDraftNotesPath(rootPath), { recursive: true })
    return
  }
  const folderRelativePath = path.posix.dirname(relativePath)
  const folderPath = assertPathInsideRoot(rootPath, path.join(rootPath, folderRelativePath))
  const normalNotesPath = getNormalNotesPath(rootPath)
  assertPathInsideRoot(normalNotesPath, folderPath)
  assertPathAndParentsAreNotSymlinks(rootPath, folderPath)
  fs.mkdirSync(folderPath, { recursive: true })
}

function createDestinationForRelativePath(relativePath: string): { type: "draft" } | { type: "normal"; folderRelativePath: string } {
  return relativePath.startsWith("draft/")
    ? { type: "draft" }
    : { type: "normal", folderRelativePath: path.posix.dirname(relativePath) }
}

function noteTypeForRelativePath(relativePath: string): "draft" | "normal" {
  return relativePath.startsWith("draft/") ? "draft" : "normal"
}

function readSidecarIfExists(rootPath: string, noteId: string): NoteSidecar | null {
  const sidecars = createSidecarRepository(rootPath)
  if (!fs.existsSync(sidecars.getSidecarPathByNoteId(noteId))) {
    return null
  }
  return sidecars.readByNoteId(noteId)
}

function findNoteIdByRelativePath(rootPath: string, relativePath: string): string | null {
  const stateNotesPath = assertPathInsideRoot(rootPath, path.join(rootPath, STATE_NOTES_DIRECTORY))
  if (!fs.existsSync(stateNotesPath)) {
    return null
  }

  for (const entry of fs.readdirSync(stateNotesPath, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(stateNotesPath, entry.name), "utf8")) as unknown
      if (typeof parsed === "object" && parsed !== null && (parsed as { relativePath?: unknown }).relativePath === relativePath) {
        const noteId = (parsed as { noteId?: unknown }).noteId
        return typeof noteId === "string" ? noteId : path.basename(entry.name, ".json")
      }
    } catch {
      // Ignore unrelated malformed sidecars here; direct sidecar reads still validate when targeted.
    }
  }

  return null
}

function assertRelativePathAvailable(rootPath: string, relativePath: string, ownerNoteId: string): void {
  const existingOwner = findNoteIdByRelativePath(rootPath, relativePath)
  if (existingOwner !== null && existingOwner !== ownerNoteId) {
    throw new UsageError(`Cannot sync note '${ownerNoteId}' to '${relativePath}'.`, {
      hint: `The destination path is already owned by note '${existingOwner}'.`,
    })
  }
}

function assertValidPushRequest(request: SyncServerPushRequest): void {
  if (!isPushRequest(request)) {
    throw new UsageError("Invalid sync push request.", {
      hint: "Pass a workspaceId, replicaId, baseSequence, and protocol-valid push records.",
    })
  }

  if (request.noteBodies !== undefined) {
    const noteBodies = request.noteBodies as unknown
    if (typeof noteBodies !== "object" || noteBodies === null || Array.isArray(noteBodies)) {
      throw new UsageError("Invalid sync push noteBodies.", {
        hint: "Pass noteBodies as an object keyed by note ID.",
      })
    }
    for (const [noteId, body] of Object.entries(noteBodies)) {
      if (typeof noteId !== "string" || typeof body !== "string") {
        throw new UsageError("Invalid sync push note body.", {
          hint: "Each noteBodies entry must be a string body keyed by note ID.",
        })
      }
    }
  }
}

function assertValidPullRequest(request: PullChangesRequest): void {
  if (!isPullChangesRequest(request)) {
    throw new UsageError("Invalid sync pull changes request.", {
      hint: "Pass workspaceId, a non-negative sinceSequence, and a positive limit.",
    })
  }
}

function upsertNote(rootPath: string, record: SyncPushRecord, body: string): MutationResult<NoteMetadata> {
  const metadata = noteMetadataFromPush(rootPath, record)
  const repository = createNoteRepository(rootPath)
  const sidecars = createSidecarRepository(rootPath)
  const sidecar = readSidecarIfExists(rootPath, record.entityId)
  const ai = objectMetadata(record.metadata, "ai") as NoteSidecar["ai"] | undefined
  const targetPath = assertPathInsideRoot(rootPath, path.join(rootPath, metadata.relativePath))
  const sidecarPath = sidecars.getSidecarPathByNoteId(record.entityId)
  const existingPath = sidecar === null ? null : assertPathInsideRoot(rootPath, path.join(rootPath, sidecar.relativePath))
  const snapshots = snapshotFiles([targetPath, sidecarPath, ...(existingPath === null ? [] : [existingPath])])
  const rollback = makeRollback(snapshots)

  try {
    ensureSyncNoteFolder(rootPath, metadata.relativePath)
    assertRelativePathAvailable(rootPath, metadata.relativePath, record.entityId)
    assertPathAndParentsAreNotSymlinks(rootPath, targetPath)

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
        destination: createDestinationForRelativePath(metadata.relativePath),
      })
      if (ai !== undefined) {
        sidecars.write({ ...sidecars.readByNoteId(record.entityId), ai })
      }
    } else {
      if (sidecar.relativePath !== metadata.relativePath || sidecar.key !== metadata.key) {
        const nextPath = targetPath
        if (nextPath !== existingPath && fs.existsSync(nextPath)) {
          throw new UsageError(`Cannot sync note '${record.entityId}' to '${metadata.relativePath}'.`, {
            hint: "The destination Markdown file already exists.",
          })
        }
        fs.mkdirSync(path.dirname(nextPath), { recursive: true })
        fs.writeFileSync(nextPath, serializePlainNote({ body, sourcePath: metadata.relativePath }), "utf8")
        if (nextPath !== existingPath && existingPath !== null && fs.existsSync(existingPath)) {
          fs.rmSync(existingPath)
        }
        sidecars.write({
          ...sidecar,
          type: noteTypeForRelativePath(metadata.relativePath),
          key: metadata.key,
          title: metadata.title,
          description: createNoteDescription(body),
          relativePath: metadata.relativePath,
          updatedAt: metadata.updatedAt,
          ...(ai === undefined ? {} : { ai }),
        })
      } else {
        repository.syncEditedNote(existingPath ?? targetPath, {
          title: metadata.title,
          body,
          updatedAt: metadata.updatedAt,
        })
        if (ai !== undefined) {
          sidecars.write({ ...sidecars.readByNoteId(record.entityId), ai })
        }
      }
    }
  } catch (error) {
    rollback()
    throw error
  }

  return { value: metadata, rollback }
}

function deleteNote(rootPath: string, record: SyncPushRecord): MutationResult<{ title: string | null; relativePath: string | null; metadata: Record<string, unknown> }> {
  const pushedMetadata = metadataWithoutBody(record.metadata)
  const existingSidecar = readSidecarIfExists(rootPath, record.entityId)
  const title = stringMetadata(pushedMetadata, "title") ?? existingSidecar?.title ?? null
  const pushedRelativePath = stringMetadata(pushedMetadata, "relativePath")
  const relativePath = pushedRelativePath === null ? existingSidecar?.relativePath ?? null : normalizeRelativePath(pushedRelativePath, rootPath)
  const sidecars = createSidecarRepository(rootPath)
  const notePath = existingSidecar === null ? null : assertPathInsideRoot(rootPath, path.join(rootPath, existingSidecar.relativePath))
  const sidecarPath = sidecars.getSidecarPathByNoteId(record.entityId)
  const snapshots = snapshotFiles([sidecarPath, ...(notePath === null ? [] : [notePath])])
  const rollback = makeRollback(snapshots)

  try {
    if (existingSidecar !== null && notePath !== null) {
      assertPathAndParentsAreNotSymlinks(rootPath, notePath)
      assertPathAndParentsAreNotSymlinks(rootPath, sidecarPath)
      if (fs.existsSync(notePath)) {
        createNoteRepository(rootPath).delete(notePath)
      } else if (fs.existsSync(sidecarPath)) {
        fs.rmSync(sidecarPath)
      }
    }
  } catch (error) {
    rollback()
    throw error
  }

  return {
    value: {
      title,
      relativePath,
      metadata: {
        deletedAt: record.clientUpdatedAt,
        previousRelativePath: relativePath,
        previousTitle: title,
      },
    },
    rollback,
  }
}

function applyFolderPush(
  rootPath: string,
  handle: SyncDatabaseHandle,
  record: SyncPushRecord,
): MutationResult<{ relativePath: string; deletedAt: string | null; metadata: Record<string, unknown> }> {
  const relativePath = normalizeFolderRelativePath(stringMetadata(record.metadata, "relativePath") ?? record.entityId, rootPath)
  const deletedAt = record.dirtyType === "folder-delete" ? record.clientUpdatedAt : null
  const folderPath = assertPathInsideRoot(rootPath, path.join(rootPath, relativePath))
  const existed = fs.existsSync(folderPath)
  assertPathAndParentsAreNotSymlinks(rootPath, folderPath)

  if (record.dirtyType === "folder-upsert") {
    fs.mkdirSync(folderPath, { recursive: true })
  }

  handle.db.run(
    `
      INSERT INTO folders (relativePath, createdAt, updatedAt, deletedAt)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(relativePath) DO UPDATE SET
        updatedAt = excluded.updatedAt,
        deletedAt = excluded.deletedAt
    `,
    [relativePath, record.clientUpdatedAt, record.clientUpdatedAt, deletedAt],
  )

  return {
    value: {
      relativePath,
      deletedAt,
      metadata: {
        relativePath,
        ...(deletedAt === null ? {} : { deletedAt }),
      },
    },
    rollback() {
      if (!existed && record.dirtyType === "folder-upsert") {
        try {
          fs.rmdirSync(folderPath)
        } catch {
          // Best-effort rollback: preserve original sync error.
        }
      }
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
  const sourceReplicaId = typeof row[10] === "string" ? row[10] : undefined
  return {
    sequence: Number(row[0]),
    entityType: String(row[1]) as SyncChangeEntityType,
    entityId: String(row[2]),
    changeType: String(row[3]),
    serverRevision: Number(row[4]),
    changedAt: String(row[5]),
    ...(sourceReplicaId === undefined ? {} : { sourceReplicaId }),
    ...(title === undefined ? {} : { title }),
    ...(relativePath === undefined ? {} : { relativePath }),
    bodyAvailable: row[8] === 1,
    metadata: parseSyncMetadata(typeof row[9] === "string" ? row[9] : null) ?? {},
  }
}

function assertWorkspace(expectedWorkspaceId: string, receivedWorkspaceId: string | undefined): void {
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
      assertValidPushRequest(request)
      assertWorkspace(options.workspaceId, request.workspaceId)
      const aiNoteIds: string[] = []
      const acceptedRollbacks: Array<() => void> = []

      let response: PushResponse
      try {
        response = withSyncDatabase(rootPath, dbIdentity, (handle) => {
        const accepted: PushAcceptedRecord[] = []
        const rejected: PushRejectedRecord[] = []

        handle.db.run("BEGIN IMMEDIATE TRANSACTION")
        try {
          const latestRevisions = new Map<string, number>()

          for (const record of request.records) {
            let rollbackRecord = (): void => undefined
            try {
              const changedAt = new Date().toISOString()
              let appliedChange: AppliedChange

              if (record.entityType === "note" && record.dirtyType === "upsert") {
                const body = request.noteBodies?.[record.entityId]
                if (typeof body !== "string") {
                  throw new UsageError(`Missing note body for pushed note '${record.entityId}'.`, {
                    hint: "Include noteBodies[noteId] when pushing note upserts to the in-process sync server.",
                  })
                }
                const mutation = upsertNote(rootPath, record, body)
                rollbackRecord = mutation.rollback
                const metadata = mutation.value
                const changeMetadata = metadataWithoutBody({
                  ...record.metadata,
                  ...(metadata.contentHash === undefined ? {} : { contentHash: metadata.contentHash }),
                  ...(metadata.byteLength === undefined ? {} : { byteLength: metadata.byteLength }),
                })
                appliedChange = {
                  entityType: "note",
                  entityId: record.entityId,
                  changeType: "upsert",
                  serverRevision: 0,
                  changedAt,
                  sourceReplicaId: request.replicaId,
                  title: metadata.title,
                  relativePath: metadata.relativePath,
                  bodyAvailable: true,
                  metadata: changeMetadata,
                }
              } else if (record.entityType === "note" && record.dirtyType === "delete") {
                const deletionMutation = deleteNote(rootPath, record)
                rollbackRecord = deletionMutation.rollback
                const deletion = deletionMutation.value
                appliedChange = {
                  entityType: "note",
                  entityId: record.entityId,
                  changeType: "delete",
                  serverRevision: 0,
                  changedAt,
                  sourceReplicaId: request.replicaId,
                  title: deletion.title,
                  relativePath: deletion.relativePath,
                  bodyAvailable: false,
                  metadata: deletion.metadata,
                }
              } else if (record.entityType === "folder" && (record.dirtyType === "folder-upsert" || record.dirtyType === "folder-delete")) {
                const folderMutation = applyFolderPush(rootPath, handle, record)
                rollbackRecord = folderMutation.rollback
                const folder = folderMutation.value
                appliedChange = {
                  entityType: "folder",
                  entityId: folder.relativePath,
                  changeType: record.dirtyType,
                  serverRevision: 0,
                  changedAt,
                  sourceReplicaId: request.replicaId,
                  title: null,
                  relativePath: folder.relativePath,
                  bodyAvailable: false,
                  metadata: folder.metadata,
                }
              } else {
                throw new UsageError(`Unsupported sync push record '${record.entityType}:${record.dirtyType}'.`, {
                  hint: "Task 11 implements note upsert/delete server handling only.",
                })
              }

              const revisionKey = `${appliedChange.entityType}\u0000${appliedChange.entityId}`
              const previousRevision = latestRevisions.get(revisionKey) ?? latestServerRevision(handle, appliedChange.entityType, appliedChange.entityId)
              const serverRevision = previousRevision + 1
              latestRevisions.set(revisionKey, serverRevision)
              appliedChange.serverRevision = serverRevision
              insertServerChange(handle, options.workspaceId, appliedChange)
              accepted.push({ entityType: record.entityType, entityId: record.entityId, serverRevision })
              acceptedRollbacks.push(rollbackRecord)
              if (record.entityType === "note" && record.dirtyType === "upsert") {
                aiNoteIds.push(record.entityId)
              }
            } catch (error) {
              rollbackRecord()
              rejected.push({
                entityType: record.entityType,
                entityId: record.entityId,
                code: "PUSH_REJECTED",
                message: error instanceof Error ? error.message : String(error),
              })
            }
          }

          const latestSequence = latestServerSequence(handle)
          handle.db.run("COMMIT")
          return {
            accepted,
            replacedByServer: [],
            rejected,
            serverSequence: latestSequence,
          }
        } catch (error) {
          try {
            handle.db.run("ROLLBACK")
          } catch {
            // Preserve the original error.
          }
          throw error
        }
      }, { save: true })
      } catch (error) {
      for (const rollback of [...acceptedRollbacks].reverse()) {
        rollback()
      }
      throw error
      }

      for (const noteId of aiNoteIds) {
        queueAiWork(options.queueAiWork, noteId)
      }

      return response
    },

    getChanges(request) {
      assertValidPullRequest(request)
      assertWorkspace(options.workspaceId, request.workspaceId)
      return withSyncDatabase(rootPath, dbIdentity, (handle) => {
        const rows = handle.db.exec(
          `
            SELECT sequence, entityType, entityId, changeType, serverRevision, changedAt, title, relativePath, bodyAvailable, metadataJson, sourceReplicaId
            FROM server_changes AS changes
            WHERE workspaceId = ? AND sequence > ?
              AND NOT EXISTS (
                SELECT 1
                FROM server_changes AS newer
                WHERE newer.workspaceId = changes.workspaceId
                  AND newer.entityType = changes.entityType
                  AND newer.entityId = changes.entityId
                  AND newer.sequence > changes.sequence
              )
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

    downloadNoteBody(noteId, request) {
      assertWorkspace(options.workspaceId, request?.workspaceId)
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
