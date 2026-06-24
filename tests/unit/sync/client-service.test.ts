import { describe, test } from "vitest"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"

import { createBlueNoteCore, createDirtyRecordRepository, createFolderRepository, type SyncTransport } from "../../../src"
import { createSyncClientService } from "../../../src/sync/client-service"
import { createSidecarRepository } from "../../../src/storage/sidecar-repository"
import { setSyncRuntimeMode } from "../../../src/sync/runtime-mode"
import type { PullChangesRequest, PullChangesResponse, PushRequest, PushResponse } from "../../../src/sync/protocol"

const workspaceId = "workspace-client-service"
const replicaId = "replica-client-a"

interface TestTransport extends SyncTransport {
  calls: string[]
  pushes: Array<PushRequest & { noteBodies?: Record<string, string> }>
}

async function withRoot<T>(callback: (rootPath: string) => T | Promise<T>): Promise<T> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-sync-client-service-"))
  try {
    return await callback(rootPath)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
}

function makeTransport(options: {
  pull?: (request: PullChangesRequest) => PullChangesResponse
  push?: (request: PushRequest & { noteBodies?: Record<string, string> }) => PushResponse
  bodies?: Record<string, string>
} = {}): TestTransport {
  const pushes: Array<PushRequest & { noteBodies?: Record<string, string> }> = []
  const calls: string[] = []
  return {
    calls,
    pushes,
    pull(request) {
      calls.push("pull")
      return options.pull?.(request) ?? { workspaceId: request.workspaceId, fromSequence: request.sinceSequence, toSequence: request.sinceSequence, hasMore: false, changes: [] }
    },
    push(request) {
      calls.push("push")
      pushes.push(request)
      return options.push?.(request) ?? {
        accepted: request.records.map((record, index) => ({ entityType: record.entityType, entityId: record.entityId, serverRevision: index + 1 })),
        replacedByServer: [],
        rejected: [],
        serverSequence: request.baseSequence + request.records.length,
      }
    },
    downloadNoteBody(noteId) {
      calls.push(`download:${noteId}`)
      return { workspaceId, noteId, body: options.bodies?.[noteId] ?? "Server body.\n" }
    },
  }
}

function enableClient(rootPath: string): void {
  createBlueNoteCore({ rootPath }).init()
  setSyncRuntimeMode(rootPath, { mode: "sync-client", workspaceId })
}

function listRecoveryOrConflictFiles(rootPath: string): string[] {
  const found: string[] = []
  function visit(directoryPath: string): void {
    if (!existsSync(directoryPath)) return
    for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
      const entryPath = path.join(directoryPath, entry.name)
      if (entry.isDirectory()) visit(entryPath)
      if (entry.isFile() && /conflict|recovery/i.test(entry.name)) found.push(entryPath)
    }
  }
  visit(rootPath)
  return found
}

