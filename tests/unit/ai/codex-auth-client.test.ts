import { test } from "bun:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { mkdtemp, readFile, rm } from "node:fs/promises"

import {
  CodexAuthClientError,
  createCodexAuthClient,
  type CodexAuthFetch,
} from "../../../src/ai/codex-auth-client"
import { createCodexAuthRepository, type CodexAuth } from "../../../src/ai/codex-auth-repository"
import { ensureManagedRoot } from "../../../src/storage/root-layout"

type FetchCall = {
  url: string
  init: RequestInit
  body: unknown
}

type FetchHandler = (url: string, init: RequestInit, callIndex: number) => Response | Promise<Response>

const issuer = "https://auth.fake.test"
const clientId = "client_test_codex"
const now = () => new Date("2026-06-04T00:00:00.000Z")

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...init.headers },
    ...init,
  })
}

function parseBody(init: RequestInit): unknown {
  if (typeof init.body !== "string") {
    return init.body
  }

  const contentType = new Headers(init.headers).get("content-type") ?? ""
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(init.body))
  }

  return JSON.parse(init.body)
}

function createFakeFetch(handler: FetchHandler): { fetch: CodexAuthFetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const fetch: CodexAuthFetch = async (url, init = {}) => {
    const call = { url: String(url), init, body: parseBody(init) }
    calls.push(call)
    return handler(call.url, init, calls.length - 1)
  }

  return { fetch, calls }
}

function tokenBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    access_token: "access-token-secret-value",
    refresh_token: "refresh-token-secret-value",
    id_token: "id-token-secret-value",
    expires_in: 3600,
    ...overrides,
  }
}

