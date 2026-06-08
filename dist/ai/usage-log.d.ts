import type { AiTokenUsage } from "./types";
export type AiGenerationStatus = "applied" | "invalid" | "failed";
export interface AppendAiUsageLogInput {
    timestamp: string;
    key: string;
    provider: "openai-compatible" | "codex";
    model: string;
    status: AiGenerationStatus;
    usage?: AiTokenUsage;
    providerRequestId?: string;
}
export interface AppendAiResultLogInput {
    timestamp: string;
    key: string;
    relativePath: string;
    status: AiGenerationStatus;
    promptHash: string;
    contentHash: string;
    description?: string;
    rawOutput?: string;
    error?: string;
    providerRequestId?: string;
}
export declare function appendAiUsageLog(rootPath: string, input: AppendAiUsageLogInput): string;
export declare function appendAiResultLog(rootPath: string, input: AppendAiResultLogInput): string;
//# sourceMappingURL=usage-log.d.ts.map