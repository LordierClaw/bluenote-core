import { test } from "vitest"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises"

// @ts-expect-error sql.js does not ship TypeScript declarations in this project.
import initSqlJs from "sql.js"

import {
  createDirtyRecordRepository,
  createFolderRepository,
  createSyncStatusRepository,
  createTombstoneRepository,
  ensureSyncDatabase,
  type EnsureSyncDatabaseOptions,
} from "../../../src"

const dbIdentity: EnsureSyncDatabaseOptions = { role: "client", workspaceId: "workspace-123" }
const SQL = await initSqlJs()

async function withRoot<T>(prefix: string, callback: (rootPath: string) => T | Promise<T>): Promise<T> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), prefix))

  try {
    ensureSyncDatabase(rootPath, dbIdentity)
    return await callback(rootPath)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
}

test("dirty repository marks records idempotently by entity type and id", async () => {
  await withRoot("bluenote-dirty-repository-", (rootPath) => {
    const repository = createDirtyRecordRepository(rootPath, dbIdentity)

    repository.markDirty({
      entityType: "note",
      entityId: "note-1",
      dirtyType: "upsert",
      markedAt: "2026-01-01T00:00:00.000Z",
      metadata: { title: "Original title" },
    })
    repository.markDirty({
      entityType: "note",
      entityId: "note-1",
      dirtyType: "upsert",
      markedAt: "2026-01-01T00:01:00.000Z",
      metadata: { title: "Updated title" },
    })

    assert.deepEqual(repository.listDirtyRecords(), [
      {
        entityType: "note",
        entityId: "note-1",
        dirtyType: "upsert",
        markedAt: "2026-01-01T00:01:00.000Z",
        attempts: 0,
        lastError: null,
        metadata: { title: "Updated title" },
      },
    ])
  })
})

test("dirty repository clears accepted records", async () => {
  await withRoot("bluenote-dirty-clear-", (rootPath) => {
    const repository = createDirtyRecordRepository(rootPath, dbIdentity)

    repository.markDirty({ entityType: "note", entityId: "note-1", dirtyType: "upsert", markedAt: "2026-01-01T00:00:00.000Z" })
    repository.markDirty({ entityType: "folder", entityId: "projects", dirtyType: "upsert", markedAt: "2026-01-01T00:00:01.000Z" })
    repository.clearDirtyRecord("note", "note-1")

    assert.deepEqual(repository.listDirtyRecords(), [
      {
        entityType: "folder",
        entityId: "projects",
        dirtyType: "upsert",
        markedAt: "2026-01-01T00:00:01.000Z",
        attempts: 0,
        lastError: null,
        metadata: null,
      },
    ])
  })
})

test("dirty repository re-marking resets stale retry state", async () => {
  await withRoot("bluenote-dirty-reset-", (rootPath) => {
    const repository = createDirtyRecordRepository(rootPath, dbIdentity)

    repository.markDirty({ entityType: "note", entityId: "note-1", dirtyType: "upsert", markedAt: "2026-01-01T00:00:00.000Z" })

    const dbPath = path.join(rootPath, ".data", "sync", "sync.sqlite")
    const db = new SQL.Database(readFileSync(dbPath))
    try {
      db.run("UPDATE dirty_records SET attempts = 4, lastError = 'network failed' WHERE entityType = 'note' AND entityId = 'note-1'")
      writeFileSync(dbPath, db.export())
    } finally {
      db.close()
    }

    repository.markDirty({ entityType: "note", entityId: "note-1", dirtyType: "upsert", markedAt: "2026-01-01T00:02:00.000Z" })

    assert.deepEqual(repository.listDirtyRecords(), [
      {
        entityType: "note",
        entityId: "note-1",
        dirtyType: "upsert",
        markedAt: "2026-01-01T00:02:00.000Z",
        attempts: 0,
        lastError: null,
        metadata: null,
      },
    ])
  })
})

test("package root does not expose low-level sync database handles", async () => {
  const core = await import("../../../src")

  assert.equal("openSyncDatabase" in core, false)
  assert.equal("saveSyncDatabase" in core, false)
})

