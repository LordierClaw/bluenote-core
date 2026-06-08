import { test } from "bun:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { access, mkdir, mkdtemp, rm, stat, symlink } from "node:fs/promises"

import { UsageError } from "../../../src/core/errors"
import {
  ensureManagedRoot,
  getAiConfigPath,
  getAiLogsPath,
  getAiPromptsPath,
  getAiQueuePath,
  getAiStatePath,
} from "../../../src/storage/root-layout"

test("ensureManagedRoot creates AI support directories", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bluenote-ai-root-layout-"))

  try {
    const resolvedRoot = ensureManagedRoot(tempRoot)

    for (const relativePath of [path.join(".data", "ai"), path.join(".data", "ai", "prompts"), path.join(".data", "ai", "logs")]) {
      const fullPath = path.join(resolvedRoot, relativePath)
      const stats = await stat(fullPath)
      assert.equal(stats.isDirectory(), true, `${relativePath} should be a directory`)
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test("AI path helpers return paths inside the managed root", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bluenote-ai-root-layout-helpers-"))

  try {
    const resolvedRoot = ensureManagedRoot(tempRoot)

    assert.equal(getAiStatePath(resolvedRoot), path.join(resolvedRoot, ".data", "ai"))
    assert.equal(getAiPromptsPath(resolvedRoot), path.join(resolvedRoot, ".data", "ai", "prompts"))
    assert.equal(getAiConfigPath(resolvedRoot), path.join(resolvedRoot, ".data", "ai", "config.json"))
    assert.equal(getAiQueuePath(resolvedRoot), path.join(resolvedRoot, ".data", "ai", "queue.json"))
    assert.equal(getAiLogsPath(resolvedRoot), path.join(resolvedRoot, ".data", "ai", "logs"))
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test("ensureManagedRoot rejects a symlinked AI state directory before creating child directories", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bluenote-ai-root-layout-symlink-"))
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "bluenote-ai-root-layout-outside-"))

  try {
    await mkdir(path.join(tempRoot, ".data"), { recursive: true })
    await symlink(outsideRoot, path.join(tempRoot, ".data", "ai"), "dir")

    assert.throws(
      () => ensureManagedRoot(tempRoot),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.match(error.message, /Could not initialize BlueNote root at/)
        assert.equal(error.hint, "Ensure BLUENOTE_ROOT points to a writable directory path.")
        assert.ok(error.cause instanceof UsageError)
        assert.match(error.cause.message, /\.data[/\\]ai.*must not be a symlink/)
        return true
      },
    )

    await assert.rejects(() => access(path.join(outsideRoot, "prompts")))
    await assert.rejects(() => access(path.join(outsideRoot, "logs")))
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
    await rm(outsideRoot, { recursive: true, force: true })
  }
})
