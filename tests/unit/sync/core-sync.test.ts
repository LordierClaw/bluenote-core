import { describe, test } from "vitest"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { existsSync, readFileSync } from "node:fs"
import { mkdir, mkdtemp, rm } from "node:fs/promises"

import { createBlueNoteCore, createDirtyRecordRepository, UsageError } from "@lordierclaw/bluenote-core"
import { readSyncRuntimeMode } from "../../../src/sync/runtime-mode"
import { getStateManifestPath, readStateManifest } from "../../../src/storage/state-manifest"

async function withTempRoot<T>(prefix: string, callback: (rootPath: string) => T | Promise<T>): Promise<T> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), prefix))

  try {
    return await callback(rootPath)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
}

describe("createBlueNoteCore sync namespace", () => {
  test("status returns unlinked idle status for a new root", async () => {
    await withTempRoot("bluenote-core-sync-status-", (rootPath) => {
      const core = createBlueNoteCore({ rootPath })

      assert.deepEqual(core.sync.status(), {
        state: "unlinked",
        mode: "standalone",
        activity: "idle",
        pendingCount: 0,
        runningCount: 0,
        failedCount: 0,
        lastError: null,
      })
    })
  })

  test("link seeds a client runtime mode and marks existing notes and folders dirty", async () => {
    await withTempRoot("bluenote-core-sync-link-", async (rootPath) => {
      const core = createBlueNoteCore({ rootPath })
      core.init()
      await mkdir(path.join(rootPath, "note", "projects", "empty"), { recursive: true })
      const first = core.notes.create({
        type: "normal",
        title: "Sync Existing One",
        body: "First local note.",
        destinationFolder: "note/projects",
        enqueueAi: false,
        noteIdGenerator: () => "note_existing_1",
      })
      const second = core.notes.create({
        type: "draft",
        title: "Sync Existing Draft",
        body: "Second local note.",
        enqueueAi: false,
        noteIdGenerator: () => "note_existing_2",
      })

      const summary = core.sync.link({
        mode: "seed-empty-server-from-local",
        serverUrl: "https://sync.example.test",
      })

      assert.equal(summary.state, "linked")
      assert.equal(summary.mode, "sync-client")
      assert.equal(summary.serverUrl, "https://sync.example.test")
      assert.equal(summary.notesMarked, 2)
      assert.equal(summary.foldersMarked, 2)
      assert.equal(summary.dirtyRecordsMarked, 4)
      assert.deepEqual(readSyncRuntimeMode(rootPath), { mode: "sync-client", workspaceId: summary.workspaceId })

      const dirtyRecords = createDirtyRecordRepository(rootPath, { role: "client", workspaceId: summary.workspaceId }).listDirtyRecords()
      assert.deepEqual(
        dirtyRecords.map((record) => [record.entityType, record.entityId, record.dirtyType]).sort(),
        [
          ["folder", "note/projects", "upsert"],
          ["folder", "note/projects/empty", "upsert"],
          ["note", first.noteId, "upsert"],
          ["note", second.noteId, "upsert"],
        ].sort(),
      )
      assert.deepEqual(core.sync.status(), {
        state: "linked",
        mode: "sync-client",
        activity: "idle",
        workspaceId: summary.workspaceId,
        pendingCount: 4,
        runningCount: 0,
        failedCount: 0,
        lastError: null,
      })
      assert.deepEqual(core.sync.now(), { status: "transport-not-configured", pushed: 0, pulled: 0 })
    })
  })

  test("link keeps runtime mode standalone if initial dirty seeding fails", async () => {
    await withTempRoot("bluenote-core-sync-link-seed-failure-", async (rootPath) => {
      const core = createBlueNoteCore({ rootPath })
      core.init()
      const created = core.notes.create({
        type: "draft",
        title: "Seed Failure",
        body: "This local note should remain standalone if seeding fails.",
        enqueueAi: false,
        noteIdGenerator: () => "note_seed_failure",
      })
      await mkdir(path.join(rootPath, ".data", "sync", "sync.sqlite.lock"), { recursive: true })

      assert.throws(
        () => core.sync.link({ mode: "seed-empty-server-from-local", serverUrl: "https://sync.example.test" }),
        /busy/,
      )
      assert.deepEqual(readSyncRuntimeMode(rootPath), { mode: "standalone" })
      assert.equal(existsSync(created.notePath), true)
    })
  })

  test("link reports user-facing validation errors", async () => {
    await withTempRoot("bluenote-core-sync-link-validation-", (rootPath) => {
      const core = createBlueNoteCore({ rootPath })
      core.init()

      assert.throws(
        () => core.sync.link({ mode: "unsupported" as "seed-empty-server-from-local", serverUrl: "https://sync.example.test" }),
        UsageError,
      )
      assert.throws(
        () => core.sync.link({ mode: "seed-empty-server-from-local", serverUrl: "" }),
        UsageError,
      )
    })
  })

  test("unlink switches back to standalone while keeping local schema 3 notes and note IDs", async () => {
    await withTempRoot("bluenote-core-sync-unlink-", async (rootPath) => {
      const core = createBlueNoteCore({ rootPath })
      core.init()
      await mkdir(path.join(rootPath, "note", "projects"), { recursive: true })
      const created = core.notes.create({
        type: "normal",
        title: "Keep Me Local",
        body: "Local content remains after unlink.",
        destinationFolder: "note/projects",
        enqueueAi: false,
        noteIdGenerator: () => "note_keep_local_1",
      })
      core.sync.link({ mode: "seed-empty-server-from-local", serverUrl: "https://sync.example.test" })

      const summary = core.sync.unlink()

      assert.deepEqual(summary, { state: "unlinked", mode: "standalone", keptLocalNotes: true })
      assert.deepEqual(readSyncRuntimeMode(rootPath), { mode: "standalone" })
      assert.equal(readStateManifest(rootPath).schemaVersion, 3)
      assert.deepEqual(core.notes.list().map((note) => note.key), [created.key])
      const sidecar = JSON.parse(readFileSync(path.join(rootPath, ".data", "notes", `${created.noteId}.json`), "utf8")) as { noteId?: unknown }
      assert.equal(sidecar.noteId, created.noteId)
    })
  })

  test("repair dry run is non-mutating by default", async () => {
    await withTempRoot("bluenote-core-sync-repair-", (rootPath) => {
      const core = createBlueNoteCore({ rootPath })
      core.init()
      const manifestBefore = readFileSync(getStateManifestPath(rootPath), "utf8")
      const runtimeModePath = path.join(rootPath, ".data", "sync", "runtime-mode.json")

      assert.equal(existsSync(runtimeModePath), false)
      assert.deepEqual(core.sync.repair({ dryRun: true }), {
        dryRun: true,
        changed: false,
        issuesFound: 1,
        repairsApplied: 0,
        issues: [
          {
            code: "missing-sync-database",
            severity: "warning",
            message: "Sync database is missing.",
            suggestion: "Recreate .data/sync/sync.sqlite before running linked sync operations.",
          },
        ],
      })
      assert.equal(readFileSync(getStateManifestPath(rootPath), "utf8"), manifestBefore)
      assert.equal(existsSync(runtimeModePath), false)
    })
  })
})
