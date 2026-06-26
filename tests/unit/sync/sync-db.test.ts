import { test } from "vitest"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { access, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises"

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

test("ensureSyncDatabase rejects workspace or role mismatches for an existing sync database", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-sync-db-identity-"))

  try {
    ensureSyncDatabase(rootPath, { role: "client", workspaceId: "workspace-123" })

    assert.throws(
      () => ensureSyncDatabase(rootPath, { role: "client", workspaceId: "workspace-456" }),
      /workspaceId/i,
    )
    assert.throws(
      () => ensureSyncDatabase(rootPath, { role: "server", workspaceId: "workspace-123" }),
      /role/i,
    )

    const bytes = new Uint8Array(await readFile(path.join(rootPath, ".data", "sync", "sync.sqlite")))
    const db = new SQL.Database(bytes)

    try {
      const metadata = Object.fromEntries(db.exec("SELECT key, value FROM sync_meta ORDER BY key ASC")[0]?.values as [string, string][])
      assert.equal(metadata.workspaceId, "workspace-123")
      assert.equal(metadata.role, "client")
    } finally {
      db.close()
    }
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("ensureSyncDatabase rejects managed sync paths that escape through symlinks", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-sync-db-symlink-root-"))
  const outsidePath = await mkdtemp(path.join(os.tmpdir(), "bluenote-sync-db-symlink-outside-"))

  try {
    await mkdir(path.join(rootPath, ".data"), { recursive: true })
    await symlink(outsidePath, path.join(rootPath, ".data", "sync"), "dir")

    assert.throws(
      () => ensureSyncDatabase(rootPath, { role: "client", workspaceId: "workspace-123" }),
      /symlink/i,
    )
    await assert.rejects(readFile(path.join(outsidePath, "sync.sqlite")), (error: unknown) => {
      const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined
      return code === "ENOENT"
    })
  } finally {
    await rm(rootPath, { recursive: true, force: true })
    await rm(outsidePath, { recursive: true, force: true })
  }
})
