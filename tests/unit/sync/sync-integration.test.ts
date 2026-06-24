import { test } from "vitest"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"

import {
  createBlueNoteCore,
  createDirtyRecordRepository,
  createSidecarRepository,
  createSyncServerService,
  ensureSyncDatabase,
  type SyncTransport,
} from "../../../src"

async function withTempWorkspace<T>(callback: (roots: { serverRoot: string; clientARoot: string; clientBRoot: string }) => T | Promise<T>): Promise<T> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "bluenote-core-sync-integration-"))
  const roots = {
    serverRoot: path.join(workspaceRoot, "server"),
    clientARoot: path.join(workspaceRoot, "client-a"),
    clientBRoot: path.join(workspaceRoot, "client-b"),
  }

  try {
    mkdirSync(roots.serverRoot, { recursive: true })
    mkdirSync(roots.clientARoot, { recursive: true })
    mkdirSync(roots.clientBRoot, { recursive: true })
    return await callback(roots)
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
}

test("core sync moves a note from client A to server to client B and propagates tombstones", async () => {
  await withTempWorkspace(({ serverRoot, clientARoot, clientBRoot }) => {
    const serverCore = createBlueNoteCore({ rootPath: serverRoot })
    const clientA = createBlueNoteCore({ rootPath: clientARoot })
    const clientB = createBlueNoteCore({ rootPath: clientBRoot })
    serverCore.init()
    clientA.init()
    clientB.init()

    const workspaceId = serverCore.sync.status().state === "unlinked"
      ? JSON.parse(readFileSync(path.join(serverRoot, ".data", "manifest.json"), "utf8")).workspaceId as string
      : assert.fail("server should start unlinked")
    ensureSyncDatabase(serverRoot, { role: "server", workspaceId })
    const server = createSyncServerService({ rootPath: serverRoot, workspaceId })
    const transport: SyncTransport = {
      pull(request) {
        return server.getChanges(request)
      },
      push(request) {
        return server.acceptPush(request)
      },
      downloadNoteBody(noteId) {
        return server.downloadNoteBody(noteId, { workspaceId })
      },
    }

    clientA.sync.link({ mode: "seed-empty-server-from-local", serverUrl: "http://sync.local", workspaceId })
    mkdirSync(path.join(clientARoot, "note", "projects"), { recursive: true })
    const created = clientA.notes.create({
      type: "normal",
      title: "End To End Sync",
      body: "Body created on client A and pulled by client B.\n",
      destinationFolder: "note/projects",
      enqueueAi: false,
      noteIdGenerator: () => "note-e2e-sync",
    })
    const clientASidecars = createSidecarRepository(clientARoot)
    clientASidecars.write({
      ...clientASidecars.readByNoteId(created.noteId),
      ai: { description: { lastProcessedAt: "2026-06-24T00:00:00.000Z" } },
    })

    assert.deepEqual(clientA.sync.now({ transport, replicaId: "client-a" }), { status: "synced", pushed: 2, pulled: 2 })

    clientB.sync.link({ mode: "seed-empty-server-from-local", serverUrl: "http://sync.local", workspaceId })
    assert.deepEqual(clientB.sync.now({ transport, replicaId: "client-b" }), { status: "synced", pushed: 0, pulled: 2 })

    const pulled = clientB.notes.get(created.key)
    assert.equal(pulled.body, "Body created on client A and pulled by client B.\n")
    assert.equal(pulled.relativePath, created.relativePath)
    const clientBSidecar = createSidecarRepository(clientBRoot).readByNoteId(created.noteId)
    assert.equal(clientBSidecar.noteId, created.noteId)
    assert.equal(clientBSidecar.relativePath, created.relativePath)
    assert.deepEqual(clientBSidecar.ai, { description: { lastProcessedAt: "2026-06-24T00:00:00.000Z" } })

    clientASidecars.write({
      ...clientASidecars.readByNoteId(created.noteId),
      ai: { description: { lastProcessedAt: "2026-06-24T00:02:00.000Z" } },
    })
    createDirtyRecordRepository(clientARoot, { role: "client", workspaceId }).markDirty({
      entityType: "note",
      entityId: created.noteId,
      dirtyType: "upsert",
      markedAt: "2026-06-24T00:02:00.000Z",
    })
    assert.deepEqual(clientA.sync.now({ transport, replicaId: "client-a" }), { status: "synced", pushed: 1, pulled: 1 })
    assert.deepEqual(clientB.sync.now({ transport, replicaId: "client-b" }), { status: "synced", pushed: 0, pulled: 1 })
    assert.deepEqual(createSidecarRepository(clientBRoot).readByNoteId(created.noteId).ai, { description: { lastProcessedAt: "2026-06-24T00:02:00.000Z" } })

    clientA.notes.delete(created.key, { force: true, clock: { now: () => new Date("2026-06-24T00:01:00.000Z") } })
    assert.deepEqual(clientA.sync.now({ transport, replicaId: "client-a" }), { status: "synced", pushed: 1, pulled: 1 })
    assert.deepEqual(clientB.sync.now({ transport, replicaId: "client-b" }), { status: "synced", pushed: 0, pulled: 1 })

    assert.equal(existsSync(path.join(clientBRoot, created.relativePath)), false)
    assert.equal(existsSync(path.join(clientBRoot, ".data", "notes", `${created.noteId}.json`)), false)
    assert.deepEqual(clientB.notes.list(), [])
  })
})
