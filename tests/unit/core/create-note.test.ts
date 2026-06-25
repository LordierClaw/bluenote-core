import { test } from "vitest"
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { UsageError } from "../../../src/core/errors"
import { createNote } from "../../../src/core/create-note"
import type { Clock } from "../../../src/platform/clock"
import { getAiQueuePath, getStateNotesPath } from "../../../src/storage/root-layout"
import { createAiConfigRepository } from "../../../src/ai/config-repository"
import { enableSyncClientMode, listDirtyRecords, withTempRoot } from "./sync-dirty-test-helpers"

function fixedClock(isoTimestamp: string): Clock {
  return {
    now: () => new Date(isoTimestamp),
  }
}

test("createNote creates an untitled draft with generated draft key and title", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-create-note-draft-generated-"))

  try {
    const created = createNote({
      override: rootPath,
      type: "draft",
      body: "Draft body.\n",
      randomSource: () => 46655,
      clock: fixedClock("2026-06-06T12:00:00.000Z"),
    })

    assert.equal(created.key, "draft-000zzz")
    assert.equal(created.title, "draft-000zzz")
    assert.equal(created.relativePath, "draft/draft-000zzz.md")
    assert.equal(created.notePath, path.join(rootPath, "draft", "draft-000zzz.md"))
    assert.equal(created.description, "Draft body.")
    assert.equal(await readFile(created.notePath, "utf8"), "Draft body.\n")

    const sidecar = JSON.parse(await readFile(path.join(getStateNotesPath(rootPath), `${created.noteId}.json`), "utf8"))
    assert.equal(sidecar.type, "draft")
    assert.equal(sidecar.key, "draft-000zzz")
    assert.equal(sidecar.title, "draft-000zzz")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("createNote does not create dirty records for standalone schema 3 roots", async () => {
  await withTempRoot("bluenote-create-note-standalone-dirty-", (rootPath) => {
    const created = createNote({
      override: rootPath,
      type: "draft",
      title: "Standalone Draft",
      body: "Standalone body.\n",
      noteIdGenerator: () => "note_standalone_dirty",
      randomSource: () => 46655,
      clock: fixedClock("2026-06-06T12:00:00.000Z"),
    })

    assert.equal(created.noteId, "note_standalone_dirty")
    assert.deepEqual(listDirtyRecords(rootPath), [])
  })
})

test("createNote marks the new note dirty in explicit sync-client mode", async () => {
  await withTempRoot("bluenote-create-note-sync-dirty-", async (rootPath) => {
    await enableSyncClientMode(rootPath)

    const created = createNote({
      override: rootPath,
      type: "draft",
      title: "Synced Draft",
      body: "Synced body.\n",
      noteIdGenerator: () => "note_sync_dirty",
      randomSource: () => 46655,
      clock: fixedClock("2026-06-06T12:00:00.000Z"),
    })

    assert.equal(created.noteId, "note_sync_dirty")
    assert.deepEqual(listDirtyRecords(rootPath), [
      {
        entityType: "note",
        entityId: "note_sync_dirty",
        dirtyType: "upsert",
        markedAt: "2026-06-06T12:00:00.000Z",
        attempts: 0,
        lastError: null,
        metadata: {
          key: "synced-draft-000zzz",
          relativePath: "draft/synced-draft-000zzz.md",
          title: "Synced Draft",
        },
      },
    ])
  })
})



test("createNote surfaces sync-client dirty tracking failures", async () => {
  await withTempRoot("bluenote-create-note-sync-dirty-failure-", async (rootPath) => {
    await enableSyncClientMode(rootPath)
    await mkdir(path.join(rootPath, ".data", "sync", "sync.sqlite.lock"), { recursive: true })

    assert.throws(
      () => createNote({
        override: rootPath,
        type: "normal",
        title: "Dirty Failure",
        body: "Dirty failure body.\n",
        destinationFolder: "note",
        enqueueAi: false,
        noteIdGenerator: () => "note_dirty_failure",
        clock: fixedClock("2026-06-06T12:00:00.000Z"),
      }),
      /Could not record sync dirty state for local mutation/,
    )
    assert.equal(existsSync(path.join(rootPath, "note", "dirty-failure.md")), false)
    await rm(path.join(rootPath, ".data", "sync", "sync.sqlite.lock"), { recursive: true, force: true })
    assert.deepEqual(listDirtyRecords(rootPath), [])
  })
})

test("createNote suppresses local AI enqueueing in sync-client mode", async () => {
  await withTempRoot("bluenote-create-note-sync-client-no-local-ai-", async (rootPath) => {
    await enableSyncClientMode(rootPath)
    createAiConfigRepository(rootPath).write({
      version: 1,
      enabled: true,
      provider: "openai-compatible",
      baseUrl: "https://ai.example.test/v1",
      apiKey: "test-key",
      model: "test-model",
      logging: { usage: false, conversations: false, results: false },
    })

    createNote({
      override: rootPath,
      type: "draft",
      title: "Synced AI Draft",
      body: "Do not enqueue local AI in sync-client mode.\n",
      noteIdGenerator: () => "note_sync_no_local_ai",
      randomSource: () => 46655,
      clock: fixedClock("2026-06-06T12:00:00.000Z"),
    })

    await assert.rejects(access(getAiQueuePath(rootPath)))
    assert.equal(listDirtyRecords(rootPath).some((record) => record.entityId === "note_sync_no_local_ai"), true)
  })
})

test("createNote marks canonical destination folder dirty in sync-client mode", async () => {
  await withTempRoot("bluenote-create-note-sync-folder-canonical-", async (rootPath) => {
    await enableSyncClientMode(rootPath)
    await mkdir(path.join(rootPath, "note", "projects"), { recursive: true })

    const created = createNote({
      override: rootPath,
      type: "normal",
      title: "Project Plan",
      destinationFolder: "note/projects/",
      body: "Plan body.\n",
      noteIdGenerator: () => "note_sync_folder_dirty",
      randomSource: () => 46655,
      clock: fixedClock("2026-06-06T12:00:00.000Z"),
    })

    assert.equal(created.relativePath, "note/projects/project-plan-000zzz.md")
    assert.deepEqual(listDirtyRecords(rootPath).map((record) => [record.entityType, record.entityId]), [
      ["folder", "note/projects"],
      ["note", "note_sync_folder_dirty"],
    ])
  })
})

test("createNote records sync dirty state before post-create rebuild validation can fail", async () => {
  await withTempRoot("bluenote-create-note-sync-dirty-rebuild-failure-", async (rootPath) => {
    await enableSyncClientMode(rootPath)
    await writeFile(path.join(rootPath, ".data", "notes", "orphan.json"), JSON.stringify({
      type: "normal",
      key: "orphan",
      title: "Orphan",
      description: "Missing note",
      relativePath: "note/missing/orphan.md",
      createdAt: "2026-06-06T11:00:00.000Z",
      updatedAt: "2026-06-06T11:00:00.000Z",
      archivedAt: null,
      namingVersion: 1,
    }), "utf8")

    assert.throws(
      () => createNote({
        override: rootPath,
        type: "draft",
        title: "Needs Sync",
        body: "Persisted before rebuild failure.\n",
        noteIdGenerator: () => "note_create_rebuild_dirty",
        randomSource: () => 46655,
        clock: fixedClock("2026-06-06T12:00:00.000Z"),
      }),
      /derived indexes could not be rebuilt/i,
    )

    assert.deepEqual(listDirtyRecords(rootPath), [
      {
        entityType: "note",
        entityId: "note_create_rebuild_dirty",
        dirtyType: "upsert",
        markedAt: "2026-06-06T12:00:00.000Z",
        attempts: 0,
        lastError: null,
        metadata: {
          key: "needs-sync-000zzz",
          relativePath: "draft/needs-sync-000zzz.md",
          title: "Needs Sync",
        },
      },
    ])
    assert.equal(await readFile(path.join(rootPath, "draft", "needs-sync-000zzz.md"), "utf8"), "Persisted before rebuild failure.\n")
  })
})

test("createNote fails when sync dirty bookkeeping is temporarily unavailable", async () => {
  await withTempRoot("bluenote-create-note-sync-dirty-failure-", async (rootPath) => {
    await enableSyncClientMode(rootPath)
    await mkdir(path.join(rootPath, ".data", "sync", "sync.sqlite.lock"), { recursive: true })

    assert.throws(
      () => createNote({
        override: rootPath,
        type: "draft",
        title: "Retry Later",
        body: "Local write must not be reported as synced.\n",
        noteIdGenerator: () => "note_dirty_retry_later",
        randomSource: () => 46655,
        clock: fixedClock("2026-06-06T12:00:00.000Z"),
      }),
      /Could not record sync dirty state for local mutation/,
    )
    assert.equal(await readFile(path.join(rootPath, "draft", "retry-later-000zzz.md"), "utf8"), "Local write must not be reported as synced.\n")
  })
})

test("createNote assigns a noteId while preserving the human-readable key and markdown path", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-create-note-note-id-"))

  try {
    const created = createNote({
      override: rootPath,
      type: "draft",
      title: "Readable Idea",
      body: "Draft body.\n",
      randomSource: () => 46655,
      noteIdGenerator: () => "note_test_123",
      clock: fixedClock("2026-06-06T12:00:00.000Z"),
    })

    assert.equal(created.noteId, "note_test_123")
    assert.equal(created.key, "readable-idea-000zzz")
    assert.equal(created.relativePath, "draft/readable-idea-000zzz.md")
    assert.equal(created.notePath, path.join(rootPath, "draft", "readable-idea-000zzz.md"))
    assert.equal(await readFile(created.notePath, "utf8"), "Draft body.\n")

    const sidecarPath = path.join(getStateNotesPath(rootPath), "note_test_123.json")
    const sidecar = JSON.parse(await readFile(sidecarPath, "utf8"))
    assert.equal(sidecar.noteId, "note_test_123")
    assert.equal(sidecar.key, "readable-idea-000zzz")
    assert.equal(sidecar.relativePath, "draft/readable-idea-000zzz.md")
    await assert.rejects(access(path.join(getStateNotesPath(rootPath), "readable-idea-000zzz.json")))
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("createNote rejects generated noteIds that are not storage-safe basenames", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-create-note-bad-note-id-"))

  try {
    assert.throws(
      () =>
        createNote({
          override: rootPath,
          type: "draft",
          title: "Bad Note ID",
          body: "Draft body.\n",
          randomSource: () => 46655,
          noteIdGenerator: () => "note/nested",
          clock: fixedClock("2026-06-06T12:00:00.000Z"),
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /noteId/i)
        return true
      },
    )
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("createNote creates a titled draft under draft", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-create-note-draft-titled-"))

  try {
    const created = createNote({
      override: rootPath,
      type: "draft",
      title: "Idea",
      body: "Named draft body.\n",
      randomSource: () => 46655,
      clock: fixedClock("2026-06-06T12:00:00.000Z"),
    })

    assert.equal(created.key, "idea-000zzz")
    assert.equal(created.title, "Idea")
    assert.equal(created.relativePath, "draft/idea-000zzz.md")

    const sidecar = JSON.parse(await readFile(path.join(getStateNotesPath(rootPath), `${created.noteId}.json`), "utf8"))
    assert.equal(sidecar.type, "draft")
    assert.equal(sidecar.relativePath, "draft/idea-000zzz.md")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("createNote creates a normal note in an existing note destination folder", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-create-note-normal-"))

  try {
    await mkdir(path.join(rootPath, "note", "work"), { recursive: true })

    const created = createNote({
      override: rootPath,
      type: "normal",
      destinationFolder: "note/work",
      title: "Meeting",
      body: "Meeting body.\n",
      randomSource: () => 46655,
      clock: fixedClock("2026-06-06T12:00:00.000Z"),
    })

    assert.equal(created.key, "meeting-000zzz")
    assert.equal(created.title, "Meeting")
    assert.equal(created.relativePath, "note/work/meeting-000zzz.md")
    assert.equal(await readFile(created.notePath, "utf8"), "Meeting body.\n")

    const sidecar = JSON.parse(await readFile(path.join(getStateNotesPath(rootPath), `${created.noteId}.json`), "utf8"))
    assert.equal(sidecar.type, "normal")
    assert.equal(sidecar.relativePath, "note/work/meeting-000zzz.md")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("createNote defaults titled notes to drafts unless normal creation is explicit", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-create-note-titled-default-draft-"))

  try {
    const created = createNote({
      override: rootPath,
      title: "Default destination",
      body: "Default note body.",
      randomSource: () => 46655,
      clock: fixedClock("2026-06-06T12:00:00.000Z"),
    })

    assert.equal(created.key, "default-destination-000zzz")
    assert.equal(created.title, "Default destination")
    assert.equal(created.relativePath, "draft/default-destination-000zzz.md")
    assert.equal(await readFile(created.notePath, "utf8"), "Default note body.")

    const sidecar = JSON.parse(await readFile(path.join(getStateNotesPath(rootPath), `${created.noteId}.json`), "utf8"))
    assert.equal(sidecar.type, "draft")
    assert.equal(sidecar.relativePath, "draft/default-destination-000zzz.md")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("createNote rejects explicit normal creation without a destination folder", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-create-note-normal-missing-destination-"))

  try {
    assert.throws(
      () =>
        createNote({
          override: rootPath,
          type: "normal",
          title: "Missing destination",
          body: "Normal note body.",
          randomSource: () => 46655,
          clock: fixedClock("2026-06-06T12:00:00.000Z"),
        }),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.match(error.message, /Normal note creation requires an explicit destination folder\./)
        return true
      },
    )
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("createNote rejects normal notes in nonexistent or draft destinations", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-create-note-normal-bad-destination-"))

  try {
    assert.throws(
      () =>
        createNote({
          override: rootPath,
          type: "normal",
          destinationFolder: "note/missing",
          title: "Missing folder",
          body: "",
          randomSource: () => 46655,
          clock: fixedClock("2026-06-06T12:00:00.000Z"),
        }),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.match(error.message, /Could not create note 'note[\\/]missing[\\/]missing-folder-000zzz\.md'\./)
        return true
      },
    )

    assert.throws(
      () =>
        createNote({
          override: rootPath,
          type: "normal",
          destinationFolder: "draft",
          title: "Draft folder",
          body: "",
          randomSource: () => 46655,
          clock: fixedClock("2026-06-06T12:00:00.000Z"),
        }),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.match(error.message, /Could not create note 'draft[\\/]draft-folder-000zzz\.md'\./)
        return true
      },
    )
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("createNote rejects duplicate basenames across normal and draft notes", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-create-note-duplicate-key-"))

  try {
    await mkdir(path.join(rootPath, "note", "work"), { recursive: true })

    createNote({
      override: rootPath,
      type: "draft",
      title: "Duplicate",
      body: "Draft.\n",
      randomSource: () => 46655,
      clock: fixedClock("2026-06-06T12:00:00.000Z"),
    })

    assert.throws(
      () =>
        createNote({
          override: rootPath,
          type: "normal",
          destinationFolder: "note/work",
          title: "Duplicate",
          body: "Normal.\n",
          randomSource: () => 46655,
          clock: fixedClock("2026-06-06T12:01:00.000Z"),
        }),
      (error) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /Unable to generate a unique note key/)
        return true
      },
    )
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})
