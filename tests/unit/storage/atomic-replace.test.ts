import { test } from "bun:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"

import { replaceFileAtomically } from "../../../src/storage/atomic-replace"

async function withTempDir(name: string, callback: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), name))
  try {
    await callback(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test("replaceFileAtomically overwrites an existing target on the Windows fallback path", async () => {
  await withTempDir("bluenote-atomic-replace-win32-", async (dir) => {
    const targetPath = path.join(dir, "config.json")
    const temporaryPath = path.join(dir, "config.json.tmp")

    await writeFile(targetPath, "old", "utf8")
    await writeFile(temporaryPath, "new", "utf8")

    replaceFileAtomically(temporaryPath, targetPath, { platform: "win32" })

    assert.equal(await readFile(targetPath, "utf8"), "new")
    await assert.rejects(readFile(temporaryPath, "utf8"), (error: unknown) => {
      const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined
      return code === "ENOENT"
    })
  })
})
