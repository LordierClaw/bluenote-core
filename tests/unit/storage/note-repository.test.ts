import { test } from "vitest"
import assert from "node:assert/strict"
import fs from "node:fs"

type MockedMethod<T, K extends keyof T> = { mock: { restore(): void } }

function mockMethod<T extends object, K extends keyof T>(object: T, method: K, implementation: T[K]): MockedMethod<T, K> {
  const original = object[method]
  object[method] = implementation
  return {
    mock: {
      restore() {
        object[method] = original
      },
    },
  }
}
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

test("repository writes schema 3 sidecars by noteId while preserving key and markdown path", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-note-id-"))

  try {
    const repository = createNoteRepository(rootPath)
    const created = repository.create({
      noteId: "note_repo_123",
      frontmatter: FIXED_FRONTMATTER,
      body: "Hello from BlueNote.\n",
    })

    assert.equal(created.relativePath, "note/note-123.md")
    assert.equal(created.notePath, path.join(rootPath, "note", "note-123.md"))
    assert.equal(await readFile(created.notePath, "utf8"), "Hello from BlueNote.\n")

    const sidecarPath = path.join(getStateNotesPath(rootPath), "note_repo_123.json")
    const sidecar = JSON.parse(await readFile(sidecarPath, "utf8"))
    assert.equal(sidecar.noteId, "note_repo_123")
    assert.equal(sidecar.key, "note-123")
    assert.equal(sidecar.relativePath, "note/note-123.md")
    await assert.rejects(access(path.join(getStateNotesPath(rootPath), "note-123.json")))

    const loaded = repository.read(created.notePath)
    assert.deepEqual(loaded.frontmatter, FIXED_FRONTMATTER)
    assert.equal(loaded.body, "Hello from BlueNote.\n")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})



