import { test } from "vitest"
import assert from "node:assert/strict"
import path from "node:path"
import { access, readFile } from "node:fs/promises"

import { deleteNote } from "../../../src/core/delete-note"
import { enableSyncClientMode, listDirtyRecords, listTombstones, withTempRoot, writeSidecarNote } from "./sync-dirty-test-helpers"

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

    deleteNote({ override: rootPath, selector: "obsolete", force: true })

    assert.deepEqual(listTombstones(rootPath), [
      {
        entityType: "note",
        entityId: "note_delete_dirty",
        deletedAt: "2026-06-02T00:00:00.000Z",
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
        markedAt: "2026-06-02T00:00:00.000Z",
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
