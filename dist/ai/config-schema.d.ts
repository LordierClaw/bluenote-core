export type AiProvider = "openai-compatible" | "codex";
interface AiConfigLogging {
    usage: boolean;
    conversations: boolean;
    results: boolean;
}
interface AiConfigPreferences {
    maxAttempts?: number;
    outputLanguage?: string;
}
export interface OpenAiCompatibleAiConfig extends AiConfigPreferences {
    version: 1;
    enabled: boolean;
    provider: "openai-compatible";
    baseUrl: string;
    apiKey: string;
    model: string;
    logging: AiConfigLogging;
}
export interface CodexAiConfig extends AiConfigPreferences {
    version: 1;
    enabled: boolean;
    provider: "codex";
    model: string;
    logging: AiConfigLogging;
}
export type AiConfig = OpenAiCompatibleAiConfig | CodexAiConfig;
export declare function validateAiConfig(input: unknown, sourcePath: string): AiConfig;
export declare function maskApiKey(value: string): string;
export {};
//# sourceMappingURL=config-schema.d.ts.map