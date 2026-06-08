import { describe, test } from "bun:test"
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  createNoteRepository,
  createSidecarRepository,
  ensureManagedRoot,
  getAiStatePath,
  getArchiveNotesPath,
  getDraftNotesPath,
  getNotesPath,
  getStateNotesPath,
  getStatePath,
} from "@lordierclaw/bluenote-core"
import { ensureManagedRoot as shimEnsureManagedRoot } from "../../../src/storage/root-layout"
import { createNoteRepository as shimCreateNoteRepository } from "../../../src/storage/note-repository"

describe("@lordierclaw/bluenote-core storage exports", () => {
  test("exports managed-root storage helpers and preserves root shim identity", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-core-storage-exports-"))

    try {
      const managedRootPath = ensureManagedRoot(rootPath)

      assert.equal(managedRootPath, path.resolve(rootPath))
      assert.equal(getNotesPath(rootPath), path.join(managedRootPath, "note"))
      assert.equal(getDraftNotesPath(rootPath), path.join(managedRootPath, "draft"))
      assert.equal(getStatePath(rootPath), path.join(managedRootPath, ".data"))
      assert.equal(getStateNotesPath(rootPath), path.join(managedRootPath, ".data", "notes"))
      assert.equal(getAiStatePath(rootPath), path.join(managedRootPath, ".data", "ai"))
      assert.equal(getArchiveNotesPath(rootPath), path.join(managedRootPath, ".data", "archive"))

      for (const relativePath of ["note", "draft", ".data", ".data/notes", ".data/ai", ".data/archive"]) {
        assert.equal(existsSync(path.join(managedRootPath, relativePath)), true, `${relativePath} should exist`)
      }

      assert.equal(typeof createNoteRepository(rootPath).list, "function")
      assert.equal(typeof createSidecarRepository(rootPath).read, "function")
      assert.equal(shimEnsureManagedRoot, ensureManagedRoot)
      assert.equal(shimCreateNoteRepository, createNoteRepository)
    } finally {
      await rm(rootPath, { recursive: true, force: true })
    }
  })
})
