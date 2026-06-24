export type SyncRuntimeMode = "standalone" | "sync-client";
export interface SyncRuntimeModeConfig {
    mode: SyncRuntimeMode;
    workspaceId?: string;
}
export interface SyncClientRuntimeModeConfig {
    mode: "sync-client";
    workspaceId: string;
}
export declare function getSyncRuntimeModePath(rootPath: string): string;
export declare function readSyncRuntimeMode(rootPath: string): SyncRuntimeModeConfig;
export declare function getSyncClientRuntimeMode(rootPath: string): SyncClientRuntimeModeConfig | null;
export declare function setSyncRuntimeMode(rootPath: string, config: SyncRuntimeModeConfig): void;
//# sourceMappingURL=runtime-mode.d.ts.map