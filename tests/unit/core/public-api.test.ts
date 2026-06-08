import { describe, test } from "bun:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { mkdir, mkdtemp, rm } from "node:fs/promises"

import { createBlueNoteCore } from "@lordierclaw/bluenote-core"

describe("@lordierclaw/bluenote-core public API", () => {
  test("exposes a minimal headless façade over notes, search, and rebuild", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-core-public-api-"))

    try {
      const core = createBlueNoteCore({ rootPath })

      assert.equal(typeof core.notes.list, "function")
      assert.equal(typeof core.notes.get, "function")
      assert.equal(typeof core.notes.create, "function")
      assert.equal(typeof core.notes.delete, "function")
      assert.equal(typeof core.notes.archive, "function")
      assert.equal(typeof core.notes.rename, "function")
      assert.equal(typeof core.notes.move, "function")
      assert.equal(typeof core.notes.promoteDraft, "function")
      assert.equal(typeof core.search.search, "function")
      assert.equal(typeof core.rebuild, "function")

      await mkdir(path.join(rootPath, "note", "projects"), { recursive: true })
      const created = core.notes.create({
        type: "normal",
        title: "Core API Note",
        body: "A note created through the @lordierclaw/bluenote-core façade.",
        destinationFolder: "note/projects",
        enqueueAi: false,
        randomSource: () => 0,
      })

      assert.equal(created.title, "Core API Note")
      assert.equal(created.relativePath, "note/projects/core-api-note-000000.md")
      assert.deepEqual(core.notes.list().map((note) => note.key), ["core-api-note-000000"])
      assert.equal(core.notes.get("core-api-note-000000").body, "A note created through the @lordierclaw/bluenote-core façade.")
      assert.equal(core.search.search("façade")[0]?.key, "core-api-note-000000")
      assert.equal(core.rebuild().noteCount, 1)
    } finally {
      await rm(rootPath, { recursive: true, force: true })
    }
  })
})
