import { test } from "bun:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"

import { UsageError } from "../../../src/core/errors"
import { ensureManagedRoot, getAiConfigPath, getAiStatePath } from "../../../src/storage/root-layout"
import { createAiConfigRepository, maskApiKey, validateAiConfig, type AiConfig } from "../../../src/ai/config"

function validConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    version: 1,
    enabled: true,
    provider: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test-secret-value",
    model: "gpt-4o-mini",
    logging: {
      usage: true,
      conversations: false,
      results: true,
    },
    maxAttempts: 3,
    outputLanguage: "English",
    ...overrides,
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

test("valid AI config is accepted and round-trips through .data/ai/config.json", async () => {
  await withRoot("bluenote-ai-config-roundtrip-", async (rootPath) => {
    const repository = createAiConfigRepository(rootPath)
    const config = validConfig()

    assert.equal(repository.exists(), false)
    const writtenPath = repository.write(config)

    assert.equal(writtenPath, getAiConfigPath(rootPath))
    assert.equal(repository.exists(), true)
    assert.deepEqual(repository.read(), config)

    const rawJson = await readFile(getAiConfigPath(rootPath), "utf8")
    assert.equal(rawJson, `${JSON.stringify(config, null, 2)}\n`)
  })
})

test("missing retry and output language config fields default when reading legacy config", () => {
  const legacy = {
    version: 1,
    enabled: true,
    provider: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    logging: { usage: true, conversations: false, results: true },
  }

  assert.deepEqual(validateAiConfig(legacy, ".data/ai/config.json"), {
    ...legacy,
    maxAttempts: 3,
    outputLanguage: "English",
  })
})

test("retry attempts and output language are validated", () => {
  const configured = validateAiConfig(validConfig({ maxAttempts: 5, outputLanguage: "日本語" }), ".data/ai/config.json")
  assert.equal(configured.maxAttempts, 5)
  assert.equal(configured.outputLanguage, "日本語")

  for (const badMaxAttempts of [0, -1, 1.5, "3"] as unknown[]) {
    assert.throws(() => validateAiConfig({ ...validConfig(), maxAttempts: badMaxAttempts }, ".data/ai/config.json"), /maxAttempts/i)
  }

  assert.throws(() => validateAiConfig({ ...validConfig(), outputLanguage: "" }, ".data/ai/config.json"), /outputLanguage/i)
})

test("AI config writes restrict plaintext API key file permissions to owner only on POSIX", async () => {
  await withRoot("bluenote-ai-config-permissions-", async (rootPath) => {
    const repository = createAiConfigRepository(rootPath)

    repository.write(validConfig())
    const configStats = await stat(getAiConfigPath(rootPath))
    if (process.platform === "win32") {
      assert.equal(configStats.isFile(), true)
    } else {
      assert.equal(configStats.mode & 0o077, 0)
    }
  })
})

test("empty apiKey, empty model, and invalid baseUrl are rejected", () => {
  for (const [field, config] of [
    ["apiKey", validConfig({ apiKey: "" })],
    ["model", validConfig({ model: "" })],
    ["baseUrl", validConfig({ baseUrl: "not a url" })],
  ] as const) {
    assert.throws(
      () => validateAiConfig(config, ".data/ai/config.json"),
      (error: unknown) => {
        assert.ok(error instanceof UsageError)
        assert.match(error.message, new RegExp(field, "i"))
        return true
      },
    )
  }
})

test("malformed config JSON produces a BlueNote UsageError with a helpful message", async () => {
  await withRoot("bluenote-ai-config-malformed-", async (rootPath) => {
    await writeFile(getAiConfigPath(rootPath), "{ malformed json", "utf8")
    const repository = createAiConfigRepository(rootPath)

    assert.throws(
      () => repository.read(),
      (error: unknown) => {
        assert.ok(error instanceof UsageError)
        assert.match(error.message, /Could not parse AI config/i)
        assert.match(error.hint ?? "", /valid JSON/i)
        assert.ok(error.cause instanceof SyntaxError)
        return true
      },
    )
  })
})

test("maskApiKey returns a masked value that does not expose the full key", () => {
  const key = "sk-test-secret-value"
  const masked = maskApiKey(key)

  assert.notEqual(masked, key)
  assert.equal(masked.includes(key), false)
  assert.match(masked, /\*/)
  assert.equal(maskApiKey("***"), "***")
})

test("config writes avoid partial files on the normal success path", async () => {
  await withRoot("bluenote-ai-config-atomic-", async (rootPath) => {
    const repository = createAiConfigRepository(rootPath)
    const config = validConfig({ apiKey: "sk-second-secret-value" })

    repository.write(config)

    const aiDirectoryEntries = await readdir(getAiStatePath(rootPath))
    assert.deepEqual(aiDirectoryEntries.sort(), ["config.json", "logs", "prompts"])

    const rawJson = await readFile(getAiConfigPath(rootPath), "utf8")
    assert.equal(rawJson.endsWith("\n"), true)
    assert.deepEqual(JSON.parse(rawJson), config)
  })
})
