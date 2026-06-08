import type { Clock } from "../platform/clock";
export interface EnqueueDescribeNoteIfAiEnabledInput {
    key: string;
    relativePath: string;
    title: string;
    body: string;
    currentDescription?: string | null;
    replaceKey?: string | null;
}
export interface EnqueueDescribeNoteIfAiEnabledOptions {
    clock: Clock;
    warn?: (message: string) => void;
}
export declare function formatAiEnqueueFailureWarning(error: unknown): string;
export declare function enqueueDescribeNoteIfAiEnabled(rootPath: string, input: EnqueueDescribeNoteIfAiEnabledInput, options: EnqueueDescribeNoteIfAiEnabledOptions): boolean;
//# sourceMappingURL=enqueue-describe-note.d.ts.map