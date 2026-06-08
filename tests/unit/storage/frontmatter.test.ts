import { test } from "bun:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { InvalidFrontmatterError } from "../../../src/core/errors"
import { parseNoteFile, serializeNoteFile } from "../../../src/storage/frontmatter"
import type { ParsedNote } from "../../../src/storage/note-schema"

const fixturesDir = path.resolve(import.meta.dir, "../../fixtures/invalid-frontmatter")

test("parseNoteFile parses a valid Markdown note with YAML frontmatter", () => {
  const markdown = `---
id: note-123
schemaVersion: 1
title: Example title
mode: plain
tags:
  - alpha
  - beta
createdAt: 2026-05-21T10:15:00.000Z
updatedAt: 2026-05-21T12:30:00.000Z
---
This is the first line of the note.
And this is the second line.
`

  const parsedNote = parseNoteFile(markdown, "notes/inbox/example.md")

  assert.deepEqual(parsedNote.frontmatter, {
    id: "note-123",
    schemaVersion: 1,
    title: "Example title",
    mode: "plain",
    tags: ["alpha", "beta"],
    createdAt: "2026-05-21T10:15:00.000Z",
    updatedAt: "2026-05-21T12:30:00.000Z",
  })
  assert.equal(parsedNote.body, "This is the first line of the note.\nAnd this is the second line.\n")
  assert.equal(parsedNote.sourcePath, "notes/inbox/example.md")
})

test("serializeNoteFile writes canonical Markdown for frontmatter and body", () => {
  const markdown = serializeNoteFile({
    frontmatter: {
      id: "note-123",
      schemaVersion: 1,
      title: "Example title",
      mode: "plain",
      tags: ["alpha", "beta"],
      createdAt: "2026-05-21T10:15:00.000Z",
      updatedAt: "2026-05-21T12:30:00.000Z",
    },
    body: "This is the first line of the note.\nAnd this is the second line.\n",
    sourcePath: "notes/inbox/example.md",
  })

  assert.equal(
    markdown,
    `---\nid: note-123\nschemaVersion: 1\ntitle: Example title\nmode: plain\ntags:\n  - alpha\n  - beta\ncreatedAt: 2026-05-21T10:15:00.000Z\nupdatedAt: 2026-05-21T12:30:00.000Z\n---\nThis is the first line of the note.\nAnd this is the second line.\n`,
  )
})

test("parseNoteFile rejects invalid YAML frontmatter", async () => {
  const markdown = await readFile(path.join(fixturesDir, "bad-yaml.md"), "utf8")

  assert.throws(
    () => parseNoteFile(markdown, "tests/fixtures/invalid-frontmatter/bad-yaml.md"),
    (error: unknown) => {
      assert.ok(error instanceof InvalidFrontmatterError)
      assert.match(error.message, /Invalid frontmatter/i)
      return true
    },
  )
})

test("parseNoteFile rejects missing required frontmatter fields", async () => {
  const markdown = await readFile(path.join(fixturesDir, "missing-title.md"), "utf8")

  assert.throws(
    () => parseNoteFile(markdown, "tests/fixtures/invalid-frontmatter/missing-title.md"),
    (error: unknown) => {
      assert.ok(error instanceof InvalidFrontmatterError)
      assert.match(error.message, /title/i)
      return true
    },
  )
})

test("parseNoteFile rejects unknown frontmatter fields", () => {
  const markdown = `---
id: note-123
schemaVersion: 1
title: Example title
mode: plain
tags:
  - alpha
createdAt: 2026-05-21T10:15:00.000Z
updatedAt: 2026-05-21T12:30:00.000Z
extraField: keep-me
---
Body.
`

  assert.throws(
    () => parseNoteFile(markdown, "notes/inbox/example.md"),
    (error: unknown) => {
      assert.ok(error instanceof InvalidFrontmatterError)
      assert.match(error.message, /unknown field 'extraField'/i)
      return true
    },
  )
})

test("parseNoteFile rejects YAML merge keys without polluting object prototypes", () => {
  const markdown = `---
id: note-123
schemaVersion: 1
title: Example title
mode: plain
tags: []
createdAt: 2026-05-21T10:15:00.000Z
updatedAt: 2026-05-21T12:30:00.000Z
base: &base
  polluted: yes
<<: *base
---
Body.
`

  assert.equal(({} as Record<string, unknown>).polluted, undefined)
  assert.throws(
    () => parseNoteFile(markdown, "notes/inbox/merge-key.md"),
    (error: unknown) => {
      assert.ok(error instanceof InvalidFrontmatterError)
      assert.match(error.message, /unknown field/i)
      return true
    },
  )
  assert.equal(({} as Record<string, unknown>).polluted, undefined)
})

test("parseNoteFile rejects malformed timestamps", () => {
  const markdown = `---
id: note-123
schemaVersion: 1
title: Example title
mode: plain
tags:
  - alpha
createdAt: not-a-timestamp
updatedAt: 2026-05-21T12:30:00.000Z
---
Body.
`

  assert.throws(
    () => parseNoteFile(markdown, "notes/inbox/example.md"),
    (error: unknown) => {
      assert.ok(error instanceof InvalidFrontmatterError)
      assert.match(error.message, /createdAt/i)
      return true
    },
  )
})

test("serializeNoteFile rejects frontmatter that would lose data", () => {
  const parsedNote = {
    frontmatter: {
      id: "note-123",
      schemaVersion: 1,
      title: "Example title",
      mode: "plain",
      tags: ["alpha", "beta"],
      createdAt: "2026-05-21T10:15:00.000Z",
      updatedAt: "2026-05-21T12:30:00.000Z",
      extraField: "keep-me",
    },
    body: "Body.\n",
    sourcePath: "notes/inbox/example.md",
  } as ParsedNote

  assert.throws(
    () => serializeNoteFile(parsedNote),
    (error: unknown) => {
      assert.ok(error instanceof InvalidFrontmatterError)
      assert.match(error.message, /unknown field 'extraField'/i)
      return true
    },
  )
})
