import { test } from "vitest"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"

import { UsageError } from "../../../src/core/errors"
import { readSyncRuntimeMode } from "../../../src/sync/runtime-mode"

test("readSyncRuntimeMode treats a missing runtime mode file as standalone", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-sync-runtime-mode-missing-"))

  try {
    assert.deepEqual(readSyncRuntimeMode(rootPath), { mode: "standalone" })
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("readSyncRuntimeMode rejects malformed runtime mode JSON", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-sync-runtime-mode-malformed-"))

  try {
    await mkdir(path.join(rootPath, ".data", "sync"), { recursive: true })
    await writeFile(path.join(rootPath, ".data", "sync", "runtime-mode.json"), "{not-json\n", "utf8")

    assert.throws(
      () => readSyncRuntimeMode(rootPath),
      (error) => error instanceof UsageError && /runtime mode/i.test(error.message),
    )
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})
