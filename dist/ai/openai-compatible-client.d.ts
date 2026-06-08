import type { AiChatCompletionRequest, AiCompletionResult } from "./types";
export type OpenAiCompatibleFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export interface OpenAiCompatibleClientOptions {
    fetch: OpenAiCompatibleFetch;
}
export interface OpenAiCompatibleClient {
    createChatCompletion(request: AiChatCompletionRequest): Promise<AiCompletionResult>;
}
export declare class OpenAiCompatibleClientError extends Error {
    constructor(message: string, options?: ErrorOptions);
}
export declare function createOpenAiCompatibleClient(options: OpenAiCompatibleClientOptions): OpenAiCompatibleClient;
//# sourceMappingURL=openai-compatible-client.d.ts.map