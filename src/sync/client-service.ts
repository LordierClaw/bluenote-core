import path from "node:path"
import fs from "node:fs"

import { createNoteDescription } from "../domain/note-description"
import { UsageError } from "../core/errors"
import { assertPathInsideRoot, toRootRelativePath } from "../platform/path-safety"
import { createNoteRepository } from "../storage/note-repository"
import { serializePlainNote } from "../storage/plain-note"
import { getStateNotesPath } from "../storage/root-layout"
import { createSidecarRepository } from "../storage/sidecar-repository"
import type { NoteSidecar } from "../storage/sidecar-schema"
import { createDirtyRecordRepository } from "./dirty-repository"
import type { DirtyRecord } from "./dirty-repository"
import type { SyncTransport } from "./core-sync"
import type { SyncChangeView, SyncPushRecord, PushRequest, PushResponse } from "./protocol"
import { type EnsureSyncDatabaseOptions, withSyncDatabase } from "./sync-db"
import type { SyncNowSummary } from "./types"

export interface CreateSyncClientServiceOptions {
  rootPath: string
  workspaceId: string
  replicaId?: string
  transport: SyncTransport
  pullLimit?: number
}

export interface SyncClientService {
  syncNow(): SyncNowSummary
}

type PushRequestWithBodies = PushRequest & { noteBodies?: Record<string, string> }

interface FileSnapshot {
  filePath: string
  existed: boolean
  content: Buffer | null
}

function metadataString(metadata: Record<string, unknown> | null, key: string): string | null {
  const value = metadata?.[key]
  return typeof value === "string" ? value : null
}

function basenameKey(relativePath: string): string {
  return path.posix.basename(relativePath, ".md")
}

function assertMetadataKeyMatchesRelativePath(key: string, relativePath: string): void {
  if (key !== basenameKey(relativePath)) {
    throw new UsageError("Pulled note metadata key must match the relativePath basename.", {
      hint: "Rejecting inconsistent server note metadata to avoid writing a note to the wrong local path.",
    })
  }
}

