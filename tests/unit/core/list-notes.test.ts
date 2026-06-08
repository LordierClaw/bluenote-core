import { test } from "bun:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"

import { listNotes } from "../../../src/core/list-notes"
import { rebuildIndexStore, type IndexedNoteRecord } from "../../../src/index/index-store"

const VISIBILITY_NOTES: IndexedNoteRecord[] = [
  {
    key: "normal-note",
    title: "Normal Note",
    description: "Visible by default",
    body: "Normal body.\n",
    relativePath: "note/normal-note.md",
    createdAt: "2026-05-21T10:19:00.000Z",
    updatedAt: "2026-05-21T10:19:00.000Z",
    archivedAt: null,
  },
  {
    key: "draft-note",
    title: "Draft Note",
    description: "Visible with drafts",
    body: "Draft body.\n",
    relativePath: "draft/draft-note.md",
    createdAt: "2026-05-21T10:20:00.000Z",
    updatedAt: "2026-05-21T10:20:00.000Z",
    archivedAt: null,
  },
  {
    key: "archived-note",
    title: "Archived Note",
    description: "Visible with all",
    body: "Archived body.\n",
    relativePath: ".data/archive/archived-note.md",
    createdAt: "2026-05-21T10:21:00.000Z",
    updatedAt: "2026-05-21T10:21:00.000Z",
    archivedAt: "2026-05-22T10:21:00.000Z",
  },
]

test("listNotes defaults to normal notes and expands with --drafts and --all visibility", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-list-notes-visibility-"))

  try {
    rebuildIndexStore({ rootPath, notes: VISIBILITY_NOTES })

    assert.deepEqual(listNotes({ override: rootPath }).map((summary) => summary.key), ["normal-note"])
    assert.deepEqual(listNotes({ override: rootPath, visibility: "drafts" }).map((summary) => summary.key), [
      "draft-note",
      "normal-note",
    ])
    assert.deepEqual(listNotes({ override: rootPath, visibility: "all" }).map((summary) => summary.key), [
      "archived-note",
      "draft-note",
      "normal-note",
    ])
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})
