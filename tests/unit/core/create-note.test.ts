import { test } from "bun:test"
import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { UsageError } from "../../../src/core/errors"
import { createNote } from "../../../src/core/create-note"
import type { Clock } from "../../../src/platform/clock"
import { getStateNotesPath } from "../../../src/storage/root-layout"

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

    const sidecar = JSON.parse(await readFile(path.join(getStateNotesPath(rootPath), "draft-000zzz.json"), "utf8"))
    assert.equal(sidecar.type, "draft")
    assert.equal(sidecar.key, "draft-000zzz")
    assert.equal(sidecar.title, "draft-000zzz")
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

    const sidecar = JSON.parse(await readFile(path.join(getStateNotesPath(rootPath), "idea-000zzz.json"), "utf8"))
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

    const sidecar = JSON.parse(await readFile(path.join(getStateNotesPath(rootPath), "meeting-000zzz.json"), "utf8"))
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

    const sidecar = JSON.parse(await readFile(path.join(getStateNotesPath(rootPath), "default-destination-000zzz.json"), "utf8"))
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
