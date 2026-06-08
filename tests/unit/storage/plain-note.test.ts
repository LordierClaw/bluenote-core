import { test } from "bun:test"
import assert from "node:assert/strict"

import { parsePlainNote, serializePlainNote } from "../../../src/storage/plain-note"

test("parsePlainNote preserves plain note bodies with no frontmatter", () => {
  const markdown = "# Title\n\nPlain note body.\n---\nThis stays in the body.\n"

  const parsed = parsePlainNote(markdown, "notes/inbox/plain-note.md")

  assert.deepEqual(parsed, {
    body: "# Title\n\nPlain note body.\n---\nThis stays in the body.\n",
    sourcePath: "notes/inbox/plain-note.md",
  })
})

test("serializePlainNote writes the canonical body without adding frontmatter", () => {
  const markdown = serializePlainNote({
    body: "Line one.\r\nLine two.\r\n",
    sourcePath: "notes/inbox/plain-note.md",
  })

  assert.equal(markdown, "Line one.\nLine two.\n")
  assert.doesNotMatch(markdown, /^---\n/)
})
