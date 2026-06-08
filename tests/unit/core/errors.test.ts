import { test } from "bun:test"
import assert from "node:assert/strict"

import {
  AmbiguousSelectorError,
  AppError,
  EditorLaunchError,
  IndexUnavailableError,
  InvalidFrontmatterError,
  RootNotInitializedError,
} from "../../../src/core/errors"

test("AppError subclasses expose code, message, and optional hint", () => {
  const error = new RootNotInitializedError("BlueNote root is not initialized.", {
    hint: "Run 'bn init' first.",
  })

  assert.equal(error.name, "RootNotInitializedError")
  assert.equal(error.code, "ROOT_NOT_INITIALIZED")
  assert.equal(error.message, "BlueNote root is not initialized.")
  assert.equal(error.hint, "Run 'bn init' first.")
})

test("distinct core error classes exist for domain failure cases", () => {
  const cases = [
    {
      instance: new RootNotInitializedError("root missing"),
      name: "RootNotInitializedError",
      code: "ROOT_NOT_INITIALIZED",
    },
    {
      instance: new AmbiguousSelectorError("selector matched multiple notes"),
      name: "AmbiguousSelectorError",
      code: "AMBIGUOUS_SELECTOR",
    },
    {
      instance: new InvalidFrontmatterError("frontmatter is invalid"),
      name: "InvalidFrontmatterError",
      code: "INVALID_FRONTMATTER",
    },
    {
      instance: new EditorLaunchError("editor could not be started"),
      name: "EditorLaunchError",
      code: "EDITOR_LAUNCH_FAILED",
    },
    {
      instance: new IndexUnavailableError("index is unavailable"),
      name: "IndexUnavailableError",
      code: "INDEX_UNAVAILABLE",
    },
  ]

  for (const { instance, name, code } of cases) {
    assert.equal(instance.name, name)
    assert.equal(instance.code, code)
    assert.match(instance.message, /.+/)
  }
})

test("AppError preserves explicitly provided falsy causes", () => {
  const error = new AppError("USAGE_ERROR", "message", { cause: "" })

  assert.equal("cause" in error, true)
  assert.equal(error.cause, "")
})
