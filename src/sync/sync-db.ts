import path from "node:path"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"

// @ts-expect-error sql.js does not ship TypeScript declarations in this project.
import initSqlJs from "sql.js"

import {
  APP_STATE_SYNC_DATABASE_FILENAME,
  APP_STATE_SYNC_DIRECTORY,
} from "../config/root"
import { assertPathInsideRoot } from "../platform/path-safety"

const SQL_WASM_FILENAME = "sql-wasm.wasm"
const executableAdjacentSqlWasmPath = path.join(path.dirname(process.execPath), SQL_WASM_FILENAME)
const projectSqlWasmPath = path.resolve("node_modules", "sql.js", "dist", SQL_WASM_FILENAME)

let resolvedSqlWasmPath: string | null = null
try {
  const require = createRequire(import.meta.url)
  resolvedSqlWasmPath = require.resolve("sql.js/dist/sql-wasm.wasm")
} catch {
  // ignore
}

function locateSqlWasm(fileName: string): string {
  if (fileName !== SQL_WASM_FILENAME) {
    return fileName
  }

  if (existsSync(executableAdjacentSqlWasmPath)) {
    return executableAdjacentSqlWasmPath
  }

  if (resolvedSqlWasmPath && existsSync(resolvedSqlWasmPath)) {
    return resolvedSqlWasmPath
  }

  if (existsSync(projectSqlWasmPath)) {
    return projectSqlWasmPath
  }

  return fileName
}

const SQL = await initSqlJs({ locateFile: locateSqlWasm })

export const SYNC_SCHEMA_VERSION = 1

export type SyncDatabaseRole = "client" | "server"

export interface EnsureSyncDatabaseOptions {
  role: SyncDatabaseRole
  workspaceId: string
}

export interface EnsureSyncDatabaseResult {
  syncDatabasePath: string
  schemaVersion: number
}

interface SyncDatabaseHandle {
  db: InstanceType<typeof SQL.Database>
  syncDatabasePath: string
}

export function getSyncDatabasePath(rootPath: string): string {
  const normalizedRootPath = path.resolve(rootPath)
  const syncDirectoryPath = assertPathInsideRoot(normalizedRootPath, path.join(normalizedRootPath, APP_STATE_SYNC_DIRECTORY))

  return assertPathInsideRoot(syncDirectoryPath, path.join(syncDirectoryPath, APP_STATE_SYNC_DATABASE_FILENAME))
}

function openSyncDatabase(rootPath: string): SyncDatabaseHandle {
  const syncDatabasePath = getSyncDatabasePath(rootPath)
  mkdirSync(path.dirname(syncDatabasePath), { recursive: true })

  if (existsSync(syncDatabasePath)) {
    return {
      db: new SQL.Database(readFileSync(syncDatabasePath)),
      syncDatabasePath,
    }
  }

  return {
    db: new SQL.Database(),
    syncDatabasePath,
  }
}

function saveSyncDatabase(handle: SyncDatabaseHandle): void {
  writeFileSync(handle.syncDatabasePath, handle.db.export())
}

function bootstrapSyncSchema(handle: SyncDatabaseHandle, options: EnsureSyncDatabaseOptions): void {
  const { db } = handle

  db.run("BEGIN IMMEDIATE TRANSACTION")

  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS replicas (
        replicaId TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        label TEXT,
        lastSeenAt TEXT,
        lastPulledSequence INTEGER DEFAULT 0,
        lastPushedAt TEXT,
        status TEXT NOT NULL DEFAULT 'active'
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS server_changes (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        workspaceId TEXT NOT NULL,
        entityType TEXT NOT NULL,
        entityId TEXT NOT NULL,
        changeType TEXT NOT NULL,
        serverRevision INTEGER NOT NULL,
        changedAt TEXT NOT NULL,
        sourceReplicaId TEXT,
        title TEXT,
        relativePath TEXT,
        bodyAvailable INTEGER NOT NULL DEFAULT 0,
        metadataJson TEXT NOT NULL
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS dirty_records (
        entityType TEXT NOT NULL,
        entityId TEXT NOT NULL,
        dirtyType TEXT NOT NULL,
        markedAt TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        lastError TEXT,
        PRIMARY KEY (entityType, entityId)
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS tombstones (
        entityType TEXT NOT NULL,
        entityId TEXT NOT NULL,
        deletedAt TEXT NOT NULL,
        serverRevision INTEGER,
        sourceReplicaId TEXT,
        previousRelativePath TEXT,
        previousTitle TEXT,
        PRIMARY KEY (entityType, entityId)
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS folders (
        relativePath TEXT PRIMARY KEY,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        deletedAt TEXT
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS sync_status (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `)

    const upsertMeta = db.prepare(`
      INSERT INTO sync_meta (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)

    try {
      upsertMeta.run(["schemaVersion", String(SYNC_SCHEMA_VERSION)])
      upsertMeta.run(["workspaceId", options.workspaceId])
      upsertMeta.run(["role", options.role])
    } finally {
      upsertMeta.free()
    }

    db.run("COMMIT")
  } catch (error) {
    try {
      db.run("ROLLBACK")
    } catch {
      // Ignore rollback failures; the original error is more useful.
    }

    throw error
  }
}

export function ensureSyncDatabase(rootPath: string, options: EnsureSyncDatabaseOptions): EnsureSyncDatabaseResult {
  const handle = openSyncDatabase(rootPath)

  try {
    bootstrapSyncSchema(handle, options)
    saveSyncDatabase(handle)
  } finally {
    handle.db.close()
  }

  return {
    syncDatabasePath: handle.syncDatabasePath,
    schemaVersion: SYNC_SCHEMA_VERSION,
  }
}