function existingAuth(overrides: Partial<CodexAuth> = {}): CodexAuth {
  return {
    version: 1,
    provider: "codex",
    authType: "device-code-oauth",
    idToken: "old-id-token-secret",
    accessToken: "old-access-token-secret",
    refreshToken: "refresh-token-secret-value",
    expiresAt: "2026-06-04T00:05:00.000Z",
    createdAt: "2026-06-03T23:00:00.000Z",
    updatedAt: "2026-06-03T23:00:00.000Z",
    issuer,
    clientId,
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

test("starts device flow, exposes verification URL and user code, and never persists transient codes", async () => {
  await withRoot("bluenote-codex-client-start-", async (rootPath) => {
    const repository = createCodexAuthRepository(rootPath, { now })
    const { fetch, calls } = createFakeFetch((url, _init, index) => {
      if (index === 0) {
        assert.equal(url, `${issuer}/api/accounts/deviceauth/usercode`)
        return jsonResponse({ device_auth_id: "device-secret-value", user_code: "ABCD-EFGH", interval: 2 })
      }
      assert.equal(url, `${issuer}/oauth/token`)
      return jsonResponse(tokenBody())
    })
    const client = createCodexAuthClient({ fetch, issuer, clientId, now, repository })

    const flow = await client.startDeviceFlow()

    assert.deepEqual(flow, {
      deviceAuthId: "device-secret-value",
      userCode: "ABCD-EFGH",
      verificationUrl: `${issuer}/codex/device`,
      intervalSeconds: 2,
    })
    assert.deepEqual(calls[0]?.body, { client_id: clientId })
    assert.equal(repository.exists(), false)

    repository.write(await client.exchangeAuthorizationCode({
      authorizationCode: "authorization-code-secret",
      codeChallenge: "challenge",
      codeVerifier: "verifier-secret",
    }))
    const persisted = await readFile(repository.write(repository.read()), "utf8")
    assert.equal(persisted.includes("device-secret-value"), false)
    assert.equal(persisted.includes("ABCD-EFGH"), false)
    assert.equal(persisted.includes("authorization-code-secret"), false)
    assert.equal(persisted.includes("verifier-secret"), false)
  })
})

test("polls at the provider interval and completes token exchange into auth tokens", async () => {
  const sleeps: number[] = []
  const { fetch, calls } = createFakeFetch((url, init, index) => {
    if (index === 0) {
      return jsonResponse({ device_auth_id: "device-secret-value", usercode: "WXYZ-1234", interval: 3 })
    }
    if (index === 1) {
      assert.equal(url, `${issuer}/api/accounts/deviceauth/token`)
      return jsonResponse({ status: "authorization_pending" }, { status: 403 })
    }
    if (index === 2) {
      assert.equal(url, `${issuer}/api/accounts/deviceauth/token`)
      return jsonResponse({ authorization_code: "authorization-code-secret", code_challenge: "challenge", code_verifier: "verifier-secret" })
    }
    assert.equal(url, `${issuer}/oauth/token`)
    assert.equal(new Headers(init.headers).get("content-type"), "application/x-www-form-urlencoded")
    return jsonResponse(tokenBody())
  })
  const client = createCodexAuthClient({ fetch, issuer, clientId, now, sleep: async (ms: number) => { sleeps.push(ms) } })

  const flow = await client.startDeviceFlow()
  const auth = await client.completeDeviceFlow(flow)

  assert.deepEqual(sleeps, [3000])
  assert.deepEqual(calls[1]?.body, { device_auth_id: "device-secret-value", user_code: "WXYZ-1234" })
  assert.deepEqual(calls[3]?.body, {
    grant_type: "authorization_code",
    code: "authorization-code-secret",
    redirect_uri: `${issuer}/deviceauth/callback`,
    client_id: clientId,
    code_verifier: "verifier-secret",
  })
  assert.deepEqual(auth, {
    version: 1,
    provider: "codex",
    authType: "device-code-oauth",
    idToken: "id-token-secret-value",
    accessToken: "access-token-secret-value",
    refreshToken: "refresh-token-secret-value",
    expiresAt: "2026-06-04T01:00:00.000Z",
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
    issuer,
    clientId,
  })
})

test("handles pending, timeout, denied/cancelled/permanent errors, and HTTP errors with sanitized messages", async () => {
  const pendingFetch = createFakeFetch((_, __, index) => index === 0
    ? jsonResponse({ device_auth_id: "device-secret-value", user_code: "CODE-0000", interval: 1 })
    : jsonResponse({ status: "authorization_pending" }, { status: 404 }))
  const pendingClient = createCodexAuthClient({
    fetch: pendingFetch.fetch,
    issuer,
    clientId,
    now: () => new Date("2026-06-04T00:00:00.000Z"),
    sleep: async () => {},
    loginTimeoutMs: 0,
  })
  const flow = await pendingClient.startDeviceFlow()
  await assert.rejects(() => pendingClient.completeDeviceFlow(flow), (error: unknown) => {
    assert.ok(error instanceof CodexAuthClientError)
    const authError = error as CodexAuthClientError
    assert.equal(authError.code, "expired")
    assert.doesNotMatch(authError.message, /device-secret-value|CODE-0000/)
    return true
  })

  for (const [status, code] of [
    ["access_denied", "denied"],
    ["authorization_declined", "denied"],
    ["cancelled", "cancelled"],
    ["expired_token", "expired"],
    ["bad_device_code", "permanent"],
  ] as const) {
    const { fetch } = createFakeFetch((_, __, index) => index === 0
      ? jsonResponse({ device_auth_id: "device-secret-value", user_code: "CODE-0000", interval: 1 })
      : jsonResponse({ error: status, error_description: `failed with access_token=raw-access-token and refresh_token=raw-refresh-token` }, { status: 400 }))
    const client = createCodexAuthClient({ fetch, issuer, clientId, now, sleep: async () => {} })
    const errorFlow = await client.startDeviceFlow()
    await assert.rejects(() => client.completeDeviceFlow(errorFlow), (error: unknown) => {
      assert.ok(error instanceof CodexAuthClientError)
      const authError = error as CodexAuthClientError
      assert.equal(authError.code, code)
      assert.doesNotMatch(authError.message, /raw-access-token|raw-refresh-token|device-secret-value|CODE-0000/)
      return true
    })
  }

  const { fetch } = createFakeFetch((_, __, index) => index === 0
    ? jsonResponse({ device_auth_id: "device-secret-value", user_code: "CODE-0000", interval: 1 })
    : jsonResponse({ error: { message: "server saw Bearer raw-token-secret" } }, { status: 500 }))
  const client = createCodexAuthClient({ fetch, issuer, clientId, now, sleep: async () => {} })
  const httpFlow = await client.startDeviceFlow()
  await assert.rejects(() => client.completeDeviceFlow(httpFlow), (error: unknown) => {
    assert.ok(error instanceof CodexAuthClientError)
    const authError = error as CodexAuthClientError
    assert.equal(authError.code, "http")
    assert.match(authError.message, /status 500/)
    assert.doesNotMatch(authError.message, /raw-token-secret|device-secret-value|CODE-0000/)
    return true
  })
})

test("terminal device errors on pending-status responses fail immediately without polling until timeout", async () => {
  let currentTime = new Date("2026-06-04T00:00:00.000Z").getTime()
  const sleeps: number[] = []
  const { fetch } = createFakeFetch((_, __, index) => index === 0
    ? jsonResponse({ device_auth_id: "device-secret-value", user_code: "CODE-0000", interval: 1 })
    : jsonResponse({ error: "access_denied", error_description: "user declined authorization" }, { status: 403 }))
  const client = createCodexAuthClient({
    fetch,
    issuer,
    clientId,
    now: () => new Date(currentTime),
    loginTimeoutMs: 5,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      currentTime += ms
    },
  })

  const flow = await client.startDeviceFlow()
  await assert.rejects(() => client.completeDeviceFlow(flow), (error: unknown) => {
    assert.ok(error instanceof CodexAuthClientError)
    assert.equal(error.code, "denied")
    assert.match(error.message, /access_denied|declined/)
    assert.doesNotMatch(error.message, /device-secret-value|CODE-0000/)
    return true
  })
  assert.deepEqual(sleeps, [])
})

test("caps pending poll sleeps to the remaining login timeout", async () => {
  let currentTime = new Date("2026-06-04T00:00:00.000Z").getTime()
  const sleeps: number[] = []
  const { fetch } = createFakeFetch((_, __, index) => index === 0
    ? jsonResponse({ device_auth_id: "device-secret-value", user_code: "CODE-0000", interval: 999 })
    : jsonResponse({ status: "authorization_pending" }, { status: 403 }))
  const client = createCodexAuthClient({
    fetch,
    issuer,
    clientId,
    now: () => new Date(currentTime),
    loginTimeoutMs: 5000,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      currentTime += ms
    },
  })

  const flow = await client.startDeviceFlow()
  await assert.rejects(() => client.completeDeviceFlow(flow), (error: unknown) => {
    assert.ok(error instanceof CodexAuthClientError)
    assert.equal(error.code, "expired")
    return true
  })

  assert.deepEqual(sleeps, [5000])
})

