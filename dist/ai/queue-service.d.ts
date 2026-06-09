import { type Clock } from "../platform/clock.js";
import { type AiQueueJob, type DescribeNoteJob } from "./queue-repository.js";
export interface DescribeNoteQueueInput {
    key: string;
    relativePath: string;
    title: string;
    body: string;
    currentDescription?: string | null;
    promptHash: string;
}
export interface AiQueueServiceOptions {
    clock?: Clock;
    /** Remove a stale describe-note job for this old key in the same queue write. */
    replaceKey?: string | null;
    /** @internal Test hook for forcing queue mutation interleavings. */
    beforeQueueWrite?: () => void;
}
export declare function hashDescribeNoteContent(input: Pick<DescribeNoteQueueInput, "title" | "body" | "currentDescription">): string;
export declare function enqueueDescribeNoteJob(rootPath: string, input: DescribeNoteQueueInput, options?: AiQueueServiceOptions): DescribeNoteJob;
export declare function removeDescribeNoteJob(rootPath: string, key: string): boolean;
export declare function removeDescribeNoteJobIfContentHashMatches(rootPath: string, key: string, contentHash: string): boolean;
export declare function markDescribeNoteJobFailedIfContentHashMatches(input: {
    rootPath: string;
    key: string;
    contentHash: string;
    lastError: string;
    updatedAt?: string;
}): boolean;
export declare function findDescribeNoteJob(rootPath: string, key: string): DescribeNoteJob | null;
export declare function dropDescribeNoteJobIfNoteMissing(rootPath: string, job: AiQueueJob): boolean;
export declare function listPendingAiJobs(rootPath: string): AiQueueJob[];
export declare function listRetryableAiJobs(rootPath: string, maxAttempts?: number): AiQueueJob[];
//# sourceMappingURL=queue-service.d.ts.map