export type AiQueueJobStatus = "pending" | "running" | "failed";
export interface DescribeNoteJob {
    kind: "describe-note";
    key: string;
    relativePath: string;
    contentHash: string;
    promptHash: string;
    status: AiQueueJobStatus;
    attempts: number;
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
    nextAttemptAt: string | null;
}
export type AiQueueJob = DescribeNoteJob;
export interface AiQueue {
    version: 1;
    jobs: AiQueueJob[];
}
export interface AiQueueRepository {
    exists(): boolean;
    read(): AiQueue;
    write(queue: AiQueue): string;
    update<Result>(mutator: (queue: AiQueue) => {
        queue: AiQueue;
        result: Result;
    }): Result;
}
export declare function validateAiQueue(input: unknown, sourcePath: string): AiQueue;
export declare function createAiQueueRepository(rootPath: string): AiQueueRepository;
//# sourceMappingURL=queue-repository.d.ts.map