import { test } from "vitest"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"

import { createBlueNoteCore } from "../../../src"
import { showNote } from "../../../src/core/show-note"
import { createSidecarRepository } from "../../../src/storage/sidecar-repository"

async function withRoot<T>(callback: (rootPath: string) => T | Promise<T>): Promise<T> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-show-note-"))
  try {
    return await callback(rootPath)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
}

test("showNote reads descriptions from noteId-keyed sidecars", async () => {
  await withRoot((rootPath) => {
    const core = createBlueNoteCore({ rootPath })
    core.init()
    const created = core.notes.create({
      type: "normal",
      title: "Sidecar Description",
      body: "Body-derived fallback should not win.",
      destinationFolder: "note",
      enqueueAi: false,
      noteIdGenerator: () => "note_show_sidecar_description",
      randomSource: () => 0,
    })
    const sidecars = createSidecarRepository(rootPath)
    sidecars.write({
      ...sidecars.readByNoteId(created.noteId),
      description: "Generated sidecar description.",
    })

    assert.equal(showNote({ override: rootPath, selector: created.key }).description, "Generated sidecar description.")
  })
})