test("normalizes aborts that occur while fetch is pending", async () => {
  const controller = new AbortController()
  const pendingFetch: CodexAuthFetch = async (_url, init = {}) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => {
      const error = new Error("aborted")
      error.name = "AbortError"
      reject(error)
    }, { once: true })
    controller.abort()
  })
  const client = createCodexAuthClient({ fetch: pendingFetch, issuer, clientId, now })

  await assert.rejects(() => client.startDeviceFlow({ signal: controller.signal }), (error: unknown) => {
    assert.ok(error instanceof CodexAuthClientError)
    assert.equal(error.code, "aborted")
    assert.doesNotMatch(error.message, /DOMException|AbortError/)
    return true
  })
})

test("refreshes access tokens with refresh token and updates expiry", async () => {
  const { fetch, calls } = createFakeFetch((url) => {
    assert.equal(url, `${issuer}/oauth/token`)
    return jsonResponse(tokenBody({ access_token: "new-access-token-secret", id_token: "new-id-token-secret", expires_in: 7200 }))
  })
  const client = createCodexAuthClient({ fetch, issuer, clientId, now })

  const refreshed = await client.refreshAuth(existingAuth())

  assert.equal(new Headers(calls[0]?.init.headers).get("content-type"), "application/x-www-form-urlencoded")
  assert.equal(typeof calls[0]?.init.body, "string")
  assert.deepEqual(calls[0]?.body, {
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: "refresh-token-secret-value",
  })
  assert.equal(refreshed.accessToken, "new-access-token-secret")
  assert.equal(refreshed.refreshToken, "refresh-token-secret-value")
  assert.equal(refreshed.idToken, "new-id-token-secret")
  assert.equal(refreshed.expiresAt, "2026-06-04T02:00:00.000Z")
  assert.equal(refreshed.createdAt, "2026-06-03T23:00:00.000Z")
  assert.equal(refreshed.updatedAt, "2026-06-04T00:00:00.000Z")
})

test("refresh failure is classified as setup-required and never leaks raw tokens", async () => {
  const { fetch } = createFakeFetch(() => jsonResponse({
    error: "invalid_grant",
    error_description: "refresh_token=refresh-token-secret-value access_token=old-access-token-secret",
  }, { status: 400 }))
  const client = createCodexAuthClient({ fetch, issuer, clientId, now })

  await assert.rejects(() => client.refreshAuth(existingAuth()), (error: unknown) => {
    assert.ok(error instanceof CodexAuthClientError)
    const authError = error as CodexAuthClientError
    assert.equal(authError.code, "setup-required")
    assert.match(authError.message, /refresh failed/i)
    assert.doesNotMatch(authError.message, /refresh-token-secret-value|old-access-token-secret/)
    return true
  })
})
