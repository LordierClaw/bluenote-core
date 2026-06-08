import { test } from "bun:test"
import assert from "node:assert/strict"
import path from "node:path"

import {
  AppError,
  UsageError,
  assertPathInsideRoot,
  createNoteDescription,
  createNoteKey,
  slugifyNoteTitle,
  systemClock,
  uuidGenerator,
} from "@lordierclaw/bluenote-core"
import { UsageError as ShimUsageError } from "../../../src/core/errors"
import { createNoteKey as shimCreateNoteKey } from "../../../src/domain/note-key"
import { assertPathInsideRoot as shimAssertPathInsideRoot } from "../../../src/platform/path-safety"


test("@lordierclaw/bluenote-core exports moved pure domain and platform helpers", () => {
  assert.equal(slugifyNoteTitle("Hello, BlueNote!"), "hello-bluenote")
  assert.equal(
    createNoteKey("Package API", { suffixLength: 4, randomSource: () => 0x12345678 }),
    "package-api-u7i0",
  )
  assert.equal(createNoteDescription("one two three four five six seven"), "one two three … five six seven")
  assert.equal(typeof systemClock.now, "function")
  assert.equal(typeof uuidGenerator.generate, "function")
})

test("root compatibility shims preserve helper and error identity", () => {
  assert.equal(shimCreateNoteKey, createNoteKey)
  assert.equal(shimAssertPathInsideRoot, assertPathInsideRoot)
  assert.equal(ShimUsageError, UsageError)

  const rootPath = path.resolve("/tmp/bluenote-root")
  const outsidePath = path.resolve(rootPath, "../outside.md")
  assert.throws(
    () => shimAssertPathInsideRoot(rootPath, outsidePath),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.ok(error instanceof UsageError)
      assert.ok(error instanceof ShimUsageError)
      assert.equal(error.code, "USAGE_ERROR")
      return true
    },
  )
})
