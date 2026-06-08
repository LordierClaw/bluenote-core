import { describe, test } from "bun:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { mkdir, mkdtemp, rm } from "node:fs/promises"

import {
  containsSearchQuery,
  createNote,
  createSearchDocuments,
  loadIndexStore,
  rebuildIndexes,
  rebuildIndexStore,
  searchNotes,
  updateIndexedNote,
} from "@lordierclaw/bluenote-core"
import { containsSearchQuery as rootContainsSearchQuery } from "../../../src/search/contains-match"
import { rebuildIndexes as rootRebuildIndexes } from "../../../src/core/rebuild-indexes"
import { searchNotes as rootSearchNotes } from "../../../src/core/search-notes"
import {
  loadIndexStore as rootLoadIndexStore,
  rebuildIndexStore as rootRebuildIndexStore,
  updateIndexedNote as rootUpdateIndexedNote,
} from "../../../src/index/index-store"
import { createSearchDocuments as rootCreateSearchDocuments } from "../../../src/index/search-documents"

describe("@lordierclaw/bluenote-core search/rebuild/index exports", () => {
  test("exports package-local search APIs with root shim identity and literal contains search", async () => {
    assert.equal(containsSearchQuery, rootContainsSearchQuery)
    assert.equal(rebuildIndexes, rootRebuildIndexes)
    assert.equal(searchNotes, rootSearchNotes)
    assert.equal(loadIndexStore, rootLoadIndexStore)
    assert.equal(rebuildIndexStore, rootRebuildIndexStore)
    assert.equal(updateIndexedNote, rootUpdateIndexedNote)
    assert.equal(createSearchDocuments, rootCreateSearchDocuments)
    assert.equal(containsSearchQuery("Alpha Project", "pha"), true)
    assert.equal(containsSearchQuery("Alpha Project", "apj"), false)

    const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-core-search-exports-"))

    try {
      await mkdir(path.join(rootPath, "note"), { recursive: true })
      const created = createNote({
        override: rootPath,
        type: "normal",
        title: "Literal Contains Fixture",
        body: "The body includes foobar for substring lookup.",
        destinationFolder: "note",
        enqueueAi: false,
        randomSource: () => 0,
      })

      const rebuilt = rebuildIndexes({ override: rootPath })
      assert.equal(rebuilt.noteCount, 1)

      const titleMatches = searchNotes("xtur", { override: rootPath })
      assert.deepEqual(titleMatches.map((match) => match.key), [created.key])
      assert.equal(titleMatches[0]?.match.label, "title")

      const bodyMatches = searchNotes("ooba", { override: rootPath })
      assert.deepEqual(bodyMatches.map((match) => match.key), [created.key])
      assert.equal(bodyMatches[0]?.match.label, "content line 1")
    } finally {
      await rm(rootPath, { recursive: true, force: true })
    }
  })
})
