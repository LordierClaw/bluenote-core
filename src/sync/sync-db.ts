import path from "node:path"
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"

// @ts-expect-error sql.js does not ship TypeScript declarations in this project.
import initSqlJs from "sql.js"

import {
  APP_STATE_SYNC_DATABASE_FILENAME,
  APP_STATE_SYNC_DIRECTORY,
} from "../config/root"
import { UsageError } from "../core/errors"
import { assertPathInsideRoot } from "../platform/path-safety"
import { replaceFileAtomically } from "../storage/atomic-replace"
import { ensureManagedRoot } from "../storage/root-layout"

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

export type SyncJsonObject = Record<string, unknown>

export interface SyncDatabaseHandle {
  db: InstanceType<typeof SQL.Database>
  syncDatabasePath: string
}

export function getSyncDatabasePath(rootPath: string): string {
  const normalizedRootPath = path.resolve(rootPath)
  const syncDirectoryPath = assertPathInsideRoot(normalizedRootPath, path.join(normalizedRootPath, APP_STATE_SYNC_DIRECTORY))

  return assertPathInsideRoot(syncDirectoryPath, path.join(syncDirectoryPath, APP_STATE_SYNC_DATABASE_FILENAME))
}

export function openSyncDatabase(rootPath: string): SyncDatabaseHandle {
  ensureManagedRoot(rootPath)
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

export function saveSyncDatabase(handle: SyncDatabaseHandle): void {
  const syncDirectoryPath = path.dirname(handle.syncDatabasePath)
  const temporaryPath = path.join(syncDirectoryPath, `${path.basename(handle.syncDatabasePath)}.tmp-${process.pid}-${Date.now()}`)

  try {
    writeFileSync(temporaryPath, handle.db.export())
    fsyncFileBestEffort(temporaryPath)
    replaceFileAtomically(temporaryPath, handle.syncDatabasePath)
    fsyncDirectoryBestEffort(syncDirectoryPath)
  } catch (error) {
    rmSync(temporaryPath, { force: true })
    throw error
  }
}

function fsyncFileBestEffort(filePath: string): void {
  let fd: number | null = null
  try {
    fd = openSync(filePath, "r")
    fsyncSync(fd)
  } catch {
    // Best-effort durability: some filesystems/platforms may reject fsync.
  } finally {
    if (fd !== null) {
      closeSync(fd)
    }
  }
}

function fsyncDirectoryBestEffort(directoryPath: string): void {
  let fd: number | null = null
  try {
    fd = openSync(directoryPath, "r")
    fsyncSync(fd)
  } catch {
    // Best-effort durability: directory fsync is not portable across all platforms.
  } finally {
    if (fd !== null) {
      closeSync(fd)
    }
  }
}

function readMetadataValue(db: InstanceType<typeof SQL.Database>, key: string): string | null {
  const rows = db.exec("SELECT value FROM sync_meta WHERE key = ?", [key])[0]?.values ?? []
  const value = rows[0]?.[0]

  return typeof value === "string" ? value : null
}

function ensureMetadataValue(db: InstanceType<typeof SQL.Database>, key: string, value: string): void {
  const existingValue = readMetadataValue(db, key)

  if (existingValue !== null && existingValue !== value) {
    throw new UsageError(`Sync database ${key} mismatch.`, {
      hint: `Expected ${key} '${existingValue}', but received '${value}'. Use a different BlueNote root or reset sync state deliberately.`,
    })
  }

  if (existingValue === null) {
    db.run("INSERT INTO sync_meta (key, value) VALUES (?, ?)", [key, value])
  }
}

export function serializeSyncMetadata(metadata: SyncJsonObject | null | undefined): string {
  return JSON.stringify(metadata ?? null)
}

export function parseSyncMetadata(value: string | null): SyncJsonObject | null {
  if (value === null) {
    return null
  }

  const parsed = JSON.parse(value) as unknown
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as SyncJsonObject) : null
}

function ensureColumn(db: InstanceType<typeof SQL.Database>, tableName: string, columnName: string, definition: string): void {
  const rows = db.exec(`PRAGMA table_info(${tableName})`)[0]?.values ?? []
  const hasColumn = (rows as unknown[][]).some((row: unknown[]) => row[1] === columnName)

  if (!hasColumn) {
    db.run(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`)
  }
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
        metadataJson TEXT NOT NULL DEFAULT 'null',
        PRIMARY KEY (entityType, entityId)
      )
    `)

    ensureColumn(db, "dirty_records", "metadataJson", "metadataJson TEXT NOT NULL DEFAULT 'null'")

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

    ensureMetadataValue(db, "schemaVersion", String(SYNC_SCHEMA_VERSION))
    ensureMetadataValue(db, "workspaceId", options.workspaceId)
    ensureMetadataValue(db, "role", options.role)

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
