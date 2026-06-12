export type CodexAuthStatusState = "not-configured" | "setup-required" | "authenticated" | "expired" | "invalid";
export interface CodexAuth {
    version: 1;
    provider: "codex";
    authType: "device-code-oauth";
    idToken: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
    createdAt: string;
    updatedAt: string;
    issuer: string;
    clientId: string;
}
export type CodexAuthStatus = {
    state: "not-configured";
} | {
    state: "setup-required";
} | {
    state: "authenticated";
    expiresAt: string;
    issuer: string;
} | {
    state: "expired";
    hint: string;
} | {
    state: "invalid";
    message: string;
    hint: string;
};
export interface CodexAuthRepository {
    exists(): boolean;
    read(): CodexAuth;
    write(auth: CodexAuth): string;
    delete(): void;
    getStatus(selection: {
        provider: "codex" | "openai-compatible";
    }): CodexAuthStatus;
}
export interface CodexAuthRepositoryOptions {
    now?: () => Date;
}
export declare function getCodexAuthPath(rootPath: string): string;
export declare function validateCodexAuth(input: unknown, sourcePath: string): CodexAuth;
export declare function formatCodexAuthStatus(status: CodexAuthStatus): string;
export declare function createCodexAuthRepository(rootPath: string, options?: CodexAuthRepositoryOptions): CodexAuthRepository;
//# sourceMappingURL=codex-auth-repository.d.ts.map