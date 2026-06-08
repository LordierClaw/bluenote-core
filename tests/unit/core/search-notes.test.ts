import { test } from "bun:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"

import { IndexUnavailableError } from "../../../src/core/errors"
import { listNotes } from "../../../src/core/list-notes"
import { searchNotes } from "../../../src/core/search-notes"
import { rebuildIndexStore, type IndexedNoteRecord } from "../../../src/index/index-store"

const MATCH_NOTES: IndexedNoteRecord[] = [
  {
    key: "moonbeam-title",
    title: "Moonbeam Launch",
    description: "Status review",
    body: "Quiet body text.\n",
    relativePath: "note/moonbeam-title.md",
    createdAt: "2026-05-21T10:15:00.000Z",
    updatedAt: "2026-05-21T10:15:00.000Z",
    archivedAt: null,
  },
  {
    key: "description-match",
    title: "Status Review",
    description: "Moonbeam rollout checklist",
    body: "General body text.\n",
    relativePath: "note/description-match.md",
    createdAt: "2026-05-21T10:16:00.000Z",
    updatedAt: "2026-05-21T10:16:00.000Z",
    archivedAt: null,
  },
  {
    key: "content-match",
    title: "Incident Notes",
    description: "Body-only reference",
    body: "First line stays quiet.\nSecond line mentions moonbeam during deployment.\nThird line closes out.\n",
    relativePath: "note/content-match.md",
    createdAt: "2026-05-21T10:17:00.000Z",
    updatedAt: "2026-05-21T10:17:00.000Z",
    archivedAt: null,
  },
  {
    key: "moonbeam-utility",
    title: "Utility Note",
    description: "Helper index",
    body: "Plain helper text only.\n",
    relativePath: "note/moonbeam-utility.md",
    createdAt: "2026-05-21T10:18:00.000Z",
    updatedAt: "2026-05-21T10:18:00.000Z",
    archivedAt: null,
  },
]

