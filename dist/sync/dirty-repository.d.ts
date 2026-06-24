import { type EnsureSyncDatabaseOptions, type SyncJsonObject } from "./sync-db.js";
export interface DirtyRecordInput {
    entityType: string;
    entityId: string;
    dirtyType: string;
    markedAt: string;
    metadata?: SyncJsonObject | null;
}
export interface DirtyRecord {
    entityType: string;
    entityId: string;
    dirtyType: string;
    markedAt: string;
    attempts: number;
    lastError: string | null;
    metadata: SyncJsonObject | null;
}
export interface DirtyRecordRepository {
    markDirty(record: DirtyRecordInput): void;
    listDirtyRecords(): DirtyRecord[];
    clearDirtyRecord(entityType: string, entityId: string): void;
}
export declare function createDirtyRecordRepository(rootPath: string, dbIdentity: EnsureSyncDatabaseOptions): DirtyRecordRepository;
//# sourceMappingURL=dirty-repository.d.ts.map