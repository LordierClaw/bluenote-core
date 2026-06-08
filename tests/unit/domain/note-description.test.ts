import { test } from "bun:test"
import assert from "node:assert/strict"

import { createNoteDescription } from "../../../src/domain/note-description"

test("createNoteDescription derives a short description from the opening and closing note text", () => {
  const description = createNoteDescription(
    "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu",
  )

  assert.equal(description, "Alpha beta gamma … kappa lambda mu")
})

test("createNoteDescription handles empty note bodies deterministically", () => {
  assert.equal(createNoteDescription(""), "")
  assert.equal(createNoteDescription("   \n\t  "), "")
})

test("createNoteDescription returns short note bodies without ellipsis", () => {
  assert.equal(createNoteDescription("solo"), "solo")
  assert.equal(createNoteDescription("one two three four five six"), "one two three four five six")
})

test("createNoteDescription normalizes internal whitespace before summarizing", () => {
  const description = createNoteDescription(" Alpha   beta\n\n gamma\t delta epsilon zeta eta  ")

  assert.equal(description, "Alpha beta gamma … epsilon zeta eta")
})
