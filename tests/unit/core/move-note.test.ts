import { test } from "vitest"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"

import { SelectorNotFoundError, UsageError } from "../../../src/core/errors"
import { moveNote } from "../../../src/core/move-note"
import { createSidecarRepository } from "../../../src/storage/sidecar-repository"
import { enableSyncClientMode, listDirtyRecords } from "./sync-dirty-test-helpers"

async function writeLegacyFrontmatterNote(rootPath: string, input: { key: string; title: string; relativePath: string; body: string }) {
  const notePath = path.join(rootPath, input.relativePath)
  await mkdir(path.dirname(notePath), { recursive: true })
  await writeFile(notePath, [
    "---",
    `id: ${input.key}`,
    "schemaVersion: 1",
    `title: ${input.title}`,
    "mode: plain",
    "tags: []",
    "createdAt: 2026-06-01T00:00:00.000Z",
    "updatedAt: 2026-06-02T00:00:00.000Z",
    "---",
    input.body,
  ].join("\n"), "utf8")
}

async function writeSidecarNote(rootPath: string, input: { key: string; noteId?: string; title: string; relativePath: string; type?: "normal" | "draft" | "archived" }) {
  const notePath = path.join(rootPath, input.relativePath)
  await mkdir(path.dirname(notePath), { recursive: true })
  await mkdir(path.join(rootPath, ".data", "notes"), { recursive: true })
  await writeFile(notePath, `${input.title} body\n`, "utf8")
  await writeFile(path.join(rootPath, ".data", "notes", `${input.noteId ?? input.key}.json`), JSON.stringify({
    type: input.type ?? "normal",
    ...(input.noteId === undefined ? {} : { noteId: input.noteId }),
    key: input.key,
    title: input.title,
    description: "existing description",
    relativePath: input.relativePath,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
    archivedAt: input.type === "archived" ? "2026-06-03T00:00:00.000Z" : null,
    namingVersion: 1,
    ai: { description: { lastProcessedAt: "2026-06-04T00:00:00.000Z" } },
  }, null, 2) + "\n", "utf8")
}

