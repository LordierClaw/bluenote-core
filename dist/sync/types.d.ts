import type { ResolveBlueNoteRootOptions } from "../config/root.js";
export type SyncLinkMode = "seed-empty-server-from-local";
export type SyncRuntimeViewMode = "standalone" | "sync-client";
export type SyncConnectionState = "unlinked" | "linked";
export type SyncActivityState = "idle";
export interface SyncStatusView {
    state: SyncConnectionState;
    mode: SyncRuntimeViewMode;
    activity: SyncActivityState;
    workspaceId?: string;
    pendingCount: number;
    runningCount: number;
    failedCount: number;
    lastError: string | null;
}
export interface SyncLinkOptions {
    mode: SyncLinkMode;
    serverUrl: string;
    workspaceId?: string;
}
export interface SyncLinkSummary {
    state: "linked";
    mode: "sync-client";
    workspaceId: string;
    serverUrl: string;
    dirtyRecordsMarked: number;
    notesMarked: number;
    foldersMarked: number;
}
export interface SyncUnlinkSummary {
    state: "unlinked";
    mode: "standalone";
    keptLocalNotes: true;
}
export interface SyncNowOptions {
    force?: boolean;
    transport?: import("./core-sync.js").SyncTransport;
    replicaId?: string;
}
export type SyncNowStatus = "not-linked" | "transport-not-configured" | "synced";
export interface SyncNowSummary {
    status: SyncNowStatus;
    pushed: number;
    pulled: number;
}
export interface SyncRepairOptions {
    dryRun?: boolean;
}
export interface SyncRepairSummary {
    dryRun: boolean;
    changed: boolean;
    issuesFound: number;
    repairsApplied: number;
}
export type SyncRootOptions = ResolveBlueNoteRootOptions;
//# sourceMappingURL=types.d.ts.map