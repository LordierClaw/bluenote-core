import { test } from "vitest"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"

import { archiveNote } from "../../../src/core/archive-note"
import { enableSyncClientMode, listDirtyRecords } from "./sync-dirty-test-helpers"

async function writeSidecarNote(rootPath: string, input: { key: string; noteId?: string; title: string; relativePath: string; type?: "normal" | "draft" | "archived" }) {
  const notePath = path.join(rootPath, input.relativePath)
  await mkdir(path.dirname(notePath), { recursive: true })
  await mkdir(path.join(rootPath, ".data", "notes"), { recursive: true })
  await writeFile(notePath, `${input.title} body\n`, "utf8")
  await writeFile(path.join(rootPath, ".data", "notes", `${input.noteId ?? input.key}.json`), JSON.stringify({
    type: input.type ?? "normal",
    ...(input.noteId === undefined ? {} : { noteId: input.noteId }),
    key: input.key,
    title: input.title,
    description: "existing description",
    relativePath: input.relativePath,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
    archivedAt: input.type === "archived" ? "2026-06-03T00:00:00.000Z" : null,
    namingVersion: 1,
    ai: { description: { lastProcessedAt: "2026-06-04T00:00:00.000Z" } },
  }, null, 2) + "\n", "utf8")
}

test("archiveNote preserves noteId-keyed sidecars while marking the note archived", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-archive-note-note-id-"))
  const noteId = "note_archive_123"

  try {
    await writeSidecarNote(rootPath, { noteId, key: "roadmap", title: "Roadmap", relativePath: "note/work/roadmap.md" })

    const archived = archiveNote({
      override: rootPath,
      selector: "roadmap",
      clock: { now: () => new Date("2026-06-07T12:00:00.000Z") },
    })

    assert.equal(archived.relativePath, ".data/archive/roadmap.md")
    assert.equal(archived.archivedAt, "2026-06-07T12:00:00.000Z")
    await assert.rejects(() => access(path.join(rootPath, ".data", "notes", "roadmap.json")))

    const sidecar = JSON.parse(await readFile(path.join(rootPath, ".data", "notes", `${noteId}.json`), "utf8"))
    assert.equal(sidecar.noteId, noteId)
    assert.equal(sidecar.type, "archived")
    assert.equal(sidecar.key, "roadmap")
    assert.equal(sidecar.title, "Roadmap")
    assert.equal(sidecar.relativePath, ".data/archive/roadmap.md")
    assert.equal(sidecar.archivedAt, "2026-06-07T12:00:00.000Z")
    assert.equal(await readFile(path.join(rootPath, ".data", "archive", "roadmap.md"), "utf8"), "Roadmap body\n")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("archiveNote marks the archived note dirty in sync-client mode", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-archive-note-sync-dirty-"))

  try {
    await enableSyncClientMode(rootPath)
    await writeSidecarNote(rootPath, { noteId: "note_archive_dirty", key: "roadmap", title: "Roadmap", relativePath: "note/work/roadmap.md" })

    archiveNote({
      override: rootPath,
      selector: "roadmap",
      clock: { now: () => new Date("2026-06-07T12:00:00.000Z") },
    })

    assert.deepEqual(listDirtyRecords(rootPath), [
      {
        entityType: "note",
        entityId: "note_archive_dirty",
        dirtyType: "upsert",
        markedAt: "2026-06-07T12:00:00.000Z",
        attempts: 0,
        lastError: null,
        metadata: {
          archivedAt: "2026-06-07T12:00:00.000Z",
          key: "roadmap",
          previousRelativePath: "note/work/roadmap.md",
          relativePath: ".data/archive/roadmap.md",
          title: "Roadmap",
        },
      },
    ])
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})
