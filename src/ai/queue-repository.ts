import path from "node:path"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"

import { UsageError } from "../core/errors"
import { replaceFileAtomically } from "../storage/atomic-replace"
import { getAiQueuePath } from "../storage/root-layout"
import { toPortableRelativePath } from "../platform/path-safety"

export type AiQueueJobStatus = "pending" | "running" | "failed"

export interface DescribeNoteJob {
  kind: "describe-note"
  key: string
  relativePath: string
  contentHash: string
  promptHash: string
  status: AiQueueJobStatus
  attempts: number
  lastError: string | null
  createdAt: string
  updatedAt: string
  nextAttemptAt: string | null
}

export type AiQueueJob = DescribeNoteJob

export interface AiQueue {
  version: 1
  jobs: AiQueueJob[]
}

export interface AiQueueRepository {
  exists(): boolean
  read(): AiQueue
  write(queue: AiQueue): string
  update<Result>(mutator: (queue: AiQueue) => { queue: AiQueue; result: Result }): Result
}

const EMPTY_QUEUE: AiQueue = { version: 1, jobs: [] }
const LOCK_STALE_AFTER_MS = 10 * 60 * 1000

interface QueueLockMetadata {
  pid: number
  acquiredAt: string
}

function getQueueLockMetadataPath(lockPath: string): string {
  return path.join(lockPath, "lock.json")
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined
    return code === "EPERM"
  }
}

function readQueueLockMetadata(lockPath: string): QueueLockMetadata | null {
  try {
    const parsed = JSON.parse(readFileSync(getQueueLockMetadataPath(lockPath), "utf8")) as Partial<QueueLockMetadata>
    if (typeof parsed.pid === "number" && typeof parsed.acquiredAt === "string") {
      return { pid: parsed.pid, acquiredAt: parsed.acquiredAt }
    }
  } catch {
    // Missing or malformed metadata is handled by the directory mtime fallback.
  }

  return null
}

function isStaleQueueLock(lockPath: string, now = Date.now()): boolean {
  const metadata = readQueueLockMetadata(lockPath)
  if (metadata) {
    const acquiredAt = Date.parse(metadata.acquiredAt)
    return !isProcessAlive(metadata.pid) || (!Number.isNaN(acquiredAt) && now - acquiredAt > LOCK_STALE_AFTER_MS)
  }

  try {
    return now - statSync(lockPath).mtimeMs > LOCK_STALE_AFTER_MS
  } catch {
    return false
  }
}

function writeQueueLockMetadata(lockPath: string): void {
  writeFileSync(getQueueLockMetadataPath(lockPath), `${JSON.stringify({
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8")
}

function getTemporaryQueuePath(queuePath: string): string {
  return `${queuePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
}

function removeTemporaryQueue(queuePath: string): void {
  try {
    rmSync(queuePath, { force: true })
  } catch {
    // Best-effort cleanup must not hide the original write error.
  }
}

function acquireQueueLock(lockPath: string, relativePath: string): () => void {
  try {
    mkdirSync(path.dirname(lockPath), { recursive: true })
    mkdirSync(lockPath)
    writeQueueLockMetadata(lockPath)
  } catch (error) {
    const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined
    if (code === "EEXIST" && isStaleQueueLock(lockPath)) {
      try {
        rmSync(lockPath, { recursive: true, force: true })
        mkdirSync(lockPath)
        writeQueueLockMetadata(lockPath)
      } catch (recoveryError) {
        throw new UsageError(`Could not recover stale AI queue lock '${relativePath}'.`, {
          hint: "Retry after any other BlueNote AI queue operation finishes, or remove the stale .data/ai/queue.json.lock directory if no BlueNote process is running.",
          cause: recoveryError,
        })
      }
    } else if (code === "EEXIST") {
      throw new UsageError(`AI queue '${relativePath}' is busy.`, {
        hint: "Retry after any other BlueNote AI queue operation finishes.",
        cause: error,
      })
    } else {
      throw new UsageError(`Could not lock AI queue '${relativePath}'.`, {
        hint: "Ensure BLUENOTE_ROOT points to a writable directory path.",
        cause: error,
      })
    }
  }

  return () => {
    try {
      rmSync(lockPath, { recursive: true, force: true })
    } catch {
      // Best-effort cleanup must not hide the original queue operation error.
    }
  }
}

function relativeQueuePath(rootPath: string, queuePath: string): string {
  return toPortableRelativePath(path.relative(rootPath, queuePath) || queuePath)
}

function assertPlainObject(input: unknown, sourcePath: string): asserts input is Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new UsageError(`Invalid AI queue '${sourcePath}'.`, {
      hint: "Ensure .data/ai/queue.json contains a BlueNote AI queue object.",
    })
  }
}

function assertString(value: unknown, field: string, sourcePath: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new UsageError(`Invalid AI queue '${sourcePath}': ${field} must be a non-empty string.`, {
      hint: "Fix or remove the queue file, then run bn ai process-queue again.",
    })
  }

  return value
}

function assertNullableString(value: unknown, field: string, sourcePath: string): string | null {
  if (value === null) {
    return null
  }

  return assertString(value, field, sourcePath)
}

