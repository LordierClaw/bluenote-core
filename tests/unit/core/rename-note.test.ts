import { test } from "vitest"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"

import { UsageError } from "../../../src/core/errors"
import { renameNote } from "../../../src/core/rename-note"
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
    "createdAt: 2026-05-21T10:15:00.000Z",
    "updatedAt: 2026-05-21T10:15:00.000Z",
    "---",
    input.body,
  ].join("\n"), "utf8")
}

async function writePlainNoteWithSidecar(
  rootPath: string,
  {
    key,
    noteId,
    title,
    description,
    relativePath,
    body,
  }: {
    key: string
    noteId?: string
    title: string
    description: string
    relativePath: string
    body: string
  },
) {
  const notePath = path.join(rootPath, relativePath)
  const sidecarPath = path.join(rootPath, ".data", "notes", `${noteId ?? key}.json`)

  await mkdir(path.dirname(notePath), { recursive: true })
  await mkdir(path.dirname(sidecarPath), { recursive: true })
  await writeFile(notePath, body, "utf8")
  await writeFile(
    sidecarPath,
    JSON.stringify(
      {
        ...(noteId === undefined ? {} : { noteId }),
        key,
        title,
        description,
        relativePath,
        createdAt: "2026-05-21T10:15:00.000Z",
        updatedAt: "2026-05-21T10:15:00.000Z",
        archivedAt: null,
        type: relativePath.startsWith("draft/") ? "draft" : "normal",
        namingVersion: 1,
        ai: { description: { lastProcessedAt: "2026-06-03T00:00:00.000Z" } },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  )
}

test("renameNote preserves noteId-keyed sidecars while updating mutable metadata", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-rename-note-note-id-"))
  const noteId = "note_rename_123"
  const previousRelativePath = "note/work/original-note.md"

  try {
    await writePlainNoteWithSidecar(rootPath, {
      noteId,
      key: "original-note",
      title: "Original Title",
      description: "Original description.",
      relativePath: previousRelativePath,
      body: "# Original Title\n\nBody before rename.\n",
    })

    const summary = renameNote({
      override: rootPath,
      selector: "original-note",
      title: "Renamed Title",
      body: "# Renamed Title\n\nBody after rename.\n",
      updatedAt: "2026-05-21T12:45:00.000Z",
      randomSource: () => 10,
    })

    assert.equal(summary.previousKey, "original-note")
    assert.equal(summary.key, "renamed-title-00000a")
    assert.equal(summary.previousRelativePath, previousRelativePath)
    assert.equal(summary.relativePath, "note/work/renamed-title-00000a.md")
    await assert.rejects(() => access(path.join(rootPath, ".data", "notes", "original-note.json")))
    await assert.rejects(() => access(path.join(rootPath, ".data", "notes", "renamed-title-00000a.json")))

    const sidecarPath = path.join(rootPath, ".data", "notes", `${noteId}.json`)
    const sidecar = JSON.parse(await readFile(sidecarPath, "utf8")) as {
      noteId: string
      key: string
      title: string
      relativePath: string
      archivedAt: string | null
    }

    assert.equal(sidecar.noteId, noteId)
    assert.equal(sidecar.key, "renamed-title-00000a")
    assert.equal(sidecar.title, "Renamed Title")
    assert.equal(sidecar.relativePath, "note/work/renamed-title-00000a.md")
    assert.equal(sidecar.archivedAt, null)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})


test("renameNote preserves existing body when body is omitted for schema 3 sidecar notes", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-rename-note-body-omitted-"))
  const noteId = "note_rename_body_omitted"
  const previousRelativePath = "note/work/original-note.md"

  try {
    await writePlainNoteWithSidecar(rootPath, {
      noteId,
      key: "original-note",
      title: "Original Title",
      description: "Original description.",
      relativePath: previousRelativePath,
      body: "Body before rename.\n",
    })

    const summary = renameNote({
      override: rootPath,
      selector: "original-note",
      title: "Renamed Title",
      updatedAt: "2026-05-21T12:45:00.000Z",
      randomSource: () => 10,
    })

    assert.equal(summary.key, "renamed-title-00000a")
    assert.equal(await readFile(path.join(rootPath, "note", "work", "renamed-title-00000a.md"), "utf8"), "Body before rename.\n")
    const sidecar = createSidecarRepository(rootPath).readByNoteId(noteId)
    assert.equal(sidecar.description, "Body before rename.")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("renameNote renames the key, file, and sidecar and reports the previous and new key", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-rename-note-"))
  const relativePath = "note/work/original-note.md"

  try {
    await writePlainNoteWithSidecar(rootPath, {
      key: "original-note",
      title: "Original Title",
      description: "Original Title Body before rename.",
      relativePath,
      body: "# Original Title\n\nBody before rename.\n",
    })

    const summary = renameNote({
      override: rootPath,
      selector: "original-note",
      title: "Renamed Title",
      body: "# Renamed Title\n\nBody after rename.\n",
      updatedAt: "2026-05-21T12:45:00.000Z",
      randomSource: () => 10,
    })

    assert.equal(summary.previousKey, "original-note")
    assert.equal(summary.key, "renamed-title-00000a")
    assert.equal(summary.previousRelativePath, relativePath)
    assert.equal(summary.relativePath, "note/work/renamed-title-00000a.md")

    await assert.rejects(() => access(path.join(rootPath, relativePath)))
    await assert.rejects(() => access(path.join(rootPath, ".data", "notes", "original-note.json")))

    const sidecar = createSidecarRepository(rootPath).read("renamed-title-00000a") as {
      ai?: unknown
      description: string
      key: string
      relativePath: string
      title: string
      updatedAt: string
    }

    assert.equal(sidecar.key, "renamed-title-00000a")
    assert.equal(sidecar.title, "Renamed Title")
    assert.equal(sidecar.relativePath, "note/work/renamed-title-00000a.md")
    assert.equal(sidecar.description, "# Renamed Title Body after rename.")
    assert.deepEqual(sidecar.ai, { description: { lastProcessedAt: "2026-06-03T00:00:00.000Z" } })
    assert.equal(sidecar.updatedAt, "2026-05-21T12:45:00.000Z")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("renameNote updates latest-opened when the renamed note is open", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-rename-note-latest-opened-"))

  try {
    await writePlainNoteWithSidecar(rootPath, {
      key: "original-note",
      title: "Original Title",
      description: "Original description.",
      relativePath: "note/work/original-note.md",
      body: "Original body.\n",
    })
    await mkdir(path.join(rootPath, ".data"), { recursive: true })
    await writeFile(path.join(rootPath, ".data", "latest-opened-note.json"), JSON.stringify({
      relativePath: "note/work/original-note.md",
      openedAt: "2026-05-21T11:00:00.000Z",
    }, null, 2) + "\n", "utf8")

    renameNote({
      override: rootPath,
      selector: "original-note",
      title: "Renamed Title",
      body: "Body after rename.\n",
      updatedAt: "2026-05-21T12:45:00.000Z",
      randomSource: () => 10,
    })

    const latest = JSON.parse(await readFile(path.join(rootPath, ".data", "latest-opened-note.json"), "utf8"))
    assert.equal(latest.relativePath, "note/work/renamed-title-00000a.md")
    assert.equal(latest.openedAt, "2026-05-21T11:00:00.000Z")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("renameNote fails cleanly when the generated target key collides", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-rename-note-collision-"))

  try {
    await writePlainNoteWithSidecar(rootPath, {
      key: "original-note",
      title: "Original Title",
      description: "Original Title Body before rename.",
      relativePath: "note/work/original-note.md",
      body: "# Original Title\n\nBody before rename.\n",
    })
    await writePlainNoteWithSidecar(rootPath, {
      key: "renamed-title-00000a",
      title: "Occupied Title",
      description: "Occupied body.",
      relativePath: "note/other/renamed-title-00000a.md",
      body: "Occupied body.\n",
    })

    assert.throws(
      () =>
        renameNote({
          override: rootPath,
          selector: "original-note",
          title: "Renamed Title",
          body: "# Renamed Title\n\nBody after rename.\n",
          updatedAt: "2026-05-21T12:45:00.000Z",
          randomSource: () => 10,
        }),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.match(error.message, /Could not rename note 'note[\\/]work[\\/]original-note\.md'\./)
        assert.match(error.hint ?? "", /generated key already exists/i)
        return true
      },
    )
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("renameNote leaves a recovery artifact behind when rename staging fails", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-rename-note-recovery-"))

  try {
    await writePlainNoteWithSidecar(rootPath, {
      key: "original-note",
      title: "Original Title",
      description: "Original Title Body before rename.",
      relativePath: "note/work/original-note.md",
      body: "# Original Title\n\nBody before rename.\n",
    })

    assert.throws(
      () =>
        renameNote({
          override: rootPath,
          selector: "original-note",
          title: "Renamed Title",
          body: "# Renamed Title\n\nBody after rename.\n",
          updatedAt: "2026-05-21T12:45:00.000Z",
          randomSource: () => 10,
          hooks: {
            onRecoveryArtifactStaged: () => {
              throw new Error("boom during staging")
            },
          },
        }),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.match(error.message, /Could not rename note 'note[\\/]work[\\/]original-note\.md'\./)
        return true
      },
    )

    const recoveryPath = path.join(rootPath, ".data", "recovery")
    let entries: string[] = []

    try {
      entries = (await readdir(recoveryPath)).filter((entry) => entry.endsWith(".json")).sort()
    } catch {
      entries = []
    }

    assert.equal(entries.length, 1)

    const recoveryArtifact = JSON.parse(await readFile(path.join(recoveryPath, entries[0]), "utf8")) as {
      nextKey: string
      previousKey: string
    }

    assert.equal(recoveryArtifact.previousKey, "original-note")
    assert.equal(recoveryArtifact.nextKey, "renamed-title-00000a")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("renameNote marks the renamed note dirty in sync-client mode", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-rename-note-sync-dirty-"))

  try {
    await enableSyncClientMode(rootPath)
    await writePlainNoteWithSidecar(rootPath, {
      noteId: "note_rename_dirty",
      key: "original-note",
      title: "Original Title",
      description: "Original description.",
      relativePath: "note/work/original-note.md",
      body: "Original body.\n",
    })

    renameNote({
      override: rootPath,
      selector: "original-note",
      title: "Renamed Title",
      body: "Renamed body.\n",
      updatedAt: "2026-05-21T12:45:00.000Z",
      randomSource: () => 10,
    })

    assert.deepEqual(listDirtyRecords(rootPath), [
      {
        entityType: "note",
        entityId: "note_rename_dirty",
        dirtyType: "upsert",
        markedAt: "2026-05-21T12:45:00.000Z",
        attempts: 0,
        lastError: null,
        metadata: {
          key: "renamed-title-00000a",
          previousKey: "original-note",
          previousRelativePath: "note/work/original-note.md",
          relativePath: "note/work/renamed-title-00000a.md",
          title: "Renamed Title",
        },
      },
    ])
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})


test("renameNote does not migrate sidecar-less legacy Markdown when title validation fails", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-rename-note-invalid-legacy-"))
  const legacyRelativePath = "note/work/legacy.md"
  const legacyPath = path.join(rootPath, legacyRelativePath)

  try {
    await writeLegacyFrontmatterNote(rootPath, {
      key: "legacy",
      title: "Legacy",
      relativePath: legacyRelativePath,
      body: "Legacy body.\n",
    })
    await writePlainNoteWithSidecar(rootPath, {
      key: "duplicate-title-00000a",
      title: "Duplicate Title",
      description: "Duplicate description.",
      relativePath: "note/work/duplicate-title-00000a.md",
      body: "Duplicate body.\n",
    })
    const before = await readFile(legacyPath, "utf8")

    assert.throws(
      () => renameNote({
        override: rootPath,
        selector: "legacy",
        title: "Duplicate Title",
        body: "Renamed body.\n",
        updatedAt: "2026-05-21T12:45:00.000Z",
        randomSource: () => 10,
      }),
      UsageError,
    )

    assert.equal(await readFile(legacyPath, "utf8"), before)
    await assert.rejects(() => access(path.join(rootPath, ".data", "notes", "legacy.json")))
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})
