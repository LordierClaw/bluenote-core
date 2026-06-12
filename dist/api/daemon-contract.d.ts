export declare const BLUENOTE_DAEMON_API_VERSION = "1";
export declare const BLUENOTE_DAEMON_API_CAPABILITY_KEYS: readonly ["workspaceApi", "notesApi", "aiApi"];
export type BlueNoteDaemonApiCapability = typeof BLUENOTE_DAEMON_API_CAPABILITY_KEYS[number];
export type BlueNoteDaemonApiCapabilities = Record<BlueNoteDaemonApiCapability, boolean>;
export interface BlueNoteDaemonCapabilities extends BlueNoteDaemonApiCapabilities {
    apiVersion: typeof BLUENOTE_DAEMON_API_VERSION;
}
export interface ApiErrorBody {
    error: {
        code: string;
        message: string;
        hint?: string;
    };
}
export interface WorkspaceStatus {
    selected: boolean;
    initialized: boolean;
    rootPath?: string;
    defaultRootPath?: string;
    noteCount?: number;
    message?: string;
}
export interface OpenWorkspaceRequest {
    rootPath: string;
}
export interface InitWorkspaceRequest {
    rootPath?: string;
}
export interface FolderView {
    relativePath: string;
    name: string;
    noteCount: number;
}
export interface CreateFolderRequest {
    relativePath: string;
}
export interface RenameFolderRequest {
    from: string;
    to: string;
}
export type NoteFolder = "note" | "draft" | "all";
export interface NoteSummaryView {
    key: string;
    title: string;
    description: string;
    relativePath: string;
    folder: "note" | "draft";
    createdAt?: string;
    updatedAt?: string;
}
export interface NoteDetailView extends NoteSummaryView {
    body: string;
}
export interface SearchResultView extends NoteSummaryView {
    source: string;
    score?: number;
    match?: string;
}
export interface CreateNoteRequest {
    type?: "draft" | "normal";
    title?: string;
    body?: string;
    destinationFolder?: string;
}
export interface UpdateNoteRequest {
    body: string;
    title?: string;
}
export interface MoveNoteRequest {
    destinationFolder: string;
}
export interface AiStatusSummary {
    status: "workspace-not-open" | "not-configured" | "auth-required" | "connected" | "running" | "error";
    provider?: "openai-compatible" | "codex";
    model?: string;
    queue?: {
        pending: number;
        running: number;
        failed: number;
    };
    message?: string;
}
export interface AiConfigLoggingView {
    usage: boolean;
    conversations: boolean;
    results: boolean;
}
export interface AiConfigView {
    configured: boolean;
    enabled?: boolean;
    provider?: "openai-compatible" | "codex";
    model?: string;
    baseUrl?: string;
    apiKeyMasked?: string;
    logging?: AiConfigLoggingView;
    maxAttempts?: number;
    outputLanguage?: string;
}
export interface SaveAiConfigRequest {
    enabled?: boolean;
    provider?: "openai-compatible" | "codex";
    model?: string;
    baseUrl?: string;
    apiKey?: string;
    logging?: Partial<AiConfigLoggingView>;
    maxAttempts?: number;
    outputLanguage?: string;
}
export interface AiQueueJobView {
    kind: "describe-note";
    key: string;
    relativePath: string;
    status: "pending" | "running" | "failed";
    attempts: number;
    lastError?: string | null;
    updatedAt: string;
}
export interface AiQueueView {
    jobs: AiQueueJobView[];
}
export interface AiDescribeRequest {
    selector: string;
}
export interface AiDescribeResult {
    key: string;
    relativePath: string;
    status: "applied" | "rejected" | "error" | "stale";
    description?: string;
    error?: string;
}
export interface AiProcessQueueRequest {
    limit?: number;
}
export interface AiProcessQueueResult {
    applied: number;
    failed: number;
    remaining: number;
    setupBlocked: boolean;
}
export interface CodexAuthStatusView {
    state: "not-configured" | "setup-required" | "authenticated" | "expired" | "invalid";
    expiresAt?: string;
    issuer?: string;
    message?: string;
    hint?: string;
}
export interface CodexAuthStartView {
    verificationUrl: string;
    userCode: string;
    intervalSeconds: number;
}
//# sourceMappingURL=daemon-contract.d.ts.map