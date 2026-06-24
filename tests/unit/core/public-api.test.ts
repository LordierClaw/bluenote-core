import { describe, test } from "vitest"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { mkdir, mkdtemp, rm } from "node:fs/promises"

import {
  createBlueNoteCore,
  type SyncLinkOptions,
  type SyncLinkSummary,
  type SyncNowSummary,
  type SyncRepairSummary,
  type SyncStatusView,
  type SyncUnlinkSummary,
} from "@lordierclaw/bluenote-core"

describe("@lordierclaw/bluenote-core public API", () => {
  test("exposes a minimal headless façade over notes, search, and rebuild", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-core-public-api-"))

    try {
      const core = createBlueNoteCore({ rootPath })

      assert.equal(typeof core.notes.list, "function")
      assert.equal(typeof core.notes.get, "function")
      assert.equal(typeof core.notes.create, "function")
      assert.equal(typeof core.notes.delete, "function")
      assert.equal(typeof core.notes.archive, "function")
      assert.equal(typeof core.notes.rename, "function")
      assert.equal(typeof core.notes.move, "function")
      assert.equal(typeof core.notes.promoteDraft, "function")
      assert.equal(typeof core.search.search, "function")
      assert.equal(typeof core.rebuild, "function")
      assert.equal(typeof core.sync.status, "function")
      assert.equal(typeof core.sync.link, "function")
      assert.equal(typeof core.sync.unlink, "function")
      assert.equal(typeof core.sync.now, "function")
      assert.equal(typeof core.sync.repair, "function")

      await mkdir(path.join(rootPath, "note", "projects"), { recursive: true })
      const created = core.notes.create({
        type: "normal",
        title: "Core API Note",
        body: "A note created through the @lordierclaw/bluenote-core façade.",
        destinationFolder: "note/projects",
        enqueueAi: false,
        randomSource: () => 0,
      })

      assert.equal(created.title, "Core API Note")
      assert.equal(created.relativePath, "note/projects/core-api-note-000000.md")
      assert.deepEqual(core.notes.list().map((note) => note.key), ["core-api-note-000000"])
      assert.equal(core.notes.get("core-api-note-000000").body, "A note created through the @lordierclaw/bluenote-core façade.")
      assert.equal(core.search.search("façade")[0]?.key, "core-api-note-000000")
      assert.equal(core.rebuild().noteCount, 1)
    } finally {
      await rm(rootPath, { recursive: true, force: true })
    }
  })

  test("exports public sync namespace types from the package root", () => {
    const linkOptions: SyncLinkOptions = {
      mode: "seed-empty-server-from-local",
      serverUrl: "https://sync.example.test",
    }
    const status: SyncStatusView = {
      state: "unlinked",
      mode: "standalone",
      activity: "idle",
      pendingCount: 0,
      runningCount: 0,
      failedCount: 0,
      lastError: null,
    }
    const linkSummary: SyncLinkSummary = {
      state: "linked",
      mode: "sync-client",
      workspaceId: "workspace_public_api",
      serverUrl: linkOptions.serverUrl,
      dirtyRecordsMarked: 0,
      foldersMarked: 0,
      notesMarked: 0,
    }
    const unlinkSummary: SyncUnlinkSummary = {
      state: "unlinked",
      mode: "standalone",
      keptLocalNotes: true,
    }
    const nowSummary: SyncNowSummary = {
      status: "not-linked",
      pushed: 0,
      pulled: 0,
    }
    const repairSummary: SyncRepairSummary = {
      dryRun: true,
      changed: false,
      issuesFound: 0,
      repairsApplied: 0,
      issues: [],
    }

    assert.equal(status.activity, "idle")
    assert.equal(linkSummary.serverUrl, "https://sync.example.test")
    assert.equal(unlinkSummary.keptLocalNotes, true)
    assert.equal(nowSummary.status, "not-linked")
    assert.equal(repairSummary.changed, false)
  })
})
