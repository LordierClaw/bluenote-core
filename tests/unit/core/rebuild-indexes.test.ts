import { test } from "vitest"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"

import { rebuildIndexes } from "../../../src/core/rebuild-indexes"
import { createNoteRepository } from "../../../src/storage/note-repository"
import { ensureManagedRoot } from "../../../src/storage/root-layout"

async function withRoot<T>(callback: (rootPath: string) => Promise<T>): Promise<T> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bluenote-rebuild-indexes-"))

  try {
    return await callback(ensureManagedRoot(tempRoot))
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

test("rebuildIndexes reports malformed unrelated sidecars without aborting sidecar lookup", async () => {
  await withRoot(async (rootPath) => {
    createNoteRepository(rootPath).create({
      noteId: "note_z_note_123",
      frontmatter: {
        id: "z-note",
        schemaVersion: 1,
        title: "Z Note",
        mode: "plain",
        tags: [],
        createdAt: "2026-06-01T10:00:00.000Z",
        updatedAt: "2026-06-01T10:00:00.000Z",
      },
      body: "A valid note.\n",
      destination: { type: "normal", folderRelativePath: "note" },
    })
    await mkdir(path.join(rootPath, ".data", "notes"), { recursive: true })
    await writeFile(path.join(rootPath, ".data", "notes", "aaa-bad.json"), "{bad json", "utf8")

    const summary = rebuildIndexes({ override: rootPath })

    assert.equal(summary.noteCount, 1)
    assert.match(summary.validationErrors.join("\n"), /Could not parse sidecar/i)
  })
})
