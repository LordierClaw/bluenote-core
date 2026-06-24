import { test } from "vitest"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"

import {
  createDirtyRecordRepository,
  createFolderRepository,
  createSyncStatusRepository,
  createTombstoneRepository,
  ensureSyncDatabase,
  type EnsureSyncDatabaseOptions,
} from "../../../src"

const dbIdentity: EnsureSyncDatabaseOptions = { role: "client", workspaceId: "workspace-123" }

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
