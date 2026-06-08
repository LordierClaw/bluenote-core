import type { CodexAuth, CodexAuthRepository } from "./codex-auth-repository";
export declare const DEFAULT_CODEX_AUTH_ISSUER = "https://auth.openai.com";
export declare const DEFAULT_CODEX_AUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export declare const DEFAULT_CODEX_LOGIN_TIMEOUT_MS: number;
export type CodexAuthFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type CodexAuthClientErrorCode = "denied" | "cancelled" | "expired" | "permanent" | "http" | "malformed" | "setup-required" | "aborted";
export interface CodexDeviceFlow {
    deviceAuthId: string;
    userCode: string;
    verificationUrl: string;
    intervalSeconds: number;
}
export interface CodexAuthorizationCode {
    authorizationCode: string;
    codeChallenge: string;
    codeVerifier: string;
}
export interface CodexAuthClientOptions {
    fetch?: CodexAuthFetch;
    issuer?: string;
    clientId?: string;
    loginTimeoutMs?: number;
    now?: () => Date;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    repository?: CodexAuthRepository;
}
export interface CodexLoginOptions {
    signal?: AbortSignal;
    onDeviceFlow?: (flow: CodexDeviceFlow) => void | Promise<void>;
}
export interface CodexAuthClient {
    startDeviceFlow(options?: {
        signal?: AbortSignal;
    }): Promise<CodexDeviceFlow>;
    pollDeviceFlow(flow: CodexDeviceFlow, options?: {
        signal?: AbortSignal;
    }): Promise<CodexAuthorizationCode>;
    exchangeAuthorizationCode(code: CodexAuthorizationCode, options?: {
        signal?: AbortSignal;
    }): Promise<CodexAuth>;
    completeDeviceFlow(flow: CodexDeviceFlow, options?: {
        signal?: AbortSignal;
    }): Promise<CodexAuth>;
    login(options?: CodexLoginOptions): Promise<CodexAuth>;
    refreshAuth(auth: CodexAuth, options?: {
        signal?: AbortSignal;
    }): Promise<CodexAuth>;
}
export declare class CodexAuthClientError extends Error {
    code: CodexAuthClientErrorCode;
    constructor(code: CodexAuthClientErrorCode, message: string, options?: ErrorOptions);
}
export declare function createCodexAuthClient(options?: CodexAuthClientOptions): CodexAuthClient;
//# sourceMappingURL=codex-auth-client.d.ts.map