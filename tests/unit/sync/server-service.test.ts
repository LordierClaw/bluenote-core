import { test } from "vitest"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"

// @ts-expect-error sql.js does not ship TypeScript declarations in this project.
import initSqlJs from "sql.js"

import { createSyncServerService } from "../../../src/sync/server-service"
import { createFolderRepository, createSidecarRepository, createTombstoneRepository, ensureSyncDatabase, UsageError } from "../../../src"

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
        sourceReplicaId: "client-a",
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

test("server accepts synced draft note upserts", async () => {
  await withRoot((rootPath) => {
    const server = createSyncServerService({ rootPath, workspaceId })

    const response = server.acceptPush({
      workspaceId,
      replicaId: "client-a",
      baseSequence: 0,
      noteBodies: { "draft-1": "Draft body.\n" },
      records: [
        {
          entityType: "note",
          entityId: "draft-1",
          dirtyType: "upsert",
          clientUpdatedAt: "2026-01-01T00:00:00.000Z",
          metadata: {
            key: "quick-draft",
            title: "Quick Draft",
            relativePath: "draft/quick-draft.md",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          bodyUpload: { contentHash: "sha256:draft", byteLength: 12 },
        },
      ],
    })

    assert.deepEqual(response.accepted, [{ entityType: "note", entityId: "draft-1", serverRevision: 1 }])
    assert.equal(response.rejected.length, 0)
    assert.equal(readFileSync(path.join(rootPath, "draft", "quick-draft.md"), "utf8"), "Draft body.\n")
    assert.deepEqual(createSidecarRepository(rootPath).readByNoteId("draft-1"), {
      type: "draft",
      noteId: "draft-1",
      key: "quick-draft",
      title: "Quick Draft",
      description: "Draft body.",
      relativePath: "draft/quick-draft.md",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archivedAt: null,
      namingVersion: 1,
    })
  })
})

test("server rejects pushed note relocations through symlinked destination parents", async () => {
  await withRoot(async (rootPath) => {
    const outsidePath = await mkdtemp(path.join(os.tmpdir(), "bluenote-sync-server-outside-"))
    try {
      const server = createSyncServerService({ rootPath, workspaceId })
      const initial = server.acceptPush({
        workspaceId,
        replicaId: "client-a",
        baseSequence: 0,
        noteBodies: { "note-escape": "Original body.\n" },
        records: [{
          entityType: "note",
          entityId: "note-escape",
          dirtyType: "upsert",
          clientUpdatedAt: "2026-01-01T00:00:00.000Z",
          metadata: {
            key: "safe-note",
            title: "Safe Note",
            relativePath: "note/safe-note.md",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        }],
      })
      assert.equal(initial.rejected.length, 0)
      symlinkSync(outsidePath, path.join(rootPath, "note", "link"), "dir")

      const response = server.acceptPush({
        workspaceId,
        replicaId: "client-a",
        baseSequence: initial.serverSequence,
        noteBodies: { "note-escape": "Escaped body.\n" },
        records: [{
          entityType: "note",
          entityId: "note-escape",
          dirtyType: "upsert",
          clientUpdatedAt: "2026-01-01T00:01:00.000Z",
          metadata: {
            key: "escaped",
            title: "Escaped",
            relativePath: "note/link/escaped.md",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:01:00.000Z",
          },
        }],
      })

      assert.equal(response.accepted.length, 0)
      assert.equal(response.rejected.length, 1)
      assert.equal(existsSync(path.join(outsidePath, "escaped.md")), false)
      assert.equal(readFileSync(path.join(rootPath, "note", "safe-note.md"), "utf8"), "Original body.\n")
    } finally {
      await rm(outsidePath, { recursive: true, force: true })
    }
  })
})

test("server accepts folder dirty records so client folder queues can drain", async () => {
  await withRoot((rootPath) => {
    const server = createSyncServerService({ rootPath, workspaceId })

    const response = server.acceptPush({
      workspaceId,
      replicaId: "client-a",
      baseSequence: 0,
      records: [
        {
          entityType: "folder",
          entityId: "note/projects",
          dirtyType: "folder-upsert",
          clientUpdatedAt: "2026-01-01T00:00:00.000Z",
          metadata: { relativePath: "note/projects" },
        },
        {
          entityType: "folder",
          entityId: "note/old-projects",
          dirtyType: "folder-delete",
          clientUpdatedAt: "2026-01-01T00:01:00.000Z",
          metadata: { relativePath: "note/old-projects" },
        },
      ],
    })

    assert.deepEqual(response.accepted, [
      { entityType: "folder", entityId: "note/projects", serverRevision: 1 },
      { entityType: "folder", entityId: "note/old-projects", serverRevision: 1 },
    ])
    assert.equal(response.rejected.length, 0)
    assert.deepEqual(createFolderRepository(rootPath, dbIdentity).listFolders(), [
      {
        relativePath: "note/old-projects",
        createdAt: "2026-01-01T00:01:00.000Z",
        updatedAt: "2026-01-01T00:01:00.000Z",
        deletedAt: "2026-01-01T00:01:00.000Z",
      },
      {
        relativePath: "note/projects",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        deletedAt: null,
      },
    ])
    assert.equal(existsSync(path.join(rootPath, "note", "projects")), true)
    assert.deepEqual(server.getChanges({ workspaceId, sinceSequence: 0, limit: 10 }).changes.map((change) => ({
      entityType: change.entityType,
      entityId: change.entityId,
      changeType: change.changeType,
      relativePath: change.relativePath,
      bodyAvailable: change.bodyAvailable,
      metadata: change.metadata,
    })), [
      {
        entityType: "folder",
        entityId: "note/projects",
        changeType: "folder-upsert",
        relativePath: "note/projects",
        bodyAvailable: false,
        metadata: { relativePath: "note/projects" },
      },
      {
        entityType: "folder",
        entityId: "note/old-projects",
        changeType: "folder-delete",
        relativePath: "note/old-projects",
        bodyAvailable: false,
        metadata: { relativePath: "note/old-projects", deletedAt: "2026-01-01T00:01:00.000Z" },
      },
    ])
  })
})

test("server allocates in-batch revisions transactionally for repeated entity changes", async () => {
  await withRoot((rootPath) => {
    const server = createSyncServerService({ rootPath, workspaceId })

    const response = server.acceptPush({
      workspaceId,
      replicaId: "client-a",
      baseSequence: 0,
      noteBodies: {
        "note-dup": "Second version should win on disk.\n",
      },
      records: [
        {
          entityType: "note",
          entityId: "note-dup",
          dirtyType: "upsert",
          clientUpdatedAt: "2026-01-01T00:00:00.000Z",
          metadata: {
            key: "dup-note",
            title: "Dup Note 1",
            relativePath: "note/dup-note.md",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          bodyUpload: { contentHash: "sha256:dup-1", byteLength: 35 },
        },
        {
          entityType: "note",
          entityId: "note-dup",
          dirtyType: "upsert",
          clientUpdatedAt: "2026-01-01T00:01:00.000Z",
          metadata: {
            key: "dup-note",
            title: "Dup Note 2",
            relativePath: "note/dup-note.md",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:01:00.000Z",
          },
          bodyUpload: { contentHash: "sha256:dup-2", byteLength: 35 },
        },
      ],
    })

    assert.deepEqual(response.accepted, [
      { entityType: "note", entityId: "note-dup", serverRevision: 1 },
      { entityType: "note", entityId: "note-dup", serverRevision: 2 },
    ])
    assert.deepEqual(
      server.getChanges({ workspaceId, sinceSequence: 0, limit: 10 }).changes.map((change) => change.serverRevision),
      [2],
    )
  })
})

test("server validates malformed push requests before mutating local files", async () => {
  await withRoot((rootPath) => {
    const server = createSyncServerService({ rootPath, workspaceId })

    assert.throws(
      () => server.acceptPush({ workspaceId, replicaId: "client-a", baseSequence: 0, records: "not-an-array" } as never),
      UsageError,
    )
    assert.deepEqual(readServerChanges(rootPath), [])
  })
})

test("server rejects path collisions instead of overwriting another note", async () => {
  await withRoot((rootPath) => {
    const server = createSyncServerService({ rootPath, workspaceId })
    server.acceptPush({
      workspaceId,
      replicaId: "client-a",
      baseSequence: 0,
      noteBodies: { "note-a": "Original A.\n", "note-b": "Original B.\n" },
      records: [
        {
          entityType: "note",
          entityId: "note-a",
          dirtyType: "upsert",
          clientUpdatedAt: "2026-01-01T00:00:00.000Z",
          metadata: { key: "note-a", title: "Note A", relativePath: "note/note-a.md" },
          bodyUpload: { contentHash: "sha256:a", byteLength: 12 },
        },
        {
          entityType: "note",
          entityId: "note-b",
          dirtyType: "upsert",
          clientUpdatedAt: "2026-01-01T00:00:00.000Z",
          metadata: { key: "note-b", title: "Note B", relativePath: "note/note-b.md" },
          bodyUpload: { contentHash: "sha256:b", byteLength: 12 },
        },
      ],
    })

    const response = server.acceptPush({
      workspaceId,
      replicaId: "client-a",
      baseSequence: 2,
      noteBodies: { "note-a": "Should not overwrite B.\n" },
      records: [
        {
          entityType: "note",
          entityId: "note-a",
          dirtyType: "upsert",
          clientUpdatedAt: "2026-01-01T00:01:00.000Z",
          metadata: { key: "note-b", title: "Colliding A", relativePath: "note/note-b.md" },
          bodyUpload: { contentHash: "sha256:collision", byteLength: 24 },
        },
      ],
    })

    assert.equal(response.accepted.length, 0)
    assert.equal(response.rejected.length, 1)
    assert.equal(readFileSync(path.join(rootPath, "note", "note-b.md"), "utf8"), "Original B.\n")
    assert.equal(createSidecarRepository(rootPath).readByNoteId("note-b").title, "Note B")
  })
})

test("server rejects relocation onto an existing Markdown file without a sidecar", async () => {
  await withRoot((rootPath) => {
    const server = createSyncServerService({ rootPath, workspaceId })
    server.acceptPush({
      workspaceId,
      replicaId: "client-a",
      baseSequence: 0,
      noteBodies: { "note-a": "Original A.\n" },
      records: [
        {
          entityType: "note",
          entityId: "note-a",
          dirtyType: "upsert",
          clientUpdatedAt: "2026-01-01T00:00:00.000Z",
          metadata: { key: "note-a", title: "Note A", relativePath: "note/note-a.md" },
          bodyUpload: { contentHash: "sha256:a", byteLength: 12 },
        },
      ],
    })
    writeFileSync(path.join(rootPath, "note", "raw-existing.md"), "Raw orphan note.\n", "utf8")

    const response = server.acceptPush({
      workspaceId,
      replicaId: "client-a",
      baseSequence: 1,
      noteBodies: { "note-a": "Should not overwrite raw.\n" },
      records: [
        {
          entityType: "note",
          entityId: "note-a",
          dirtyType: "upsert",
          clientUpdatedAt: "2026-01-01T00:01:00.000Z",
          metadata: { key: "raw-existing", title: "Colliding Raw", relativePath: "note/raw-existing.md" },
          bodyUpload: { contentHash: "sha256:raw-collision", byteLength: 26 },
        },
      ],
    })

    assert.equal(response.accepted.length, 0)
    assert.equal(response.rejected.length, 1)
    assert.equal(readFileSync(path.join(rootPath, "note", "raw-existing.md"), "utf8"), "Raw orphan note.\n")
    assert.equal(readFileSync(path.join(rootPath, "note", "note-a.md"), "utf8"), "Original A.\n")
  })
})

test("server rolls back files when change metadata cannot be serialized", async () => {
  await withRoot((rootPath) => {
    const server = createSyncServerService({ rootPath, workspaceId })
    const response = server.acceptPush({
      workspaceId,
      replicaId: "client-a",
      baseSequence: 0,
      noteBodies: { "note-bigint": "Should be rolled back.\n" },
      records: [
        {
          entityType: "note",
          entityId: "note-bigint",
          dirtyType: "upsert",
          clientUpdatedAt: "2026-01-01T00:00:00.000Z",
          metadata: { key: "note-bigint", title: "BigInt", relativePath: "note/note-bigint.md", unserializable: BigInt(1) },
          bodyUpload: { contentHash: "sha256:bigint", byteLength: 23 },
        },
      ],
    })

    assert.equal(response.accepted.length, 0)
    assert.equal(response.rejected.length, 1)
    assert.equal(existsSync(path.join(rootPath, "note", "note-bigint.md")), false)
    assert.deepEqual(readServerChanges(rootPath), [])
  })
})

test("server rolls back relocation files when sidecar validation fails", async () => {
  await withRoot((rootPath) => {
    const server = createSyncServerService({ rootPath, workspaceId })
    server.acceptPush({
      workspaceId,
      replicaId: "client-a",
      baseSequence: 0,
      noteBodies: { "note-a": "Original A.\n" },
      records: [
        {
          entityType: "note",
          entityId: "note-a",
          dirtyType: "upsert",
          clientUpdatedAt: "2026-01-01T00:00:00.000Z",
          metadata: { key: "note-a", title: "Note A", relativePath: "note/note-a.md" },
          bodyUpload: { contentHash: "sha256:a", byteLength: 12 },
        },
      ],
    })

    const response = server.acceptPush({
      workspaceId,
      replicaId: "client-a",
      baseSequence: 1,
      noteBodies: { "note-a": "Relocation should roll back.\n" },
      records: [
        {
          entityType: "note",
          entityId: "note-a",
          dirtyType: "upsert",
          clientUpdatedAt: "not-a-date",
          metadata: { key: "note-a-renamed", title: "Bad Relocation", relativePath: "note/note-a-renamed.md", updatedAt: "not-a-date" },
          bodyUpload: { contentHash: "sha256:bad-relocation", byteLength: 30 },
        },
      ],
    })

    assert.equal(response.accepted.length, 0)
    assert.equal(response.rejected.length, 1)
    assert.equal(readFileSync(path.join(rootPath, "note", "note-a.md"), "utf8"), "Original A.\n")
    assert.equal(existsSync(path.join(rootPath, "note", "note-a-renamed.md")), false)
    assert.equal(createSidecarRepository(rootPath).readByNoteId("note-a").relativePath, "note/note-a.md")
    assert.equal(server.getChanges({ workspaceId, sinceSequence: 1, limit: 10 }).changes.length, 0)
  })
})

test("server rejects invalid delete metadata paths without tombstones or changes", async () => {
  await withRoot((rootPath) => {
    const server = createSyncServerService({ rootPath, workspaceId })
    const response = server.acceptPush({
      workspaceId,
      replicaId: "client-a",
      baseSequence: 0,
      records: [
        {
          entityType: "note",
          entityId: "missing-note",
          dirtyType: "delete",
          clientUpdatedAt: "2026-01-01T00:01:00.000Z",
          metadata: { relativePath: "../outside.md", title: "Bad Delete" },
        },
      ],
    })

    assert.equal(response.accepted.length, 0)
    assert.equal(response.rejected.length, 1)
    assert.deepEqual(createTombstoneRepository(rootPath, dbIdentity).listTombstones(), [])
    assert.deepEqual(server.getChanges({ workspaceId, sinceSequence: 0, limit: 10 }).changes, [])
  })
})

test("server holds the sync DB lock before mutating accepted push files", async () => {
  await withRoot((rootPath) => {
    mkdirSync(path.join(rootPath, ".data", "sync", "sync.sqlite.lock"))
    const server = createSyncServerService({ rootPath, workspaceId })

    assert.throws(
      () => server.acceptPush({
        workspaceId,
        replicaId: "client-a",
        baseSequence: 0,
        noteBodies: { "note-locked": "Should not be written.\n" },
        records: [
          {
            entityType: "note",
            entityId: "note-locked",
            dirtyType: "upsert",
            clientUpdatedAt: "2026-01-01T00:00:00.000Z",
            metadata: { key: "note-locked", title: "Locked", relativePath: "note/note-locked.md" },
            bodyUpload: { contentHash: "sha256:locked", byteLength: 23 },
          },
        ],
      }),
      UsageError,
    )
    assert.equal(existsSync(path.join(rootPath, "note", "note-locked.md")), false)
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

    const fullHistory = server.getChanges({ workspaceId, sinceSequence: 0, limit: 10 })
    assert.deepEqual(fullHistory.changes.map((change) => change.changeType), ["delete"])

    const changes = server.getChanges({ workspaceId, sinceSequence: 1, limit: 10 })
    assert.deepEqual(changes.changes, [
      {
        sequence: 2,
        entityType: "note",
        entityId: "note-1",
        changeType: "delete",
        serverRevision: 2,
        changedAt: changes.changes[0].changedAt,
        sourceReplicaId: "client-a",
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