test("repository rejects custom noteIds that shadow an existing note key", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-noteid-key-shadow-"))

  try {
    const repository = createNoteRepository(rootPath)
    repository.create({
      noteId: "note_existing_key_shadow",
      frontmatter: { ...FIXED_FRONTMATTER, id: "existing-key", title: "Existing Key" },
      body: "Existing body.\n",
    })

    assert.throws(
      () => repository.create({
        noteId: "existing-key",
        frontmatter: { ...FIXED_FRONTMATTER, id: "new-key", title: "New Key" },
        body: "New body.\n",
      }),
      UsageError,
    )

    await assert.rejects(access(path.join(getStateNotesPath(rootPath), "existing-key.json")))
    assert.equal(await readFile(path.join(rootPath, "note", "existing-key.md"), "utf8"), "Existing body.\n")
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

test("repository read ignores unrelated malformed sidecars when noteId sidecar lookup scans", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-bad-unrelated-sidecar-"))

  try {
    const repository = createNoteRepository(rootPath)
    const created = repository.create({
      noteId: "note_valid_sidecar_scan",
      frontmatter: FIXED_FRONTMATTER,
      body: "Readable body.\n",
    })
    await writeFile(path.join(getStateNotesPath(rootPath), "aaa_bad_unrelated.json"), "{ not valid json", "utf8")

    const loaded = repository.read(created.notePath)

    assert.deepEqual(loaded.frontmatter, FIXED_FRONTMATTER)
    assert.equal(loaded.body, "Readable body.\n")
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

test("repository enforces global key uniqueness against noteId-keyed sidecars", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-note-id-key-collision-"))

  try {
    const repository = createNoteRepository(rootPath)
    const sidecarPath = path.join(getStateNotesPath(rootPath), "note_orphan_123.json")
    await mkdir(path.dirname(sidecarPath), { recursive: true })
    await writeFile(sidecarPath, JSON.stringify({
      type: "normal",
      noteId: "note_orphan_123",
      key: "shared-key",
      title: "Shared key",
      description: "Existing sidecar",
      relativePath: "note/shared-key.md",
      createdAt: "2026-05-21T10:15:00.000Z",
      updatedAt: "2026-05-21T10:15:00.000Z",
      archivedAt: null,
      namingVersion: 1,
    }), "utf8")

    assert.equal(repository.keyExists("shared-key"), true)
    assert.throws(
      () =>
        repository.create({
          frontmatter: {
            ...FIXED_FRONTMATTER,
            id: "shared-key",
            title: "Normal title",
          },
          body: "Normal body.\n",
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
    const rmMock = mockMethod(fs, "rmSync", (...args: Parameters<typeof fs.rmSync>) => {
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
      rmMock.mock.restore()
    }

    await access(sourcePath)
    await assert.rejects(() => access(archivedPath))
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("repository mutations preserve noteId-keyed sidecars without creating legacy sidecars", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-note-id-mutations-"))

  try {
    const repository = createNoteRepository(rootPath)
    await mkdir(path.join(rootPath, "note", "work", "projects"), { recursive: true })
    const created = repository.create({
      noteId: "note_mutation_123",
      frontmatter: { ...FIXED_FRONTMATTER, id: "mutation-note", title: "Mutation Note" },
      body: "Original body.\n",
      destination: { type: "normal", folderRelativePath: "note/work" },
    })
    const sidecarPath = path.join(getStateNotesPath(rootPath), "note_mutation_123.json")
    const legacySidecarPath = path.join(getStateNotesPath(rootPath), "mutation-note.json")

    repository.syncEditedNote(created.notePath, {
      title: "Mutation Note Edited",
      body: "Edited body.\n",
      updatedAt: "2026-06-07T10:00:00.000Z",
    })

    let sidecar = JSON.parse(await readFile(sidecarPath, "utf8"))
    assert.equal(sidecar.noteId, "note_mutation_123")
    assert.equal(sidecar.key, "mutation-note")
    assert.equal(sidecar.description, "Edited body.")
    await assert.rejects(access(legacySidecarPath))

    const moved = repository.moveNote(created.notePath, "note/work/projects", "2026-06-07T11:00:00.000Z")
    sidecar = JSON.parse(await readFile(sidecarPath, "utf8"))
    assert.equal(sidecar.noteId, "note_mutation_123")
    assert.equal(sidecar.relativePath, "note/work/projects/mutation-note.md")
    assert.equal(sidecar.updatedAt, "2026-06-07T11:00:00.000Z")
    await assert.rejects(access(legacySidecarPath))

    const archived = repository.archive(moved.notePath, "2026-06-07T12:00:00.000Z")
    sidecar = JSON.parse(await readFile(sidecarPath, "utf8"))
    assert.equal(sidecar.noteId, "note_mutation_123")
    assert.equal(sidecar.type, "archived")
    assert.equal(sidecar.relativePath, ".data/archive/mutation-note.md")
    assert.equal(sidecar.archivedAt, "2026-06-07T12:00:00.000Z")
    await assert.rejects(access(legacySidecarPath))

    repository.delete(archived.notePath)
    await assert.rejects(access(sidecarPath))
    await assert.rejects(access(legacySidecarPath))
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("repository rename preserves noteId-keyed sidecar path", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-note-id-rename-"))

  try {
    const repository = createNoteRepository(rootPath)
    await mkdir(path.join(rootPath, "note", "work"), { recursive: true })
    const created = repository.create({
      noteId: "note_rename_123",
      frontmatter: { ...FIXED_FRONTMATTER, id: "old-title", title: "Old Title" },
      body: "Original body.\n",
      destination: { type: "normal", folderRelativePath: "note/work" },
    })
    const sidecarPath = path.join(getStateNotesPath(rootPath), "note_rename_123.json")

    const renamed = repository.rename(created.notePath, {
      nextKey: "new-title",
      title: "New Title",
      body: "Renamed body.\n",
      updatedAt: "2026-06-07T10:00:00.000Z",
    })

    assert.equal(renamed.relativePath, "note/work/new-title.md")
    const sidecar = JSON.parse(await readFile(sidecarPath, "utf8"))
    assert.equal(sidecar.noteId, "note_rename_123")
    assert.equal(sidecar.key, "new-title")
    assert.equal(sidecar.relativePath, "note/work/new-title.md")
    await assert.rejects(access(path.join(getStateNotesPath(rootPath), "old-title.json")))
    await assert.rejects(access(path.join(getStateNotesPath(rootPath), "new-title.json")))
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("repository rename rejects keys that collide with noteId sidecar filenames", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-rename-noteid-collision-"))

  try {
    const repository = createNoteRepository(rootPath)
    await mkdir(path.join(rootPath, "note", "work"), { recursive: true })
    const first = repository.create({
      noteId: "note_collision_target",
      frontmatter: { ...FIXED_FRONTMATTER, id: "first-note", title: "First Note" },
      body: "First body.\n",
      destination: { type: "normal", folderRelativePath: "note/work" },
    })
    const second = repository.create({
      noteId: "note_other",
      frontmatter: { ...FIXED_FRONTMATTER, id: "second-note", title: "Second Note" },
      body: "Second body.\n",
      destination: { type: "normal", folderRelativePath: "note/work" },
    })

    assert.throws(
      () => repository.rename(second.notePath, {
        nextKey: "note_collision_target",
        title: "Collision Target",
        body: "Renamed body.\n",
        updatedAt: "2026-06-07T10:00:00.000Z",
      }),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.match(error.hint ?? "", /already exists/i)
        return true
      },
    )
    assert.equal(repository.read(first.notePath).frontmatter.id, "first-note")
    assert.equal(repository.read(second.notePath).frontmatter.id, "second-note")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("repository rename restores noteId-keyed sidecar when removing the old note fails", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-note-id-rename-rollback-"))

  try {
    const repository = createNoteRepository(rootPath)
    await mkdir(path.join(rootPath, "note", "work"), { recursive: true })
    const created = repository.create({
      noteId: "note_rename_rollback_123",
      frontmatter: { ...FIXED_FRONTMATTER, id: "old-title", title: "Old Title" },
      body: "Original body.\n",
      destination: { type: "normal", folderRelativePath: "note/work" },
    })
    const sidecarPath = path.join(getStateNotesPath(rootPath), "note_rename_rollback_123.json")
    const originalSidecar = await readFile(sidecarPath, "utf8")
    const originalRmSync = fs.rmSync
    const removeFailure = new Error("simulated old note removal failure")
    const rmMock = mockMethod(fs, "rmSync", (...args: Parameters<typeof fs.rmSync>) => {
      const [targetPath] = args

      if (path.resolve(String(targetPath)) === path.resolve(created.notePath)) {
        throw removeFailure
      }

      return originalRmSync(...args)
    })

    try {
      assert.throws(
        () =>
          repository.rename(created.notePath, {
            nextKey: "new-title",
            title: "New Title",
            body: "Renamed body.\n",
            updatedAt: "2026-06-07T10:00:00.000Z",
          }),
        (error) => {
          assert.ok(error instanceof UsageError)
          assert.equal(error.cause, removeFailure)
          return true
        },
      )
    } finally {
      rmMock.mock.restore()
    }

    await access(created.notePath)
    await assert.rejects(access(path.join(rootPath, "note", "work", "new-title.md")))
    assert.equal(await readFile(sidecarPath, "utf8"), originalSidecar)
    await assert.rejects(access(path.join(getStateNotesPath(rootPath), "old-title.json")))
    await assert.rejects(access(path.join(getStateNotesPath(rootPath), "new-title.json")))
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("repository rename restores the note body when same-path sidecar persistence fails", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-note-repository-rename-same-path-sidecar-failure-"))

  try {
    const repository = createNoteRepository(rootPath)
    const created = repository.create({
      frontmatter: FIXED_FRONTMATTER,
      body: "Original body.\n",
    })
    const sidecarPath = path.join(getStateNotesPath(rootPath), "note-123.json")
    const originalSidecar = await readFile(sidecarPath, "utf8")
    const originalWriteFileSync = fs.writeFileSync
    const sidecarFailure = new Error("simulated same-path sidecar write failure")
    const writeFileMock = mockMethod(fs, "writeFileSync", (...args: Parameters<typeof fs.writeFileSync>) => {
      const [target] = args

      if (path.resolve(String(target)).startsWith(path.resolve(sidecarPath))) {
        throw sidecarFailure
      }

      return originalWriteFileSync(...args)
    })

    try {
      assert.throws(
        () =>
          repository.rename(created.notePath, {
            nextKey: "note-123",
            title: "Updated title",
            body: "Updated body.\n",
            updatedAt: "2026-05-21T12:30:00.000Z",
          }),
        (error) => {
          assert.ok(error instanceof UsageError)
          assert.ok(error.cause instanceof UsageError)
          assert.equal(error.cause.cause, sidecarFailure)
          return true
        },
      )
    } finally {
      writeFileMock.mock.restore()
    }

    assert.equal(await readFile(created.notePath, "utf8"), "Original body.\n")
    assert.equal(await readFile(sidecarPath, "utf8"), originalSidecar)
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
    const writeFileMock = mockMethod(fs, "writeFileSync", (...args: Parameters<typeof fs.writeFileSync>) => {
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
      writeFileMock.mock.restore()
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
