import { test } from "bun:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"

// @ts-expect-error sql.js does not ship TypeScript declarations in this project.
import initSqlJs from "sql.js"

import { IndexUnavailableError } from "../../../src/core/errors"
import { createSearchDocuments } from "../../../src/index/search-documents"
import { loadIndexStore, rebuildIndexStore, updateIndexedNote } from "../../../src/index/index-store"

const NOTE_ALPHA = {
  key: "note-alpha",
  title: "Alpha Note",
  description: "Alpha summary",
  body: "Alpha body mentions project comet.\n",
  relativePath: "notes/inbox/note-alpha.md",
  createdAt: "2026-05-21T10:15:00.000Z",
  updatedAt: "2026-05-21T10:15:00.000Z",
  archivedAt: null,
}

const NOTE_BETA = {
  key: "note-beta",
  title: "Beta Note",
  description: "Nebula planning note",
  body: "Beta body mentions launch windows.\n",
  relativePath: "notes/journal/note-beta.md",
  createdAt: "2026-05-21T11:15:00.000Z",
  updatedAt: "2026-05-21T11:15:00.000Z",
  archivedAt: null,
}

const NOTE_ARCHIVED = {
  key: "note-archived",
  title: "Archived Note",
  description: "Archived nebula summary",
  body: "Archived body mentions hidden comet trails.\n",
  relativePath: "notes/archive/note-archived.md",
  createdAt: "2026-05-21T12:15:00.000Z",
  updatedAt: "2026-05-21T12:15:00.000Z",
  archivedAt: "2026-05-22T09:30:00.000Z",
}

