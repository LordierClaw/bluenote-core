import { test } from "bun:test"
import assert from "node:assert/strict"

import { InvalidFrontmatterError } from "../../../src/core/errors"
import { validateNoteSidecar } from "../../../src/storage/sidecar-schema"

function canonicalSidecar() {
  return {
    type: "normal",
    key: "note-work-24-abc123",
    title: "Note Work #24",
    description: "Meeting notes about rollout risks.",
    relativePath: "note/work.md",
    createdAt: "2026-05-24T12:00:00.000Z",
    updatedAt: "2026-05-24T12:10:00.000Z",
    archivedAt: null,
    namingVersion: 1,
  }
}

test("validateNoteSidecar accepts the canonical sidecar JSON shape", () => {
  const sidecar = validateNoteSidecar(
    {
      type: "normal",
      key: "note-work-24-abc123",
      title: "Note Work #24",
      description: "Meeting notes about rollout risks.",
      relativePath: "note/work.md",
      createdAt: "2026-05-24T12:00:00.000Z",
      updatedAt: "2026-05-24T12:10:00.000Z",
      archivedAt: null,
      namingVersion: 1,
    },
    ".data/notes/note-work-24-abc123.json",
  )

  assert.deepEqual(sidecar, {
    type: "normal",
    key: "note-work-24-abc123",
    title: "Note Work #24",
    description: "Meeting notes about rollout risks.",
    relativePath: "note/work.md",
    createdAt: "2026-05-24T12:00:00.000Z",
    updatedAt: "2026-05-24T12:10:00.000Z",
    archivedAt: null,
    namingVersion: 1,
  })
})

test("validateNoteSidecar accepts normal, draft, and archived sidecar type/path/archive combinations", () => {
  assert.deepEqual(validateNoteSidecar(canonicalSidecar(), ".data/notes/work.json"), canonicalSidecar())

  assert.equal(
    validateNoteSidecar(
      { ...canonicalSidecar(), relativePath: "note/work/projects/foo.md" },
      ".data/notes/work.json",
    ).relativePath,
    "note/work/projects/foo.md",
  )

  assert.deepEqual(
    validateNoteSidecar(
      {
        ...canonicalSidecar(),
        type: "draft",
        key: "draft-a8k2p9",
        relativePath: "draft/draft-a8k2p9.md",
      },
      ".data/notes/draft-a8k2p9.json",
    ),
    {
      ...canonicalSidecar(),
      type: "draft",
      key: "draft-a8k2p9",
      relativePath: "draft/draft-a8k2p9.md",
    },
  )

  assert.deepEqual(
    validateNoteSidecar(
      {
        ...canonicalSidecar(),
        type: "archived",
        key: "example",
        relativePath: ".data/archive/example.md",
        archivedAt: "2026-05-25T12:00:00.000Z",
      },
      ".data/notes/example.json",
    ),
    {
      ...canonicalSidecar(),
      type: "archived",
      key: "example",
      relativePath: ".data/archive/example.md",
      archivedAt: "2026-05-25T12:00:00.000Z",
    },
  )
})

test("validateNoteSidecar accepts and preserves AI description freshness metadata", () => {
  const sidecar = validateNoteSidecar(
    {
      ...canonicalSidecar(),
      ai: { description: { lastProcessedAt: "2026-06-02T10:00:00.000Z" } },
    },
    ".data/notes/note-work-24-abc123.json",
  )

  assert.deepEqual(sidecar.ai, {
    description: { lastProcessedAt: "2026-06-02T10:00:00.000Z" },
  })
})

test("validateNoteSidecar still accepts existing sidecars with no AI metadata", () => {
  const sidecar = validateNoteSidecar(canonicalSidecar(), ".data/notes/note-work-24-abc123.json")

  assert.equal("ai" in sidecar, false)
})

test("validateNoteSidecar rejects invalid AI timestamps as sidecar metadata", () => {
  assert.throws(
    () =>
      validateNoteSidecar(
        {
          ...canonicalSidecar(),
          ai: { description: { lastProcessedAt: "not-a-timestamp" } },
        },
        ".data/notes/note-work-24-abc123.json",
      ),
    (error: unknown) => {
      assert.ok(error instanceof InvalidFrontmatterError)
      assert.match(error.message, /Invalid sidecar metadata/i)
      assert.match(error.message, /lastProcessedAt/i)
      assert.match(error.message, /ISO 8601 timestamp/i)
      return true
    },
  )
})

test("validateNoteSidecar rejects unknown nested AI fields", () => {
  assert.throws(
    () =>
      validateNoteSidecar(
        {
          ...canonicalSidecar(),
          ai: {
            description: {
              lastProcessedAt: "2026-06-02T10:00:00.000Z",
              model: "test-model",
            },
          },
        },
        ".data/notes/note-work-24-abc123.json",
      ),
    (error: unknown) => {
      assert.ok(error instanceof InvalidFrontmatterError)
      assert.match(error.message, /Invalid sidecar metadata/i)
      assert.match(error.message, /unknown field 'model'/i)
      return true
    },
  )
})

