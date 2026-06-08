import { describe, test } from "bun:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"

import {
  createAiConfigRepository,
  createAiQueueRepository,
  maskApiKey,
  sanitizeAiErrorMessage,
  validateAiConfig,
} from "@lordierclaw/bluenote-core"
import { validateAiConfig as rootValidateAiConfig, maskApiKey as rootMaskApiKey } from "../../../src/ai/config"
import { createAiQueueRepository as rootCreateAiQueueRepository } from "../../../src/ai/queue-repository"
import { sanitizeAiErrorMessage as rootSanitizeAiErrorMessage } from "../../../src/ai/error-redaction"

describe("@lordierclaw/bluenote-core AI exports", () => {
  test("exports reusable AI APIs with root shim identity and repository behavior", async () => {
    assert.equal(validateAiConfig, rootValidateAiConfig)
    assert.equal(maskApiKey, rootMaskApiKey)
    assert.equal(createAiQueueRepository, rootCreateAiQueueRepository)
    assert.equal(sanitizeAiErrorMessage, rootSanitizeAiErrorMessage)

    assert.equal(maskApiKey("sk-testsecret"), "sk-***cret")
    assert.equal(sanitizeAiErrorMessage(new Error("Bearer ***"), ["***"]), "Bearer [redacted]")

    const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-core-ai-exports-"))

    try {
      const configRepository = createAiConfigRepository(rootPath)
      assert.equal(configRepository.exists(), false)
      const configPath = configRepository.write({
        version: 1,
        enabled: true,
        provider: "openai-compatible",
        baseUrl: "https://example.test/v1",
        apiKey: "sk-test-secret",
        model: "test-model",
        logging: { usage: false, conversations: false, results: false },
      })
      assert.equal(configPath, path.join(rootPath, ".data", "ai", "config.json"))
      assert.equal(configRepository.exists(), true)
      assert.deepEqual(configRepository.read(), {
        version: 1,
        enabled: true,
        provider: "openai-compatible",
        baseUrl: "https://example.test/v1",
        apiKey: "sk-test-secret",
        model: "test-model",
        logging: { usage: false, conversations: false, results: false },
        maxAttempts: 3,
        outputLanguage: "English",
      })

      const queueRepository = createAiQueueRepository(rootPath)
      assert.deepEqual(queueRepository.read(), { version: 1, jobs: [] })
      const result = queueRepository.update((queue) => ({
        queue: {
          version: 1,
          jobs: [
            {
              kind: "describe-note",
              key: "core-ai-export-000000",
              relativePath: "note/core-ai-export-000000.md",
              contentHash: `sha256:${"a".repeat(64)}`,
              promptHash: `sha256:${"b".repeat(64)}`,
              status: "pending",
              attempts: 0,
              lastError: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              nextAttemptAt: null,
            },
          ],
        },
        result: "queued",
      }))
      assert.equal(result, "queued")
      assert.equal(queueRepository.read().jobs.length, 1)
    } finally {
      await rm(rootPath, { recursive: true, force: true })
    }
  })
})
