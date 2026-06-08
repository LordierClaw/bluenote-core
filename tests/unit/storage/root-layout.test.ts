import { test } from "bun:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { access, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises"

import {
  APP_STATE_DIRECTORY,
  APP_STATE_NOTES_DIRECTORY,
  LEGACY_STATE_DIRECTORY,
} from "../../../src/config/root"
import { UsageError } from "../../../src/core/errors"
import {
  ensureManagedRoot,
  getArchiveNotePath,
  getArchiveNotesPath,
  getDraftNotesPath,
  getNormalNotePath,
  getNormalNotesPath,
  getNotesPath,
  getStateNotesPath,
  MANAGED_ROOT_LAYOUT,
} from "../../../src/storage/root-layout"

test("ensureManagedRoot creates the full managed root layout", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bluenote-root-layout-"))

  try {
    const resolvedRoot = await ensureManagedRoot(tempRoot)

    assert.equal(resolvedRoot, path.resolve(tempRoot))

    for (const relativePath of MANAGED_ROOT_LAYOUT) {
      const fullPath = path.join(tempRoot, relativePath)
      const stats = await stat(fullPath)
      assert.equal(stats.isDirectory(), true, `${relativePath} should be a directory`)
    }

    for (const relativePath of ["note", "draft", path.join(".data", "archive"), path.join(".data", "notes"), path.join(".data", "ai")]) {
      const fullPath = path.join(tempRoot, relativePath)
      const stats = await stat(fullPath)
      assert.equal(stats.isDirectory(), true, `${relativePath} should be a directory`)
    }

    for (const relativePath of [path.join("notes", "inbox"), path.join("notes", "journal"), path.join("notes", "archive")]) {
      await assert.rejects(access(path.join(tempRoot, relativePath)), `${relativePath} should not be created for a fresh root`)
    }

    await assert.rejects(access(path.join(tempRoot, ".bluenote")))
    await assert.rejects(access(path.join(tempRoot, ".state")))
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test("root layout helpers expose note and sidecar paths for repository storage", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bluenote-root-layout-helpers-"))

  try {
    const resolvedRoot = ensureManagedRoot(tempRoot)

    assert.equal(getNotesPath(resolvedRoot), path.join(resolvedRoot, "note"))
    assert.equal(getNormalNotesPath(resolvedRoot), path.join(resolvedRoot, "note"))
    assert.equal(getDraftNotesPath(resolvedRoot), path.join(resolvedRoot, "draft"))
    assert.equal(getArchiveNotesPath(resolvedRoot), path.join(resolvedRoot, ".data", "archive"))
    assert.equal(getStateNotesPath(resolvedRoot), path.join(resolvedRoot, ".data", "notes"))
    assert.equal(APP_STATE_DIRECTORY, ".data")
    assert.equal(APP_STATE_NOTES_DIRECTORY, path.join(".data", "notes"))
    assert.equal(LEGACY_STATE_DIRECTORY, ".state")
    assert.equal(getNormalNotePath(resolvedRoot, "note-123"), path.join(resolvedRoot, "note", "note-123.md"))
    assert.equal(getArchiveNotePath(resolvedRoot, "note-123"), path.join(resolvedRoot, ".data", "archive", "note-123.md"))
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test("ensureManagedRoot wraps filesystem failures in a UsageError", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bluenote-root-layout-error-"))
  const blockedRoot = path.join(tempRoot, "blocked-root")

  try {
    await writeFile(blockedRoot, "not a directory")

    assert.throws(
      () => ensureManagedRoot(blockedRoot),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.match(error.message, /Could not initialize BlueNote root at/)
        assert.equal(error.hint, "Ensure BLUENOTE_ROOT points to a writable directory path.")

        return true
      },
    )
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test("ensureManagedRoot rejects symlinked app-state directories without creating files outside the root", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bluenote-root-layout-symlink-"))
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "bluenote-root-layout-outside-"))

  try {
    await symlink(outsideRoot, path.join(tempRoot, ".data"), "dir")

    assert.throws(
      () => ensureManagedRoot(tempRoot),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.match(error.message, /Could not initialize BlueNote root at/)
        assert.equal(error.hint, "Ensure BLUENOTE_ROOT points to a writable directory path.")
        return true
      },
    )

    await assert.rejects(() => access(path.join(outsideRoot, "notes")))
    await assert.rejects(() => access(path.join(outsideRoot, "metadata.sqlite")))
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
    await rm(outsideRoot, { recursive: true, force: true })
  }
})
