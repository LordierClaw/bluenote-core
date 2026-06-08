import { test } from "bun:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"

import { createAiConfigRepository, type AiConfig } from "../../../src/ai/config"
import {
  createCodexAuthRepository,
  formatCodexAuthStatus,
  getCodexAuthPath,
  type CodexAuth,
} from "../../../src/ai/codex-auth-repository"
import { ensureManagedRoot, getAiConfigPath } from "../../../src/storage/root-layout"

function codexConfig(): AiConfig {
  return {
    version: 1,
    enabled: true,
    provider: "codex",
    model: "gpt-5-codex",
    logging: {
      usage: true,
      conversations: false,
      results: true,
    },
    maxAttempts: 3,
    outputLanguage: "English",
  }
}

function openAiCompatibleConfig(): AiConfig {
  return {
    version: 1,
    enabled: true,
    provider: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "***",
    model: "gpt-4o-mini",
    logging: {
      usage: true,
      conversations: false,
      results: true,
    },
    maxAttempts: 3,
    outputLanguage: "English",
  }
}

function validAuth(overrides: Partial<CodexAuth> = {}): CodexAuth {
  return {
    version: 1,
    provider: "codex",
    authType: "device-code-oauth",
    idToken: "eyJhbGciOiJIUzI1NiJ9.eyJhY2NvdW50X2lkIjoiYWNjdC1zZWNyZXQifQ.signaturepart",
    accessToken: "access-token-secret-value",
    refreshToken: "refresh-token-secret-value",
    expiresAt: "2999-01-01T00:00:00.000Z",
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
    issuer: "https://auth.openai.com",
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
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

test("missing auth reports setup-required when Codex is selected and not-configured otherwise", async () => {
  await withRoot("bluenote-codex-auth-missing-", async (rootPath) => {
    const repository = createCodexAuthRepository(rootPath, { now: () => new Date("2026-06-04T00:00:00.000Z") })

    assert.deepEqual(repository.getStatus({ provider: "codex" }), { state: "setup-required" })
    assert.deepEqual(repository.getStatus({ provider: "openai-compatible" }), { state: "not-configured" })
  })
})

test("valid auth file reports authenticated without token material", async () => {
  await withRoot("bluenote-codex-auth-valid-", async (rootPath) => {
    const repository = createCodexAuthRepository(rootPath, { now: () => new Date("2026-06-04T00:00:00.000Z") })
    const auth = validAuth()

    repository.write(auth)
    const status = repository.getStatus({ provider: "codex" })
    const formatted = formatCodexAuthStatus(status)

    assert.equal(status.state, "authenticated")
    assert.equal(JSON.stringify(status).includes(auth.accessToken), false)
    assert.equal(JSON.stringify(status).includes(auth.refreshToken), false)
    assert.equal(JSON.stringify(status).includes(auth.idToken), false)
    assert.equal(formatted.includes(auth.accessToken), false)
    assert.equal(formatted.includes(auth.refreshToken), false)
    assert.equal(formatted.includes(auth.idToken), false)
    assert.match(formatted, /authenticated/i)
  })
})

test("expired auth reports expired when no refresh is attempted", async () => {
  await withRoot("bluenote-codex-auth-expired-", async (rootPath) => {
    const repository = createCodexAuthRepository(rootPath, { now: () => new Date("2026-06-04T00:00:00.000Z") })

    repository.write(validAuth({ expiresAt: "2026-06-03T00:00:00.000Z" }))

    assert.deepEqual(repository.getStatus({ provider: "codex" }), {
      state: "expired",
      hint: "Run bn ai codex auth login.",
    })
  })
})

test("malformed auth reports invalid and includes no raw token or account material", async () => {
  await withRoot("bluenote-codex-auth-malformed-", async (rootPath) => {
    const repository = createCodexAuthRepository(rootPath, { now: () => new Date("2026-06-04T00:00:00.000Z") })
    const authPath = getCodexAuthPath(rootPath)
    const rawAccessToken = "access-token-secret-value"
    const rawRefreshToken = "refresh-token-secret-value"
    const rawAccountId = "acct-secret-account"

    await writeFile(
      authPath,
      JSON.stringify({ accessToken: rawAccessToken, refreshToken: rawRefreshToken, accountId: rawAccountId, provider: "codex" }),
      "utf8",
    )

    const status = repository.getStatus({ provider: "codex" })
    const formatted = formatCodexAuthStatus(status)

    assert.equal(status.state, "invalid")
    assert.equal(JSON.stringify(status).includes(rawAccessToken), false)
    assert.equal(JSON.stringify(status).includes(rawRefreshToken), false)
    assert.equal(JSON.stringify(status).includes(rawAccountId), false)
    assert.equal(formatted.includes(rawAccessToken), false)
    assert.equal(formatted.includes(rawRefreshToken), false)
    assert.equal(formatted.includes(rawAccountId), false)
    assert.match(formatted, /invalid/i)
  })
})

test("POSIX writes create .data/ai/codex-auth.json with owner-only mode where supported", async () => {
  await withRoot("bluenote-codex-auth-permissions-", async (rootPath) => {
    const repository = createCodexAuthRepository(rootPath)

    const writtenPath = repository.write(validAuth())

    assert.equal(writtenPath, getCodexAuthPath(rootPath))
    assert.equal(JSON.parse(await readFile(writtenPath, "utf8")).accessToken, "access-token-secret-value")
    if (process.platform !== "win32") {
      const authStats = await stat(writtenPath)
      assert.equal(authStats.mode & 0o077, 0)
    }
  })
})

test("logout/delete removes auth but leaves .data/ai/config.json untouched", async () => {
  await withRoot("bluenote-codex-auth-delete-", async (rootPath) => {
    const configRepository = createAiConfigRepository(rootPath)
    const authRepository = createCodexAuthRepository(rootPath)
    const config = codexConfig()

    configRepository.write(config)
    authRepository.write(validAuth())

    authRepository.delete()

    assert.equal(existsSync(getCodexAuthPath(rootPath)), false)
    assert.equal(existsSync(getAiConfigPath(rootPath)), true)
    assert.deepEqual(configRepository.read(), config)

    configRepository.write(openAiCompatibleConfig())
    assert.equal(existsSync(getAiConfigPath(rootPath)), true)
  })
})
