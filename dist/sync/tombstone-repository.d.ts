import { type EnsureSyncDatabaseOptions } from "./sync-db.js";
export interface TombstoneInput {
    entityType: string;
    entityId: string;
    deletedAt: string;
    previousRelativePath?: string | null;
    previousTitle?: string | null;
    sourceReplicaId?: string | null;
    serverRevision?: number | null;
}
export interface TombstoneRecord {
    entityType: string;
    entityId: string;
    deletedAt: string;
    serverRevision: number | null;
    sourceReplicaId: string | null;
    previousRelativePath: string | null;
    previousTitle: string | null;
}
export interface TombstoneRepository {
    recordTombstone(tombstone: TombstoneInput): void;
    listTombstones(): TombstoneRecord[];
}
export declare function createTombstoneRepository(rootPath: string, dbIdentity: EnsureSyncDatabaseOptions): TombstoneRepository;
//# sourceMappingURL=tombstone-repository.d.ts.map