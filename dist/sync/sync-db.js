import path from "node:path";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
// @ts-expect-error sql.js does not ship TypeScript declarations in this project.
import initSqlJs from "sql.js";
import { APP_STATE_SYNC_DATABASE_FILENAME, APP_STATE_SYNC_DIRECTORY, } from "../config/root.js";
import { UsageError } from "../core/errors.js";
import { assertPathInsideRoot } from "../platform/path-safety.js";
import { replaceFileAtomically } from "../storage/atomic-replace.js";
import { ensureManagedRoot } from "../storage/root-layout.js";
const SQL_WASM_FILENAME = "sql-wasm.wasm";
const executableAdjacentSqlWasmPath = path.join(path.dirname(process.execPath), SQL_WASM_FILENAME);
const projectSqlWasmPath = path.resolve("node_modules", "sql.js", "dist", SQL_WASM_FILENAME);
let resolvedSqlWasmPath = null;
try {
    const require = createRequire(import.meta.url);
    resolvedSqlWasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
}
catch {
    // ignore
}
function locateSqlWasm(fileName) {
    if (fileName !== SQL_WASM_FILENAME) {
        return fileName;
    }
    if (existsSync(executableAdjacentSqlWasmPath)) {
        return executableAdjacentSqlWasmPath;
    }
    if (resolvedSqlWasmPath && existsSync(resolvedSqlWasmPath)) {
        return resolvedSqlWasmPath;
    }
    if (existsSync(projectSqlWasmPath)) {
        return projectSqlWasmPath;
    }
    return fileName;
}
const SQL = await initSqlJs({ locateFile: locateSqlWasm });
export const SYNC_SCHEMA_VERSION = 1;
export function getSyncDatabasePath(rootPath) {
    const normalizedRootPath = path.resolve(rootPath);
    const syncDirectoryPath = assertPathInsideRoot(normalizedRootPath, path.join(normalizedRootPath, APP_STATE_SYNC_DIRECTORY));
    return assertPathInsideRoot(syncDirectoryPath, path.join(syncDirectoryPath, APP_STATE_SYNC_DATABASE_FILENAME));
}
function openSyncDatabase(rootPath) {
    ensureManagedRoot(rootPath);
    const syncDatabasePath = getSyncDatabasePath(rootPath);
    mkdirSync(path.dirname(syncDatabasePath), { recursive: true });
    if (existsSync(syncDatabasePath)) {
        return {
            db: new SQL.Database(readFileSync(syncDatabasePath)),
            syncDatabasePath,
        };
    }
    return {
        db: new SQL.Database(),
        syncDatabasePath,
    };
}
function saveSyncDatabase(handle) {
    const syncDirectoryPath = path.dirname(handle.syncDatabasePath);
    const temporaryPath = path.join(syncDirectoryPath, `${path.basename(handle.syncDatabasePath)}.tmp-${process.pid}-${Date.now()}`);
    try {
        writeFileSync(temporaryPath, handle.db.export());
        fsyncFileBestEffort(temporaryPath);
        replaceFileAtomically(temporaryPath, handle.syncDatabasePath);
        fsyncDirectoryBestEffort(syncDirectoryPath);
    }
    catch (error) {
        rmSync(temporaryPath, { force: true });
        throw error;
    }
}
function getSyncDatabaseLockPath(syncDatabasePath) {
    return `${syncDatabasePath}.lock`;
}
function getSyncDatabaseLockMetadataPath(lockPath) {
    return path.join(lockPath, "lock.json");
}
function writeSyncDatabaseLockMetadata(lockPath) {
    writeFileSync(getSyncDatabaseLockMetadataPath(lockPath), `${JSON.stringify({
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
    }, null, 2)}\n`, "utf8");
}
function acquireSyncDatabaseLock(syncDatabasePath) {
    const lockPath = getSyncDatabaseLockPath(syncDatabasePath);
    const relativePath = path.basename(lockPath);
    try {
        mkdirSync(path.dirname(lockPath), { recursive: true });
        mkdirSync(lockPath);
        try {
            writeSyncDatabaseLockMetadata(lockPath);
        }
        catch (metadataError) {
            rmSync(lockPath, { recursive: true, force: true });
            throw metadataError;
        }
    }
    catch (error) {
        const code = error instanceof Error && "code" in error ? error.code : undefined;
        if (code === "EEXIST") {
            throw new UsageError(`Sync database '${relativePath}' is busy.`, {
                hint: "Retry after any other BlueNote sync operation finishes, or remove .data/sync/sync.sqlite.lock manually if no BlueNote process is running.",
                cause: error,
            });
        }
        else {
            throw new UsageError(`Could not lock sync database '${relativePath}'.`, {
                hint: "Ensure BLUENOTE_ROOT points to a writable directory path.",
                cause: error,
            });
        }
    }
    return () => {
        try {
            rmSync(lockPath, { recursive: true, force: true });
        }
        catch {
            // Best-effort cleanup must not hide the original sync database operation error.
        }
    };
}
function fsyncFileBestEffort(filePath) {
    let fd = null;
    try {
        fd = openSync(filePath, "r");
        fsyncSync(fd);
    }
    catch {
        // Best-effort durability: some filesystems/platforms may reject fsync.
    }
    finally {
        if (fd !== null) {
            closeSync(fd);
        }
    }
}
function fsyncDirectoryBestEffort(directoryPath) {
    let fd = null;
    try {
        fd = openSync(directoryPath, "r");
        fsyncSync(fd);
    }
    catch {
        // Best-effort durability: directory fsync is not portable across all platforms.
    }
    finally {
        if (fd !== null) {
            closeSync(fd);
        }
    }
}
function readMetadataValue(db, key) {
    const rows = db.exec("SELECT value FROM sync_meta WHERE key = ?", [key])[0]?.values ?? [];
    const value = rows[0]?.[0];
    return typeof value === "string" ? value : null;
}
function ensureMetadataValue(db, key, value) {
    const existingValue = readMetadataValue(db, key);
    if (existingValue !== null && existingValue !== value) {
        throw new UsageError(`Sync database ${key} mismatch.`, {
            hint: `Expected ${key} '${existingValue}', but received '${value}'. Use a different BlueNote root or reset sync state deliberately.`,
        });
    }
    if (existingValue === null) {
        db.run("INSERT INTO sync_meta (key, value) VALUES (?, ?)", [key, value]);
    }
}
export function serializeSyncMetadata(metadata) {
    return JSON.stringify(metadata ?? null);
}
export function parseSyncMetadata(value) {
    if (value === null) {
        return null;
    }
    const parsed = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
}
function ensureColumn(db, tableName, columnName, definition) {
    const rows = db.exec(`PRAGMA table_info(${tableName})`)[0]?.values ?? [];
    const hasColumn = rows.some((row) => row[1] === columnName);
    if (!hasColumn) {
        db.run(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
    }
}
function bootstrapSyncSchema(handle, options) {
    const { db } = handle;
    db.run("BEGIN IMMEDIATE TRANSACTION");
    try {
        db.run(`
      CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
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
    `);
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
    `);
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
    `);
        ensureColumn(db, "dirty_records", "metadataJson", "metadataJson TEXT NOT NULL DEFAULT 'null'");
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
    `);
        db.run(`
      CREATE TABLE IF NOT EXISTS folders (
        relativePath TEXT PRIMARY KEY,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        deletedAt TEXT
      )
    `);
        db.run(`
      CREATE TABLE IF NOT EXISTS sync_status (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);
        ensureMetadataValue(db, "schemaVersion", String(SYNC_SCHEMA_VERSION));
        ensureMetadataValue(db, "workspaceId", options.workspaceId);
        ensureMetadataValue(db, "role", options.role);
        db.run("COMMIT");
    }
    catch (error) {
        try {
            db.run("ROLLBACK");
        }
        catch {
            // Ignore rollback failures; the original error is more useful.
        }
        throw error;
    }
}
export function withSyncDatabase(rootPath, identity, operation, options = {}) {
    ensureManagedRoot(rootPath);
    const syncDatabasePath = getSyncDatabasePath(rootPath);
    const releaseLock = acquireSyncDatabaseLock(syncDatabasePath);
    let handle = null;
    try {
        handle = openSyncDatabase(rootPath);
        bootstrapSyncSchema(handle, identity);
        const result = operation(handle);
        if (options.save === true) {
            saveSyncDatabase(handle);
        }
        return result;
    }
    finally {
        if (handle) {
            handle.db.close();
        }
        releaseLock();
    }
}
export function ensureSyncDatabase(rootPath, options) {
    const syncDatabasePath = getSyncDatabasePath(rootPath);
    withSyncDatabase(rootPath, options, () => undefined, { save: true });
    return {
        syncDatabasePath,
        schemaVersion: SYNC_SCHEMA_VERSION,
    };
}
//# sourceMappingURL=sync-db.js.map