import { spyOn, test } from "bun:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"

import { UsageError } from "../../../src/core/errors"
import { parsePlainNote } from "../../../src/storage/plain-note"
import { createNoteRepository } from "../../../src/storage/note-repository"
import { getStateNotesPath, getStateTmpPath } from "../../../src/storage/root-layout"

const FIXED_FRONTMATTER = {
  id: "note-123",
  schemaVersion: 1,
  title: "Example title",
  mode: "plain",
  tags: [],
  createdAt: "2026-05-21T10:15:00.000Z",
  updatedAt: "2026-05-21T10:15:00.000Z",
}

test("repository writes a new note to note", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-"))

  try {
    const repository = createNoteRepository(rootPath)
    const created = repository.create({
      frontmatter: FIXED_FRONTMATTER,
      body: "Hello from BlueNote.\n",
    })

    assert.equal(created.relativePath, "note/note-123.md")
    assert.equal(created.notePath, path.join(rootPath, "note", "note-123.md"))

    const sidecar = JSON.parse(await readFile(path.join(getStateNotesPath(rootPath), "note-123.json"), "utf8"))
    assert.equal(sidecar.type, "normal")
    assert.equal(sidecar.relativePath, "note/note-123.md")
    assert.equal(sidecar.archivedAt, null)

    const loaded = repository.read(created.notePath)
    assert.deepEqual(loaded.frontmatter, FIXED_FRONTMATTER)
    assert.equal(loaded.body, "Hello from BlueNote.\n")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("repository list reads typed normal sidecars produced by create", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-list-sidecars-"))

  try {
    const repository = createNoteRepository(rootPath)
    repository.create({
      frontmatter: FIXED_FRONTMATTER,
      body: "List body.\n",
    })

    const notes = repository.list()

    assert.equal(notes.length, 1)
    assert.equal(notes[0]?.sourcePath, "note/note-123.md")
    assert.deepEqual(notes[0]?.frontmatter, FIXED_FRONTMATTER)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("repository creates a draft note under draft with a typed sidecar", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-draft-"))

  try {
    const repository = createNoteRepository(rootPath)
    const created = repository.create({
      frontmatter: {
        ...FIXED_FRONTMATTER,
        id: "draft-000zzz",
        title: "draft-000zzz",
      },
      body: "Draft body.\n",
      destination: { type: "draft" },
    })

    assert.equal(created.relativePath, "draft/draft-000zzz.md")
    assert.equal(created.notePath, path.join(rootPath, "draft", "draft-000zzz.md"))

    const sidecar = JSON.parse(await readFile(path.join(getStateNotesPath(rootPath), "draft-000zzz.json"), "utf8"))
    assert.equal(sidecar.type, "draft")
    assert.equal(sidecar.key, "draft-000zzz")
    assert.equal(sidecar.title, "draft-000zzz")
    assert.equal(sidecar.relativePath, "draft/draft-000zzz.md")
    assert.equal(await readFile(created.notePath, "utf8"), "Draft body.\n")

    const notes = repository.list()
    assert.equal(notes.length, 1)
    assert.equal(notes[0]?.sourcePath, "draft/draft-000zzz.md")
    assert.equal(notes[0]?.frontmatter.id, "draft-000zzz")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("repository creates a normal note in an existing note destination folder", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-normal-destination-"))

  try {
    await mkdir(path.join(rootPath, "note", "work"), { recursive: true })
    const repository = createNoteRepository(rootPath)
    const created = repository.create({
      frontmatter: FIXED_FRONTMATTER,
      body: "Normal body.\n",
      destination: { type: "normal", folderRelativePath: "note/work" },
    })

    assert.equal(created.relativePath, "note/work/note-123.md")
    assert.equal(created.notePath, path.join(rootPath, "note", "work", "note-123.md"))

    const sidecar = JSON.parse(await readFile(path.join(getStateNotesPath(rootPath), "note-123.json"), "utf8"))
    assert.equal(sidecar.type, "normal")
    assert.equal(sidecar.relativePath, "note/work/note-123.md")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("repository rejects normal creation without an existing note destination folder", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-normal-missing-folder-"))

  try {
    const repository = createNoteRepository(rootPath)

    assert.throws(
      () =>
        repository.create({
          frontmatter: FIXED_FRONTMATTER,
          body: "",
          destination: { type: "normal", folderRelativePath: "note/missing" },
        }),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.match(error.message, /Could not create note 'note[\\/]missing[\\/]note-123\.md'\./)
        assert.match(error.hint ?? "", /existing folder under note/i)
        return true
      },
    )
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("repository rejects normal creation when a note destination folder escapes through a symlink", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-normal-symlink-"))
  const externalPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-outside-"))

  try {
    await mkdir(path.join(rootPath, "note"), { recursive: true })
    await symlink(externalPath, path.join(rootPath, "note", "escape"), "dir")
    const repository = createNoteRepository(rootPath)

    assert.throws(
      () =>
        repository.create({
          frontmatter: FIXED_FRONTMATTER,
          body: "",
          destination: { type: "normal", folderRelativePath: "note/escape" },
        }),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.match(error.message, /Could not create note 'note[\\/]escape[\\/]note-123\.md'\./)
        assert.match(error.hint ?? "", /existing folder under note/i)
        return true
      },
    )

    await assert.rejects(access(path.join(externalPath, "note-123.md")))
  } finally {
    await rm(rootPath, { recursive: true, force: true })
    await rm(externalPath, { recursive: true, force: true })
  }
})

test("repository rejects normal creation under draft", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-normal-draft-folder-"))

  try {
    await mkdir(path.join(rootPath, "draft"), { recursive: true })
    const repository = createNoteRepository(rootPath)

    assert.throws(
      () =>
        repository.create({
          frontmatter: FIXED_FRONTMATTER,
          body: "",
          destination: { type: "normal", folderRelativePath: "draft" },
        }),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.match(error.message, /Could not create note 'draft[\\/]note-123\.md'\./)
        assert.match(error.hint ?? "", /existing folder under note/i)
        return true
      },
    )
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("repository enforces global key uniqueness across note, draft, and sidecars", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-global-key-"))

  try {
    const repository = createNoteRepository(rootPath)
    repository.create({
      frontmatter: {
        ...FIXED_FRONTMATTER,
        id: "shared-key",
        title: "shared-key",
      },
      body: "Draft body.\n",
      destination: { type: "draft" },
    })

    assert.equal(repository.keyExists("shared-key"), true)
    await mkdir(path.join(rootPath, "note"), { recursive: true })
    assert.throws(
      () =>
        repository.create({
          frontmatter: {
            ...FIXED_FRONTMATTER,
            id: "shared-key",
            title: "Normal title",
          },
          body: "Normal body.\n",
          destination: { type: "normal", folderRelativePath: "note" },
        }),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.match(error.message, /Could not create note 'note[\\/]shared-key\.md'\./)
        assert.match(error.hint ?? "", /same basename\/key already exists/i)
        return true
      },
    )
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("repository archive writes an archived sidecar type", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-archive-type-"))

  try {
    const repository = createNoteRepository(rootPath)
    const created = repository.create({
      frontmatter: FIXED_FRONTMATTER,
      body: "Archive body.\n",
    })

    const archived = repository.archive(created.notePath, "2026-05-21T12:30:00.000Z")
    const sidecar = JSON.parse(await readFile(path.join(getStateNotesPath(rootPath), "note-123.json"), "utf8"))

    assert.equal(archived.relativePath, ".data/archive/note-123.md")
    assert.equal(sidecar.type, "archived")
    assert.equal(sidecar.relativePath, ".data/archive/note-123.md")
    assert.equal(sidecar.archivedAt, "2026-05-21T12:30:00.000Z")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("note file contains the canonical plain-note body", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-frontmatter-"))

  try {
    const repository = createNoteRepository(rootPath)
    const created = repository.create({
      frontmatter: FIXED_FRONTMATTER,
      body: "A body line.\nAnother line.\n",
    })

    const markdown = await readFile(created.notePath, "utf8")
    const parsedNote = parsePlainNote(markdown, created.relativePath)

    assert.equal(parsedNote.body, "A body line.\nAnother line.\n")
    assert.equal(markdown, "A body line.\nAnother line.\n")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("repository wraps note creation filesystem failures in a UsageError", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-create-error-"))
  const blockedRoot = path.join(tempRoot, "blocked-root")

  try {
    await writeFile(blockedRoot, "not a directory")

    const repository = createNoteRepository(blockedRoot)

    assert.throws(
      () => repository.create({ frontmatter: FIXED_FRONTMATTER, body: "" }),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.match(error.message, /Could not create note 'note[\\/]note-123\.md'\./)
        assert.equal(error.hint, "Ensure BLUENOTE_ROOT points to a writable directory path.")

        return true
      },
    )
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test("repository wraps note read filesystem failures in a UsageError", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-read-error-"))

  try {
    const repository = createNoteRepository(rootPath)

    assert.throws(
      () => repository.read(path.join(rootPath, "note", "missing.md")),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.match(error.message, /Could not read note 'note[\\/]missing\.md'\./)
        assert.equal(error.hint, "Ensure the note exists inside BLUENOTE_ROOT and is readable.")

        return true
      },
    )
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("repository archive rolls back the destination file when removing the source fails", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-archive-rollback-"))
  const inboxPath = path.join(rootPath, "note")
  const archivePath = path.join(rootPath, ".data", "archive")
  const sourcePath = path.join(inboxPath, "note-123.md")
  const archivedPath = path.join(archivePath, "note-123.md")

  try {
    await mkdir(inboxPath, { recursive: true })
    await mkdir(archivePath, { recursive: true })
    await writeFile(
      sourcePath,
      `---\nid: note-123\nschemaVersion: 1\ntitle: Example title\nmode: plain\ntags: []\ncreatedAt: 2026-05-21T10:15:00.000Z\nupdatedAt: 2026-05-21T10:15:00.000Z\n---\nHello from BlueNote.\n`,
      "utf8",
    )

    const repository = createNoteRepository(rootPath)
    const originalRmSync = fs.rmSync
    const sourceRemovalFailure = new Error("simulated source removal failure")
    const rmMock = spyOn(fs, "rmSync").mockImplementation((...args: Parameters<typeof fs.rmSync>) => {
      const [targetPath] = args

      if (path.resolve(String(targetPath)) === path.resolve(sourcePath)) {
        throw sourceRemovalFailure
      }

      return originalRmSync(...args)
    })

    try {
      assert.throws(
        () => repository.archive(sourcePath, "2026-05-21T12:30:00.000Z"),
        (error) => {
          assert.ok(error instanceof UsageError)
          assert.match(error.message, /Could not archive note 'note[\\/]note-123\.md'\./)
          assert.equal(error.hint, "Ensure the note exists inside BLUENOTE_ROOT and the archive path is writable.")
          assert.equal(error.cause, sourceRemovalFailure)
          return true
        },
      )
    } finally {
      rmMock.mockRestore()
    }

    await access(sourcePath)
    await assert.rejects(() => access(archivedPath))
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("syncEditedNote preserves the previous note body when the atomic body write fails", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-sync-atomic-failure-"))

  try {
    const repository = createNoteRepository(rootPath)
    const created = repository.create({
      frontmatter: FIXED_FRONTMATTER,
      body: "Original body.\n",
    })
    const stateTmpPath = getStateTmpPath(rootPath)

    await symlink(os.tmpdir(), stateTmpPath)

    assert.throws(
      () =>
        repository.syncEditedNote(created.notePath, {
          title: "Updated title",
          body: "Updated body.\n",
          updatedAt: "2026-05-21T12:30:00.000Z",
        }),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.match(error.message, /Could not update note 'note[\\/]note-123\.md'\./)
        assert.equal(error.hint, "Ensure the note and its sidecar are writable inside BLUENOTE_ROOT.")
        assert.ok(error.cause instanceof UsageError)
        assert.match(error.cause.message, /atomic note writer path .* must not be a symlink/i)
        return true
      },
    )

    assert.equal(await readFile(created.notePath, "utf8"), "Original body.\n")
    const sidecar = JSON.parse(await readFile(path.join(getStateNotesPath(rootPath), "note-123.json"), "utf8"))
    assert.equal(sidecar.title, "Example title")
    assert.equal(sidecar.description, "Original body.")
    assert.equal(sidecar.updatedAt, "2026-05-21T10:15:00.000Z")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("syncEditedNote rolls back the body with the atomic writer when sidecar persistence fails", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-sync-sidecar-failure-"))

  try {
    const repository = createNoteRepository(rootPath)
    const created = repository.create({
      frontmatter: FIXED_FRONTMATTER,
      body: "Original body.\n",
    })
    const sidecarPath = path.join(getStateNotesPath(rootPath), "note-123.json")
    const originalSidecar = await readFile(sidecarPath, "utf8")
    const originalWriteFileSync = fs.writeFileSync
    const sidecarFailure = new Error("simulated sidecar write failure")
    const writeFileMock = spyOn(fs, "writeFileSync").mockImplementation((...args: Parameters<typeof fs.writeFileSync>) => {
      const [target] = args

      if (path.resolve(String(target)).startsWith(path.resolve(sidecarPath))) {
        throw sidecarFailure
      }

      return originalWriteFileSync(...args)
    })

    try {
      assert.throws(
        () =>
          repository.syncEditedNote(created.notePath, {
            title: "Updated title",
            body: "Updated body.\n",
            updatedAt: "2026-05-21T12:30:00.000Z",
          }),
        (error) => {
          assert.ok(error instanceof UsageError)
          assert.match(error.message, /Could not update note 'note[\\/]note-123\.md'\./)
          assert.ok(error.cause instanceof UsageError)
          assert.equal(error.cause.cause, sidecarFailure)
          return true
        },
      )
    } finally {
      writeFileMock.mockRestore()
    }

    assert.equal(await readFile(created.notePath, "utf8"), "Original body.\n")
    assert.equal(await readFile(sidecarPath, "utf8"), originalSidecar)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("repository renames a normal note title, path, key, and sidecar while preserving durable metadata", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-rename-normal-"))

  try {
    await mkdir(path.join(rootPath, "note", "work"), { recursive: true })
    await mkdir(getStateNotesPath(rootPath), { recursive: true })
    await writeFile(path.join(rootPath, "note", "work", "old-title.md"), "Old body.\n", "utf8")
    await writeFile(path.join(getStateNotesPath(rootPath), "old-title.json"), JSON.stringify({
      type: "normal", key: "old-title", title: "Old Title", description: "Preserved description", relativePath: "note/work/old-title.md", createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-02T00:00:00.000Z", archivedAt: null, namingVersion: 1, ai: { description: { lastProcessedAt: "2026-06-03T00:00:00.000Z" } },
    }, null, 2) + "\n", "utf8")

    const repository = createNoteRepository(rootPath)
    const renamed = repository.rename(path.join(rootPath, "note", "work", "old-title.md"), {
      nextKey: "new-title",
      title: "New Title",
      body: "New body.\n",
      updatedAt: "2026-06-04T00:00:00.000Z",
    })

    assert.equal(renamed.relativePath, "note/work/new-title.md")
    await assert.rejects(access(path.join(rootPath, "note", "work", "old-title.md")))
    await assert.rejects(access(path.join(getStateNotesPath(rootPath), "old-title.json")))
    assert.equal(await readFile(path.join(rootPath, "note", "work", "new-title.md"), "utf8"), "New body.\n")
    const sidecar = JSON.parse(await readFile(path.join(getStateNotesPath(rootPath), "new-title.json"), "utf8"))
    assert.equal(sidecar.key, "new-title")
    assert.equal(sidecar.title, "New Title")
    assert.equal(sidecar.relativePath, "note/work/new-title.md")
    assert.equal(sidecar.createdAt, "2026-06-01T00:00:00.000Z")
    assert.equal(sidecar.description, "New body.")
    assert.deepEqual(sidecar.ai, { description: { lastProcessedAt: "2026-06-03T00:00:00.000Z" } })
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("repository renames a custom note folder and only updates affected sidecar paths", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-rename-folder-"))

  try {
    await mkdir(path.join(rootPath, "note", "work", "nested"), { recursive: true })
    await mkdir(path.join(rootPath, "note", "other"), { recursive: true })
    await mkdir(getStateNotesPath(rootPath), { recursive: true })
    await writeFile(path.join(rootPath, "note", "work", "a.md"), "A\n", "utf8")
    await writeFile(path.join(rootPath, "note", "work", "nested", "b.md"), "B\n", "utf8")
    await writeFile(path.join(rootPath, "note", "other", "c.md"), "C\n", "utf8")
    for (const [key, relativePath] of [["a", "note/work/a.md"], ["b", "note/work/nested/b.md"], ["c", "note/other/c.md"]] as const) {
      await writeFile(path.join(getStateNotesPath(rootPath), `${key}.json`), JSON.stringify({
        type: "normal", key, title: key, description: key, relativePath, createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z", archivedAt: null, namingVersion: 1,
      }, null, 2) + "\n", "utf8")
    }

    const repository = createNoteRepository(rootPath)
    repository.renameFolder("note/work", "client")

    assert.equal(JSON.parse(await readFile(path.join(getStateNotesPath(rootPath), "a.json"), "utf8")).relativePath, "note/client/a.md")
    assert.equal(JSON.parse(await readFile(path.join(getStateNotesPath(rootPath), "b.json"), "utf8")).relativePath, "note/client/nested/b.md")
    assert.equal(JSON.parse(await readFile(path.join(getStateNotesPath(rootPath), "c.json"), "utf8")).relativePath, "note/other/c.md")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("repository rejects protected folder renames", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-rename-folder-reject-"))

  try {
    const repository = createNoteRepository(rootPath)
    assert.throws(() => repository.renameFolder("note", "renamed"), UsageError)
    assert.throws(() => repository.renameFolder("draft", "renamed"), UsageError)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("repository rolls back folder rename when sidecar updates fail", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-rename-folder-rollback-"))

  try {
    const repository = createNoteRepository(rootPath)
    await mkdir(path.join(rootPath, "note", "work"), { recursive: true })
    const created = repository.create({
      frontmatter: { ...FIXED_FRONTMATTER, id: "work-note", title: "Work note" },
      body: "Work body.\n",
      destination: { type: "normal", folderRelativePath: "note/work" },
    })
    await writeFile(path.join(getStateNotesPath(rootPath), "broken.json"), "{not valid json", "utf8")

    assert.throws(
      () => repository.renameFolder("note/work", "renamed-work"),
      UsageError,
    )

    await access(path.join(rootPath, "note", "work"))
    await assert.rejects(access(path.join(rootPath, "note", "renamed-work")))
    assert.equal(repository.read(created.notePath).frontmatter.id, "work-note")
    const sidecar = JSON.parse(await readFile(path.join(getStateNotesPath(rootPath), "work-note.json"), "utf8"))
    assert.equal(sidecar.relativePath, "note/work/work-note.md")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("repository move updates sidecar relativePath and updatedAt together", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-move-updated-at-"))

  try {
    const repository = createNoteRepository(rootPath)
    await mkdir(path.join(rootPath, "note", "work", "projects"), { recursive: true })
    const created = repository.create({
      frontmatter: { ...FIXED_FRONTMATTER, id: "move-note", title: "Move note", updatedAt: "2026-05-21T10:15:00.000Z" },
      body: "Move body.\n",
      destination: { type: "normal", folderRelativePath: "note/work" },
    })

    repository.moveNote(created.notePath, "note/work/projects", "2026-06-07T10:00:00.000Z")

    const sidecar = JSON.parse(await readFile(path.join(getStateNotesPath(rootPath), "move-note.json"), "utf8"))
    assert.equal(sidecar.relativePath, "note/work/projects/move-note.md")
    assert.equal(sidecar.updatedAt, "2026-06-07T10:00:00.000Z")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})
