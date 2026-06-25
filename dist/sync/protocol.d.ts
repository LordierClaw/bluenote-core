export type SyncChangeEntityType = "note" | "folder" | "config" | "tombstone" | "ai";
export type SyncPushEntityType = "note" | "folder";
export type SyncDirtyType = "upsert" | "delete" | "folder-upsert" | "folder-delete";
export interface PullChangesRequest {
    workspaceId: string;
    sinceSequence: number;
    limit: number;
}
export interface PullChangesResponse {
    workspaceId: string;
    fromSequence: number;
    toSequence: number;
    hasMore: boolean;
    changes: SyncChangeView[];
}
export interface SyncChangeView {
    sequence: number;
    entityType: SyncChangeEntityType;
    entityId: string;
    changeType: string;
    serverRevision: number;
    changedAt: string;
    sourceReplicaId?: string;
    title?: string;
    relativePath?: string;
    bodyAvailable?: boolean;
    metadata: Record<string, unknown>;
}
export interface SyncBodyUploadDescriptor {
    uploadId?: string;
    contentHash: string;
    byteLength: number;
}
export interface SyncPushRecord {
    entityType: SyncPushEntityType;
    entityId: string;
    dirtyType: SyncDirtyType;
    clientUpdatedAt: string;
    metadata: Record<string, unknown>;
    bodyUpload?: SyncBodyUploadDescriptor;
}
export interface PushRequest {
    workspaceId: string;
    replicaId: string;
    baseSequence: number;
    records: SyncPushRecord[];
}
export interface PushAcceptedRecord {
    entityType: SyncPushEntityType;
    entityId: string;
    serverRevision: number;
}
export interface PushRejectedRecord {
    entityType: SyncPushEntityType;
    entityId: string;
    code: string;
    message: string;
}
export interface PushResponse {
    accepted: PushAcceptedRecord[];
    replacedByServer: PushAcceptedRecord[];
    rejected: PushRejectedRecord[];
    serverSequence: number;
}
export interface UploadNoteBodyRequest {
    workspaceId: string;
    replicaId: string;
    noteId: string;
    contentHash: string;
    byteLength: number;
    body: string;
}
export interface UploadNoteBodyResponse {
    noteId: string;
    contentHash: string;
    byteLength: number;
    accepted: boolean;
}
export interface DownloadNoteBodyResponse {
    workspaceId: string;
    noteId: string;
    sequence?: number;
    serverRevision?: number;
    contentHash?: string;
    byteLength?: number;
    body: string;
}
export interface SnapshotResponse {
    workspaceId: string;
    serverSequence: number;
    hasMore: boolean;
    changes: SyncChangeView[];
}
export interface SnapshotRequiredError {
    error: "snapshot-required";
    code: "SNAPSHOT_REQUIRED";
    message: string;
    workspaceId: string;
    latestSequence: number;
}
export declare function isSyncChangeView(value: unknown): value is SyncChangeView;
export declare function isPullChangesRequest(value: unknown): value is PullChangesRequest;
export declare function isPullChangesResponse(value: unknown): value is PullChangesResponse;
export declare function isSyncBodyUploadDescriptor(value: unknown): value is SyncBodyUploadDescriptor;
export declare function isSyncPushRecord(value: unknown): value is SyncPushRecord;
export declare function isPushRequest(value: unknown): value is PushRequest;
export declare function isPushResponse(value: unknown): value is PushResponse;
export declare function isUploadNoteBodyRequest(value: unknown): value is UploadNoteBodyRequest;
export declare function isUploadNoteBodyResponse(value: unknown): value is UploadNoteBodyResponse;
export declare function isDownloadNoteBodyResponse(value: unknown): value is DownloadNoteBodyResponse;
export declare function isSnapshotResponse(value: unknown): value is SnapshotResponse;
export declare function isSnapshotRequiredError(value: unknown): value is SnapshotRequiredError;
//# sourceMappingURL=protocol.d.ts.map