function assertSha256(value: unknown, field: string, sourcePath: string): string {
  const hash = assertString(value, field, sourcePath)
  if (!/^sha256:[a-f0-9]{64}$/.test(hash)) {
    throw new UsageError(`Invalid AI queue '${sourcePath}': ${field} must be a sha256 hash.`, {
      hint: "Fix or remove the queue file, then run bn ai process-queue again.",
    })
  }

  return hash
}

function assertIsoOrNull(value: unknown, field: string, sourcePath: string): string | null {
  if (value === null) {
    return null
  }

  const timestamp = assertString(value, field, sourcePath)
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new UsageError(`Invalid AI queue '${sourcePath}': ${field} must be an ISO timestamp.`, {
      hint: "Fix or remove the queue file, then run bn ai process-queue again.",
    })
  }

  return timestamp
}

function assertIso(value: unknown, field: string, sourcePath: string): string {
  return assertIsoOrNull(value, field, sourcePath) ?? assertString(value, field, sourcePath)
}

function validateDescribeNoteJob(input: unknown, sourcePath: string): DescribeNoteJob {
  assertPlainObject(input, sourcePath)

  if (input.kind !== "describe-note") {
    throw new UsageError(`Invalid AI queue '${sourcePath}': unsupported job kind.`, {
      hint: "Fix or remove the queue file, then run bn ai process-queue again.",
    })
  }

  if (input.status !== "pending" && input.status !== "running" && input.status !== "failed") {
    throw new UsageError(`Invalid AI queue '${sourcePath}': status must be pending, running, or failed.`, {
      hint: "Fix or remove the queue file, then run bn ai process-queue again.",
    })
  }

  if (typeof input.attempts !== "number" || !Number.isInteger(input.attempts) || input.attempts < 0) {
    throw new UsageError(`Invalid AI queue '${sourcePath}': attempts must be a non-negative integer.`, {
      hint: "Fix or remove the queue file, then run bn ai process-queue again.",
    })
  }

  return {
    kind: "describe-note",
    key: assertString(input.key, "key", sourcePath),
    relativePath: assertString(input.relativePath, "relativePath", sourcePath),
    contentHash: assertSha256(input.contentHash, "contentHash", sourcePath),
    promptHash: assertSha256(input.promptHash, "promptHash", sourcePath),
    status: input.status,
    attempts: input.attempts,
    lastError: assertNullableString(input.lastError, "lastError", sourcePath),
    createdAt: assertIso(input.createdAt, "createdAt", sourcePath),
    updatedAt: assertIso(input.updatedAt, "updatedAt", sourcePath),
    nextAttemptAt: assertIsoOrNull(input.nextAttemptAt, "nextAttemptAt", sourcePath),
  }
}

export function validateAiQueue(input: unknown, sourcePath: string): AiQueue {
  assertPlainObject(input, sourcePath)

  if (input.version !== 1) {
    throw new UsageError(`Invalid AI queue '${sourcePath}': version must be 1.`, {
      hint: "Fix or remove the queue file, then run bn ai process-queue again.",
    })
  }

  if (!Array.isArray(input.jobs)) {
    throw new UsageError(`Invalid AI queue '${sourcePath}': jobs must be an array.`, {
      hint: "Fix or remove the queue file, then run bn ai process-queue again.",
    })
  }

  return {
    version: 1,
    jobs: input.jobs.map((job) => validateDescribeNoteJob(job, sourcePath)),
  }
}

export function createAiQueueRepository(rootPath: string): AiQueueRepository {
  const normalizedRootPath = path.resolve(rootPath)
  const queuePath = getAiQueuePath(normalizedRootPath)
  const lockPath = `${queuePath}.lock`
  const relativePath = relativeQueuePath(normalizedRootPath, queuePath)

  return {
    exists() {
      return existsSync(queuePath)
    },

    read() {
      if (!existsSync(queuePath)) {
        return { ...EMPTY_QUEUE, jobs: [] }
      }

      let rawJson: string
      try {
        rawJson = readFileSync(queuePath, "utf8")
      } catch (error) {
        throw new UsageError(`Could not read AI queue '${relativePath}'.`, {
          hint: "Ensure the queue file is readable.",
          cause: error,
        })
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(rawJson)
      } catch (error) {
        throw new UsageError(`Could not read AI queue '${relativePath}'.`, {
          hint: "Fix or remove the queue file, then run bn ai process-queue again.",
          cause: error,
        })
      }

      return validateAiQueue(parsed, relativePath)
    },

    write(queue) {
      const canonicalQueue = validateAiQueue(queue, relativePath)
      const temporaryQueuePath = getTemporaryQueuePath(queuePath)

      try {
        mkdirSync(path.dirname(queuePath), { recursive: true })
        writeFileSync(temporaryQueuePath, `${JSON.stringify(canonicalQueue, null, 2)}\n`, "utf8")
        replaceFileAtomically(temporaryQueuePath, queuePath)
      } catch (error) {
        removeTemporaryQueue(temporaryQueuePath)
        throw new UsageError(`Could not write AI queue '${relativePath}'.`, {
          hint: "Ensure BLUENOTE_ROOT points to a writable directory path.",
          cause: error,
        })
      }

      return queuePath
    },

    update(mutator) {
      const releaseLock = acquireQueueLock(lockPath, relativePath)

      try {
        const currentQueue = this.read()
        const { queue, result } = mutator(currentQueue)
        if (queue !== currentQueue) {
          this.write(queue)
        }
        return result
      } finally {
        releaseLock()
      }
    },
  }
}
