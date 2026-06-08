import { UsageError } from "../core/errors";
import type { AiConfig } from "./config-schema";
import { type CodexProviderFetch, type CodexTextGenerationAuthProvider } from "./codex-client";
import type { CodexAuth } from "./codex-auth-repository";
import { type OpenAiCompatibleFetch } from "./openai-compatible-client";
import type { AiChatCompletionRequest, AiCompletionResult } from "./types";
export interface AiTextGenerationClient {
    createChatCompletion(request: AiChatCompletionRequest): Promise<AiCompletionResult>;
}
export interface CodexAuthProvider extends CodexTextGenerationAuthProvider {
    hasAuth?: () => boolean;
    getAuth?: () => Promise<CodexAuth | null>;
    refreshAuth?: (auth: CodexAuth) => Promise<CodexAuth>;
    getAccessToken?: () => Promise<string | null>;
}
export interface AiProviderFactoryOptions {
    fetch?: OpenAiCompatibleFetch & CodexProviderFetch;
    codexAuth?: CodexAuthProvider;
    now?: () => Date;
}
export declare class CodexProviderSetupRequiredError extends UsageError {
    constructor();
}
export declare function createAiTextGenerationClient(config: AiConfig, options?: AiProviderFactoryOptions): AiTextGenerationClient;
//# sourceMappingURL=provider.d.ts.map