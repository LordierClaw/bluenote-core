export type SyncLogLevel = "debug" | "info" | "warn" | "error";
export type SyncLogValue = null | boolean | number | string | SyncLogValue[] | {
    [key: string]: SyncLogValue | undefined;
};
export interface SyncLogRecord {
    event: string;
    level?: SyncLogLevel;
    [key: string]: unknown;
}
export interface CreateSyncLogWriterOptions {
    rootPath: string;
    now?: () => Date;
}
export interface SyncLogWriter {
    write(record: SyncLogRecord): Promise<void>;
}
export declare function redactSyncLogValue(value: unknown): SyncLogValue;
export declare function createSyncLogWriter(options: CreateSyncLogWriterOptions): SyncLogWriter;
//# sourceMappingURL=sync-log.d.ts.map