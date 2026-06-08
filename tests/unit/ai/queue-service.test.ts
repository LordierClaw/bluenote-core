import { test } from "bun:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"

import { UsageError } from "../../../src/core/errors"
import { createNote } from "../../../src/core/create-note"
import { rebuildIndexes } from "../../../src/core/rebuild-indexes"
import { showNote } from "../../../src/core/show-note"
import { ensureManagedRoot, getAiQueuePath } from "../../../src/storage/root-layout"
import { createAiQueueRepository } from "../../../src/ai/queue-repository"
import {
  dropDescribeNoteJobIfNoteMissing,
  enqueueDescribeNoteJob,
  listPendingAiJobs,
  listRetryableAiJobs,
  markDescribeNoteJobFailedIfContentHashMatches,
  removeDescribeNoteJob,
} from "../../../src/ai/queue-service"

async function withRoot(name: string, callback: (rootPath: string) => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), name))

  try {
    await callback(ensureManagedRoot(tempRoot))
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

function fixedClock(isoTimestamp: string) {
  return {
    now() {
      return new Date(isoTimestamp)
    },
  }
}

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 2_000

  while (!existsSync(filePath)) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${filePath}`)
    }

    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function enqueueInChildProcess(
  rootPath: string,
  input: typeof baseDescribeInput,
  isoTimestamp: string,
  options: { markerPath?: string; delayBeforeWriteMs?: number } = {},
): Promise<void> {
  const queueServiceUrl = pathToFileURL(path.resolve("src/ai/queue-service.ts")).href
  const source = `
    import { writeFileSync } from "node:fs"
    import { enqueueDescribeNoteJob } from ${JSON.stringify(queueServiceUrl)}

    const sleepSync = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
    const markerPath = ${JSON.stringify(options.markerPath ?? null)}
    const delayBeforeWriteMs = ${JSON.stringify(options.delayBeforeWriteMs ?? 0)}

    enqueueDescribeNoteJob(${JSON.stringify(rootPath)}, ${JSON.stringify(input)}, {
      clock: { now: () => new Date(${JSON.stringify(isoTimestamp)}) },
      beforeQueueWrite: () => {
        if (markerPath) {
          writeFileSync(markerPath, "ready", "utf8")
        }
        if (delayBeforeWriteMs > 0) {
          sleepSync(delayBeforeWriteMs)
        }
      },
    })
  `
  const child = Bun.spawn([process.execPath, "--eval", source], {
    stderr: "pipe",
    stdout: "pipe",
  })
  const exitCode = await child.exited

  if (exitCode !== 0) {
    const stderr = await new Response(child.stderr).text()
    const stdout = await new Response(child.stdout).text()
    throw new Error(`enqueue child failed with exit ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`)
  }
}

const baseDescribeInput = {
  key: "project-notes",
  relativePath: "notes/inbox/project-notes.md",
  title: "Project notes",
  body: "Initial project task list.",
  currentDescription: "Existing description",
  promptHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
}

test("missing queue reads as an empty version 1 queue", async () => {
  await withRoot("bluenote-ai-queue-missing-", async (rootPath) => {
    const repository = createAiQueueRepository(rootPath)

    assert.equal(existsSync(getAiQueuePath(rootPath)), false)
    assert.deepEqual(repository.read(), { version: 1, jobs: [] })
    assert.deepEqual(listPendingAiJobs(rootPath), [])
  })
})

test("enqueuing creates .data/ai/queue.json", async () => {
  await withRoot("bluenote-ai-queue-create-", async (rootPath) => {
    const job = enqueueDescribeNoteJob(rootPath, baseDescribeInput, {
      clock: fixedClock("2026-06-01T00:00:00.000Z"),
    })

    assert.equal(existsSync(getAiQueuePath(rootPath)), true)
    assert.equal(job.kind, "describe-note")
    assert.equal(job.key, baseDescribeInput.key)
    assert.match(job.contentHash, /^sha256:[a-f0-9]{64}$/)
    assert.equal(job.status, "pending")
    assert.equal(job.attempts, 0)
    assert.equal(job.lastError, null)
    assert.equal(job.nextAttemptAt, null)

    const rawJson = await readFile(getAiQueuePath(rootPath), "utf8")
    assert.equal(rawJson.endsWith("\n"), true)
    assert.deepEqual(JSON.parse(rawJson), { version: 1, jobs: [job] })
  })
})

test("duplicate describe-note jobs for the same key are refreshed, not duplicated", async () => {
  await withRoot("bluenote-ai-queue-dedupe-", async (rootPath) => {
    const first = enqueueDescribeNoteJob(rootPath, baseDescribeInput, {
      clock: fixedClock("2026-06-01T00:00:00.000Z"),
    })
    const second = enqueueDescribeNoteJob(rootPath, {
      ...baseDescribeInput,
      relativePath: "notes/journal/project-notes.md",
    }, {
      clock: fixedClock("2026-06-01T00:05:00.000Z"),
    })

    const queue = createAiQueueRepository(rootPath).read()
    assert.equal(queue.jobs.length, 1)
    assert.equal(second.createdAt, first.createdAt)
    assert.equal(second.updatedAt, "2026-06-01T00:05:00.000Z")
    assert.equal(second.relativePath, "notes/journal/project-notes.md")
    assert.deepEqual(queue.jobs, [second])
  })
})

test("busy queue lock fails fast instead of blocking the event loop", async () => {
  await withRoot("bluenote-ai-queue-busy-lock-", async (rootPath) => {
    const lockPath = `${getAiQueuePath(rootPath)}.lock`
    await mkdir(lockPath, { recursive: true })

    let timerFired = false
    const timer = new Promise<void>((resolve) => {
      setTimeout(() => {
        timerFired = true
        resolve()
      }, 0)
    })

    assert.throws(
      () => enqueueDescribeNoteJob(rootPath, baseDescribeInput),
      (error: unknown) => error instanceof UsageError
        && /AI queue '.data\/ai\/queue.json' is busy\./u.test(error.message)
        && /Retry after any other BlueNote AI queue operation finishes\./u.test(error.hint ?? ""),
    )

    await timer
    assert.equal(timerFired, true)
  })
})

test("stale queue lock metadata is recovered before enqueueing", async () => {
  await withRoot("bluenote-ai-queue-stale-lock-", async (rootPath) => {
    const lockPath = `${getAiQueuePath(rootPath)}.lock`
    await mkdir(lockPath, { recursive: true })
    await writeFile(path.join(lockPath, "lock.json"), JSON.stringify({
      pid: -1,
      acquiredAt: "2026-06-01T00:00:00.000Z",
    }), "utf8")

    const job = enqueueDescribeNoteJob(rootPath, baseDescribeInput, {
      clock: fixedClock("2026-06-01T00:00:00.000Z"),
    })

    assert.equal(job.key, baseDescribeInput.key)
    assert.equal(existsSync(lockPath), false)
    assert.deepEqual(createAiQueueRepository(rootPath).read().jobs.map((queuedJob) => queuedJob.key), [baseDescribeInput.key])
  })
})

test("concurrent describe-note enqueues fail fast while another process holds the queue lock", async () => {
  await withRoot("bluenote-ai-queue-concurrent-busy-", async (rootPath) => {
    const markerPath = path.join(rootPath, ".data", "ai", "first-ready")
    const firstEnqueue = enqueueInChildProcess(rootPath, baseDescribeInput, "2026-06-01T00:00:00.000Z", {
      markerPath,
      delayBeforeWriteMs: 2_000,
    })

    await waitForFile(markerPath)

    const secondEnqueue = enqueueInChildProcess(rootPath, {
      ...baseDescribeInput,
      key: "meeting-notes",
      relativePath: "notes/inbox/meeting-notes.md",
      title: "Meeting notes",
    }, "2026-06-01T00:01:00.000Z")

    const [firstResult, secondResult] = await Promise.allSettled([firstEnqueue, secondEnqueue])
    assert.equal(firstResult.status, "fulfilled")
    assert.equal(secondResult.status, "rejected")
    assert.match(String(secondResult.reason), /AI queue '.data\/ai\/queue.json' is busy\./u)

    const queue = createAiQueueRepository(rootPath).read()
    assert.deepEqual(queue.jobs.map((job) => job.key), ["project-notes"])
  })
})

test("content hash changes reset failed-job attempts so refreshed work remains retryable", async () => {
  await withRoot("bluenote-ai-queue-refresh-content-", async (rootPath) => {
    const repository = createAiQueueRepository(rootPath)
    const first = enqueueDescribeNoteJob(rootPath, baseDescribeInput, {
      clock: fixedClock("2026-06-01T00:00:00.000Z"),
    })

    repository.write({
      version: 1,
      jobs: [{ ...first, status: "failed", attempts: 3, lastError: "rate limited", nextAttemptAt: "2026-06-01T01:00:00.000Z" }],
    })

    const refreshed = enqueueDescribeNoteJob(rootPath, {
      ...baseDescribeInput,
      body: "Changed project task list.",
    }, {
      clock: fixedClock("2026-06-01T00:10:00.000Z"),
    })

    assert.notEqual(refreshed.contentHash, first.contentHash)
    assert.equal(refreshed.updatedAt, "2026-06-01T00:10:00.000Z")
    assert.equal(refreshed.status, "pending")
    assert.equal(refreshed.lastError, null)
    assert.equal(refreshed.nextAttemptAt, null)
    assert.equal(refreshed.attempts, 0)
    assert.deepEqual(listRetryableAiJobs(rootPath, 3).map((job) => job.key), [baseDescribeInput.key])
  })
})

test("failed jobs remain retryable until maxAttempts and exhausted jobs are skipped", async () => {
  await withRoot("bluenote-ai-queue-retryable-", async (rootPath) => {
    const job = enqueueDescribeNoteJob(rootPath, baseDescribeInput, {
      clock: fixedClock("2026-06-01T00:00:00.000Z"),
    })

    markDescribeNoteJobFailedIfContentHashMatches({
      rootPath,
      key: job.key,
      contentHash: job.contentHash,
      lastError: "provider token [REDACTED] failed",
      updatedAt: "2026-06-01T00:01:00.000Z",
    })

    assert.deepEqual(listPendingAiJobs(rootPath), [])
    assert.deepEqual(listRetryableAiJobs(rootPath, 3).map((retryable) => retryable.key), [job.key])

    markDescribeNoteJobFailedIfContentHashMatches({
      rootPath,
      key: job.key,
      contentHash: job.contentHash,
      lastError: "still failing",
      updatedAt: "2026-06-01T00:02:00.000Z",
    })
    markDescribeNoteJobFailedIfContentHashMatches({
      rootPath,
      key: job.key,
      contentHash: job.contentHash,
      lastError: "exhausted",
      updatedAt: "2026-06-01T00:03:00.000Z",
    })

    assert.deepEqual(listRetryableAiJobs(rootPath, 3), [])
  })
})

test("stale deleted pending describe-note jobs are removed without failing attempts", async () => {
  await withRoot("bluenote-ai-queue-drop-deleted-pending-", async (rootPath) => {
    const job = enqueueDescribeNoteJob(rootPath, baseDescribeInput, {
      clock: fixedClock("2026-06-01T00:00:00.000Z"),
    })

    assert.equal(dropDescribeNoteJobIfNoteMissing(rootPath, job), true)
    assert.deepEqual(createAiQueueRepository(rootPath).read().jobs, [])
  })
})

test("stale deleted failed retryable describe-note jobs are removed instead of retrying", async () => {
  await withRoot("bluenote-ai-queue-drop-deleted-failed-", async (rootPath) => {
    const job = enqueueDescribeNoteJob(rootPath, baseDescribeInput, {
      clock: fixedClock("2026-06-01T00:00:00.000Z"),
    })
    markDescribeNoteJobFailedIfContentHashMatches({
      rootPath,
      key: job.key,
      contentHash: job.contentHash,
      lastError: "provider unavailable",
      updatedAt: "2026-06-01T00:01:00.000Z",
    })
    const failedJob = listRetryableAiJobs(rootPath, 3)[0]

    assert.equal(dropDescribeNoteJobIfNoteMissing(rootPath, failedJob), true)
    assert.deepEqual(createAiQueueRepository(rootPath).read().jobs, [])
  })
})

test("deleted-note cleanup is narrow and keeps existing-note describe jobs retryable", async () => {
  await withRoot("bluenote-ai-queue-keep-existing-", async (rootPath) => {
    const created = createNote({
      override: rootPath,
      type: "normal",
      destinationFolder: "note",
      title: "Existing Queue Note",
      body: "Existing note body.",
      clock: fixedClock("2026-06-01T00:00:00.000Z"),
    })
    rebuildIndexes({ override: rootPath })
    const note = showNote({ override: rootPath, selector: created.key })
    const job = enqueueDescribeNoteJob(rootPath, {
      key: created.key,
      relativePath: created.relativePath,
      title: note.title,
      body: note.body,
      currentDescription: note.description,
      promptHash: baseDescribeInput.promptHash,
    })

    assert.equal(dropDescribeNoteJobIfNoteMissing(rootPath, job), false)
    assert.deepEqual(createAiQueueRepository(rootPath).read().jobs, [job])
  })
})

test("malformed queue JSON raises a helpful error and is not overwritten", async () => {
  await withRoot("bluenote-ai-queue-malformed-", async (rootPath) => {
    const malformedJson = "{ malformed json"
    await writeFile(getAiQueuePath(rootPath), malformedJson, "utf8")

    assert.throws(
      () => enqueueDescribeNoteJob(rootPath, baseDescribeInput, {
        clock: fixedClock("2026-06-01T00:00:00.000Z"),
      }),
      (error: unknown) => {
        assert.ok(error instanceof UsageError)
        assert.match(error.message, /Could not read AI queue/i)
        assert.match(error.hint ?? "", /Fix or remove the queue file/i)
        assert.ok(error.cause instanceof SyntaxError)
        return true
      },
    )

    assert.equal(await readFile(getAiQueuePath(rootPath), "utf8"), malformedJson)
  })
})

test("removing a queued job by key works for bn ai describe", async () => {
  await withRoot("bluenote-ai-queue-remove-", async (rootPath) => {
    enqueueDescribeNoteJob(rootPath, baseDescribeInput, {
      clock: fixedClock("2026-06-01T00:00:00.000Z"),
    })
    enqueueDescribeNoteJob(rootPath, { ...baseDescribeInput, key: "meeting-notes", relativePath: "notes/inbox/meeting-notes.md" }, {
      clock: fixedClock("2026-06-01T00:01:00.000Z"),
    })

    assert.equal(removeDescribeNoteJob(rootPath, "project-notes"), true)
    assert.deepEqual(listPendingAiJobs(rootPath).map((job) => job.key), ["meeting-notes"])
    assert.equal(removeDescribeNoteJob(rootPath, "missing"), false)
  })
})
