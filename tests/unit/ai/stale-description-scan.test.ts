import { test } from "bun:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"

import { createAiConfigRepository } from "../../../src/ai/config-repository"
import { createAiQueueRepository } from "../../../src/ai/queue-repository"
import { scanAndEnqueueStaleDescriptions } from "../../../src/ai/stale-description-scan"
import { serializeNoteFile } from "../../../src/storage/frontmatter"
import { ensureManagedRoot, getAiQueuePath, getInboxNotePath } from "../../../src/storage/root-layout"
import { createNoteRepository } from "../../../src/storage/note-repository"
import { createSidecarRepository } from "../../../src/storage/sidecar-repository"
import type { Clock } from "../../../src/platform/clock"

async function withRoot(name: string, callback: (rootPath: string) => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), name))

  try {
    await callback(ensureManagedRoot(tempRoot))
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

function fixedClock(isoTimestamp: string): Clock {
  return {
    now() {
      return new Date(isoTimestamp)
    },
  }
}

function validAiConfig(enabled = true) {
  return {
    version: 1 as const,
    enabled,
    provider: "openai-compatible" as const,
    baseUrl: "https://api.example.test/v1",
    apiKey: "test-api-key",
    model: "test-model",
    logging: {
      usage: false,
      conversations: false,
      results: false,
    },
  }
}

function createStoredNote(rootPath: string, input: {
  key: string
  title: string
  body?: string
  updatedAt: string
  archivedAt?: string
  lastProcessedAt?: string
}) {
  const repository = createNoteRepository(rootPath)
  const createdAt = "2026-06-01T00:00:00.000Z"
  const record = repository.create({
    frontmatter: {
      id: input.key,
      schemaVersion: 1,
      title: input.title,
      mode: "plain",
      tags: [],
      createdAt,
      updatedAt: input.updatedAt,
    },
    body: input.body ?? `${input.title} body`,
  })

  if (input.archivedAt) {
    repository.archive(record.notePath, input.archivedAt)
  }

  if (input.lastProcessedAt) {
    const sidecars = createSidecarRepository(rootPath)
    const sidecar = sidecars.read(input.key)
    sidecars.write({
      ...sidecar,
      ai: {
        description: {
          lastProcessedAt: input.lastProcessedAt,
        },
      },
    })
  }

  return record
}

test("missing AI config returns zero enqueued and does not create queue", async () => {
  await withRoot("bluenote-stale-scan-no-config-", async (rootPath) => {
    createStoredNote(rootPath, {
      key: "project-notes",
      title: "Project notes",
      updatedAt: "2026-06-01T10:00:00.000Z",
    })

    const result = scanAndEnqueueStaleDescriptions(rootPath, {
      clock: fixedClock("2026-06-01T11:00:00.000Z"),
    })

    assert.deepEqual(result, { scanned: 0, enqueued: 0 })
    assert.equal(existsSync(getAiQueuePath(rootPath)), false)
  })
})

test("disabled AI config returns zero enqueued and does not create queue", async () => {
  await withRoot("bluenote-stale-scan-disabled-", async (rootPath) => {
    createAiConfigRepository(rootPath).write(validAiConfig(false))
    createStoredNote(rootPath, {
      key: "project-notes",
      title: "Project notes",
      updatedAt: "2026-06-01T10:00:00.000Z",
    })

    const result = scanAndEnqueueStaleDescriptions(rootPath, {
      clock: fixedClock("2026-06-01T11:00:00.000Z"),
    })

    assert.deepEqual(result, { scanned: 0, enqueued: 0 })
    assert.equal(existsSync(getAiQueuePath(rootPath)), false)
  })
})

test("note with no AI description lastProcessedAt enqueues one describe-note job", async () => {
  await withRoot("bluenote-stale-scan-missing-processed-", async (rootPath) => {
    createAiConfigRepository(rootPath).write(validAiConfig(true))
    createStoredNote(rootPath, {
      key: "project-notes",
      title: "Project notes",
      body: "Important project details.",
      updatedAt: "2026-06-01T10:00:00.000Z",
    })

    const result = scanAndEnqueueStaleDescriptions(rootPath, {
      clock: fixedClock("2026-06-01T11:00:00.000Z"),
    })

    assert.deepEqual(result, { scanned: 1, enqueued: 1 })
    const queue = createAiQueueRepository(rootPath).read()
    assert.equal(queue.jobs.length, 1)
    assert.equal(queue.jobs[0]?.kind, "describe-note")
    assert.equal(queue.jobs[0]?.key, "project-notes")
    assert.equal(queue.jobs[0]?.relativePath, "note/project-notes.md")
  })
})

test("enqueue failure reports zero enqueued and emits a warning", async () => {
  await withRoot("bluenote-stale-scan-queue-fail-", async (rootPath) => {
    createAiConfigRepository(rootPath).write(validAiConfig(true))
    createStoredNote(rootPath, {
      key: "project-notes",
      title: "Project notes",
      updatedAt: "2026-06-01T10:00:00.000Z",
    })
    mkdirSync(getAiQueuePath(rootPath))
    const warnings: string[] = []

    const result = scanAndEnqueueStaleDescriptions(rootPath, {
      clock: fixedClock("2026-06-01T11:00:00.000Z"),
      warn(message) {
        warnings.push(message)
      },
    })

    assert.deepEqual(result, { scanned: 1, enqueued: 0 })
    assert.equal(warnings.length, 1)
    assert.match(warnings[0] ?? "", /Warning: could not enqueue AI description refresh/i)
  })
})

test("missing sidecar falls back to frontmatter note data and enqueues stale description refresh", async () => {
  await withRoot("bluenote-stale-scan-missing-sidecar-", async (rootPath) => {
    createAiConfigRepository(rootPath).write(validAiConfig(true))
    const key = "legacy-frontmatter-note"
    const notePath = getInboxNotePath(rootPath, key)
    writeFileSync(notePath, serializeNoteFile({
      sourcePath: `note/${key}.md`,
      frontmatter: {
        id: key,
        schemaVersion: 1,
        title: "Legacy frontmatter note",
        mode: "plain",
        tags: [],
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T10:00:00.000Z",
      },
      body: "Legacy body that should still be scanned when sidecar metadata is missing.",
    }), "utf8")
    rmSync(createSidecarRepository(rootPath).getSidecarPath(key), { force: true })
    const warnings: string[] = []

    const result = scanAndEnqueueStaleDescriptions(rootPath, {
      clock: fixedClock("2026-06-01T11:00:00.000Z"),
      warn(message) {
        warnings.push(message)
      },
    })

    assert.deepEqual(result, { scanned: 1, enqueued: 1 })
    assert.deepEqual(warnings, [])
    const queue = createAiQueueRepository(rootPath).read()
    assert.equal(queue.jobs.length, 1)
    assert.equal(queue.jobs[0]?.kind, "describe-note")
    assert.equal(queue.jobs[0]?.key, key)
    assert.equal(queue.jobs[0]?.relativePath, `note/${key}.md`)
  })
})

test("updated notes newer than lastProcessedAt are enqueued", async () => {
  await withRoot("bluenote-stale-scan-newer-updated-", async (rootPath) => {
    createAiConfigRepository(rootPath).write(validAiConfig(true))
    createStoredNote(rootPath, {
      key: "project-notes",
      title: "Project notes",
      updatedAt: "2026-06-01T10:00:00.000Z",
      lastProcessedAt: "2026-06-01T09:59:59.000Z",
    })

    const result = scanAndEnqueueStaleDescriptions(rootPath, {
      clock: fixedClock("2026-06-01T11:00:00.000Z"),
    })

    assert.deepEqual(result, { scanned: 1, enqueued: 1 })
    assert.equal(createAiQueueRepository(rootPath).read().jobs[0]?.key, "project-notes")
  })
})

test("notes processed at or after updatedAt are not enqueued", async () => {
  await withRoot("bluenote-stale-scan-fresh-", async (rootPath) => {
    createAiConfigRepository(rootPath).write(validAiConfig(true))
    createStoredNote(rootPath, {
      key: "equal-note",
      title: "Equal note",
      updatedAt: "2026-06-01T10:00:00.000Z",
      lastProcessedAt: "2026-06-01T10:00:00.000Z",
    })
    createStoredNote(rootPath, {
      key: "newer-processed-note",
      title: "Newer processed note",
      updatedAt: "2026-06-01T10:00:00.000Z",
      lastProcessedAt: "2026-06-01T10:01:00.000Z",
    })

    const result = scanAndEnqueueStaleDescriptions(rootPath, {
      clock: fixedClock("2026-06-01T11:00:00.000Z"),
    })

    assert.deepEqual(result, { scanned: 2, enqueued: 0 })
    assert.equal(existsSync(getAiQueuePath(rootPath)), false)
  })
})

test("archived notes are skipped", async () => {
  await withRoot("bluenote-stale-scan-archived-", async (rootPath) => {
    createAiConfigRepository(rootPath).write(validAiConfig(true))
    createStoredNote(rootPath, {
      key: "archived-note",
      title: "Archived note",
      updatedAt: "2026-06-01T10:00:00.000Z",
      archivedAt: "2026-06-01T10:30:00.000Z",
    })

    const result = scanAndEnqueueStaleDescriptions(rootPath, {
      clock: fixedClock("2026-06-01T11:00:00.000Z"),
    })

    assert.deepEqual(result, { scanned: 1, enqueued: 0 })
    assert.equal(existsSync(getAiQueuePath(rootPath)), false)
  })
})

test("existing pending stale jobs are refreshed and deduped rather than duplicated", async () => {
  await withRoot("bluenote-stale-scan-dedupe-", async (rootPath) => {
    createAiConfigRepository(rootPath).write(validAiConfig(true))
    createStoredNote(rootPath, {
      key: "project-notes",
      title: "Project notes",
      body: "Important project details.",
      updatedAt: "2026-06-01T10:00:00.000Z",
      lastProcessedAt: "2026-06-01T09:00:00.000Z",
    })

    scanAndEnqueueStaleDescriptions(rootPath, {
      clock: fixedClock("2026-06-01T11:00:00.000Z"),
    })
    const firstJob = createAiQueueRepository(rootPath).read().jobs[0]

    const result = scanAndEnqueueStaleDescriptions(rootPath, {
      clock: fixedClock("2026-06-01T11:05:00.000Z"),
    })

    const queue = createAiQueueRepository(rootPath).read()
    assert.deepEqual(result, { scanned: 1, enqueued: 1 })
    assert.equal(queue.jobs.length, 1)
    assert.equal(queue.jobs[0]?.key, "project-notes")
    assert.equal(queue.jobs[0]?.createdAt, firstJob?.createdAt)
    assert.equal(queue.jobs[0]?.updatedAt, "2026-06-01T11:05:00.000Z")
  })
})
