import { test } from "vitest"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { existsSync, readFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"

// @ts-expect-error sql.js does not ship TypeScript declarations in this project.
import initSqlJs from "sql.js"

import { createSyncServerService } from "../../../src/sync/server-service"
import { createSidecarRepository, createTombstoneRepository, ensureSyncDatabase } from "../../../src"

const workspaceId = "workspace-server"
const dbIdentity = { role: "server" as const, workspaceId }
const SQL = await initSqlJs()

async function withRoot<T>(callback: (rootPath: string) => T | Promise<T>): Promise<T> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-sync-server-service-"))

  try {
    ensureSyncDatabase(rootPath, dbIdentity)
    return await callback(rootPath)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
}

function readServerChanges(rootPath: string): unknown[][] {
  const db = new SQL.Database(readFileSync(path.join(rootPath, ".data", "sync", "sync.sqlite")))
  try {
    return db.exec(`
      SELECT sequence, entityType, entityId, changeType, serverRevision, sourceReplicaId, title, relativePath, bodyAvailable, metadataJson
      FROM server_changes
      ORDER BY sequence ASC
    `)[0]?.values ?? []
  } finally {
    db.close()
  }
}

test("server accepts pushed note metadata and body, writes Markdown and sidecar, records change, and serves body separately", async () => {
  await withRoot((rootPath) => {
    const server = createSyncServerService({ rootPath, workspaceId })

    const response = server.acceptPush({
      workspaceId,
      replicaId: "client-a",
      baseSequence: 0,
      noteBodies: {
        "note-1": "# Body\n\nHello from a client.\n",
      },
      records: [
        {
          entityType: "note",
          entityId: "note-1",
          dirtyType: "upsert",
          clientUpdatedAt: "2026-01-01T00:00:00.000Z",
          metadata: {
            key: "client-note",
            title: "Client Note",
            relativePath: "note/client-note.md",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          bodyUpload: {
            contentHash: "sha256:client-body",
            byteLength: 29,
          },
        },
      ],
    })

    assert.deepEqual(response.accepted, [{ entityType: "note", entityId: "note-1", serverRevision: 1 }])
    assert.equal(response.rejected.length, 0)
    assert.equal(response.serverSequence, 1)

    assert.equal(readFileSync(path.join(rootPath, "note", "client-note.md"), "utf8"), "# Body\n\nHello from a client.\n")
    assert.deepEqual(createSidecarRepository(rootPath).readByNoteId("note-1"), {
      type: "normal",
      noteId: "note-1",
      key: "client-note",
      title: "Client Note",
      description: "# Body Hello from a client.",
      relativePath: "note/client-note.md",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archivedAt: null,
      namingVersion: 1,
    })

    const rows = readServerChanges(rootPath)
    assert.equal(rows.length, 1)
    assert.deepEqual(rows[0].slice(1, 9), ["note", "note-1", "upsert", 1, "client-a", "Client Note", "note/client-note.md", 1])

    const changes = server.getChanges({ workspaceId, sinceSequence: 0, limit: 10 })
    assert.equal(changes.fromSequence, 0)
    assert.equal(changes.toSequence, 1)
    assert.equal(changes.hasMore, false)
    assert.deepEqual(changes.changes, [
      {
        sequence: 1,
        entityType: "note",
        entityId: "note-1",
        changeType: "upsert",
        serverRevision: 1,
        changedAt: changes.changes[0].changedAt,
        title: "Client Note",
        relativePath: "note/client-note.md",
        bodyAvailable: true,
        metadata: {
          key: "client-note",
          title: "Client Note",
          relativePath: "note/client-note.md",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          contentHash: "sha256:client-body",
          byteLength: 29,
        },
      },
    ])
    assert.equal("body" in changes.changes[0], false)
    assert.equal("body" in changes.changes[0].metadata, false)

    assert.deepEqual(server.downloadNoteBody("note-1"), {
      workspaceId,
      noteId: "note-1",
      body: "# Body\n\nHello from a client.\n",
      contentHash: "sha256:client-body",
      byteLength: 29,
    })
  })
})

test("tombstone push deletes the note, records tombstone state, and appears in change list", async () => {
  await withRoot((rootPath) => {
    const server = createSyncServerService({ rootPath, workspaceId })

    server.acceptPush({
      workspaceId,
      replicaId: "client-a",
      baseSequence: 0,
      noteBodies: { "note-1": "Body before delete.\n" },
      records: [
        {
          entityType: "note",
          entityId: "note-1",
          dirtyType: "upsert",
          clientUpdatedAt: "2026-01-01T00:00:00.000Z",
          metadata: {
            key: "deleted-note",
            title: "Deleted Note",
            relativePath: "note/deleted-note.md",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          bodyUpload: { contentHash: "sha256:before-delete", byteLength: 20 },
        },
      ],
    })

    const response = server.acceptPush({
      workspaceId,
      replicaId: "client-a",
      baseSequence: 1,
      records: [
        {
          entityType: "note",
          entityId: "note-1",
          dirtyType: "delete",
          clientUpdatedAt: "2026-01-01T00:01:00.000Z",
          metadata: {
            title: "Deleted Note",
            relativePath: "note/deleted-note.md",
          },
        },
      ],
    })

    assert.deepEqual(response.accepted, [{ entityType: "note", entityId: "note-1", serverRevision: 2 }])
    assert.equal(existsSync(path.join(rootPath, "note", "deleted-note.md")), false)
    assert.equal(existsSync(path.join(rootPath, ".data", "notes", "note-1.json")), false)
    assert.deepEqual(createTombstoneRepository(rootPath, dbIdentity).listTombstones(), [
      {
        entityType: "note",
        entityId: "note-1",
        deletedAt: "2026-01-01T00:01:00.000Z",
        previousRelativePath: "note/deleted-note.md",
        previousTitle: "Deleted Note",
        sourceReplicaId: "client-a",
        serverRevision: 2,
      },
    ])

    const changes = server.getChanges({ workspaceId, sinceSequence: 1, limit: 10 })
    assert.deepEqual(changes.changes, [
      {
        sequence: 2,
        entityType: "note",
        entityId: "note-1",
        changeType: "delete",
        serverRevision: 2,
        changedAt: changes.changes[0].changedAt,
        title: "Deleted Note",
        relativePath: "note/deleted-note.md",
        bodyAvailable: false,
        metadata: {
          deletedAt: "2026-01-01T00:01:00.000Z",
          previousRelativePath: "note/deleted-note.md",
          previousTitle: "Deleted Note",
        },
      },
    ])
  })
})

test("server queues AI work after accepting note pushes without blocking or failing the response", async () => {
  await withRoot(async (rootPath) => {
    let queued: unknown = null
    let releaseQueue!: () => void
    const queueStarted = new Promise<void>((resolve) => {
      releaseQueue = resolve
    })
    const queueFinished = new Promise<void>((resolve) => {
      const server = createSyncServerService({
        rootPath,
        workspaceId,
        queueAiWork(work) {
          queued = work
          queueStarted.then(resolve)
          return queueStarted.then(() => {
            throw new Error("queue backend failed after response")
          })
        },
      })

      const response = server.acceptPush({
        workspaceId,
        replicaId: "client-a",
        baseSequence: 0,
        noteBodies: { "note-1": "AI queue body.\n" },
        records: [
          {
            entityType: "note",
            entityId: "note-1",
            dirtyType: "upsert",
            clientUpdatedAt: "2026-01-01T00:00:00.000Z",
            metadata: {
              key: "ai-note",
              title: "AI Note",
              relativePath: "note/ai-note.md",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            bodyUpload: { contentHash: "sha256:ai", byteLength: 15 },
          },
        ],
      })

      assert.equal(response.serverSequence, 1)
      assert.equal(queued, null)
    })

    await Promise.resolve()
    assert.deepEqual(queued, { noteId: "note-1", reason: "sync-push" })
    releaseQueue()
    await queueFinished
  })
})
