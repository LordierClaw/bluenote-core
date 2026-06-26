import { parseSyncMetadata, serializeSyncMetadata, withSyncDatabase, } from "./sync-db.js";
const STATUS_SUMMARY_KEY = "summary";
export function createSyncStatusRepository(rootPath, dbIdentity) {
    return {
        writeStatusSummary(summary) {
            withSyncDatabase(rootPath, dbIdentity, (handle) => {
                const stored = {
                    pendingCount: summary.pendingCount,
                    runningCount: summary.runningCount,
                    failedCount: summary.failedCount,
                    lastError: summary.lastError ?? null,
                };
                handle.db.run(`
          INSERT INTO sync_status (key, value, updatedAt)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updatedAt = excluded.updatedAt
        `, [STATUS_SUMMARY_KEY, serializeSyncMetadata(stored), summary.updatedAt]);
            }, { save: true });
        },
        readStatusSummary() {
            return withSyncDatabase(rootPath, dbIdentity, (handle) => {
                const rows = handle.db.exec("SELECT value, updatedAt FROM sync_status WHERE key = ?", [STATUS_SUMMARY_KEY])[0]?.values ?? [];
                const row = rows[0];
                if (!row) {
                    return null;
                }
                const stored = parseSyncMetadata(typeof row[0] === "string" ? row[0] : null);
                if (!stored) {
                    return null;
                }
                return {
                    pendingCount: Number(stored.pendingCount ?? 0),
                    runningCount: Number(stored.runningCount ?? 0),
                    failedCount: Number(stored.failedCount ?? 0),
                    updatedAt: String(row[1]),
                    lastError: typeof stored.lastError === "string" ? stored.lastError : null,
                };
            });
        },
    };
}
//# sourceMappingURL=status-repository.js.map