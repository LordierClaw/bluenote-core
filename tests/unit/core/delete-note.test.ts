import { test } from "vitest"
import assert from "node:assert/strict"
import path from "node:path"
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises"

import { deleteNote } from "../../../src/core/delete-note"
import { enableSyncClientMode, listDirtyRecords, listTombstones, withTempRoot, writeSidecarNote } from "./sync-dirty-test-helpers"

const deletionClock = { now: () => new Date("2026-06-08T09:30:00.000Z") }

test("deleteNote removes a note when force is provided", async () => {
  await withTempRoot("bluenote-delete-note-", async (rootPath) => {
    await writeSidecarNote(rootPath, { noteId: "note_delete_123", key: "obsolete", title: "Obsolete", relativePath: "note/work/obsolete.md" })

    const deleted = deleteNote({ override: rootPath, selector: "obsolete", force: true })

    assert.equal(deleted.relativePath, "note/work/obsolete.md")
    await assert.rejects(() => access(path.join(rootPath, "note", "work", "obsolete.md")))
    await assert.rejects(() => access(path.join(rootPath, ".data", "notes", "note_delete_123.json")))
  })
})

test("deleteNote records a tombstone and dirty delete in sync-client mode", async () => {
  await withTempRoot("bluenote-delete-note-sync-dirty-", async (rootPath) => {
    await enableSyncClientMode(rootPath)
    await writeSidecarNote(rootPath, { noteId: "note_delete_dirty", key: "obsolete", title: "Obsolete", relativePath: "note/work/obsolete.md" })

    deleteNote({ override: rootPath, selector: "obsolete", force: true, clock: deletionClock })

    assert.deepEqual(listTombstones(rootPath), [
      {
        entityType: "note",
        entityId: "note_delete_dirty",
        deletedAt: "2026-06-08T09:30:00.000Z",
        serverRevision: null,
        sourceReplicaId: null,
        previousRelativePath: "note/work/obsolete.md",
        previousTitle: "Obsolete",
      },
    ])
    assert.deepEqual(listDirtyRecords(rootPath), [
      {
        entityType: "note",
        entityId: "note_delete_dirty",
        dirtyType: "delete",
        markedAt: "2026-06-08T09:30:00.000Z",
        attempts: 0,
        lastError: null,
        metadata: {
          key: "obsolete",
          previousRelativePath: "note/work/obsolete.md",
          title: "Obsolete",
        },
      },
    ])
    await assert.rejects(readFile(path.join(rootPath, "note", "work", "obsolete.md"), "utf8"))
  })
})

test("deleteNote records sync delete even when post-delete rebuild reports unrelated validation errors", async () => {
  await withTempRoot("bluenote-delete-note-sync-dirty-rebuild-failure-", async (rootPath) => {
    await enableSyncClientMode(rootPath)
    await writeSidecarNote(rootPath, { noteId: "note_delete_rebuild_dirty", key: "obsolete", title: "Obsolete", relativePath: "note/work/obsolete.md" })
    await writeFile(path.join(rootPath, ".data", "notes", "orphan.json"), JSON.stringify({
      type: "normal",
      key: "orphan",
      title: "Orphan",
      description: "Missing note",
      relativePath: "note/missing/orphan.md",
      createdAt: "2026-06-08T09:00:00.000Z",
      updatedAt: "2026-06-08T09:00:00.000Z",
      archivedAt: null,
      namingVersion: 1,
    }), "utf8")

    assert.throws(
      () => deleteNote({ override: rootPath, selector: "obsolete", force: true, clock: deletionClock }),
      /derived indexes could not be rebuilt/i,
    )

    assert.deepEqual(listTombstones(rootPath), [
      {
        entityType: "note",
        entityId: "note_delete_rebuild_dirty",
        deletedAt: "2026-06-08T09:30:00.000Z",
        serverRevision: null,
        sourceReplicaId: null,
        previousRelativePath: "note/work/obsolete.md",
        previousTitle: "Obsolete",
      },
    ])
    assert.deepEqual(listDirtyRecords(rootPath), [
      {
        entityType: "note",
        entityId: "note_delete_rebuild_dirty",
        dirtyType: "delete",
        markedAt: "2026-06-08T09:30:00.000Z",
        attempts: 0,
        lastError: null,
        metadata: {
          key: "obsolete",
          previousRelativePath: "note/work/obsolete.md",
          title: "Obsolete",
        },
      },
    ])
    await assert.rejects(readFile(path.join(rootPath, "note", "work", "obsolete.md"), "utf8"))
  })
})


test("deleteNote keeps local deletion when sync dirty tracking fails", async () => {
  await withTempRoot("bluenote-delete-note-sync-dirty-failure-", async (rootPath) => {
    await enableSyncClientMode(rootPath)
    await writeSidecarNote(rootPath, { noteId: "note_delete_tracking_failure", key: "obsolete", title: "Obsolete", relativePath: "note/work/obsolete.md" })
    await mkdir(path.join(rootPath, ".data", "sync", "sync.sqlite.lock"), { recursive: true })

    const deleted = deleteNote({ override: rootPath, selector: "obsolete", force: true, clock: deletionClock })

    assert.equal(deleted.relativePath, "note/work/obsolete.md")
    await assert.rejects(readFile(path.join(rootPath, "note", "work", "obsolete.md"), "utf8"))
    await assert.rejects(readFile(path.join(rootPath, ".data", "notes", "note_delete_tracking_failure.json"), "utf8"))
    await rm(path.join(rootPath, ".data", "sync", "sync.sqlite.lock"), { recursive: true, force: true })
    assert.deepEqual(listDirtyRecords(rootPath), [])
    assert.deepEqual(listTombstones(rootPath), [])
  })
})
