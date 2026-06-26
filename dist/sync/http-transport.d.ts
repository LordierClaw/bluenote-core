import { type FetchLike } from "../platform/fetch.js";
import type { SyncStatusView } from "./types.js";
import type { DownloadNoteBodyResponse, PullChangesRequest, PullChangesResponse, PushRequest, PushResponse, UploadNoteBodyRequest, UploadNoteBodyResponse } from "./protocol.js";
export type SyncHttpFetch = FetchLike;
export interface CreateSyncHttpTransportOptions {
    baseUrl: string;
    fetch?: SyncHttpFetch;
}
export interface SyncHttpTransport {
    /** Async HTTP adapter for daemon/network use. The in-process core SyncTransport remains synchronous. */
    pull(request: PullChangesRequest): Promise<PullChangesResponse>;
    push(request: PushRequest & {
        noteBodies?: Record<string, string>;
    }): Promise<PushResponse>;
    uploadNoteBody(request: UploadNoteBodyRequest): Promise<UploadNoteBodyResponse>;
    downloadNoteBody(noteId: string, options?: {
        workspaceId?: string;
        sequence?: number;
        serverRevision?: number;
    }): Promise<DownloadNoteBodyResponse>;
    status(options?: {
        workspaceId?: string;
    }): Promise<Record<string, unknown>>;
    getStatus(options?: {
        workspaceId?: string;
    }): Promise<Record<string, unknown>>;
}
export type HttpSyncTransportOptions = CreateSyncHttpTransportOptions;
export type HttpSyncTransport = SyncHttpTransport;
export interface SyncHttpService {
    getChanges(request: PullChangesRequest): PullChangesResponse | Promise<PullChangesResponse>;
    acceptPush(request: PushRequest & {
        noteBodies?: Record<string, string>;
    }): PushResponse | Promise<PushResponse>;
    uploadNoteBody?(request: UploadNoteBodyRequest): UploadNoteBodyResponse | Promise<UploadNoteBodyResponse>;
    downloadNoteBody(noteId: string, request?: {
        workspaceId?: string;
        sequence?: number;
        serverRevision?: number;
    }): DownloadNoteBodyResponse | Promise<DownloadNoteBodyResponse>;
    status?(request?: {
        workspaceId?: string;
    }): Record<string, unknown> | SyncStatusView | Promise<Record<string, unknown> | SyncStatusView>;
}
export type HttpSyncServerService = SyncHttpService;
export interface CreateHttpSyncServerHandlerOptions {
    service: SyncHttpService;
    status?: (request: {
        workspaceId?: string;
    }) => Record<string, unknown> | SyncStatusView | Promise<Record<string, unknown> | SyncStatusView>;
}
export interface SyncHttpRequest {
    method: string;
    path: string;
    body?: unknown;
    headers?: Record<string, string | string[] | undefined>;
}
export interface SyncHttpResponse {
    status: number;
    body: unknown;
    headers?: Record<string, string>;
}
export interface SyncHttpHandlers {
    handle(request: SyncHttpRequest): Promise<SyncHttpResponse>;
}
export type HttpSyncServerHandler = SyncHttpHandlers;
export declare function redactSyncHttpUrl(rawUrl: string | URL): string;
export declare const redactSyncUrl: typeof redactSyncHttpUrl;
export declare function createSyncHttpTransport(options: CreateSyncHttpTransportOptions): SyncHttpTransport;
export declare const createHttpSyncTransport: typeof createSyncHttpTransport;
export declare function createSyncHttpHandlers(service: SyncHttpService): SyncHttpHandlers;
export declare function createHttpSyncServerHandler(options: CreateHttpSyncServerHandlerOptions): HttpSyncServerHandler;
export declare function isSyncHttpRequestBody(value: unknown): Record<string, unknown>;
//# sourceMappingURL=http-transport.d.ts.map