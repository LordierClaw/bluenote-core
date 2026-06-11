import type { CodexAuth } from "./codex-auth-repository.js";
import type { AiChatCompletionRequest, AiCompletionResult } from "./types.js";
export type CodexProviderFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export interface CodexTextGenerationAuthProvider {
    getAccessToken?: () => Promise<string | null>;
    getAuth?: () => Promise<CodexAuth | null>;
    refreshAuth?: (auth: CodexAuth) => Promise<CodexAuth>;
}
export interface CodexTextGenerationClientOptions {
    fetch: CodexProviderFetch;
    auth: CodexTextGenerationAuthProvider;
    model: string;
    baseUrl?: string;
    now?: () => Date;
}
export declare class CodexTextGenerationClientError extends Error {
    constructor(message: string, options?: ErrorOptions);
}
export declare function createCodexTextGenerationClient(options: CodexTextGenerationClientOptions): {
    createChatCompletion(request: AiChatCompletionRequest): Promise<AiCompletionResult>;
};
//# sourceMappingURL=codex-client.d.ts.map