import { UsageError } from "../core/errors.js";
import type { AiConfig } from "./config-schema.js";
import { type CodexProviderFetch, type CodexTextGenerationAuthProvider } from "./codex-client.js";
import type { CodexAuth } from "./codex-auth-repository.js";
import { type OpenAiCompatibleFetch } from "./openai-compatible-client.js";
import type { AiChatCompletionRequest, AiCompletionResult } from "./types.js";
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