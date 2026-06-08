import { test } from "bun:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises"

import { createAiConfigRepository } from "../../../src/ai/config-repository"
import { enqueueDescribeNoteJob } from "../../../src/ai/queue-service"
import { createAiQueueRepository } from "../../../src/ai/queue-repository"
import { generateNoteDescription } from "../../../src/ai/description-service"
import type { AiChatCompletionRequest, AiCompletionResult } from "../../../src/ai/types"
import { ensureManagedRoot, getAiLogsPath } from "../../../src/storage/root-layout"
import { createNoteRepository } from "../../../src/storage/note-repository"
import { createSidecarRepository } from "../../../src/storage/sidecar-repository"
import { archiveNote } from "../../../src/core/archive-note"

const FIXED_FRONTMATTER = {
  id: "project-notes",
  schemaVersion: 1,
  title: "Project notes",
  mode: "plain",
  tags: [],
  createdAt: "2026-06-01T10:00:00.000Z",
  updatedAt: "2026-06-01T10:00:00.000Z",
}

function fixedClock(isoTimestamp: string) {
  return {
    now() {
      return new Date(isoTimestamp)
    },
  }
}

async function withRoot(name: string, callback: (rootPath: string) => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), name))

  try {
    await callback(ensureManagedRoot(tempRoot))
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

function writeConfig(rootPath: string, logging = { usage: false, conversations: false, results: false }) {
  createAiConfigRepository(rootPath).write({
    version: 1,
    enabled: true,
    provider: "openai-compatible",
    baseUrl: "https://example.test/v1",
    apiKey: "sk-test-key",
    model: "test-model",
    logging,
  })
}

function createProjectNote(rootPath: string, body = "Discuss launch tasks and owner follow-ups.\n") {
  const repository = createNoteRepository(rootPath)
  const created = repository.create({
    frontmatter: FIXED_FRONTMATTER,
    body,
    destination: { type: "normal", folderRelativePath: "note" },
  })
  return { repository, created }
}

function fakeClient(result: AiCompletionResult) {
  const requests: AiChatCompletionRequest[] = []
  return {
    requests,
    client: {
      async createChatCompletion(request: AiChatCompletionRequest) {
        requests.push(request)
        return result
      },
    },
  }
}

function deferredCompletion() {
  let resolve!: (result: AiCompletionResult) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<AiCompletionResult>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function assertPrivateFileMode(filePath: string): Promise<void> {
  if (process.platform === "win32") {
    return
  }

  const mode = (await stat(filePath)).mode & 0o777
  assert.equal(mode, 0o600)
}

test("generating for a selected note auto-applies a valid description, preserves Markdown body, logs when enabled, and removes pending queue job", async () => {
  await withRoot("bluenote-ai-description-success-", async (rootPath) => {
    writeConfig(rootPath, { usage: true, conversations: false, results: true })
    const { created } = createProjectNote(rootPath)
    const originalMarkdown = await readFile(created.notePath, "utf8")
    const initialSidecar = createSidecarRepository(rootPath).read("project-notes")
    const pendingJob = enqueueDescribeNoteJob(rootPath, {
      key: "project-notes",
      relativePath: created.relativePath,
      title: FIXED_FRONTMATTER.title,
      body: originalMarkdown,
      currentDescription: initialSidecar.description,
      promptHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }, {
      clock: fixedClock("2026-06-01T10:01:00.000Z"),
    })
    const provider = fakeClient({
      text: "Launch tasks and owner follow-ups.",
      usage: { promptTokens: 12, completionTokens: 6, totalTokens: 18 },
      providerRequestId: "req_123",
    })

    const result = await generateNoteDescription({
      rootPath,
      selector: "project-notes",
      client: provider.client,
      clock: fixedClock("2026-06-01T10:05:00.000Z"),
    })

    assert.equal(result.status, "applied")
    assert.equal(result.description, "Launch tasks and owner follow-ups.")
    assert.equal(provider.requests.length, 1)
    assert.equal(provider.requests[0].model, "test-model")
    assert.equal(provider.requests[0].messages[0].role, "system")
    assert.match(provider.requests[0].messages[1].content, /Title: Project notes/)
    assert.match(provider.requests[0].messages[1].content, /Current description:/)
    assert.match(provider.requests[0].messages[1].content, /Discuss launch tasks/)

    const updatedSidecar = createSidecarRepository(rootPath).read("project-notes")
    assert.equal(updatedSidecar.description, "Launch tasks and owner follow-ups.")
    assert.equal(updatedSidecar.key, initialSidecar.key)
    assert.equal(updatedSidecar.relativePath, initialSidecar.relativePath)
    assert.equal(updatedSidecar.createdAt, initialSidecar.createdAt)
    assert.equal(updatedSidecar.updatedAt, initialSidecar.updatedAt)
    assert.equal(updatedSidecar.ai?.description?.lastProcessedAt, "2026-06-01T10:05:00.000Z")

    assert.equal(await readFile(created.notePath, "utf8"), originalMarkdown)
    assert.equal(originalMarkdown.startsWith("---\n"), false)

    const queue = createAiQueueRepository(rootPath).read()
    assert.deepEqual(queue.jobs.filter((job) => job.key === pendingJob.key), [])

    const usageLogPath = path.join(getAiLogsPath(rootPath), "usage.jsonl")
    const usageLog = (await readFile(usageLogPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
    assert.equal(usageLog.length, 1)
    assert.equal(usageLog[0].key, "project-notes")
    assert.equal(usageLog[0].status, "applied")
    assert.equal(usageLog[0].model, "test-model")
    assert.deepEqual(usageLog[0].usage, { promptTokens: 12, completionTokens: 6, totalTokens: 18 })
    await assertPrivateFileMode(usageLogPath)

    const resultsLogPath = path.join(getAiLogsPath(rootPath), "results.jsonl")
    const resultsLog = (await readFile(resultsLogPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
    assert.equal(resultsLog.length, 1)
    assert.equal(resultsLog[0].key, "project-notes")
    assert.equal(resultsLog[0].status, "applied")
    assert.equal(resultsLog[0].description, "Launch tasks and owner follow-ups.")
    await assertPrivateFileMode(resultsLogPath)
  })
})

test("AI apply preserves current sidecar path and archive metadata after an in-flight move", async () => {
  await withRoot("bluenote-ai-description-inflight-archive-", async (rootPath) => {
    writeConfig(rootPath)
    createProjectNote(rootPath)
    const completion = deferredCompletion()
    let providerStarted!: () => void
    const providerStartedPromise = new Promise<void>((resolve) => {
      providerStarted = resolve
    })

    const generationPromise = generateNoteDescription({
      rootPath,
      selector: "project-notes",
      client: {
        async createChatCompletion() {
          providerStarted()
          return completion.promise
        },
      },
      clock: fixedClock("2026-06-01T10:05:00.000Z"),
    })

    await providerStartedPromise
    const archived = archiveNote({
      override: rootPath,
      selector: "project-notes",
      clock: fixedClock("2026-06-01T10:03:00.000Z"),
    })

    completion.resolve({ text: "Archived project follow-up notes." })
    const result = await generationPromise

    assert.equal(result.status, "applied")
    const currentSidecar = createSidecarRepository(rootPath).read("project-notes")
    assert.equal(currentSidecar.description, "Archived project follow-up notes.")
    assert.equal(currentSidecar.relativePath, archived.relativePath)
    assert.equal(currentSidecar.archivedAt, archived.archivedAt)
    assert.equal(currentSidecar.updatedAt, "2026-06-01T10:03:00.000Z")
    assert.equal(currentSidecar.ai?.description?.lastProcessedAt, "2026-06-01T10:05:00.000Z")
  })
})

test("stale provider output is not applied when note content changes in flight", async () => {
  await withRoot("bluenote-ai-description-stale-content-", async (rootPath) => {
    writeConfig(rootPath)
    const { repository, created } = createProjectNote(rootPath, "Original launch tasks.\n")
    const initialSidecar = createSidecarRepository(rootPath).read("project-notes")
    const completion = deferredCompletion()
    let providerStarted!: () => void
    const providerStartedPromise = new Promise<void>((resolve) => {
      providerStarted = resolve
    })

    const generationPromise = generateNoteDescription({
      rootPath,
      selector: "project-notes",
      client: {
        async createChatCompletion(request: AiChatCompletionRequest) {
          assert.match(request.messages[1].content, /Original launch tasks/u)
          providerStarted()
          return completion.promise
        },
      },
      clock: fixedClock("2026-06-01T10:05:00.000Z"),
    })

    await providerStartedPromise
    repository.syncEditedNote(created.notePath, {
      title: FIXED_FRONTMATTER.title,
      body: "Fresh autosaved launch tasks.\n",
      updatedAt: "2026-06-01T10:04:00.000Z",
    })
    completion.resolve({ text: "Old launch tasks summary." })

    const result = await generationPromise

    assert.equal(result.status, "stale")
    const updatedSidecar = createSidecarRepository(rootPath).read("project-notes")
    assert.equal(updatedSidecar.description, "Fresh autosaved launch tasks.")
    assert.notEqual(updatedSidecar.description, "Old launch tasks summary.")
    assert.equal(initialSidecar.description, "Original launch tasks.")
    assert.equal(updatedSidecar.ai?.description?.lastProcessedAt, undefined)
  })
})

test("stale provider completion does not remove refreshed queue job for newer content", async () => {
  await withRoot("bluenote-ai-description-stale-queue-", async (rootPath) => {
    writeConfig(rootPath)
    const { repository, created } = createProjectNote(rootPath, "Original launch tasks.\n")
    const initialSidecar = createSidecarRepository(rootPath).read("project-notes")
    enqueueDescribeNoteJob(rootPath, {
      key: "project-notes",
      relativePath: created.relativePath,
      title: FIXED_FRONTMATTER.title,
      body: "Original launch tasks.\n",
      currentDescription: initialSidecar.description,
      promptHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }, {
      clock: fixedClock("2026-06-01T10:01:00.000Z"),
    })
    const completion = deferredCompletion()
    let providerStarted!: () => void
    const providerStartedPromise = new Promise<void>((resolve) => {
      providerStarted = resolve
    })

    const generationPromise = generateNoteDescription({
      rootPath,
      selector: "project-notes",
      client: {
        async createChatCompletion() {
          providerStarted()
          return completion.promise
        },
      },
      clock: fixedClock("2026-06-01T10:05:00.000Z"),
    })

    await providerStartedPromise
    repository.syncEditedNote(created.notePath, {
      title: FIXED_FRONTMATTER.title,
      body: "Fresh autosaved launch tasks.\n",
      updatedAt: "2026-06-01T10:04:00.000Z",
    })
    const refreshedSidecar = createSidecarRepository(rootPath).read("project-notes")
    const refreshedJob = enqueueDescribeNoteJob(rootPath, {
      key: "project-notes",
      relativePath: created.relativePath,
      title: refreshedSidecar.title,
      body: "Fresh autosaved launch tasks.\n",
      currentDescription: refreshedSidecar.description,
      promptHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    }, {
      clock: fixedClock("2026-06-01T10:04:00.000Z"),
    })
    completion.resolve({ text: "Old launch tasks summary." })

    const result = await generationPromise

    assert.equal(result.status, "stale")
    const queue = createAiQueueRepository(rootPath).read()
    assert.deepEqual(queue.jobs.filter((job) => job.key === "project-notes"), [refreshedJob])
    assert.equal(queue.jobs[0].status, "pending")
  })
})

test("manual generation applies when an unchanged note has an obsolete queued job", async () => {
  await withRoot("bluenote-ai-description-obsolete-queue-", async (rootPath) => {
    writeConfig(rootPath)
    const { created } = createProjectNote(rootPath, "Current launch tasks stay unchanged.\n")
    enqueueDescribeNoteJob(rootPath, {
      key: "project-notes",
      relativePath: created.relativePath,
      title: FIXED_FRONTMATTER.title,
      body: "Current launch tasks stay unchanged.\n",
      currentDescription: "Older queued description hash",
      promptHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }, {
      clock: fixedClock("2026-06-01T10:01:00.000Z"),
    })

    const result = await generateNoteDescription({
      rootPath,
      selector: "project-notes",
      client: fakeClient({ text: "Current launch tasks." }).client,
      clock: fixedClock("2026-06-01T10:05:00.000Z"),
    })

    assert.equal(result.status, "applied")
    assert.equal(createSidecarRepository(rootPath).read("project-notes").description, "Current launch tasks.")
    assert.deepEqual(createAiQueueRepository(rootPath).read().jobs.filter((job) => job.key === "project-notes"), [])
  })
})

test("successful description apply is not failed by logging write errors", async () => {
  await withRoot("bluenote-ai-description-success-log-failure-", async (rootPath) => {
    writeConfig(rootPath, { usage: true, conversations: false, results: true })
    createProjectNote(rootPath)
    await mkdir(path.join(getAiLogsPath(rootPath), "usage.jsonl"))
    const provider = fakeClient({ text: "Launch tasks and owner follow-ups." })

    const result = await generateNoteDescription({
      rootPath,
      selector: "project-notes",
      client: provider.client,
      clock: fixedClock("2026-06-01T10:05:00.000Z"),
    })

    assert.equal(result.status, "applied")
    assert.equal(result.description, "Launch tasks and owner follow-ups.")
    assert.equal(createSidecarRepository(rootPath).read("project-notes").description, "Launch tasks and owner follow-ups.")
  })
})

test("provider failure remains the thrown error when failure logging also fails", async () => {
  await withRoot("bluenote-ai-description-provider-failure-log-failure-", async (rootPath) => {
    writeConfig(rootPath, { usage: true, conversations: false, results: true })
    createProjectNote(rootPath)
    await mkdir(path.join(getAiLogsPath(rootPath), "usage.jsonl"))
    const providerError = new Error("provider unavailable")

    await assert.rejects(
      () => generateNoteDescription({
        rootPath,
        selector: "project-notes",
        client: {
          async createChatCompletion() {
            throw providerError
          },
        },
        clock: fixedClock("2026-06-01T10:05:00.000Z"),
      }),
      (error) => error === providerError,
    )
  })
})

test("provider failure result logs redact configured and bearer secrets", async () => {
  await withRoot("bluenote-ai-description-provider-failure-redaction-", async (rootPath) => {
    writeConfig(rootPath, { usage: false, conversations: false, results: true })
    createProjectNote(rootPath)

    await assert.rejects(
      () => generateNoteDescription({
        rootPath,
        selector: "project-notes",
        client: {
          async createChatCompletion() {
            throw new Error("provider rejected sk-test-key via Bearer abc.def.ghi")
          },
        },
        clock: fixedClock("2026-06-01T10:05:00.000Z"),
      }),
      /sk-test-key/u,
    )

    const resultsLogPath = path.join(getAiLogsPath(rootPath), "results.jsonl")
    const resultsLog = (await readFile(resultsLogPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
    assert.equal(resultsLog.length, 1)
    assert.equal(resultsLog[0].status, "failed")
    assert.doesNotMatch(resultsLog[0].error, /sk-test-key|abc\.def\.ghi/u)
    assert.match(resultsLog[0].error, /\[redacted\]/u)
  })
})

test("invalid generated output leaves the existing description unchanged", async () => {
  await withRoot("bluenote-ai-description-invalid-", async (rootPath) => {
    writeConfig(rootPath)
    createProjectNote(rootPath)
    const sidecars = createSidecarRepository(rootPath)
    const before = sidecars.read("project-notes")
    const provider = fakeClient({ text: "- This is markdown output" })

    const result = await generateNoteDescription({
      rootPath,
      selector: "project-notes",
      client: provider.client,
      clock: fixedClock("2026-06-01T10:05:00.000Z"),
    })

    assert.equal(result.status, "invalid")
    assert.equal(sidecars.read("project-notes").description, before.description)
    assert.equal(sidecars.read("project-notes").updatedAt, before.updatedAt)
    assert.equal(sidecars.read("project-notes").ai?.description?.lastProcessedAt, before.ai?.description?.lastProcessedAt)
  })
})

test("provider failure leaves the existing description unchanged", async () => {
  await withRoot("bluenote-ai-description-provider-failure-", async (rootPath) => {
    writeConfig(rootPath)
    createProjectNote(rootPath)
    const sidecars = createSidecarRepository(rootPath)
    const before = sidecars.read("project-notes")

    await assert.rejects(
      () => generateNoteDescription({
        rootPath,
        selector: "project-notes",
        client: {
          async createChatCompletion() {
            throw new Error("provider unavailable")
          },
        },
        clock: fixedClock("2026-06-01T10:05:00.000Z"),
      }),
      /provider unavailable/,
    )

    assert.equal(sidecars.read("project-notes").description, before.description)
    assert.equal(sidecars.read("project-notes").updatedAt, before.updatedAt)
    assert.equal(sidecars.read("project-notes").ai?.description?.lastProcessedAt, before.ai?.description?.lastProcessedAt)
  })
})