test("searchNotes returns one grouped match per note with ranked source labels", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-search-notes-"))

  try {
    rebuildIndexStore({ rootPath, notes: MATCH_NOTES })

    const results = searchNotes("moonbeam", { override: rootPath })

    assert.deepEqual(results.map((result) => result.key), [
      "moonbeam-title",
      "description-match",
      "content-match",
      "moonbeam-utility",
    ])
    assert.deepEqual(results.map((result) => result.match.label), [
      "title",
      "description",
      "content line 2",
      "key/path",
    ])
    assert.equal(results[2]?.match.excerpt, "...Second line mentions moonbeam during deployment....")
    assert.equal(results[0]?.relativePath, "note/moonbeam-title.md")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("searchNotes does not include fuzzy subsequence-only matches", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-search-notes-no-fuzzy-"))

  try {
    rebuildIndexStore({
      rootPath,
      notes: [
        {
          key: "a-big-cat",
          title: "A Big Cat",
          description: "Feline reference",
          body: "This line mentions a-big-cat but not the compact query.\n",
          relativePath: "note/a-big-cat.md",
          createdAt: "2026-05-21T10:19:00.000Z",
          updatedAt: "2026-05-21T10:19:00.000Z",
          archivedAt: null,
        },
      ],
    })

    assert.deepEqual(searchNotes("abc", { override: rootPath }), [])
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("searchNotes includes title, path, and body matches that contain numeric query", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-search-notes-numeric-"))

  try {
    rebuildIndexStore({
      rootPath,
      notes: [
        {
          key: "receipt-title",
          title: "Receipt 123",
          description: "Purchase record",
          body: "No numeric content here.\n",
          relativePath: "note/receipt-title.md",
          createdAt: "2026-05-21T10:19:00.000Z",
          updatedAt: "2026-05-21T10:19:00.000Z",
          archivedAt: null,
        },
        {
          key: "meeting-path",
          title: "Meeting Notes",
          description: "Planning notes",
          body: "No numeric content here.\n",
          relativePath: "note/meetings/meeting-123.md",
          createdAt: "2026-05-21T10:20:00.000Z",
          updatedAt: "2026-05-21T10:20:00.000Z",
          archivedAt: null,
        },
        {
          key: "body-match",
          title: "Body Only",
          description: "Reference note",
          body: "First line stays quiet.\nTracking code 123 appears here.\n",
          relativePath: "note/body-match.md",
          createdAt: "2026-05-21T10:21:00.000Z",
          updatedAt: "2026-05-21T10:21:00.000Z",
          archivedAt: null,
        },
      ],
    })

    const results = searchNotes("123", { override: rootPath })

    assert.deepEqual(results.map((result) => result.key), ["receipt-title", "body-match", "meeting-path"])
    assert.deepEqual(results.map((result) => result.match.label), ["title", "content line 2", "key/path"])
    assert.equal(results[1]?.match.excerpt, "...Tracking code 123 appears here....")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("searchNotes finds arbitrary substring contains matches that MiniSearch token search misses", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-search-notes-substring-"))

  try {
    rebuildIndexStore({
      rootPath,
      notes: [
        {
          key: "alpha-project",
          title: "Alpha Project",
          description: "Substring fixture",
          body: "Body contains foobar for substring search.\n",
          relativePath: "note/alpha-project.md",
          createdAt: "2026-05-21T10:22:00.000Z",
          updatedAt: "2026-05-21T10:22:00.000Z",
          archivedAt: null,
        },
      ],
    })

    assert.deepEqual(searchNotes("pha", { override: rootPath }).map((result) => result.key), ["alpha-project"])
    const bodyResults = searchNotes("oba", { override: rootPath })
    assert.deepEqual(bodyResults.map((result) => result.key), ["alpha-project"])
    assert.equal(bodyResults[0]?.match.label, "content line 1")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("listNotes prefers derived index summaries when available", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-list-notes-index-"))

  try {
    rebuildIndexStore({ rootPath, notes: [MATCH_NOTES[0]] })

    const summaries = listNotes({ override: rootPath })

    assert.deepEqual(summaries, [
      {
        key: "moonbeam-title",
        title: "Moonbeam Launch",
        createdAt: "2026-05-21T10:15:00.000Z",
        description: "Status review",
        relativePath: "note/moonbeam-title.md",
      },
    ])
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("listNotes filters typed note visibility by default, --drafts, and --all", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-list-notes-visibility-"))

  try {
    rebuildIndexStore({
      rootPath,
      notes: [
        {
          key: "normal-note",
          title: "Normal Note",
          description: "Visible by default",
          body: "Normal searchable body.\n",
          relativePath: "note/normal-note.md",
          createdAt: "2026-05-21T10:19:00.000Z",
          updatedAt: "2026-05-21T10:19:00.000Z",
          archivedAt: null,
        },
        {
          key: "draft-note",
          title: "Draft Note",
          description: "Visible with drafts",
          body: "Draft searchable body.\n",
          relativePath: "draft/draft-note.md",
          createdAt: "2026-05-21T10:20:00.000Z",
          updatedAt: "2026-05-21T10:20:00.000Z",
          archivedAt: null,
        },
        {
          key: "archived-note",
          title: "Archived Note",
          description: "Visible with all",
          body: "Archived searchable body.\n",
          relativePath: ".data/archive/archived-note.md",
          createdAt: "2026-05-21T10:21:00.000Z",
          updatedAt: "2026-05-21T10:21:00.000Z",
          archivedAt: "2026-05-22T10:21:00.000Z",
        },
      ],
    })

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

test("searchNotes filters typed note visibility by default, --drafts, and --all", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-search-notes-visibility-"))

  try {
    rebuildIndexStore({
      rootPath,
      notes: [
        {
          key: "normal-match",
          title: "Normal Match",
          description: "Shared visibility query",
          body: "normal visibility body.\n",
          relativePath: "note/normal-match.md",
          createdAt: "2026-05-21T10:19:00.000Z",
          updatedAt: "2026-05-21T10:19:00.000Z",
          archivedAt: null,
        },
        {
          key: "draft-match",
          title: "Draft Match",
          description: "Shared visibility query",
          body: "draft visibility body.\n",
          relativePath: "draft/draft-match.md",
          createdAt: "2026-05-21T10:20:00.000Z",
          updatedAt: "2026-05-21T10:20:00.000Z",
          archivedAt: null,
        },
        {
          key: "archived-match",
          title: "Archived Match",
          description: "Shared visibility query",
          body: "archived visibility body.\n",
          relativePath: ".data/archive/archived-match.md",
          createdAt: "2026-05-21T10:21:00.000Z",
          updatedAt: "2026-05-21T10:21:00.000Z",
          archivedAt: "2026-05-22T10:21:00.000Z",
        },
      ],
    })

    assert.deepEqual(searchNotes("visibility", { override: rootPath }).map((match) => match.key), ["normal-match"])
    assert.deepEqual(searchNotes("visibility", { override: rootPath, visibility: "drafts" }).map((match) => match.key), [
      "draft-match",
      "normal-match",
    ])
    assert.deepEqual(searchNotes("visibility", { override: rootPath, visibility: "all" }).map((match) => match.key), [
      "draft-match",
      "archived-match",
      "normal-match",
    ])
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("searchNotes returns actionable rebuild guidance when derived indexes are missing", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-search-notes-missing-index-"))

  try {
    assert.throws(
      () => searchNotes("comet", { override: rootPath }),
      (error) => {
        assert.ok(error instanceof IndexUnavailableError)
        assert.equal(error.message, "Derived indexes are unavailable.")
        assert.equal(error.hint, "Run bn rebuild to recreate .data artifacts from note files and sidecars.")
        return true
      },
    )
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})
