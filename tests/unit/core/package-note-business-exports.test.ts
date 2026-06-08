import { describe, test } from "bun:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  archiveNote,
  createNote,
  deleteNote,
  listNotes,
  moveNote,
  promoteDraft,
  renameNote,
  selectNote,
  showNote,
} from "@lordierclaw/bluenote-core"
import { archiveNote as shimArchiveNote } from "../../../src/core/archive-note"
import { createNote as shimCreateNote } from "../../../src/core/create-note"
import { promoteDraft as shimPromoteDraft } from "../../../src/core/promote-draft"
import { selectNote as shimSelectNote } from "../../../src/core/select-note"
import { showNote as shimShowNote } from "../../../src/core/show-note"

describe("@lordierclaw/bluenote-core note business exports", () => {
  test("exports note business APIs and preserves root shim identity", async () => {
    assert.equal(createNote, shimCreateNote)
    assert.equal(showNote, shimShowNote)
    assert.equal(selectNote, shimSelectNote)
    assert.equal(archiveNote, shimArchiveNote)
    assert.equal(promoteDraft, shimPromoteDraft)

    const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-core-note-business-exports-"))

    try {
      const created = createNote({
        override: rootPath,
        type: "draft",
        title: "Package Export Note",
        body: "Created through @lordierclaw/bluenote-core note business exports.",
        enqueueAi: false,
        randomSource: () => 0,
      })

      assert.equal(created.key, "package-export-note-000000")
      assert.equal(listNotes({ override: rootPath, visibility: "drafts" }).length, 1)
      assert.equal(showNote({ override: rootPath, selector: created.key, visibility: "drafts" }).body, "Created through @lordierclaw/bluenote-core note business exports.")
      assert.equal(typeof deleteNote, "function")
      assert.equal(typeof renameNote, "function")
      assert.equal(typeof moveNote, "function")
    } finally {
      await rm(rootPath, { recursive: true, force: true })
    }
  })
})