test("sync database lock does not evict an old lock owned by a live process", async () => {
  await withRoot("bluenote-sync-db-live-lock-", async (rootPath) => {
    const repository = createDirtyRecordRepository(rootPath, dbIdentity)
    const lockPath = path.join(rootPath, ".data", "sync", "sync.sqlite.lock")
    await mkdir(lockPath, { recursive: true })
    await writeFile(path.join(lockPath, "lock.json"), JSON.stringify({
      pid: process.pid,
      acquiredAt: "2000-01-01T00:00:00.000Z",
    }, null, 2) + "\n", "utf8")

    assert.throws(
      () => repository.listDirtyRecords(),
      /busy/i,
    )
  })
})

test("sync database lock does not evict an old metadata-less lock", async () => {
  await withRoot("bluenote-sync-db-empty-lock-", async (rootPath) => {
    const repository = createDirtyRecordRepository(rootPath, dbIdentity)
    const lockPath = path.join(rootPath, ".data", "sync", "sync.sqlite.lock")
    await mkdir(lockPath, { recursive: true })
    const oldTimestamp = new Date("2000-01-01T00:00:00.000Z")
    await utimes(lockPath, oldTimestamp, oldTimestamp)

    assert.throws(
      () => repository.listDirtyRecords(),
      /busy/i,
    )
  })
})

test("sync database lock is released if database open fails", async () => {
  await withRoot("bluenote-sync-db-open-failure-", async (rootPath) => {
    const repository = createDirtyRecordRepository(rootPath, dbIdentity)
    const databasePath = path.join(rootPath, ".data", "sync", "sync.sqlite")
    const lockPath = `${databasePath}.lock`
    await rm(databasePath, { force: true })
    await mkdir(databasePath)

    assert.throws(
      () => repository.listDirtyRecords(),
      /EISDIR|directory/i,
    )
    assert.equal(existsSync(lockPath), false)
  })
})

test("tombstone repository records deleted notes and folders", async () => {
  await withRoot("bluenote-tombstone-repository-", (rootPath) => {
    const repository = createTombstoneRepository(rootPath, dbIdentity)

    repository.recordTombstone({
      entityType: "note",
      entityId: "note-1",
      deletedAt: "2026-01-01T00:00:00.000Z",
      previousRelativePath: "notes/Old.md",
      previousTitle: "Old",
      sourceReplicaId: "replica-a",
      serverRevision: 7,
    })
    repository.recordTombstone({
      entityType: "folder",
      entityId: "projects",
      deletedAt: "2026-01-01T00:00:01.000Z",
      previousRelativePath: "projects",
    })

    assert.deepEqual(repository.listTombstones(), [
      {
        entityType: "note",
        entityId: "note-1",
        deletedAt: "2026-01-01T00:00:00.000Z",
        previousRelativePath: "notes/Old.md",
        previousTitle: "Old",
        sourceReplicaId: "replica-a",
        serverRevision: 7,
      },
      {
        entityType: "folder",
        entityId: "projects",
        deletedAt: "2026-01-01T00:00:01.000Z",
        previousRelativePath: "projects",
        previousTitle: null,
        sourceReplicaId: null,
        serverRevision: null,
      },
    ])
  })
})

test("folder repository stores empty folder records by relative path", async () => {
  await withRoot("bluenote-folder-repository-", (rootPath) => {
    const repository = createFolderRepository(rootPath, dbIdentity)

    repository.upsertFolder({ relativePath: "projects/empty", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" })
    repository.upsertFolder({ relativePath: "projects/empty", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:02:00.000Z" })

    assert.deepEqual(repository.listFolders(), [
      {
        relativePath: "projects/empty",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:02:00.000Z",
        deletedAt: null,
      },
    ])
  })
})

test("status repository writes and reads sync status summaries", async () => {
  await withRoot("bluenote-status-repository-", (rootPath) => {
    const repository = createSyncStatusRepository(rootPath, dbIdentity)

    assert.equal(repository.readStatusSummary(), null)

    repository.writeStatusSummary({
      pendingCount: 2,
      runningCount: 1,
      failedCount: 3,
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastError: "network unavailable",
    })

    assert.deepEqual(repository.readStatusSummary(), {
      pendingCount: 2,
      runningCount: 1,
      failedCount: 3,
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastError: "network unavailable",
    })
  })
})
