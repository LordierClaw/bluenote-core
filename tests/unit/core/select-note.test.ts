import { test } from "bun:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"

import { SelectorNotFoundError } from "../../../src/core/errors"
import { selectNote } from "../../../src/core/select-note"
import { createNoteRepository } from "../../../src/storage/note-repository"

async function withRepository(
  build: (rootPath: string) => Promise<void>,
  run: (repository: ReturnType<typeof createNoteRepository>) => Promise<void> | void,
) {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-select-note-"))

  try {
    await build(rootPath)
    await run(createNoteRepository(rootPath))
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
}

async function writePlainNoteWithSidecar(
  rootPath: string,
  {
    key,
    title,
    relativePath,
    body,
    description = "Example description.",
  }: {
    key: string
    title: string
    relativePath: string
    body: string
    description?: string
  },
) {
  const notePath = path.join(rootPath, relativePath)
  const sidecarPath = path.join(rootPath, ".data", "notes", `${key}.json`)

  await mkdir(path.dirname(notePath), { recursive: true })
  await mkdir(path.dirname(sidecarPath), { recursive: true })
  await writeFile(notePath, body, "utf8")
  await writeFile(
    sidecarPath,
    JSON.stringify(
      {
        type: relativePath.startsWith("draft/")
          ? "draft"
          : relativePath.startsWith(".data/archive/")
            ? "archived"
            : "normal",
        key,
        title,
        description,
        relativePath,
        createdAt: "2026-05-21T10:15:00.000Z",
        updatedAt: "2026-05-21T10:15:00.000Z",
        archivedAt: relativePath.startsWith(".data/archive/") ? "2026-05-22T10:15:00.000Z" : null,
        namingVersion: 1,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  )
}

async function writeLegacyFrontmatterNote(
  rootPath: string,
  {
    frontmatterId,
    title,
    relativePath,
    body,
  }: {
    frontmatterId: string
    title: string
    relativePath: string
    body: string
  },
) {
  const notePath = path.join(rootPath, relativePath)

  await mkdir(path.dirname(notePath), { recursive: true })
  await writeFile(
    notePath,
    [
      "---",
      `id: ${frontmatterId}`,
      "schemaVersion: 1",
      `title: ${title}`,
      "mode: plain",
      "tags: []",
      "createdAt: 2026-05-21T10:15:00.000Z",
      "updatedAt: 2026-05-21T10:15:00.000Z",
      "---",
      body.trimEnd(),
      "",
    ].join("\n"),
    "utf8",
  )
}

test("selectNote resolves an exact sidecar key before considering slug matches", async () => {
  await withRepository(
    async (rootPath) => {
      await writePlainNoteWithSidecar(rootPath, {
        key: "project-retrospective",
        title: "Direct Key Match",
        relativePath: "note/project-retrospective.md",
        body: "Direct key body.\n",
      })
      await writePlainNoteWithSidecar(rootPath, {
        key: "different-key",
        title: "Project Retrospective",
        relativePath: "note/different-key.md",
        body: "Slug body.\n",
      })
    },
    (repository) => {
      const selected = selectNote({ repository, selector: "project-retrospective" })

      assert.equal(selected.frontmatter.id, "project-retrospective")
      assert.equal(selected.sourcePath, "note/project-retrospective.md")
      assert.equal(selected.frontmatter.title, "Direct Key Match")
    },
  )
})

test("selectNote resolves an exact managed-root-relative path as a fallback", async () => {
  await withRepository(
    async (rootPath) => {
      await writePlainNoteWithSidecar(rootPath, {
        key: "archive-key",
        title: "Archive Note",
        relativePath: ".data/archive/archive-key.md",
        body: "Archive body.\n",
      })
    },
    (repository) => {
      const selected = selectNote({ repository, selector: ".data/archive/archive-key.md", visibility: "all" })

      assert.equal(selected.frontmatter.id, "archive-key")
      assert.equal(selected.sourcePath, ".data/archive/archive-key.md")
    },
  )
})

test("selectNote rejects non-canonical normalized path aliases", async () => {
  await withRepository(
    async (rootPath) => {
      await writePlainNoteWithSidecar(rootPath, {
        key: "archive-key",
        title: "Archive Note",
        relativePath: ".data/archive/archive-key.md",
        body: "Archive body.\n",
      })
    },
    (repository) => {
      assert.throws(
        () =>
          selectNote({
            repository,
            selector: `.data${path.sep}..${path.sep}.data${path.sep}archive${path.sep}archive-key.md`,
            visibility: "all",
          }),
        (error) => {
          assert.ok(error instanceof SelectorNotFoundError)
          assert.match(error.message, /Could not find a note matching selector '\.data[\\/]\.\.[\\/]\.data[\\/]archive[\\/]archive-key\.md'\./)
          return true
        },
      )
    },
  )
})

test("selectNote resolves a legacy frontmatter note by basename instead of UUID frontmatter id", async () => {
  await withRepository(
    async (rootPath) => {
      await writeLegacyFrontmatterNote(rootPath, {
        frontmatterId: "123e4567-e89b-12d3-a456-426614174000",
        title: "Legacy UUID Note",
        relativePath: "note/human-key.md",
        body: "Legacy body.\n",
      })
    },
    (repository) => {
      const selected = selectNote({ repository, selector: "human-key" })

      assert.equal(selected.frontmatter.id, "123e4567-e89b-12d3-a456-426614174000")
      assert.equal(selected.sourcePath, "note/human-key.md")
    },
  )
})

test("selectNote rejects legacy frontmatter ids as user-facing selectors", async () => {
  await withRepository(
    async (rootPath) => {
      await writeLegacyFrontmatterNote(rootPath, {
        frontmatterId: "legacy-id-123",
        title: "Legacy ID Note",
        relativePath: "note/human-key.md",
        body: "Legacy body.\n",
      })
    },
    (repository) => {
      assert.throws(
        () => selectNote({ repository, selector: "legacy-id-123" }),
        (error) => {
          assert.ok(error instanceof SelectorNotFoundError)
          assert.match(error.message, /Could not find a note matching selector 'legacy-id-123'\./)
          return true
        },
      )
    },
  )
})

test("selectNote resolves an exact key match even when a legacy frontmatter id collides with it", async () => {
  await withRepository(
    async (rootPath) => {
      await writePlainNoteWithSidecar(rootPath, {
        key: "foo",
        title: "Key Foo Note",
        relativePath: "note/foo.md",
        body: "Key body.\n",
      })
      await writeLegacyFrontmatterNote(rootPath, {
        frontmatterId: "foo",
        title: "Legacy ID Foo Note",
        relativePath: "note/legacy-human-key.md",
        body: "Legacy body.\n",
      })
    },
    (repository) => {
      const selected = selectNote({ repository, selector: "foo" })

      assert.equal(selected.frontmatter.id, "foo")
      assert.equal(selected.sourcePath, "note/foo.md")
    },
  )
})

test("selectNote defaults to normal notes and requires explicit visibility for drafts or archived notes", async () => {
  await withRepository(
    async (rootPath) => {
      await writePlainNoteWithSidecar(rootPath, {
        key: "normal-note",
        title: "Normal Note",
        relativePath: "note/normal-note.md",
        body: "Normal body.\n",
      })
      await writePlainNoteWithSidecar(rootPath, {
        key: "draft-note",
        title: "Draft Note",
        relativePath: "draft/draft-note.md",
        body: "Draft body.\n",
      })
      await writePlainNoteWithSidecar(rootPath, {
        key: "archived-note",
        title: "Archived Note",
        relativePath: ".data/archive/archived-note.md",
        body: "Archived body.\n",
      })
    },
    (repository) => {
      assert.equal(selectNote({ repository, selector: "normal-note" }).sourcePath, "note/normal-note.md")
      assert.throws(() => selectNote({ repository, selector: "draft-note" }), SelectorNotFoundError)
      assert.throws(() => selectNote({ repository, selector: "archived-note" }), SelectorNotFoundError)
      assert.throws(() => selectNote({ repository, selector: ".data/archive/archived-note.md" }), SelectorNotFoundError)

      assert.equal(selectNote({ repository, selector: "draft-note", visibility: "drafts" }).sourcePath, "draft/draft-note.md")
      assert.throws(() => selectNote({ repository, selector: "archived-note", visibility: "drafts" }), SelectorNotFoundError)
      assert.equal(selectNote({ repository, selector: "archived-note", visibility: "all" }).sourcePath, ".data/archive/archived-note.md")
      assert.equal(selectNote({ repository, selector: ".data/archive/archived-note.md", visibility: "all" }).sourcePath, ".data/archive/archived-note.md")
    },
  )
})

test("selectNote rejects title-derived slug selectors", async () => {
  await withRepository(
    async (rootPath) => {
      await writePlainNoteWithSidecar(rootPath, {
        key: "project-retro",
        title: "Project Retrospective",
        relativePath: "note/project-retro.md",
        body: "Project body.\n",
      })
    },
    (repository) => {
      assert.throws(
        () => selectNote({ repository, selector: "project-retrospective" }),
        (error) => {
          assert.ok(error instanceof SelectorNotFoundError)
          assert.match(error.message, /Could not find a note matching selector 'project-retrospective'\./)
          return true
        },
      )
    },
  )
})

test("selectNote suggests close note keys when a selector does not match", async () => {
  await withRepository(
    async (rootPath) => {
      await writePlainNoteWithSidecar(rootPath, {
        key: "show-note",
        title: "Show Note",
        relativePath: "note/show-note.md",
        body: "Show body.\n",
      })
      await writePlainNoteWithSidecar(rootPath, {
        key: "slow-note",
        title: "Slow Note",
        relativePath: "note/slow-note.md",
        body: "Slow body.\n",
      })
    },
    (repository) => {
      assert.throws(
        () => selectNote({ repository, selector: "shoe-note" }),
        (error) => {
          assert.ok(error instanceof SelectorNotFoundError)
          assert.match(error.message, /Could not find a note matching selector 'shoe-note'\./)
          assert.equal(error.hint, "Did you mean: show-note, slow-note?")
          return true
        },
      )
    },
  )
})
