import { describe, test } from "vitest"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { existsSync, readFileSync, unlinkSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"

import { createBlueNoteCore, createDirtyRecordRepository, createSidecarRepository, UsageError } from "@lordierclaw/bluenote-core"
import { getSyncDatabasePath } from "../../../src/sync/sync-db"
import { getStateManifestPath } from "../../../src/storage/state-manifest"

async function withTempRoot<T>(prefix: string, callback: (rootPath: string) => T | Promise<T>): Promise<T> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), prefix))

  try {
    return await callback(rootPath)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
}

describe("sync repair", () => {
  test("defaults to a non-mutating dry run and reports a missing sync database", async () => {
    await withTempRoot("bluenote-sync-repair-missing-db-", (rootPath) => {
      const core = createBlueNoteCore({ rootPath })
      core.init()
      const manifestBefore = readFileSync(getStateManifestPath(rootPath), "utf8")
      const syncDatabasePath = getSyncDatabasePath(rootPath)

      assert.equal(existsSync(syncDatabasePath), false)

      const report = core.sync.repair()

      assert.equal(report.dryRun, true)
      assert.equal(report.changed, false)
      assert.equal(report.repairsApplied, 0)
      assert.equal(report.issuesFound, 1)
      assert.deepEqual(report.issues, [
        {
          code: "missing-sync-database",
          severity: "warning",
          message: "Sync database is missing.",
          suggestion: "Recreate .data/sync/sync.sqlite before running linked sync operations.",
        },
      ])
      assert.equal(existsSync(syncDatabasePath), false)
      assert.equal(readFileSync(getStateManifestPath(rootPath), "utf8"), manifestBefore)
    })
  })

  test("dry run reports stale dirty records and missing sidecars without mutation", async () => {
    await withTempRoot("bluenote-sync-repair-stale-dirty-", (rootPath) => {
      const core = createBlueNoteCore({ rootPath })
      core.init()
      const linkSummary = core.sync.link({ mode: "seed-empty-server-from-local", serverUrl: "https://sync.example.test" })
      const dirtyRepository = createDirtyRecordRepository(rootPath, { role: "client", workspaceId: linkSummary.workspaceId })
      const syncDatabasePath = getSyncDatabasePath(rootPath)
      dirtyRepository.markDirty({
        entityType: "note",
        entityId: "note_missing_sidecar",
        dirtyType: "upsert",
        markedAt: "2026-06-24T00:00:00.000Z",
        metadata: { relativePath: "note/missing.md" },
      })
      const databaseBefore = readFileSync(syncDatabasePath)

      const report = core.sync.repair({ dryRun: true })

      assert.equal(report.dryRun, true)
      assert.equal(report.changed, false)
      assert.equal(report.repairsApplied, 0)
      assert.equal(report.issuesFound, 2)
      assert.deepEqual(report.issues.map((issue) => issue.code).sort(), ["missing-sidecar", "stale-dirty-record"])
      assert.deepEqual(dirtyRepository.listDirtyRecords().map((record) => record.entityId), ["note_missing_sidecar"])
      assert.deepEqual(readFileSync(syncDatabasePath), databaseBefore)
    })
  })

  test("dry run does not report pending note deletes as missing sidecars", async () => {
    await withTempRoot("bluenote-sync-repair-pending-delete-", (rootPath) => {
      const core = createBlueNoteCore({ rootPath })
      core.init()
      const created = core.notes.create({
        type: "normal",
        title: "Pending Delete",
        body: "Delete me.\n",
        destinationFolder: "note",
        enqueueAi: false,
        noteIdGenerator: () => "note_pending_delete",
      })
      const linkSummary = core.sync.link({ mode: "seed-empty-server-from-local", serverUrl: "https://sync.example.test" })
      const sidecarPath = createSidecarRepository(rootPath).getSidecarPathByNoteId(created.noteId)

      core.notes.delete(created.key, { force: true })

      assert.equal(existsSync(sidecarPath), false)
      const dirtyRecords = createDirtyRecordRepository(rootPath, { role: "client", workspaceId: linkSummary.workspaceId }).listDirtyRecords()
      assert.deepEqual(dirtyRecords.map((record) => [record.entityType, record.entityId, record.dirtyType]), [
        ["note", created.noteId, "delete"],
      ])

      const report = core.sync.repair({ dryRun: true })

      assert.equal(report.dryRun, true)
      assert.equal(report.changed, false)
      assert.equal(report.issuesFound, 0)
      assert.deepEqual(report.issues, [])
    })
  })


  test("mutating repair requires dryRun false plus explicit confirmation", async () => {
    await withTempRoot("bluenote-sync-repair-confirmation-", (rootPath) => {
      const core = createBlueNoteCore({ rootPath })
      core.init()

      assert.throws(
        () => core.sync.repair({ dryRun: false }),
        UsageError,
      )

      const report = core.sync.repair({ dryRun: false, confirm: "repair-sync-state" })
      assert.equal(report.dryRun, false)
      assert.equal(report.changed, false)
      assert.equal(report.repairsApplied, 0)
    })
  })
})
