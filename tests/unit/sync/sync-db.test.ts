import { test } from "vitest"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { access, mkdtemp, readFile, rm } from "node:fs/promises"

// @ts-expect-error sql.js does not ship TypeScript declarations in this project.
import initSqlJs from "sql.js"

import { ensureSyncDatabase, SYNC_SCHEMA_VERSION } from "../../../src/sync/sync-db"

const REQUIRED_TABLES = [
  "sync_meta",
  "replicas",
  "server_changes",
  "dirty_records",
  "tombstones",
  "folders",
  "sync_status",
]

const SQL = await initSqlJs()

test("ensureSyncDatabase creates the sync database with required tables and metadata", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-sync-db-"))
  const workspaceId = "workspace-123"

  try {
    const result = ensureSyncDatabase(rootPath, { role: "client", workspaceId })

    assert.equal(result.syncDatabasePath, path.join(rootPath, ".data", "sync", "sync.sqlite"))
    assert.equal(result.schemaVersion, SYNC_SCHEMA_VERSION)
    await access(result.syncDatabasePath)

    const bytes = new Uint8Array(await readFile(result.syncDatabasePath))
    const db = new SQL.Database(bytes)

    try {
      const tableRows = db.exec(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name ASC
      `)[0]?.values ?? []
      const tableNames = tableRows.map(([name]: [string]) => name)
      assert.deepEqual(tableNames, [...REQUIRED_TABLES].sort())

      const metaRows = db.exec("SELECT key, value FROM sync_meta ORDER BY key ASC")[0]?.values ?? []
      const metadata = Object.fromEntries(metaRows as [string, string][])

      assert.equal(metadata.schemaVersion, String(SYNC_SCHEMA_VERSION))
      assert.equal(metadata.workspaceId, workspaceId)
      assert.equal(metadata.role, "client")
    } finally {
      db.close()
    }
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})