describe("sync client service", () => {
  test("sync cycle pulls before pushing dirty records and clears accepted pushes", async () => {
    await withRoot((rootPath) => {
      enableClient(rootPath)
      mkdirSync(path.join(rootPath, "note", "projects"), { recursive: true })
      const core = createBlueNoteCore({ rootPath })
      const note = core.notes.create({
        type: "normal",
        title: "Local Dirty",
        body: "Local dirty body.\n",
        destinationFolder: "note/projects",
        enqueueAi: false,
        noteIdGenerator: () => "note-local-dirty",
      })
      const dirty = createDirtyRecordRepository(rootPath, { role: "client", workspaceId })
      for (const record of dirty.listDirtyRecords()) {
        dirty.clearDirtyRecord(record.entityType, record.entityId)
      }
      dirty.markDirty({
        entityType: "note",
        entityId: note.noteId,
        dirtyType: "upsert",
        markedAt: "2026-06-24T00:00:00.000Z",
        metadata: { key: note.key, relativePath: note.relativePath, title: "Local Dirty" },
      })
      const transport = makeTransport()

      const summary = createSyncClientService({ rootPath, workspaceId, replicaId, transport }).syncNow()

      assert.deepEqual(transport.calls, ["pull", "push", "pull"])
      assert.equal(transport.pushes.length, 1)
      assert.equal(transport.pushes[0].records.length, 1)
      assert.equal(transport.pushes[0].records[0].entityId, note.noteId)
      assert.equal(transport.pushes[0].noteBodies?.[note.noteId], "Local dirty body.\n")
      assert.deepEqual(summary, { status: "synced", pushed: 1, pulled: 0 })
      assert.deepEqual(dirty.listDirtyRecords(), [])
    })
  })

  test("archiving a synced note pushes a delete tombstone instead of an archived upsert", async () => {
    await withRoot((rootPath) => {
      enableClient(rootPath)
      mkdirSync(path.join(rootPath, "note", "projects"), { recursive: true })
      const core = createBlueNoteCore({ rootPath })
      const note = core.notes.create({
        type: "normal",
        title: "Archive Dirty",
        body: "Archive me remotely.\n",
        destinationFolder: "note/projects",
        enqueueAi: false,
        noteIdGenerator: () => "note-archive-dirty",
      })
      const dirty = createDirtyRecordRepository(rootPath, { role: "client", workspaceId })
      for (const record of dirty.listDirtyRecords()) {
        dirty.clearDirtyRecord(record.entityType, record.entityId)
      }

      core.notes.archive(note.key, { clock: { now: () => new Date("2026-06-24T02:00:00.000Z") } })
      assert.deepEqual(dirty.listDirtyRecords().map((record) => ({
        entityType: record.entityType,
        entityId: record.entityId,
        dirtyType: record.dirtyType,
        metadata: record.metadata,
      })), [
        {
          entityType: "note",
          entityId: note.noteId,
          dirtyType: "delete",
          metadata: {
            archivedAt: "2026-06-24T02:00:00.000Z",
            key: note.key,
            previousRelativePath: note.relativePath,
            title: note.title,
          },
        },
      ])

      const transport = makeTransport()
      assert.deepEqual(createSyncClientService({ rootPath, workspaceId, replicaId, transport }).syncNow(), { status: "synced", pushed: 1, pulled: 0 })
      assert.equal(transport.pushes.length, 1)
      assert.equal(transport.pushes[0].records.length, 1)
      assert.deepEqual(transport.pushes[0].records[0], {
        entityType: "note",
        entityId: note.noteId,
        dirtyType: "delete",
        clientUpdatedAt: "2026-06-24T02:00:00.000Z",
        metadata: {
          archivedAt: "2026-06-24T02:00:00.000Z",
          key: note.key,
          previousRelativePath: note.relativePath,
          title: note.title,
        },
      })
      assert.equal(transport.pushes[0].noteBodies, undefined)
      assert.deepEqual(dirty.listDirtyRecords(), [])
    })
  })

  test("newer pulled server note replaces a locally dirty note without pushing or preserving conflict files", async () => {
    await withRoot((rootPath) => {
      enableClient(rootPath)
      mkdirSync(path.join(rootPath, "note", "projects"), { recursive: true })
      const core = createBlueNoteCore({ rootPath })
      const note = core.notes.create({
        type: "normal",
        title: "Local Title",
        body: "Local dirty content must be overwritten.\n",
        destinationFolder: "note/projects",
        enqueueAi: false,
        noteIdGenerator: () => "note-overwrite",
      })
      const dirty = createDirtyRecordRepository(rootPath, { role: "client", workspaceId })
      for (const record of dirty.listDirtyRecords()) {
        dirty.clearDirtyRecord(record.entityType, record.entityId)
      }
      dirty.markDirty({
        entityType: "note",
        entityId: note.noteId,
        dirtyType: "upsert",
        markedAt: "2026-06-24T00:00:00.000Z",
        metadata: { key: note.key, relativePath: note.relativePath, title: "Local Title" },
      })
      const transport = makeTransport({
        bodies: { [note.noteId]: "Server body wins.\n" },
        pull: (request) => ({
          workspaceId: request.workspaceId,
          fromSequence: request.sinceSequence,
          toSequence: 5,
          hasMore: false,
          changes: [{
            sequence: 5,
            entityType: "note",
            entityId: note.noteId,
            changeType: "upsert",
            serverRevision: 2,
            changedAt: "2026-06-24T01:00:00.000Z",
            title: "Server Title",
            relativePath: note.relativePath,
            bodyAvailable: true,
            metadata: { key: note.key, relativePath: note.relativePath, title: "Server Title", updatedAt: "2026-06-24T01:00:00.000Z" },
          }],
        }),
      })

      const summary = createSyncClientService({ rootPath, workspaceId, replicaId, transport }).syncNow()

      assert.deepEqual(transport.calls, ["pull", `download:${note.noteId}`])
      assert.equal(transport.pushes.length, 0)
      assert.deepEqual(summary, { status: "synced", pushed: 0, pulled: 1 })
      assert.deepEqual(dirty.listDirtyRecords(), [])
      const updated = core.notes.get(note.key)
      assert.equal(updated.title, "Server Title")
      assert.equal(updated.body, "Server body wins.\n")
      assert.equal(readFileSync(note.notePath, "utf8").includes("Local dirty content must be overwritten"), false)
      assert.deepEqual(listRecoveryOrConflictFiles(rootPath), [])
    })
  })

  test("sync cycle normalizes dirty folder records to protocol folder dirty types", async () => {
    await withRoot((rootPath) => {
      enableClient(rootPath)
      const dirty = createDirtyRecordRepository(rootPath, { role: "client", workspaceId })
      dirty.markDirty({
        entityType: "folder",
        entityId: "note/projects",
        dirtyType: "upsert",
        markedAt: "2026-06-24T00:00:00.000Z",
        metadata: { relativePath: "note/projects" },
      })
      const transport = makeTransport()

      createSyncClientService({ rootPath, workspaceId, replicaId, transport }).syncNow()

      assert.equal(transport.pushes.length, 1)
      assert.deepEqual(transport.pushes[0].records, [{
        entityType: "folder",
        entityId: "note/projects",
        dirtyType: "folder-upsert",
        clientUpdatedAt: "2026-06-24T00:00:00.000Z",
        metadata: { relativePath: "note/projects" },
      }])
    })
  })

  test("pulled folder upserts create local empty folders and folder records", async () => {
    await withRoot((rootPath) => {
      enableClient(rootPath)
      const transport = makeTransport({
        pull: (request) => ({
          workspaceId: request.workspaceId,
          fromSequence: request.sinceSequence,
          toSequence: 7,
          hasMore: false,
          changes: [{
            sequence: 7,
            entityType: "folder",
            entityId: "note/projects/empty",
            changeType: "folder-upsert",
            serverRevision: 1,
            changedAt: "2026-06-24T01:00:00.000Z",
            relativePath: "note/projects/empty",
            bodyAvailable: false,
            metadata: { relativePath: "note/projects/empty" },
          }],
        }),
      })

      assert.deepEqual(createSyncClientService({ rootPath, workspaceId, replicaId, transport }).syncNow(), { status: "synced", pushed: 0, pulled: 1 })
      assert.equal(existsSync(path.join(rootPath, "note", "projects", "empty")), true)
      assert.deepEqual(createFolderRepository(rootPath, { role: "client", workspaceId }).listFolders(), [
        {
          relativePath: "note/projects/empty",
          createdAt: "2026-06-24T01:00:00.000Z",
          updatedAt: "2026-06-24T01:00:00.000Z",
          deletedAt: null,
        },
      ])
    })
  })

  test("push response does not mark unseen server changes as pulled", async () => {
    await withRoot((rootPath) => {
      enableClient(rootPath)
      const dirty = createDirtyRecordRepository(rootPath, { role: "client", workspaceId })
      dirty.markDirty({
        entityType: "folder",
        entityId: "note/projects",
        dirtyType: "upsert",
        markedAt: "2026-06-24T00:00:00.000Z",
        metadata: { relativePath: "note/projects" },
      })
      const pullSinceSequences: number[] = []
      const transport = makeTransport({
        pull(request) {
          pullSinceSequences.push(request.sinceSequence)
          return { workspaceId: request.workspaceId, fromSequence: request.sinceSequence, toSequence: 5, hasMore: false, changes: [] }
        },
        push(request) {
          return {
            accepted: request.records.map((record) => ({ entityType: record.entityType, entityId: record.entityId, serverRevision: 1 })),
            replacedByServer: [],
            rejected: [],
            serverSequence: 6,
          }
        },
      })
      const service = createSyncClientService({ rootPath, workspaceId, replicaId, transport })

      assert.deepEqual(service.syncNow(), { status: "synced", pushed: 1, pulled: 0 })
      assert.deepEqual(service.syncNow(), { status: "synced", pushed: 0, pulled: 0 })
      assert.deepEqual(pullSinceSequences, [0, 5, 5])
    })
  })

  test("pulled note upsert without an available body does not wipe local content", async () => {
    await withRoot((rootPath) => {
      enableClient(rootPath)
      mkdirSync(path.join(rootPath, "note", "projects"), { recursive: true })
      const core = createBlueNoteCore({ rootPath })
      const note = core.notes.create({
        type: "normal",
        title: "Keep Body",
        body: "Do not erase this.\n",
        destinationFolder: "note/projects",
        enqueueAi: false,
        noteIdGenerator: () => "note-keep-body",
      })
      const dirty = createDirtyRecordRepository(rootPath, { role: "client", workspaceId })
      dirty.markDirty({
        entityType: "note",
        entityId: note.noteId,
        dirtyType: "upsert",
        markedAt: "2026-06-24T00:00:00.000Z",
        metadata: { key: note.key, relativePath: note.relativePath, title: note.title },
      })
      const transport = makeTransport({
        pull: (request) => ({
          workspaceId: request.workspaceId,
          fromSequence: request.sinceSequence,
          toSequence: 6,
          hasMore: false,
          changes: [{
            sequence: 6,
            entityType: "note",
            entityId: note.noteId,
            changeType: "upsert",
            serverRevision: 2,
            changedAt: "2026-06-24T01:00:00.000Z",
            title: note.title,
            relativePath: note.relativePath,
            bodyAvailable: false,
            metadata: { key: note.key, relativePath: note.relativePath, title: note.title, updatedAt: "2026-06-24T01:00:00.000Z" },
          }],
        }),
      })

      assert.throws(() => createSyncClientService({ rootPath, workspaceId, replicaId, transport }).syncNow(), /body/i)
      assert.equal(core.notes.get(note.key).body, "Do not erase this.\n")
      assert.equal(dirty.listDirtyRecords().some((record) => record.entityId === note.noteId), true)
      assert.deepEqual(transport.calls, ["pull"])
    })
  })

  test("pulled new note creates missing destination folders", async () => {
    await withRoot((rootPath) => {
      enableClient(rootPath)
      const core = createBlueNoteCore({ rootPath })
      const transport = makeTransport({
        bodies: { "note-server-new": "Hydrated from server.\n" },
        pull: (request) => ({
          workspaceId: request.workspaceId,
          fromSequence: request.sinceSequence,
          toSequence: 7,
          hasMore: false,
          changes: [{
            sequence: 7,
            entityType: "note",
            entityId: "note-server-new",
            changeType: "upsert",
            serverRevision: 1,
            changedAt: "2026-06-24T01:00:00.000Z",
            title: "Server New",
            relativePath: "note/projects/server-new.md",
            bodyAvailable: true,
            metadata: { key: "server-new", relativePath: "note/projects/server-new.md", title: "Server New", updatedAt: "2026-06-24T01:00:00.000Z" },
          }],
        }),
      })

      assert.deepEqual(createSyncClientService({ rootPath, workspaceId, replicaId, transport }).syncNow(), { status: "synced", pushed: 0, pulled: 1 })
      assert.equal(core.notes.get("server-new").body, "Hydrated from server.\n")
      assert.equal(existsSync(path.join(rootPath, "note", "projects", "server-new.md")), true)
    })
  })

  test("pulled relocation rejects paths owned by another local note", async () => {
    await withRoot((rootPath) => {
      enableClient(rootPath)
      mkdirSync(path.join(rootPath, "note", "projects"), { recursive: true })
      const core = createBlueNoteCore({ rootPath })
      const first = core.notes.create({ type: "normal", title: "First", body: "First body.\n", destinationFolder: "note/projects", enqueueAi: false, noteIdGenerator: () => "note-first" })
      const second = core.notes.create({ type: "normal", title: "Second", body: "Second body.\n", destinationFolder: "note/projects", enqueueAi: false, noteIdGenerator: () => "note-second" })
      const transport = makeTransport({
        bodies: { [first.noteId]: "Server relocated first.\n" },
        pull: (request) => ({
          workspaceId: request.workspaceId,
          fromSequence: request.sinceSequence,
          toSequence: 8,
          hasMore: false,
          changes: [{
            sequence: 8,
            entityType: "note",
            entityId: first.noteId,
            changeType: "upsert",
            serverRevision: 2,
            changedAt: "2026-06-24T01:00:00.000Z",
            title: second.title,
            relativePath: second.relativePath,
            bodyAvailable: true,
            metadata: { key: second.key, relativePath: second.relativePath, title: second.title, updatedAt: "2026-06-24T01:00:00.000Z" },
          }],
        }),
      })

      assert.throws(() => createSyncClientService({ rootPath, workspaceId, replicaId, transport }).syncNow(), /already exists|owned/i)
      assert.equal(core.notes.get(first.key).body, "First body.\n")
      assert.equal(core.notes.get(second.key).body, "Second body.\n")
    })
  })

  test("pulled folder changes clear matching local dirty folder records", async () => {
    await withRoot((rootPath) => {
      enableClient(rootPath)
      const dirty = createDirtyRecordRepository(rootPath, { role: "client", workspaceId })
      dirty.markDirty({
        entityType: "folder",
        entityId: "note/projects",
        dirtyType: "upsert",
        markedAt: "2026-06-24T00:00:00.000Z",
        metadata: { relativePath: "note/projects" },
      })
      const transport = makeTransport({
        pull: (request) => ({
          workspaceId: request.workspaceId,
          fromSequence: request.sinceSequence,
          toSequence: 9,
          hasMore: false,
          changes: [{
            sequence: 9,
            entityType: "folder",
            entityId: "note/projects",
            changeType: "folder-upsert",
            serverRevision: 1,
            changedAt: "2026-06-24T01:00:00.000Z",
            metadata: { relativePath: "note/projects" },
          }],
        }),
      })

      assert.deepEqual(createSyncClientService({ rootPath, workspaceId, replicaId, transport }).syncNow(), { status: "synced", pushed: 0, pulled: 1 })
      assert.equal(dirty.listDirtyRecords().length, 0)
      assert.equal(transport.pushes.length, 0)
    })
  })

  test("pulled note metadata key must match the relative path basename", async () => {
    await withRoot((rootPath) => {
      enableClient(rootPath)
      mkdirSync(path.join(rootPath, "note", "projects"), { recursive: true })
      const transport = makeTransport({
        bodies: { "note-key-mismatch": "Mismatch.\n" },
        pull: (request) => ({
          workspaceId: request.workspaceId,
          fromSequence: request.sinceSequence,
          toSequence: 10,
          hasMore: false,
          changes: [{
            sequence: 10,
            entityType: "note",
            entityId: "note-key-mismatch",
            changeType: "upsert",
            serverRevision: 1,
            changedAt: "2026-06-24T01:00:00.000Z",
            title: "Mismatch",
            relativePath: "note/projects/server-key.md",
            bodyAvailable: true,
            metadata: { key: "different-key", relativePath: "note/projects/server-key.md", title: "Mismatch", updatedAt: "2026-06-24T01:00:00.000Z" },
          }],
        }),
      })

      assert.throws(() => createSyncClientService({ rootPath, workspaceId, replicaId, transport }).syncNow(), /key.*relativePath|relativePath.*key/i)
      assert.equal(existsSync(path.join(rootPath, "note", "projects", "server-key.md")), false)
      assert.equal(existsSync(path.join(rootPath, "note", "projects", "different-key.md")), false)
    })
  })

  test("pulled note relative paths are validated after normalization before writing", async () => {
    await withRoot((rootPath) => {
      enableClient(rootPath)
      mkdirSync(path.join(rootPath, "note", "projects"), { recursive: true })
      const core = createBlueNoteCore({ rootPath })
      const note = core.notes.create({
        type: "normal",
        title: "Victim",
        body: "Victim body.\n",
        destinationFolder: "note/projects",
        enqueueAi: false,
        noteIdGenerator: () => "note-victim",
      })
      const transport = makeTransport({
        bodies: { [note.noteId]: "Escaped body.\n" },
        pull: (request) => ({
          workspaceId: request.workspaceId,
          fromSequence: request.sinceSequence,
          toSequence: 11,
          hasMore: false,
          changes: [{
            sequence: 11,
            entityType: "note",
            entityId: note.noteId,
            changeType: "upsert",
            serverRevision: 2,
            changedAt: "2026-06-24T01:00:00.000Z",
            title: "Escape",
            relativePath: "note/../escape.md",
            bodyAvailable: true,
            metadata: { key: "escape", relativePath: "note/../escape.md", title: "Escape", updatedAt: "2026-06-24T01:00:00.000Z" },
          }],
        }),
      })

      assert.throws(() => createSyncClientService({ rootPath, workspaceId, replicaId, transport }).syncNow(), /relativePath|note\//i)
      assert.equal(existsSync(path.join(rootPath, "escape.md")), false)
      assert.equal(readFileSync(note.notePath, "utf8").includes("Victim body."), true)
      assert.equal(core.notes.get(note.key).body, "Victim body.\n")
    })
  })

  test("pulled relocation rolls back files when sidecar validation fails", async () => {
    await withRoot((rootPath) => {
      enableClient(rootPath)
      mkdirSync(path.join(rootPath, "note", "projects"), { recursive: true })
      const core = createBlueNoteCore({ rootPath })
      const note = core.notes.create({
        type: "normal",
        title: "Rollback Source",
        body: "Original body.\n",
        destinationFolder: "note/projects",
        enqueueAi: false,
        noteIdGenerator: () => "note-rollback-source",
      })
      const destination = "note/projects/rollback-target.md"
      const transport = makeTransport({
        bodies: { [note.noteId]: "Relocated body.\n" },
        pull: (request) => ({
          workspaceId: request.workspaceId,
          fromSequence: request.sinceSequence,
          toSequence: 12,
          hasMore: false,
          changes: [{
            sequence: 12,
            entityType: "note",
            entityId: note.noteId,
            changeType: "upsert",
            serverRevision: 2,
            changedAt: "2026-06-24T01:00:00.000Z",
            title: "Rollback Target",
            relativePath: destination,
            bodyAvailable: true,
            metadata: { key: "rollback-target", relativePath: destination, title: "Rollback Target", updatedAt: "not-a-date" },
          }],
        }),
      })

      assert.throws(() => createSyncClientService({ rootPath, workspaceId, replicaId, transport }).syncNow(), /Invalid sidecar|updatedAt/i)
      assert.equal(readFileSync(note.notePath, "utf8").includes("Original body."), true)
      assert.equal(existsSync(path.join(rootPath, destination)), false)
      assert.equal(core.notes.get(note.key).body, "Original body.\n")
    })
  })

  test("pulled same-path AI validation failure rolls back edited note and sidecar", async () => {
    await withRoot((rootPath) => {
      enableClient(rootPath)
      mkdirSync(path.join(rootPath, "note", "projects"), { recursive: true })
      const core = createBlueNoteCore({ rootPath })
      const note = core.notes.create({
        type: "normal",
        title: "Same Path Rollback",
        body: "Original same-path body.\n",
        destinationFolder: "note/projects",
        enqueueAi: false,
        noteIdGenerator: () => "note-same-path-rollback",
      })
      const sidecars = createSidecarRepository(rootPath)
      const originalSidecar = sidecars.readByNoteId(note.noteId)
      const originalMarkdown = readFileSync(note.notePath, "utf8")
      const transport = makeTransport({
        bodies: { [note.noteId]: "Mutated body must roll back.\n" },
        pull: (request) => ({
          workspaceId: request.workspaceId,
          fromSequence: request.sinceSequence,
          toSequence: 15,
          hasMore: false,
          changes: [{
            sequence: 15,
            entityType: "note",
            entityId: note.noteId,
            changeType: "upsert",
            serverRevision: 2,
            changedAt: "2026-06-24T01:00:00.000Z",
            title: "Mutated Title",
            relativePath: note.relativePath,
            bodyAvailable: true,
            metadata: {
              key: note.key,
              relativePath: note.relativePath,
              title: "Mutated Title",
              updatedAt: "2026-06-24T01:00:00.000Z",
              ai: { description: { lastProcessedAt: 123 } },
            },
          }],
        }),
      })

      assert.throws(() => createSyncClientService({ rootPath, workspaceId, replicaId, transport }).syncNow(), /Invalid sidecar|lastProcessedAt/i)
      assert.equal(readFileSync(note.notePath, "utf8"), originalMarkdown)
      assert.deepEqual(sidecars.readByNoteId(note.noteId), originalSidecar)
      assert.equal(core.notes.get(note.key).body, "Original same-path body.\n")
      assert.equal(core.notes.get(note.key).title, "Same Path Rollback")
    })
  })

  test("pulled relocation rejects symlinked destination parents before writing", async () => {
    await withRoot((rootPath) => {
      enableClient(rootPath)
      mkdirSync(path.join(rootPath, "note", "projects"), { recursive: true })
      const outsidePath = path.join(rootPath, "outside")
      mkdirSync(outsidePath, { recursive: true })
      symlinkSync(outsidePath, path.join(rootPath, "note", "link"), "dir")
      const core = createBlueNoteCore({ rootPath })
      const note = core.notes.create({
        type: "normal",
        title: "Symlink Source",
        body: "Safe local body.\n",
        destinationFolder: "note/projects",
        enqueueAi: false,
        noteIdGenerator: () => "note-symlink-source",
      })
      const destination = "note/link/escaped.md"
      const transport = makeTransport({
        bodies: { [note.noteId]: "Escaped through symlink.\n" },
        pull: (request) => ({
          workspaceId: request.workspaceId,
          fromSequence: request.sinceSequence,
          toSequence: 13,
          hasMore: false,
          changes: [{
            sequence: 13,
            entityType: "note",
            entityId: note.noteId,
            changeType: "upsert",
            serverRevision: 2,
            changedAt: "2026-06-24T01:00:00.000Z",
            title: "Escaped",
            relativePath: destination,
            bodyAvailable: true,
            metadata: { key: "escaped", relativePath: destination, title: "Escaped", updatedAt: "2026-06-24T01:00:00.000Z" },
          }],
        }),
      })

      assert.throws(() => createSyncClientService({ rootPath, workspaceId, replicaId, transport }).syncNow(), /symlink/i)
      assert.equal(existsSync(path.join(outsidePath, "escaped.md")), false)
      assert.equal(readFileSync(note.notePath, "utf8").includes("Safe local body."), true)
      assert.equal(core.notes.get(note.key).body, "Safe local body.\n")
    })
  })

  test("pulled delete rejects symlinked note parents before deleting", async () => {
    await withRoot((rootPath) => {
      enableClient(rootPath)
      mkdirSync(path.join(rootPath, "note"), { recursive: true })
      const outsidePath = path.join(rootPath, "outside")
      mkdirSync(outsidePath, { recursive: true })
      writeFileSync(path.join(outsidePath, "victim.md"), "Outside content must remain.\n", "utf8")
      symlinkSync(outsidePath, path.join(rootPath, "note", "link"), "dir")
      const sidecars = createSidecarRepository(rootPath)
      sidecars.write({
        noteId: "note-delete-symlink",
        key: "victim",
        title: "Victim",
        description: "Outside content must remain.",
        relativePath: "note/link/victim.md",
        createdAt: "2026-06-24T00:00:00.000Z",
        updatedAt: "2026-06-24T00:00:00.000Z",
        archivedAt: null,
        namingVersion: 1,
        type: "normal",
      })
      const transport = makeTransport({
        pull: (request) => ({
          workspaceId: request.workspaceId,
          fromSequence: request.sinceSequence,
          toSequence: 14,
          hasMore: false,
          changes: [{
            sequence: 14,
            entityType: "note",
            entityId: "note-delete-symlink",
            changeType: "delete",
            serverRevision: 2,
            changedAt: "2026-06-24T01:00:00.000Z",
            metadata: { relativePath: "note/link/victim.md" },
          }],
        }),
      })

      assert.throws(() => createSyncClientService({ rootPath, workspaceId, replicaId, transport }).syncNow(), /symlink/i)
      assert.equal(readFileSync(path.join(outsidePath, "victim.md"), "utf8"), "Outside content must remain.\n")
      assert.equal(existsSync(sidecars.getSidecarPathByNoteId("note-delete-symlink")), true)
    })
  })

  test("createBlueNoteCore sync.now uses a configured abstract transport", async () => {
    await withRoot((rootPath) => {
      enableClient(rootPath)
      const transport = makeTransport()
      const core = createBlueNoteCore({ rootPath, syncTransport: transport, syncReplicaId: replicaId })

      assert.deepEqual(core.sync.now(), { status: "synced", pushed: 0, pulled: 0 })
      assert.deepEqual(transport.calls, ["pull"])
    })
  })
})
