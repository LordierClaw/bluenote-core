import { test } from "bun:test"
import assert from "node:assert/strict"

import { createAiTextGenerationClient, CodexProviderSetupRequiredError, type CodexAuthProvider } from "../../../src/ai/provider"
import type { AiConfig } from "../../../src/ai/config"
import type { CodexAuth } from "../../../src/ai/codex-auth-repository"

const openAiConfig: AiConfig = {
  version: 1,
  enabled: true,
  provider: "openai-compatible",
  baseUrl: "https://example.test/v1",
  apiKey: "***",
  model: "test-model",
  logging: { usage: false, conversations: false, results: false },
}

const codexConfig: AiConfig = {
  version: 1,
  enabled: true,
  provider: "codex",
  model: "codex-test-model",
  logging: { usage: false, conversations: false, results: false },
}

test("provider factory routes OpenAI-compatible config through the existing chat completion API", async () => {
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = []
  const client = createAiTextGenerationClient(openAiConfig, {
    fetch: async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({ choices: [{ message: { content: "Generated description" } }] }), {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "req_factory" },
      })
    },
  })

  const result = await client.createChatCompletion({
    model: "ignored-by-configured-factory",
    messages: [{ role: "user", content: "Describe this" }],
  })

  assert.equal(result.text, "Generated description")
  assert.equal(result.providerRequestId, "req_factory")
  assert.equal(String(calls[0].input), "https://example.test/v1/chat/completions")
  assert.equal((calls[0].init?.headers as Record<string, string>).authorization, "Bearer ***")
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    model: "test-model",
    messages: [{ role: "user", content: "Describe this" }],
  })
})

test("factory returns setup-required when Codex config lacks auth", () => {
  assert.throws(
    () => createAiTextGenerationClient(codexConfig),
    (error) => {
      assert.ok(error instanceof CodexProviderSetupRequiredError)
      assert.match(error.message, /Codex auth setup is required/i)
      assert.match(error.message, /bn ai codex auth status/i)
      assert.doesNotMatch(error.message, /secret|Bearer|apiKey/i)
      return true
    },
  )
})

test("factory returns setup-required when Codex auth repository has no stored auth", () => {
  const auth: CodexAuthProvider = {
    hasAuth: () => false,
  }
  assert.throws(
    () => createAiTextGenerationClient(codexConfig, { codexAuth: auth }),
    /Codex auth setup is required/,
  )
})

function fakeJwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature-secret",
  ].join(".")
}

function codexAuth(overrides: Partial<CodexAuth> = {}): CodexAuth {
  return {
    version: 1,
    provider: "codex",
    authType: "device-code-oauth",
    idToken: fakeJwt({ chatgpt_account_id: "workspace-123", email: "user@example.test" }),
    accessToken: "access-token-secret",
    refreshToken: "refresh-token-secret",
    expiresAt: "2099-06-04T12:30:00.000Z",
    createdAt: "2026-06-04T12:00:00.000Z",
    updatedAt: "2026-06-04T12:00:00.000Z",
    issuer: "https://auth.openai.com",
    clientId: "client-id",
    ...overrides,
  }
}

test("factory returns a Codex client when Codex config plus valid auth are available", async () => {
  const auth: CodexAuthProvider = {
    hasAuth: () => true,
    getAuth: async () => codexAuth(),
  }

  const client = createAiTextGenerationClient(codexConfig, {
    codexAuth: auth,
    fetch: async () => new Response(JSON.stringify({ output_text: "Codex description" }), { status: 200 }),
  })

  const result = await client.createChatCompletion({ model: "ignored", messages: [{ role: "user", content: "Describe" }] })
  assert.equal(result.text, "Codex description")
})

test("Codex client sends bearer auth streaming Responses API request and normalizes completion result", async () => {
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = []
  const client = createAiTextGenerationClient({ ...codexConfig, model: "gpt 5.5" }, {
    codexAuth: {
      hasAuth: () => true,
      getAuth: async () => codexAuth(),
    },
    fetch: async (input, init) => {
      calls.push({ input, init })
      return new Response([
        "event: response.output_text.delta",
        "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Normalized \"}",
        "",
        "event: response.output_text.done",
        "data: {\"type\":\"response.output_text.done\",\"text\":\"Normalized Codex output\"}",
        "",
        "event: response.completed",
        "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_codex\",\"usage\":{\"input_tokens\":7,\"output_tokens\":3,\"total_tokens\":10}}}",
        "",
      ].join("\n"), {
        status: 200,
        headers: { "x-request-id": "req_codex" },
      })
    },
  })

  const result = await client.createChatCompletion({
    model: "ignored-by-configured-factory",
    messages: [{ role: "system", content: "Summarize" }, { role: "user", content: "Body" }],
  })

  assert.equal(result.text, "Normalized Codex output")
  assert.deepEqual(result.usage, { promptTokens: 7, completionTokens: 3, totalTokens: 10 })
  assert.equal(result.providerRequestId, "req_codex")
  assert.equal(String(calls[0].input), "https://chatgpt.com/backend-api/codex/responses")
  assert.equal((calls[0].init?.headers as Record<string, string>).authorization, "Bearer access-token-secret")
  assert.equal((calls[0].init?.headers as Record<string, string>)["ChatGPT-Account-ID"], "workspace-123")
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    model: "gpt-5.5",
    instructions: "Summarize",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Body" }] }],
    tools: [],
    tool_choice: "none",
    parallel_tool_calls: false,
    store: false,
    stream: true,
  })
})

test("Codex provider refreshes near-expired tokens before provider use", async () => {
  let refreshed = false
  let authorization = ""
  const client = createAiTextGenerationClient(codexConfig, {
    now: () => new Date("2026-06-04T12:00:00.000Z"),
    codexAuth: {
      hasAuth: () => true,
      getAuth: async () => codexAuth({ expiresAt: "2026-06-04T12:02:00.000Z" }),
      refreshAuth: async () => {
        refreshed = true
        return codexAuth({ accessToken: "fresh-access-token-secret", expiresAt: "2026-06-04T13:00:00.000Z" })
      },
    },
    fetch: async (_input, init) => {
      authorization = (init?.headers as Record<string, string>).authorization
      return new Response(JSON.stringify({ output_text: "Fresh token response" }), { status: 200 })
    },
  })

  const result = await client.createChatCompletion({ model: "ignored", messages: [{ role: "user", content: "Describe" }] })
  assert.equal(result.text, "Fresh token response")
  assert.equal(refreshed, true)
  assert.equal(authorization, "Bearer fresh-access-token-secret")
})

test("Codex provider/auth errors are sanitized and do not leak tokens", async () => {
  const storedAuth = codexAuth()
  const client = createAiTextGenerationClient(codexConfig, {
    codexAuth: {
      hasAuth: () => true,
      getAuth: async () => storedAuth,
    },
    fetch: async () => new Response(JSON.stringify({
      error: { type: "invalid_request", message: `Bearer ${storedAuth.accessToken} ${storedAuth.refreshToken} ${storedAuth.idToken} ***` },
    }), { status: 401, statusText: "Unauthorized" }),
  })

  await assert.rejects(
    () => client.createChatCompletion({ model: "ignored", messages: [{ role: "user", content: "Describe" }] }),
    (error) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /Codex provider request failed with status 401/)
      assert.doesNotMatch(error.message, /access-token-secret|refresh-token-secret|id-token-secret|\*\*\*/)
      return true
    },
  )
})
