import { test } from "bun:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { access, mkdir, mkdtemp, rm } from "node:fs/promises"

import { archiveNote } from "../../../src/core/archive-note"
import { sidecarJson } from "../../helpers/note-fixtures"
import { createNoteRepository } from "../../../src/storage/note-repository"

async function writeNote(rootPath: string, relativePath: string, markdown: string) {
  const notePath = path.join(rootPath, relativePath)
  await mkdir(path.dirname(notePath), { recursive: true })
  await Bun.write(notePath, markdown)
}

async function writeSidecar(rootPath: string, key: string, json: string) {
  const sidecarPath = path.join(rootPath, ".data", "notes", `${key}.json`)
  await mkdir(path.dirname(sidecarPath), { recursive: true })
  await Bun.write(sidecarPath, json)
}

test("archiveNote moves a selected note into .data/archive and stamps archivedAt", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-archive-note-"))
  const archivedAt = "2026-05-21T12:30:00.000Z"
  const originalRelativePath = "note/archive-me.md"

  try {
    await writeNote(rootPath, originalRelativePath, "Ready to archive.\n")
    await writeSidecar(
      rootPath,
      "archive-me",
      sidecarJson({ key: "archive-me", title: "Archive Me", description: "Ready to archive.", relativePath: originalRelativePath }),
    )

    const summary = archiveNote({
      override: rootPath,
      selector: "archive-me",
      clock: {
        now() {
          return new Date(archivedAt)
        },
      },
    })

    assert.equal(summary.rootPath, rootPath)
    assert.equal(summary.archivedAt, archivedAt)
    assert.equal(summary.relativePath, ".data/archive/archive-me.md")
    assert.equal(summary.notePath, path.join(rootPath, ".data", "archive", "archive-me.md"))

    await assert.rejects(() => access(path.join(rootPath, originalRelativePath)))
    await access(summary.notePath)

    const repository = createNoteRepository(rootPath)
    const archivedNote = repository.read(summary.notePath)
    assert.equal(archivedNote.frontmatter.archivedAt, archivedAt)
    assert.equal(archivedNote.frontmatter.id, "archive-me")
    assert.equal(archivedNote.sourcePath, ".data/archive/archive-me.md")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("archiveNote refuses to select a target when another note already has invalid sidecar metadata", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-archive-note-"))

  try {
    await writeNote(rootPath, "note/archive-me.md", "Ready to archive.\n")
    await writeSidecar(
      rootPath,
      "archive-me",
      sidecarJson({ key: "archive-me", title: "Archive Me", description: "Ready to archive.", relativePath: "note/archive-me.md" }),
    )
    await writeNote(rootPath, "note/journal/invalid-sidecar.md", "Plain body with mismatched metadata.\n")
    await writeSidecar(
      rootPath,
      "invalid-sidecar",
      sidecarJson({
        key: "other-key",
        title: "Invalid Sidecar",
        description: "Broken metadata",
        relativePath: "note/invalid-sidecar.md",
      }),
    )

    assert.throws(
      () =>
        archiveNote({
          override: rootPath,
          selector: "archive-me",
        }),
      /Note metadata for 'other-key' points to 'note[\\/]invalid-sidecar\.md' instead of 'note[\\/]journal[\\/]invalid-sidecar\.md'\./,
    )

    const repository = createNoteRepository(rootPath)
    const original = repository.read(path.join(rootPath, "note", "archive-me.md"))
    assert.equal(original.frontmatter.archivedAt, undefined)
    assert.equal(original.sourcePath, "note/archive-me.md")
    await assert.rejects(() => access(path.join(rootPath, ".data", "archive", "archive-me.md")))
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("archiveNote rejects notes that are already stored under .data/archive", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-archive-note-"))

  try {
    await writeNote(rootPath, ".data/archive/already-archived.md", "Already archived.\n")
    await writeSidecar(
      rootPath,
      "already-archived",
      sidecarJson({
        key: "already-archived",
        title: "Already Archived",
        description: "Already archived.",
        relativePath: ".data/archive/already-archived.md",
        archivedAt: "2026-05-21T11:00:00.000Z",
      }),
    )

    assert.throws(
      () =>
        archiveNote({
          override: rootPath,
          selector: "already-archived",
          visibility: "all",
        }),
      /Note '\.data[\\/]archive[\\/]already-archived\.md' is already archived\./,
    )

    const repository = createNoteRepository(rootPath)
    const archived = repository.read(path.join(rootPath, ".data", "archive", "already-archived.md"))
    assert.equal(archived.frontmatter.archivedAt, "2026-05-21T11:00:00.000Z")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("archiveNote defaults to normal visibility and requires explicit visibility for drafts", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-archive-note-visibility-"))

  try {
    await writeNote(rootPath, "draft/draft-abc123.md", "Draft body.\n")
    await writeSidecar(
      rootPath,
      "draft-abc123",
      sidecarJson({
        key: "draft-abc123",
        title: "draft-abc123",
        description: "Draft body.",
        relativePath: "draft/draft-abc123.md",
        type: "draft",
      }),
    )

    assert.throws(
      () =>
        archiveNote({
          override: rootPath,
          selector: "draft-abc123",
        }),
      /Could not find a note matching selector 'draft-abc123'\./,
    )

    assert.throws(
      () =>
        archiveNote({
          override: rootPath,
          selector: "draft-abc123",
          visibility: "drafts",
        }),
      /Cannot archive non-normal note 'draft[\\/]draft-abc123\.md'\./,
    )

    await access(path.join(rootPath, "draft", "draft-abc123.md"))
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("archiveNote requires all visibility before resolving archived exact paths", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-archive-note-visibility-"))

  try {
    await writeNote(rootPath, ".data/archive/already-archived.md", "Already archived.\n")
    await writeSidecar(
      rootPath,
      "already-archived",
      sidecarJson({
        key: "already-archived",
        title: "Already Archived",
        description: "Already archived.",
        relativePath: ".data/archive/already-archived.md",
        archivedAt: "2026-05-21T11:00:00.000Z",
      }),
    )

    assert.throws(
      () =>
        archiveNote({
          override: rootPath,
          selector: ".data/archive/already-archived.md",
        }),
      /Could not find a note matching selector '\.data[\\/]archive[\\/]already-archived\.md'\./,
    )

    assert.throws(
      () =>
        archiveNote({
          override: rootPath,
          selector: ".data/archive/already-archived.md",
          visibility: "all",
        }),
      /Note '\.data[\\/]archive[\\/]already-archived\.md' is already archived\./,
    )
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("archiveNote rejects active notes whose sidecar has archived metadata", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-archive-note-"))

  try {
    await writeNote(rootPath, "note/archived-flag.md", "Already archived in metadata.\n")
    await writeSidecar(
      rootPath,
      "archived-flag",
      sidecarJson({
        key: "archived-flag",
        title: "Archived Flag",
        description: "Already archived in metadata.",
        relativePath: "note/archived-flag.md",
        archivedAt: "2026-05-21T11:00:00.000Z",
      }),
    )

    assert.throws(
      () =>
        archiveNote({
          override: rootPath,
          selector: "archived-flag",
        }),
      /Could not read note 'note[\\/]archived-flag\.md'\./,
    )

    await access(path.join(rootPath, "note", "archived-flag.md"))
    await assert.rejects(() => access(path.join(rootPath, ".data", "archive", "archived-flag.md")))
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("archiveNote fails when .data/archive already contains the same key", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-archive-note-"))

  try {
    await writeNote(rootPath, "note/duplicate-source.md", "Source note.\n")
    await writeSidecar(
      rootPath,
      "duplicate-source",
      sidecarJson({ key: "duplicate-source", title: "Duplicate Source", description: "Source note.", relativePath: "note/duplicate-source.md" }),
    )
    await writeNote(rootPath, ".data/archive/duplicate-source.md", "Archived first.\n")

    assert.throws(
      () =>
        archiveNote({
          override: rootPath,
          selector: "duplicate-source",
        }),
      /Found duplicate note key 'duplicate-source' for '\.data[\\/]archive[\\/]duplicate-source\.md' and 'note[\\/]duplicate-source\.md'\./,
    )

    const archivedExisting = await Bun.file(path.join(rootPath, ".data", "archive", "duplicate-source.md")).text()
    assert.equal(archivedExisting, "Archived first.\n")

    const original = createNoteRepository(rootPath).read(path.join(rootPath, "note", "duplicate-source.md"))
    assert.equal(original.frontmatter.id, "duplicate-source")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})
