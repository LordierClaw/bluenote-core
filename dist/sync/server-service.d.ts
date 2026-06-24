import type { DownloadNoteBodyResponse, PullChangesRequest, PullChangesResponse, PushRequest, PushResponse } from "./protocol.js";
export interface SyncServerAiWork {
    noteId: string;
    reason: "sync-push";
}
export type SyncServerAiQueue = (work: SyncServerAiWork) => void | Promise<void>;
export interface CreateSyncServerServiceOptions {
    rootPath: string;
    workspaceId: string;
    queueAiWork?: SyncServerAiQueue;
}
export interface SyncServerPushRequest extends PushRequest {
    noteBodies?: Record<string, string>;
}
export interface SyncServerService {
    acceptPush(request: SyncServerPushRequest): PushResponse;
    getChanges(request: PullChangesRequest): PullChangesResponse;
    downloadNoteBody(noteId: string): DownloadNoteBodyResponse;
}
export declare function createSyncServerService(options: CreateSyncServerServiceOptions): SyncServerService;
//# sourceMappingURL=server-service.d.ts.map