import { type Clock } from "../platform/clock.js";
import type { AiTextGenerationClient } from "./provider.js";
import { type AiGenerationStatus } from "./usage-log.js";
export interface GenerateNoteDescriptionOptions {
    rootPath?: string;
    selector: string;
    client: AiTextGenerationClient;
    clock?: Clock;
}
export interface GenerateNoteDescriptionResult {
    key: string;
    relativePath: string;
    status: AiGenerationStatus | "stale";
    description?: string;
    error?: string;
}
export declare function generateNoteDescription(options: GenerateNoteDescriptionOptions): Promise<GenerateNoteDescriptionResult>;
//# sourceMappingURL=description-service.d.ts.map