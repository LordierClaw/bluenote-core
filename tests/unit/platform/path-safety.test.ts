import { test } from "bun:test"
import assert from "node:assert/strict"
import path from "node:path"

import { UsageError } from "../../../src/core/errors"
import {
  assertPathInsideRoot,
  toRootRelativePath,
} from "../../../src/platform/path-safety"

test("path safety helper rejects paths escaping the managed root", () => {
  const rootPath = path.resolve("/tmp/bluenote-root")
  const escapingPath = path.resolve(rootPath, "../outside.md")

  assert.throws(
    () => assertPathInsideRoot(rootPath, escapingPath),
    (error: unknown) => {
      assert.ok(error instanceof UsageError)
      assert.match(error.message, /outside the managed root/)
      return true
    },
  )
})

test("path safety helper accepts paths inside the managed root", () => {
  const rootPath = path.resolve("/tmp/bluenote-root")
  const targetPath = path.resolve(rootPath, "notes/inbox/note.md")

  assert.equal(assertPathInsideRoot(rootPath, targetPath), targetPath)
  assert.equal(toRootRelativePath(rootPath, targetPath), "notes/inbox/note.md")
})

test("path safety helper rejects an empty managed root path", () => {
  assert.throws(() => assertPathInsideRoot("", "/tmp/bluenote-root/note.md"), {
    message: "Managed root path must not be empty.",
  })
})

test("path safety helper rejects an empty target path", () => {
  assert.throws(() => assertPathInsideRoot("/tmp/bluenote-root", ""), {
    message: "Target path must not be empty.",
  })
})
