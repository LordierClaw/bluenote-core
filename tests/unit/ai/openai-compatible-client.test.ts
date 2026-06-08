import { test } from "bun:test"
import assert from "node:assert/strict"

import {
  OpenAiCompatibleClientError,
  createOpenAiCompatibleClient,
} from "../../../src/ai/openai-compatible-client"
import type { AiChatMessage } from "../../../src/ai/types"

type FetchCall = {
  url: string
  init: RequestInit
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...init.headers },
    ...init,
  })
}

function createMockFetch(response: Response) {
  const calls: FetchCall[] = []
  const fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init: init ?? {} })
    return response
  }

  return { fetch, calls }
}

const messages: AiChatMessage[] = [
  { role: "system", content: "Write a short description." },
  { role: "user", content: "Secret note content that must never appear in errors." },
]

test("POSTs chat completions with authorization, model, and messages, then parses content and usage", async () => {
  const { fetch, calls } = createMockFetch(jsonResponse({
    id: "chatcmpl-test",
    choices: [
      { message: { role: "assistant", content: "Concise project planning notes." } },
    ],
    usage: {
      prompt_tokens: 12,
      completion_tokens: 5,
      total_tokens: 17,
    },
  }, {
    headers: { "x-request-id": "req_123" },
  }))
  const client = createOpenAiCompatibleClient({ fetch })

  const result = await client.createChatCompletion({
    baseUrl: "https://provider.example/v1///",
    apiKey: "sk-secret-token",
    model: "model-a",
    messages,
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.url, "https://provider.example/v1/chat/completions")
  assert.equal(calls[0]?.init.method, "POST")
  assert.deepEqual(calls[0]?.init.headers, {
    authorization: "Bearer sk-secret-token",
    "content-type": "application/json",
  })
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    model: "model-a",
    messages,
  })
  assert.deepEqual(result, {
    text: "Concise project planning notes.",
    usage: {
      promptTokens: 12,
      completionTokens: 5,
      totalTokens: 17,
    },
    providerRequestId: "req_123",
  })
})

test("throws a helpful sanitized error for non-2xx responses", async () => {
  const { fetch } = createMockFetch(jsonResponse({
    error: {
      message: "Invalid API key for this request",
      type: "authentication_error",
    },
  }, { status: 401, statusText: "Unauthorized" }))
  const client = createOpenAiCompatibleClient({ fetch })

  await assert.rejects(
    () => client.createChatCompletion({
      baseUrl: "https://provider.example/v1",
      apiKey: "sk-secret-token",
      model: "model-a",
      messages,
    }),
    (error: unknown) => {
      assert.ok(error instanceof OpenAiCompatibleClientError)
      assert.match(error.message, /OpenAI-compatible provider request failed/i)
      assert.match(error.message, /401/)
      assert.match(error.message, /authentication_error/i)
      assert.doesNotMatch(error.message, /\*\*\*/)
      assert.doesNotMatch(error.message, /Secret note content/)
      return true
    },
  )
})

test("throws a sanitized provider error with status for non-JSON non-2xx responses", async () => {
  const { fetch } = createMockFetch(new Response(
    "provider says Invalid API key *** Secret note content that must never appear in errors.",
    {
      status: 429,
      statusText: "Too Many Requests",
      headers: { "content-type": "text/plain" },
    },
  ))
  const client = createOpenAiCompatibleClient({ fetch })

  await assert.rejects(
    () => client.createChatCompletion({
      baseUrl: "https://provider.example/v1",
      apiKey: "***",
      model: "model-a",
      messages,
    }),
    (error: unknown) => {
      assert.ok(error instanceof OpenAiCompatibleClientError)
      assert.match(error.message, /OpenAI-compatible provider request failed/i)
      assert.match(error.message, /429/)
      assert.doesNotMatch(error.message, /Invalid API key/i)
      assert.doesNotMatch(error.message, /\*\*\*/)
      assert.doesNotMatch(error.message, /Secret note content/)
      return true
    },
  )
})

test("throws a helpful sanitized error for malformed success responses", async () => {
  const { fetch } = createMockFetch(jsonResponse({ choices: [{ message: {} }] }))
  const client = createOpenAiCompatibleClient({ fetch })

  await assert.rejects(
    () => client.createChatCompletion({
      baseUrl: "https://provider.example/v1",
      apiKey: "sk-secret-token",
      model: "model-a",
      messages,
    }),
    (error: unknown) => {
      assert.ok(error instanceof OpenAiCompatibleClientError)
      assert.match(error.message, /malformed OpenAI-compatible provider response/i)
      assert.doesNotMatch(error.message, /\*\*\*/)
      assert.doesNotMatch(error.message, /Secret note content/)
      return true
    },
  )
})