test("validateNoteSidecar rejects non-object sidecar input with a validation error", () => {
  assert.throws(
    () => validateNoteSidecar("not-an-object", ".data/notes/note-work-24-abc123.json"),
    (error: unknown) => {
      assert.ok(error instanceof InvalidFrontmatterError)
      assert.match(error.message, /expected a JSON object/i)
      return true
    },
  )
})

test("validateNoteSidecar rejects missing required fields", () => {
  assert.throws(
    () =>
      validateNoteSidecar(
        {
          type: "normal",
          key: "note-work-24-abc123",
          title: "Note Work #24",
          description: "Meeting notes about rollout risks.",
          createdAt: "2026-05-24T12:00:00.000Z",
          updatedAt: "2026-05-24T12:10:00.000Z",
          archivedAt: null,
          namingVersion: 1,
        },
        ".data/notes/note-work-24-abc123.json",
      ),
    (error: unknown) => {
      assert.ok(error instanceof InvalidFrontmatterError)
      assert.match(error.message, /relativePath/i)
      return true
    },
  )
})

test("validateNoteSidecar infers legacy missing type from path and archived state", () => {
  const { type: _type, ...normalWithoutType } = canonicalSidecar()
  const { type: _draftType, ...draftWithoutType } = {
    ...canonicalSidecar(),
    type: "draft",
    key: "draft-a8k2p9",
    relativePath: "draft/draft-a8k2p9.md",
  }
  const { type: _archivedType, ...archivedWithoutType } = {
    ...canonicalSidecar(),
    type: "archived",
    key: "archived-note",
    relativePath: ".data/archive/archived-note.md",
    archivedAt: "2026-05-25T12:00:00.000Z",
  }

  assert.equal(validateNoteSidecar(normalWithoutType, ".data/notes/note-work-24-abc123.json").type, "normal")
  assert.equal(validateNoteSidecar(draftWithoutType, ".data/notes/draft-a8k2p9.json").type, "draft")
  assert.equal(validateNoteSidecar(archivedWithoutType, ".data/notes/archived-note.json").type, "archived")
})

test("validateNoteSidecar rejects invalid note type/path/archive invariants", () => {
  const invalidSidecars = [
    { ...canonicalSidecar(), type: "unknown" },
    { ...canonicalSidecar(), type: "normal", relativePath: "draft/work.md" },
    { ...canonicalSidecar(), type: "draft", relativePath: "note/work.md" },
    { ...canonicalSidecar(), type: "archived", relativePath: ".data/archive/example.md", archivedAt: null },
    { ...canonicalSidecar(), type: "normal", archivedAt: "2026-05-25T12:00:00.000Z" },
    { ...canonicalSidecar(), type: "draft", archivedAt: "2026-05-25T12:00:00.000Z" },
    { ...canonicalSidecar(), type: "normal", relativePath: "note/../draft/foo.md" },
    { ...canonicalSidecar(), type: "draft", relativePath: "draft/../note/foo.md" },
    {
      ...canonicalSidecar(),
      type: "archived",
      relativePath: ".data/archive/../../note/foo.md",
      archivedAt: "2026-05-25T12:00:00.000Z",
    },
    { ...canonicalSidecar(), type: "normal", relativePath: "/note/foo.md" },
    { ...canonicalSidecar(), type: "normal", relativePath: "C:/note/foo.md" },
    { ...canonicalSidecar(), type: "normal", relativePath: "note/foo" },
    { ...canonicalSidecar(), type: "draft", relativePath: "draft/draft-a8k2p9" },
    {
      ...canonicalSidecar(),
      type: "archived",
      relativePath: ".data/archive/example",
      archivedAt: "2026-05-25T12:00:00.000Z",
    },
    { ...canonicalSidecar(), type: "normal", relativePath: "note" },
    { ...canonicalSidecar(), type: "normal", relativePath: "" },
  ]

  for (const invalidSidecar of invalidSidecars) {
    assert.throws(
      () => validateNoteSidecar(invalidSidecar, ".data/notes/note-work-24-abc123.json"),
      (error: unknown) => {
        assert.ok(error instanceof InvalidFrontmatterError)
        assert.match(error.message, /sidecar metadata/i)
        return true
      },
    )
  }
})

test("validateNoteSidecar rejects invalid required fields", () => {
  assert.throws(
    () =>
      validateNoteSidecar(
        {
          type: "normal",
          key: "note-work-24-abc123",
          title: "Note Work #24",
          description: "Meeting notes about rollout risks.",
          relativePath: "note/work.md",
          createdAt: "2026-05-24T12:00:00.000Z",
          updatedAt: "not-a-timestamp",
          archivedAt: null,
          namingVersion: "1",
        },
        ".data/notes/note-work-24-abc123.json",
      ),
    (error: unknown) => {
      assert.ok(error instanceof InvalidFrontmatterError)
      assert.match(error.message, /updatedAt|namingVersion/i)
      return true
    },
  )
})
