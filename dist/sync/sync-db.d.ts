declare const SQL: any;
export declare const SYNC_SCHEMA_VERSION = 1;
export type SyncDatabaseRole = "client" | "server";
export interface EnsureSyncDatabaseOptions {
    role: SyncDatabaseRole;
    workspaceId: string;
}
export interface EnsureSyncDatabaseResult {
    syncDatabasePath: string;
    schemaVersion: number;
}
export type SyncJsonObject = Record<string, unknown>;
export interface SyncDatabaseHandle {
    db: InstanceType<typeof SQL.Database>;
    syncDatabasePath: string;
}
export interface WithSyncDatabaseOptions {
    save?: boolean;
}
export declare function getSyncDatabasePath(rootPath: string): string;
export declare function serializeSyncMetadata(metadata: SyncJsonObject | null | undefined): string;
export declare function parseSyncMetadata(value: string | null): SyncJsonObject | null;
export declare function withSyncDatabase<Result>(rootPath: string, identity: EnsureSyncDatabaseOptions, operation: (handle: SyncDatabaseHandle) => Result, options?: WithSyncDatabaseOptions): Result;
export declare function ensureSyncDatabase(rootPath: string, options: EnsureSyncDatabaseOptions): EnsureSyncDatabaseResult;
export {};
//# sourceMappingURL=sync-db.d.ts.map