test("rebuildIndexStore writes rebuildable derived artifacts under .data and preserves sidecar metadata", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-index-store-"))

  try {
    const result = rebuildIndexStore({
      rootPath,
      notes: [NOTE_ALPHA, NOTE_BETA],
    })

    assert.equal(result.noteCount, 2)
    assert.equal(result.metadataDatabasePath, path.join(rootPath, ".data", "metadata.sqlite"))
    assert.equal(result.searchIndexPath, path.join(rootPath, ".data", "search-index.json"))

    await access(result.metadataDatabasePath)
    await access(result.searchIndexPath)

    const store = loadIndexStore(rootPath)
    const summaries = store.listSummaries()

    assert.deepEqual(summaries, [
      {
        key: "note-alpha",
        id: "note-alpha",
        title: "Alpha Note",
        description: "Alpha summary",
        relativePath: "notes/inbox/note-alpha.md",
        createdAt: "2026-05-21T10:15:00.000Z",
        updatedAt: "2026-05-21T10:15:00.000Z",
        archivedAt: null,
      },
      {
        key: "note-beta",
        id: "note-beta",
        title: "Beta Note",
        description: "Nebula planning note",
        relativePath: "notes/journal/note-beta.md",
        createdAt: "2026-05-21T11:15:00.000Z",
        updatedAt: "2026-05-21T11:15:00.000Z",
        archivedAt: null,
      },
    ])

    assert.deepEqual(store.search("comet").map((result) => result.key), ["note-alpha"])
    assert.deepEqual(store.search("Nebula planning").map((result) => result.key), ["note-beta"])
    assert.deepEqual(
      store.search("note-beta").map((result) => result.key).includes("note-beta"),
      true,
    )
    assert.deepEqual(
      store.search("journal/note-beta").map((result) => result.key).includes("note-beta"),
      true,
    )
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("derived artifacts can be deleted and recreated from canonical note index records", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-index-store-rebuild-"))

  try {
    const initial = rebuildIndexStore({
      rootPath,
      notes: [NOTE_ALPHA],
    })

    await rm(initial.metadataDatabasePath, { force: true })
    await rm(initial.searchIndexPath, { force: true })

    const recreated = rebuildIndexStore({
      rootPath,
      notes: [NOTE_ALPHA],
    })

    await access(recreated.metadataDatabasePath)
    await access(recreated.searchIndexPath)

    const store = loadIndexStore(rootPath)
    assert.deepEqual(store.search("Alpha summary").map((result) => result.key), ["note-alpha"])
    assert.deepEqual(createSearchDocuments([NOTE_ALPHA]), [
      {
        id: "note-alpha",
        key: "note-alpha",
        title: "Alpha Note",
        description: "Alpha summary",
        body: "Alpha body mentions project comet.\n",
        relativePath: "notes/inbox/note-alpha.md",
      },
    ])
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("loadIndexStore preserves archived metadata in derived artifacts without surfacing archived notes as active results", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-index-store-archived-"))
  const SQL = await initSqlJs()

  try {
    const rebuilt = rebuildIndexStore({
      rootPath,
      notes: [NOTE_ALPHA, NOTE_ARCHIVED],
    })

    const store = loadIndexStore(rootPath)
    assert.deepEqual(store.listSummaries().map((summary) => summary.key), ["note-alpha"])
    assert.deepEqual(store.search("hidden").map((result) => result.key), [])

    const metadataBytes = new Uint8Array(await readFile(rebuilt.metadataDatabasePath))
    const db = new SQL.Database(metadataBytes)

    try {
      const archivedRows = db.exec(`
        SELECT key, archivedAt
        FROM notes
        WHERE key = 'note-archived'
      `)

      assert.deepEqual(archivedRows[0]?.values ?? [], [["note-archived", NOTE_ARCHIVED.archivedAt]])
    } finally {
      db.close()
    }
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("updateIndexedNote upserts one note without rebuilding unrelated search documents", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-index-store-incremental-"))

  try {
    const rebuilt = rebuildIndexStore({
      rootPath,
      notes: [NOTE_ALPHA, NOTE_BETA],
    })
    const initialSearchJson = JSON.parse(await readFile(rebuilt.searchIndexPath, "utf8")) as {
      storedFields?: Record<string, { key?: string; body?: string }>
    }
    const initialStoredFields = Object.values(initialSearchJson.storedFields ?? {})
    assert.equal(initialStoredFields.find((field) => field.key === NOTE_BETA.key)?.body, NOTE_BETA.body)

    const updatedAlpha = {
      ...NOTE_ALPHA,
      title: "Alpha Note Updated",
      description: "Alpha updated summary",
      body: "Alpha replacement body mentions aurora only.\n",
      updatedAt: "2026-05-23T10:15:00.000Z",
    }
    const result = updateIndexedNote(rootPath, updatedAlpha)

    assert.equal(result.noteCount, 2)
    const store = loadIndexStore(rootPath)
    assert.deepEqual(store.search("aurora").map((match) => match.key), ["note-alpha"])
    assert.deepEqual(store.search("project comet").map((match) => match.key), [])
    assert.deepEqual(store.search("launch windows").map((match) => match.key), ["note-beta"])

    const summaries = store.listSummaries()
    assert.equal(summaries.find((summary) => summary.key === NOTE_ALPHA.key)?.title, "Alpha Note Updated")
    assert.equal(summaries.find((summary) => summary.key === NOTE_BETA.key)?.title, NOTE_BETA.title)
    const searchJson = JSON.parse(await readFile(rebuilt.searchIndexPath, "utf8")) as {
      storedFields?: Record<string, { key?: string; body?: string }>
    }
    const storedFields = Object.values(searchJson.storedFields ?? {})
    assert.equal(storedFields.find((field) => field.key === NOTE_ALPHA.key)?.body, updatedAlpha.body)
    assert.equal(storedFields.find((field) => field.key === NOTE_BETA.key)?.body, NOTE_BETA.body)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("updateIndexedNote inserts a new note with a single metadata row and search document", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-index-store-incremental-insert-"))

  try {
    rebuildIndexStore({
      rootPath,
      notes: [NOTE_ALPHA],
    })
    const result = updateIndexedNote(rootPath, NOTE_BETA)

    assert.equal(result.noteCount, 2)
    const store = loadIndexStore(rootPath)
    assert.deepEqual(store.listSummaries().map((summary) => summary.key), ["note-alpha", "note-beta"])
    assert.deepEqual(store.search("launch windows").map((match) => match.key), ["note-beta"])
    assert.deepEqual(store.search("project comet").map((match) => match.key), ["note-alpha"])
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("loadIndexStore wraps corrupt metadata artifacts as IndexUnavailableError with rebuild hint", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-index-store-corrupt-metadata-"))

  try {
    const rebuilt = rebuildIndexStore({
      rootPath,
      notes: [NOTE_ALPHA],
    })

    await writeFile(rebuilt.metadataDatabasePath, "not-a-sqlite-database", "utf8")

    let caughtError: unknown
    try {
      loadIndexStore(rootPath)
      assert.fail("Expected loadIndexStore to throw for corrupt metadata artifacts")
    } catch (error) {
      caughtError = error
    }

    assert.ok(caughtError instanceof IndexUnavailableError)
    assert.equal(caughtError.message, "Derived indexes are unavailable.")
    assert.equal(caughtError.hint, "Run bn rebuild to recreate .data artifacts from note files and sidecars.")
    assert.notEqual(caughtError.cause, undefined)
    assert.equal(caughtError.cause instanceof IndexUnavailableError, false)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("loadIndexStore wraps corrupt search artifacts as IndexUnavailableError with rebuild hint", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-index-store-corrupt-search-"))

  try {
    const rebuilt = rebuildIndexStore({
      rootPath,
      notes: [NOTE_ALPHA],
    })

    await writeFile(rebuilt.searchIndexPath, "{not-valid-json", "utf8")

    let caughtError: unknown
    try {
      loadIndexStore(rootPath)
      assert.fail("Expected loadIndexStore to throw for corrupt search artifacts")
    } catch (error) {
      caughtError = error
    }

    assert.ok(caughtError instanceof IndexUnavailableError)
    assert.equal(caughtError.message, "Derived indexes are unavailable.")
    assert.equal(caughtError.hint, "Run bn rebuild to recreate .data artifacts from note files and sidecars.")
    assert.notEqual(caughtError.cause, undefined)
    assert.equal(caughtError.cause instanceof IndexUnavailableError, false)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})
