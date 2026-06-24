import { type EnsureSyncDatabaseOptions } from "./sync-db.js";
export interface SyncStatusSummary {
    pendingCount: number;
    runningCount: number;
    failedCount: number;
    updatedAt: string;
    lastError?: string | null;
}
export interface SyncStatusRepository {
    writeStatusSummary(summary: SyncStatusSummary): void;
    readStatusSummary(): SyncStatusSummary | null;
}
export declare function createSyncStatusRepository(rootPath: string, dbIdentity: EnsureSyncDatabaseOptions): SyncStatusRepository;
//# sourceMappingURL=status-repository.d.ts.map