test("moveNote preserves noteId-keyed sidecars while updating the relative path", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-move-note-note-id-"))
  const noteId = "note_move_123"

  try {
    await writeSidecarNote(rootPath, { noteId, key: "roadmap", title: "Roadmap", relativePath: "note/work/roadmap.md" })
    await mkdir(path.join(rootPath, "note", "projects"), { recursive: true })

    const moved = moveNote({
      override: rootPath,
      selector: "roadmap",
      destinationFolder: "note/projects",
      updatedAt: "2026-06-07T11:00:00.000Z",
    })

    assert.equal(moved.previousKey, "roadmap")
    assert.equal(moved.key, "roadmap")
    assert.equal(moved.title, "Roadmap")
    assert.equal(moved.previousRelativePath, "note/work/roadmap.md")
    assert.equal(moved.relativePath, "note/projects/roadmap.md")
    await assert.rejects(readFile(path.join(rootPath, ".data", "notes", "roadmap.json"), "utf8"))

    const sidecar = JSON.parse(await readFile(path.join(rootPath, ".data", "notes", `${noteId}.json`), "utf8"))
    assert.equal(sidecar.noteId, noteId)
    assert.equal(sidecar.key, "roadmap")
    assert.equal(sidecar.title, "Roadmap")
    assert.equal(sidecar.relativePath, "note/projects/roadmap.md")
    assert.equal(sidecar.archivedAt, null)
    assert.equal(sidecar.updatedAt, "2026-06-07T11:00:00.000Z")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("moveNote moves a normal note to an existing note folder and preserves key/title", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-move-note-"))
  try {
    await writeSidecarNote(rootPath, { key: "roadmap", title: "Roadmap", relativePath: "note/work/roadmap.md" })
    await mkdir(path.join(rootPath, "note", "projects"), { recursive: true })

    const moved = moveNote({ override: rootPath, selector: "roadmap", destinationFolder: "note/projects" })

    assert.equal(moved.key, "roadmap")
    assert.equal(moved.title, "Roadmap")
    assert.equal(moved.previousRelativePath, "note/work/roadmap.md")
    assert.equal(moved.relativePath, "note/projects/roadmap.md")
    await assert.rejects(readFile(path.join(rootPath, "note", "work", "roadmap.md"), "utf8"))
    assert.equal(await readFile(path.join(rootPath, "note", "projects", "roadmap.md"), "utf8"), "Roadmap body\n")

    const sidecar = createSidecarRepository(rootPath).read("roadmap")
    assert.equal(sidecar.key, "roadmap")
    assert.equal(sidecar.title, "Roadmap")
    assert.equal(sidecar.description, "existing description")
    assert.equal(sidecar.relativePath, "note/projects/roadmap.md")
    assert.deepEqual(sidecar.ai, { description: { lastProcessedAt: "2026-06-04T00:00:00.000Z" } })
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("moveNote updates latest-opened state when the moved note is currently open", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-move-note-latest-opened-"))
  try {
    await writeSidecarNote(rootPath, { key: "roadmap", title: "Roadmap", relativePath: "note/work/roadmap.md" })
    await mkdir(path.join(rootPath, "note", "projects"), { recursive: true })
    await mkdir(path.join(rootPath, ".data"), { recursive: true })
    await writeFile(path.join(rootPath, ".data", "latest-opened-note.json"), JSON.stringify({
      relativePath: "note/work/roadmap.md",
      openedAt: "2026-06-07T00:00:00.000Z",
    }, null, 2) + "\n", "utf8")

    moveNote({ override: rootPath, selector: "roadmap", destinationFolder: "note/projects" })

    const latest = JSON.parse(await readFile(path.join(rootPath, ".data", "latest-opened-note.json"), "utf8"))
    assert.equal(latest.relativePath, "note/projects/roadmap.md")
    assert.equal(latest.openedAt, "2026-06-07T00:00:00.000Z")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("moveNote rejects drafts and hidden/archive destinations", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-move-note-reject-"))
  try {
    await writeSidecarNote(rootPath, { key: "draft-one", title: "Draft One", relativePath: "draft/draft-one.md", type: "draft" })
    await writeSidecarNote(rootPath, { key: "normal-one", title: "Normal One", relativePath: "note/work/normal-one.md" })
    await mkdir(path.join(rootPath, "note", "target"), { recursive: true })
    await mkdir(path.join(rootPath, ".data", "archive"), { recursive: true })

    assert.throws(() => moveNote({ override: rootPath, selector: "draft-one", destinationFolder: "note/target" }), SelectorNotFoundError)
    assert.throws(() => moveNote({ override: rootPath, selector: "normal-one", destinationFolder: ".data/archive" }), UsageError)
    assert.throws(() => moveNote({ override: rootPath, selector: "normal-one", destinationFolder: "draft" }), UsageError)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("moveNote requires an existing destination folder under note", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-move-note-existing-folder-"))
  try {
    await writeSidecarNote(rootPath, { key: "normal-one", title: "Normal One", relativePath: "note/work/normal-one.md" })

    assert.throws(
      () => moveNote({ override: rootPath, selector: "normal-one", destinationFolder: "note/missing" }),
      (error) => error instanceof UsageError && /existing folder under note/i.test(error.hint ?? ""),
    )
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("moveNote marks the moved note and destination folder dirty in sync-client mode", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-move-note-sync-dirty-"))

  try {
    await enableSyncClientMode(rootPath)
    await writeSidecarNote(rootPath, { noteId: "note_move_dirty", key: "roadmap", title: "Roadmap", relativePath: "note/work/roadmap.md" })
    await mkdir(path.join(rootPath, "note", "projects"), { recursive: true })

    moveNote({
      override: rootPath,
      selector: "roadmap",
      destinationFolder: "note/projects/",
      updatedAt: "2026-06-07T11:00:00.000Z",
    })

    assert.deepEqual(listDirtyRecords(rootPath), [
      {
        entityType: "folder",
        entityId: "note/projects",
        dirtyType: "upsert",
        markedAt: "2026-06-07T11:00:00.000Z",
        attempts: 0,
        lastError: null,
        metadata: { relativePath: "note/projects" },
      },
      {
        entityType: "note",
        entityId: "note_move_dirty",
        dirtyType: "upsert",
        markedAt: "2026-06-07T11:00:00.000Z",
        attempts: 0,
        lastError: null,
        metadata: {
          key: "roadmap",
          previousRelativePath: "note/work/roadmap.md",
          relativePath: "note/projects/roadmap.md",
          title: "Roadmap",
        },
      },
    ])
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})


test("moveNote keeps normalized local move when sync dirty tracking fails", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-move-note-sync-dirty-normalized-failure-"))

  try {
    await enableSyncClientMode(rootPath)
    await writeSidecarNote(rootPath, { noteId: "note_move_normalized_failure", key: "roadmap", title: "Roadmap", relativePath: "note/work/roadmap.md" })
    await mkdir(path.join(rootPath, "note", "projects"), { recursive: true })
    await mkdir(path.join(rootPath, ".data", "sync", "sync.sqlite.lock"), { recursive: true })

    const moved = moveNote({
      override: rootPath,
      selector: "roadmap",
      destinationFolder: String.raw`./note\projects/`,
      updatedAt: "2026-06-07T11:00:00.000Z",
    })

    assert.equal(moved.relativePath, "note/projects/roadmap.md")
    await assert.rejects(readFile(path.join(rootPath, "note", "work", "roadmap.md"), "utf8"))
    assert.equal(await readFile(path.join(rootPath, "note", "projects", "roadmap.md"), "utf8"), "Roadmap body\n")
    const sidecar = JSON.parse(await readFile(path.join(rootPath, ".data", "notes", "note_move_normalized_failure.json"), "utf8"))
    assert.equal(sidecar.relativePath, "note/projects/roadmap.md")
    await rm(path.join(rootPath, ".data", "sync", "sync.sqlite.lock"), { recursive: true, force: true })
    assert.deepEqual(listDirtyRecords(rootPath), [])
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})


test("moveNote does not migrate sidecar-less legacy Markdown when destination validation fails", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-move-note-invalid-legacy-"))
  const legacyRelativePath = "note/work/legacy.md"
  const legacyPath = path.join(rootPath, legacyRelativePath)

  try {
    await writeLegacyFrontmatterNote(rootPath, {
      key: "legacy",
      title: "Legacy",
      relativePath: legacyRelativePath,
      body: "Legacy body.\n",
    })
    const before = await readFile(legacyPath, "utf8")

    assert.throws(
      () => moveNote({ override: rootPath, selector: "legacy", destinationFolder: "note/missing" }),
      UsageError,
    )

    assert.equal(await readFile(legacyPath, "utf8"), before)
    await assert.rejects(readFile(path.join(rootPath, ".data", "notes", "legacy.json"), "utf8"))
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})
