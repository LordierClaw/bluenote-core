import { createHash } from "node:crypto"
import { existsSync } from "node:fs"

import { SelectorNotFoundError } from "../core/errors"
import { selectNote } from "../core/select-note"
import { systemClock, type Clock } from "../platform/clock"
import { createNoteRepository } from "../storage/note-repository"
import { createSidecarRepository } from "../storage/sidecar-repository"
import { createAiQueueRepository, type AiQueueJob, type DescribeNoteJob } from "./queue-repository"

export interface DescribeNoteQueueInput {
  key: string
  relativePath: string
  title: string
  body: string
  currentDescription?: string | null
  promptHash: string
}

export interface AiQueueServiceOptions {
  clock?: Clock
  /** Remove a stale describe-note job for this old key in the same queue write. */
  replaceKey?: string | null
  /** @internal Test hook for forcing queue mutation interleavings. */
  beforeQueueWrite?: () => void
}

export function hashDescribeNoteContent(input: Pick<DescribeNoteQueueInput, "title" | "body" | "currentDescription">): string {
  const canonicalInput = JSON.stringify({
    title: input.title,
    body: input.body,
    currentDescription: input.currentDescription ?? "",
  })

  return `sha256:${createHash("sha256").update(canonicalInput, "utf8").digest("hex")}`
}

export function enqueueDescribeNoteJob(
  rootPath: string,
  input: DescribeNoteQueueInput,
  options: AiQueueServiceOptions = {},
): DescribeNoteJob {
  const repository = createAiQueueRepository(rootPath)
  const now = (options.clock ?? systemClock).now().toISOString()
  const contentHash = hashDescribeNoteContent(input)

  return repository.update((queue) => {
    const existingJob = queue.jobs.find((job) => job.kind === "describe-note" && job.key === input.key)

    const refreshedWorkChanged = existingJob
      ? existingJob.contentHash !== contentHash || existingJob.promptHash !== input.promptHash
      : false
    const job: DescribeNoteJob = existingJob
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
        }

    const replaceKey = options.replaceKey && options.replaceKey !== input.key ? options.replaceKey : null
    const jobs = [...queue.jobs.filter((existing) => {
      if (existing.kind !== "describe-note") {
        return true
      }

      return existing.key !== input.key && existing.key !== replaceKey
    }), job]

    options.beforeQueueWrite?.()

    return { queue: { version: 1, jobs }, result: job }
  })
}

export function removeDescribeNoteJob(rootPath: string, key: string): boolean {
  const repository = createAiQueueRepository(rootPath)

  return repository.update((queue) => {
    const jobs = queue.jobs.filter((job) => !(job.kind === "describe-note" && job.key === key))

    return {
      queue: jobs.length === queue.jobs.length ? queue : { version: 1, jobs },
      result: jobs.length !== queue.jobs.length,
    }
  })
}

export function removeDescribeNoteJobIfContentHashMatches(rootPath: string, key: string, contentHash: string): boolean {
  const repository = createAiQueueRepository(rootPath)

  return repository.update((queue) => {
    const jobs = queue.jobs.filter((job) => !(job.kind === "describe-note" && job.key === key && job.contentHash === contentHash))

    return {
      queue: jobs.length === queue.jobs.length ? queue : { version: 1, jobs },
      result: jobs.length !== queue.jobs.length,
    }
  })
}

export function markDescribeNoteJobFailedIfContentHashMatches(input: {
  rootPath: string
  key: string
  contentHash: string
  lastError: string
  updatedAt?: string
}): boolean {
  const repository = createAiQueueRepository(input.rootPath)

  return repository.update((queue) => {
    let marked = false
    const jobs = queue.jobs.map((job) => {
      if (job.kind !== "describe-note" || job.key !== input.key || job.contentHash !== input.contentHash) {
        return job
      }

      marked = true
      return {
        ...job,
        status: "failed" as const,
        attempts: job.attempts + 1,
        lastError: input.lastError,
        updatedAt: input.updatedAt ?? new Date().toISOString(),
      }
    })

    return {
      queue: marked ? { version: 1, jobs } : queue,
      result: marked,
    }
  })
}

export function findDescribeNoteJob(rootPath: string, key: string): DescribeNoteJob | null {
  return createAiQueueRepository(rootPath).read().jobs.find((job) => job.kind === "describe-note" && job.key === key) ?? null
}

export function dropDescribeNoteJobIfNoteMissing(rootPath: string, job: AiQueueJob): boolean {
  if (job.kind !== "describe-note") {
    return false
  }

  let key = job.key
  try {
    const selected = selectNote({ repository: createNoteRepository(rootPath), selector: job.key, visibility: "all" })
    key = selected.frontmatter.id
  } catch (error) {
    if (error instanceof SelectorNotFoundError) {
      return removeDescribeNoteJob(rootPath, job.key)
    }
    throw error
  }

  const sidecars = createSidecarRepository(rootPath)
  if (!existsSync(sidecars.getSidecarPath(key))) {
    return removeDescribeNoteJob(rootPath, job.key)
  }

  return false
}

export function listPendingAiJobs(rootPath: string): AiQueueJob[] {
  return createAiQueueRepository(rootPath)
    .read()
    .jobs.filter((job) => job.status === "pending")
}

export function listRetryableAiJobs(rootPath: string, maxAttempts = 3): AiQueueJob[] {
  const boundedMaxAttempts = Number.isInteger(maxAttempts) && maxAttempts > 0 ? maxAttempts : 3
  return createAiQueueRepository(rootPath)
    .read()
    .jobs.filter((job) => (job.status === "pending" || job.status === "failed") && job.attempts < boundedMaxAttempts)
}