function normalizeNoteRelativePath(rootPath: string, relativePath: string): string {
  const portableRelativePath = relativePath.replace(/\\/g, "/").replace(/^\.\//, "")
  if (!portableRelativePath.startsWith("note/") || !portableRelativePath.endsWith(".md")) {
    throw new Error(`Invalid pulled note relativePath '${relativePath}'.`)
  }
  const normalizedRelativePath = toRootRelativePath(rootPath, assertPathInsideRoot(rootPath, path.join(rootPath, portableRelativePath)))
  if (!normalizedRelativePath.startsWith("note/") || !normalizedRelativePath.endsWith(".md")) {
    throw new Error(`Invalid pulled note relativePath '${relativePath}'.`)
  }
  return normalizedRelativePath
}

function snapshotFile(filePath: string): FileSnapshot {
  if (!fs.existsSync(filePath)) {
    return { filePath, existed: false, content: null }
  }
  return { filePath, existed: true, content: fs.readFileSync(filePath) }
}

function restoreFileSnapshots(snapshots: FileSnapshot[]): void {
  for (const snapshot of [...snapshots].reverse()) {
    if (snapshot.existed) {
      fs.mkdirSync(path.dirname(snapshot.filePath), { recursive: true })
      fs.writeFileSync(snapshot.filePath, snapshot.content ?? Buffer.alloc(0))
    } else {
      fs.rmSync(snapshot.filePath, { force: true })
    }
  }
}

function readLastPulledSequence(rootPath: string, identity: EnsureSyncDatabaseOptions, replicaId: string): number {
  return withSyncDatabase(rootPath, identity, (handle) => {
    const rows = handle.db.exec("SELECT lastPulledSequence FROM replicas WHERE replicaId = ?", [replicaId])[0]?.values ?? []
    const value = rows[0]?.[0]
    return typeof value === "number" ? value : 0
  })
}

function writeReplicaProgress(rootPath: string, identity: EnsureSyncDatabaseOptions, replicaId: string, sequence: number, pushedAt?: string): void {
  withSyncDatabase(rootPath, identity, (handle) => {
    handle.db.run(
      `
        INSERT INTO replicas (replicaId, workspaceId, lastSeenAt, lastPulledSequence, lastPushedAt, status)
        VALUES (?, ?, ?, ?, ?, 'active')
        ON CONFLICT(replicaId) DO UPDATE SET
          workspaceId = excluded.workspaceId,
          lastSeenAt = excluded.lastSeenAt,
          lastPulledSequence = excluded.lastPulledSequence,
          lastPushedAt = COALESCE(excluded.lastPushedAt, replicas.lastPushedAt),
          status = 'active'
      `,
      [replicaId, identity.workspaceId, new Date().toISOString(), sequence, pushedAt ?? null],
    )
  }, { save: true })
}

function readSidecarIfExists(rootPath: string, noteId: string): NoteSidecar | null {
  const sidecars = createSidecarRepository(rootPath)
  if (!fs.existsSync(sidecars.getSidecarPathByNoteId(noteId))) {
    return null
  }
  return sidecars.readByNoteId(noteId)
}

function findSidecarOwnerForRelativePath(rootPath: string, relativePath: string): string | null {
  const stateNotesPath = getStateNotesPath(rootPath)
  const sidecars = createSidecarRepository(rootPath)
  if (!fs.existsSync(stateNotesPath)) {
    return null
  }

  for (const entry of fs.readdirSync(stateNotesPath, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue
    }
    const noteId = path.basename(entry.name, ".json")
    const sidecar = sidecars.readByNoteId(noteId)
    if (sidecar.relativePath === relativePath) {
      return sidecar.noteId ?? noteId
    }
  }

  return null
}

function assertPulledNotePathAvailable(rootPath: string, relativePath: string, noteId: string): void {
  const owner = findSidecarOwnerForRelativePath(rootPath, relativePath)
  if (owner !== null && owner !== noteId) {
    throw new UsageError(`Pulled note path '${relativePath}' is already owned by another note.`, {
      hint: "Rejecting pulled note relocation to avoid overwriting local note content.",
    })
  }

  const notePath = assertPathInsideRoot(rootPath, path.join(rootPath, relativePath))
  if (fs.existsSync(notePath) && owner !== noteId) {
    throw new UsageError(`Pulled note path '${relativePath}' already exists.`, {
      hint: "Rejecting pulled note to avoid overwriting an existing local Markdown file.",
    })
  }
}

function applyPulledNoteUpsert(rootPath: string, change: SyncChangeView, body: string): void {
  const notes = createNoteRepository(rootPath)
  const sidecars = createSidecarRepository(rootPath)
  const existingSidecar = readSidecarIfExists(rootPath, change.entityId)
  const relativePath = normalizeNoteRelativePath(rootPath, metadataString(change.metadata, "relativePath") ?? change.relativePath ?? `note/${change.entityId}.md`)
  const key = metadataString(change.metadata, "key") ?? basenameKey(relativePath)
  assertMetadataKeyMatchesRelativePath(key, relativePath)
  assertPulledNotePathAvailable(rootPath, relativePath, change.entityId)
  const title = metadataString(change.metadata, "title") ?? change.title ?? key
  const updatedAt = metadataString(change.metadata, "updatedAt") ?? change.changedAt
  const createdAt = metadataString(change.metadata, "createdAt") ?? updatedAt
  const notePath = assertPathInsideRoot(rootPath, path.join(rootPath, relativePath))

  if (existingSidecar === null) {
    fs.mkdirSync(path.dirname(notePath), { recursive: true })
    notes.create({
      noteId: change.entityId,
      body,
      frontmatter: {
        id: key,
        schemaVersion: 1,
        title,
        mode: "plain",
        tags: [],
        createdAt,
        updatedAt,
      },
      destination: { type: "normal", folderRelativePath: path.posix.dirname(relativePath) },
    })
    return
  }

  const existingPath = assertPathInsideRoot(rootPath, path.join(rootPath, existingSidecar.relativePath))
  if (existingSidecar.relativePath === relativePath && existingSidecar.key === key) {
    notes.syncEditedNote(existingPath, { title, body, updatedAt })
    return
  }

  const snapshots = [snapshotFile(notePath), snapshotFile(existingPath), snapshotFile(sidecars.getSidecarPathByNoteId(change.entityId))]
  try {
    fs.mkdirSync(path.dirname(notePath), { recursive: true })
    fs.writeFileSync(notePath, serializePlainNote({ sourcePath: relativePath, body }), "utf8")
    if (existingPath !== notePath && fs.existsSync(existingPath)) {
      fs.rmSync(existingPath, { force: true })
    }
    sidecars.write({
      ...existingSidecar,
      key,
      title,
      description: createNoteDescription(body),
      relativePath,
      updatedAt,
    })
  } catch (error) {
    restoreFileSnapshots(snapshots)
    throw error
  }
}

function applyPulledNoteDelete(rootPath: string, change: SyncChangeView): void {
  const sidecar = readSidecarIfExists(rootPath, change.entityId)
  if (sidecar === null) {
    return
  }
  const notePath = assertPathInsideRoot(rootPath, path.join(rootPath, sidecar.relativePath))
  if (fs.existsSync(notePath)) {
    createNoteRepository(rootPath).delete(notePath)
  } else {
    fs.rmSync(createSidecarRepository(rootPath).getSidecarPathByNoteId(change.entityId), { force: true })
  }
}

function applyPulledChange(rootPath: string, change: SyncChangeView, transport: SyncTransport): boolean {
  if (change.entityType !== "note") {
    return false
  }
  if (change.changeType === "delete") {
    applyPulledNoteDelete(rootPath, change)
    return true
  }
  if (change.changeType !== "upsert") {
    return false
  }
  if (change.bodyAvailable === false) {
    throw new UsageError("Pulled note upsert is missing an available body.", {
      hint: "Note upsert changes must provide a downloadable body before local content can be replaced.",
    })
  }
  const body = transport.downloadNoteBody(change.entityId).body
  applyPulledNoteUpsert(rootPath, change, body)
  return true
}

function toProtocolDirtyType(record: DirtyRecord): SyncPushRecord["dirtyType"] {
  if (record.entityType === "folder") {
    return record.dirtyType === "delete" || record.dirtyType === "folder-delete" ? "folder-delete" : "folder-upsert"
  }
  return record.dirtyType as SyncPushRecord["dirtyType"]
}

function toPushRecord(record: DirtyRecord): SyncPushRecord {
  return {
    entityType: record.entityType as SyncPushRecord["entityType"],
    entityId: record.entityId,
    dirtyType: toProtocolDirtyType(record),
    clientUpdatedAt: record.markedAt,
    metadata: record.metadata ?? {},
  }
}

function buildPushRequest(rootPath: string, workspaceId: string, replicaId: string, baseSequence: number, records: DirtyRecord[]): PushRequestWithBodies {
  const noteBodies: Record<string, string> = {}
  const pushRecords = records.map((record) => {
    if (record.entityType === "note" && record.dirtyType === "upsert") {
      const sidecar = readSidecarIfExists(rootPath, record.entityId)
      const relativePath = sidecar?.relativePath ?? metadataString(record.metadata, "relativePath")
      if (relativePath !== null) {
        const notePath = assertPathInsideRoot(rootPath, path.join(rootPath, relativePath))
        noteBodies[record.entityId] = createNoteRepository(rootPath).read(notePath).body
      }
    }
    return toPushRecord(record)
  })

  return {
    workspaceId,
    replicaId,
    baseSequence,
    records: pushRecords,
    ...(Object.keys(noteBodies).length === 0 ? {} : { noteBodies }),
  }
}

function clearAcceptedDirty(rootPath: string, identity: EnsureSyncDatabaseOptions, response: PushResponse): void {
  const dirty = createDirtyRecordRepository(rootPath, identity)
  for (const record of [...response.accepted, ...response.replacedByServer]) {
    dirty.clearDirtyRecord(record.entityType, record.entityId)
  }
}

export function createSyncClientService(options: CreateSyncClientServiceOptions): SyncClientService {
  const rootPath = path.resolve(options.rootPath)
  const replicaId = options.replicaId ?? "local"
  const identity: EnsureSyncDatabaseOptions = { role: "client", workspaceId: options.workspaceId }
  const pullLimit = options.pullLimit ?? 100

  return {
    syncNow() {
      let pulled = 0
      let pushed = 0
      let sinceSequence = readLastPulledSequence(rootPath, identity, replicaId)
      const dirty = createDirtyRecordRepository(rootPath, identity)

      for (;;) {
        const response = options.transport.pull({ workspaceId: options.workspaceId, sinceSequence, limit: pullLimit })
        for (const change of response.changes) {
          if (applyPulledChange(rootPath, change, options.transport)) {
            dirty.clearDirtyRecord(change.entityType, change.entityId)
          }
        }
        pulled += response.changes.length
        sinceSequence = response.toSequence
        writeReplicaProgress(rootPath, identity, replicaId, sinceSequence)
        if (!response.hasMore) {
          break
        }
      }

      const dirtyRecords = dirty.listDirtyRecords()
      if (dirtyRecords.length > 0) {
        const pushResponse = options.transport.push(buildPushRequest(rootPath, options.workspaceId, replicaId, sinceSequence, dirtyRecords))
        pushed = pushResponse.accepted.length
        clearAcceptedDirty(rootPath, identity, pushResponse)
        writeReplicaProgress(rootPath, identity, replicaId, pushResponse.serverSequence, new Date().toISOString())
      }

      return { status: "synced", pushed, pulled }
    },
  }
}
