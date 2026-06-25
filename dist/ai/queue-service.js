import { createHash } from "node:crypto";
import { SelectorNotFoundError, UsageError } from "../core/errors.js";
import { selectNote } from "../core/select-note.js";
import { systemClock } from "../platform/clock.js";
import { createNoteRepository } from "../storage/note-repository.js";
import { createSidecarRepository } from "../storage/sidecar-repository.js";
import { createAiQueueRepository } from "./queue-repository.js";
export function hashDescribeNoteContent(input) {
    const canonicalInput = JSON.stringify({
        title: input.title,
        body: input.body,
        currentDescription: input.currentDescription ?? "",
    });
    return `sha256:${createHash("sha256").update(canonicalInput, "utf8").digest("hex")}`;
}
export function enqueueDescribeNoteJob(rootPath, input, options = {}) {
    const repository = createAiQueueRepository(rootPath);
    const now = (options.clock ?? systemClock).now().toISOString();
    const contentHash = hashDescribeNoteContent(input);
    return repository.update((queue) => {
        const existingJob = queue.jobs.find((job) => job.kind === "describe-note" && job.key === input.key);
        const refreshedWorkChanged = existingJob
            ? existingJob.contentHash !== contentHash || existingJob.promptHash !== input.promptHash
            : false;
        const job = existingJob
            ? {
                ...existingJob,
                relativePath: input.relativePath,
                contentHash,
                promptHash: input.promptHash,
                status: "pending",
                attempts: refreshedWorkChanged ? 0 : existingJob.attempts,
                lastError: null,
                updatedAt: now,
                nextAttemptAt: null,
            }
            : {
                kind: "describe-note",
                key: input.key,
                relativePath: input.relativePath,
                contentHash,
                promptHash: input.promptHash,
                status: "pending",
                attempts: 0,
                lastError: null,
                createdAt: now,
                updatedAt: now,
                nextAttemptAt: null,
            };
        const replaceKey = options.replaceKey && options.replaceKey !== input.key ? options.replaceKey : null;
        const jobs = [...queue.jobs.filter((existing) => {
                if (existing.kind !== "describe-note") {
                    return true;
                }
                return existing.key !== input.key && existing.key !== replaceKey;
            }), job];
        options.beforeQueueWrite?.();
        return { queue: { version: 1, jobs }, result: job };
    });
}
export function removeDescribeNoteJob(rootPath, key) {
    const repository = createAiQueueRepository(rootPath);
    return repository.update((queue) => {
        const jobs = queue.jobs.filter((job) => !(job.kind === "describe-note" && job.key === key));
        return {
            queue: jobs.length === queue.jobs.length ? queue : { version: 1, jobs },
            result: jobs.length !== queue.jobs.length,
        };
    });
}
export function removeDescribeNoteJobIfContentHashMatches(rootPath, key, contentHash) {
    const repository = createAiQueueRepository(rootPath);
    return repository.update((queue) => {
        const jobs = queue.jobs.filter((job) => !(job.kind === "describe-note" && job.key === key && job.contentHash === contentHash));
        return {
            queue: jobs.length === queue.jobs.length ? queue : { version: 1, jobs },
            result: jobs.length !== queue.jobs.length,
        };
    });
}
export function markDescribeNoteJobFailedIfContentHashMatches(input) {
    const repository = createAiQueueRepository(input.rootPath);
    return repository.update((queue) => {
        let marked = false;
        const jobs = queue.jobs.map((job) => {
            if (job.kind !== "describe-note" || job.key !== input.key || job.contentHash !== input.contentHash) {
                return job;
            }
            marked = true;
            return {
                ...job,
                status: "failed",
                attempts: job.attempts + 1,
                lastError: input.lastError,
                updatedAt: input.updatedAt ?? new Date().toISOString(),
            };
        });
        return {
            queue: marked ? { version: 1, jobs } : queue,
            result: marked,
        };
    });
}
export function findDescribeNoteJob(rootPath, key) {
    return createAiQueueRepository(rootPath).read().jobs.find((job) => job.kind === "describe-note" && job.key === key) ?? null;
}
export function dropDescribeNoteJobIfNoteMissing(rootPath, job) {
    if (job.kind !== "describe-note") {
        return false;
    }
    try {
        selectNote({ repository: createNoteRepository(rootPath), selector: job.key, visibility: "all" });
    }
    catch (error) {
        if (error instanceof SelectorNotFoundError) {
            return removeDescribeNoteJob(rootPath, job.key);
        }
        throw error;
    }
    try {
        createSidecarRepository(rootPath).read(job.key);
    }
    catch (error) {
        if (error instanceof UsageError && /Could not read sidecar/.test(error.message)) {
            return removeDescribeNoteJob(rootPath, job.key);
        }
        throw error;
    }
    return false;
}
export function listPendingAiJobs(rootPath) {
    return createAiQueueRepository(rootPath)
        .read()
        .jobs.filter((job) => job.status === "pending");
}
export function listRetryableAiJobs(rootPath, maxAttempts = 3) {
    const boundedMaxAttempts = Number.isInteger(maxAttempts) && maxAttempts > 0 ? maxAttempts : 3;
    return createAiQueueRepository(rootPath)
        .read()
        .jobs.filter((job) => (job.status === "pending" || job.status === "failed") && job.attempts < boundedMaxAttempts);
}
//# sourceMappingURL=queue-service.js.map