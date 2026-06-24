import {
  ensureSyncDatabase,
  openSyncDatabase,
  parseSyncMetadata,
  saveSyncDatabase,
  serializeSyncMetadata,
  type EnsureSyncDatabaseOptions,
} from "./sync-db"

const STATUS_SUMMARY_KEY = "summary"

export interface SyncStatusSummary {
  pendingCount: number
  runningCount: number
  failedCount: number
  updatedAt: string
  lastError?: string | null
}

interface StoredSyncStatusSummary extends Record<string, unknown> {
  pendingCount: number
  runningCount: number
  failedCount: number
  lastError: string | null
}

export interface SyncStatusRepository {
  writeStatusSummary(summary: SyncStatusSummary): void
  readStatusSummary(): SyncStatusSummary | null
}

export function createSyncStatusRepository(rootPath: string, dbIdentity: EnsureSyncDatabaseOptions): SyncStatusRepository {
  return {
    writeStatusSummary(summary) {
      ensureSyncDatabase(rootPath, dbIdentity)
      const handle = openSyncDatabase(rootPath)
      const stored: StoredSyncStatusSummary = {
        pendingCount: summary.pendingCount,
        runningCount: summary.runningCount,
        failedCount: summary.failedCount,
        lastError: summary.lastError ?? null,
      }

      try {
        handle.db.run(
          `
          INSERT INTO sync_status (key, value, updatedAt)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updatedAt = excluded.updatedAt
        `,
          [STATUS_SUMMARY_KEY, serializeSyncMetadata(stored), summary.updatedAt],
        )
        saveSyncDatabase(handle)
      } finally {
        handle.db.close()
      }
    },

    readStatusSummary() {
      ensureSyncDatabase(rootPath, dbIdentity)
      const handle = openSyncDatabase(rootPath)

      try {
        const rows =
          handle.db.exec("SELECT value, updatedAt FROM sync_status WHERE key = ?", [STATUS_SUMMARY_KEY])[0]?.values ?? []
        const row = rows[0] as unknown[] | undefined

        if (!row) {
          return null
        }

        const stored = parseSyncMetadata(typeof row[0] === "string" ? row[0] : null)

        if (!stored) {
          return null
        }

        return {
          pendingCount: Number(stored.pendingCount ?? 0),
          runningCount: Number(stored.runningCount ?? 0),
          failedCount: Number(stored.failedCount ?? 0),
          updatedAt: String(row[1]),
          lastError: typeof stored.lastError === "string" ? stored.lastError : null,
        }
      } finally {
        handle.db.close()
      }
    },
  }
}
