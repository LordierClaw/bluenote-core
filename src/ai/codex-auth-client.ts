import type { CodexAuth, CodexAuthRepository } from "./codex-auth-repository"
import { sanitizeCodexAuthErrorMessage } from "./error-redaction"

export const DEFAULT_CODEX_AUTH_ISSUER = "https://auth.openai.com"
export const DEFAULT_CODEX_AUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
export const DEFAULT_CODEX_LOGIN_TIMEOUT_MS = 15 * 60 * 1000

export type CodexAuthFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
export type CodexAuthClientErrorCode =
  | "denied"
  | "cancelled"
  | "expired"
  | "permanent"
  | "http"
  | "malformed"
  | "setup-required"
  | "aborted"

export interface CodexDeviceFlow {
  deviceAuthId: string
  userCode: string
  verificationUrl: string
  intervalSeconds: number
}

export interface CodexAuthorizationCode {
  authorizationCode: string
  codeChallenge: string
  codeVerifier: string
}

export interface CodexAuthClientOptions {
  fetch?: CodexAuthFetch
  issuer?: string
  clientId?: string
  loginTimeoutMs?: number
  now?: () => Date
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  repository?: CodexAuthRepository
}

export interface CodexLoginOptions {
  signal?: AbortSignal
  onDeviceFlow?: (flow: CodexDeviceFlow) => void | Promise<void>
}

export interface CodexAuthClient {
  startDeviceFlow(options?: { signal?: AbortSignal }): Promise<CodexDeviceFlow>
  pollDeviceFlow(flow: CodexDeviceFlow, options?: { signal?: AbortSignal }): Promise<CodexAuthorizationCode>
  exchangeAuthorizationCode(code: CodexAuthorizationCode, options?: { signal?: AbortSignal }): Promise<CodexAuth>
  completeDeviceFlow(flow: CodexDeviceFlow, options?: { signal?: AbortSignal }): Promise<CodexAuth>
  login(options?: CodexLoginOptions): Promise<CodexAuth>
  refreshAuth(auth: CodexAuth, options?: { signal?: AbortSignal }): Promise<CodexAuth>
}

export class CodexAuthClientError extends Error {
  code: CodexAuthClientErrorCode

  constructor(code: CodexAuthClientErrorCode, message: string, options: ErrorOptions = {}) {
    super(message, options)
    this.name = "CodexAuthClientError"
    this.code = code
  }
}

function normalizeIssuer(issuer: string): string {
  return issuer.replace(/\/+$/u, "")
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CodexAuthClientError("aborted", "Codex auth request was cancelled."))
      return
    }

    let timeout: ReturnType<typeof setTimeout>
    const cleanup = () => {
      if (signal) {
        signal.removeEventListener("abort", onAbort)
      }
    }
    const onAbort = () => {
      clearTimeout(timeout)
      cleanup()
      reject(new CodexAuthClientError("aborted", "Codex auth request was cancelled."))
    }

    timeout = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field]
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function requireString(body: Record<string, unknown>, field: string, context: string): string {
  const value = getString(body, field)
  if (!value) {
    throw new CodexAuthClientError("malformed", `Malformed Codex auth ${context}: missing ${field}.`)
  }

  return value
}

function readUserCode(body: Record<string, unknown>): string {
  const value = getString(body, "user_code") ?? getString(body, "usercode")
  if (!value) {
    throw new CodexAuthClientError("malformed", "Malformed Codex device auth response: missing user_code.")
  }

  return value
}

function readIntervalSeconds(body: Record<string, unknown>): number {
  const value = body.interval
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 5
}

async function readJson(response: Response, context: string): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    throw new CodexAuthClientError("malformed", `Malformed Codex auth ${context}: expected JSON.`, { cause: error })
  }
}

async function tryReadJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

function providerErrorText(body: unknown): string | undefined {
  if (!isRecord(body)) {
    return undefined
  }

  if (isRecord(body.error)) {
    return [getString(body.error, "code"), getString(body.error, "type"), getString(body.error, "message")].filter(Boolean).join(" ")
  }

  return [getString(body, "error"), getString(body, "error_description"), getString(body, "status")].filter(Boolean).join(" ")
}

function classifyDeviceError(status: number, body: unknown): CodexAuthClientErrorCode | "pending" {
  const text = (providerErrorText(body) ?? "").toLowerCase()

  if (text.includes("access_denied") || text.includes("authorization_declined") || text.includes("denied")) {
    return "denied"
  }
  if (text.includes("cancel")) {
    return "cancelled"
  }
  if (text.includes("expired")) {
    return "expired"
  }
  if (status === 403 || status === 404 || text.includes("authorization_pending")) {
    return "pending"
  }
  if (status >= 400 && status < 500) {
    return "permanent"
  }

  return "http"
}

function sanitizeForError(error: unknown, secrets: string[]): string {
  return sanitizeCodexAuthErrorMessage(error, secrets)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new CodexAuthClientError("aborted", "Codex auth request was cancelled.")
  }
}

function buildAuthFromTokenResponse(input: {
  body: unknown
  now: Date
  issuer: string
  clientId: string
  existing?: CodexAuth
}): CodexAuth {
  if (!isRecord(input.body)) {
    throw new CodexAuthClientError("malformed", "Malformed Codex token response: expected a JSON object.")
  }

  const accessToken = requireString(input.body, "access_token", "token response")
  const refreshToken = getString(input.body, "refresh_token") ?? input.existing?.refreshToken
  const idToken = getString(input.body, "id_token") ?? input.existing?.idToken
  const expiresIn = input.body.expires_in

  if (!refreshToken) {
    throw new CodexAuthClientError("malformed", "Malformed Codex token response: missing refresh_token.")
  }
  if (!idToken) {
    throw new CodexAuthClientError("malformed", "Malformed Codex token response: missing id_token.")
  }
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new CodexAuthClientError("malformed", "Malformed Codex token response: missing expires_in.")
  }

  const timestamp = input.now.toISOString()
  return {
    version: 1,
    provider: "codex",
    authType: "device-code-oauth",
    idToken,
    accessToken,
    refreshToken,
    expiresAt: new Date(input.now.getTime() + expiresIn * 1000).toISOString(),
    createdAt: input.existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    issuer: input.issuer,
    clientId: input.clientId,
  }
}

export function createCodexAuthClient(options: CodexAuthClientOptions = {}): CodexAuthClient {
  const fetchImpl = options.fetch ?? fetch
  const issuer = normalizeIssuer(options.issuer ?? DEFAULT_CODEX_AUTH_ISSUER)
  const clientId = options.clientId ?? DEFAULT_CODEX_AUTH_CLIENT_ID
  const timeoutMs = Math.max(0, Math.min(options.loginTimeoutMs ?? DEFAULT_CODEX_LOGIN_TIMEOUT_MS, DEFAULT_CODEX_LOGIN_TIMEOUT_MS))
  const now = options.now ?? (() => new Date())
  const sleep = options.sleep ?? defaultSleep
  const secretsForFlow = (flow: CodexDeviceFlow): string[] => [flow.deviceAuthId, flow.userCode]

  async function request(input: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    try {
      return await fetchImpl(input, { ...init, signal })
    } catch (error) {
      if (signal?.aborted) {
        throw new CodexAuthClientError("aborted", "Codex auth request was cancelled.", { cause: error })
      }
      throw error
    }
  }

  async function startDeviceFlow(startOptions: { signal?: AbortSignal } = {}): Promise<CodexDeviceFlow> {
    throwIfAborted(startOptions.signal)
    const response = await request(`${issuer}/api/accounts/deviceauth/usercode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: clientId }),
    }, startOptions.signal)

    if (!response.ok) {
      const body = await tryReadJson(response)
      throw new CodexAuthClientError(
        "http",
        `Codex device auth start failed with status ${response.status}: ${sanitizeForError(providerErrorText(body) ?? response.statusText, [])}.`,
      )
    }

    const body = await readJson(response, "device auth response")
    if (!isRecord(body)) {
      throw new CodexAuthClientError("malformed", "Malformed Codex device auth response: expected a JSON object.")
    }

    return {
      deviceAuthId: requireString(body, "device_auth_id", "device auth response"),
      userCode: readUserCode(body),
      verificationUrl: `${issuer}/codex/device`,
      intervalSeconds: readIntervalSeconds(body),
    }
  }

  async function pollDeviceFlow(flow: CodexDeviceFlow, pollOptions: { signal?: AbortSignal } = {}): Promise<CodexAuthorizationCode> {
    const deadline = now().getTime() + timeoutMs
    const secrets = secretsForFlow(flow)

    while (true) {
      throwIfAborted(pollOptions.signal)
      if (now().getTime() >= deadline) {
        throw new CodexAuthClientError("expired", "Codex device auth timed out. Run bn ai codex auth login again.")
      }

      const response = await request(`${issuer}/api/accounts/deviceauth/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_auth_id: flow.deviceAuthId, user_code: flow.userCode }),
      }, pollOptions.signal)
      const body = await tryReadJson(response)

      if (response.ok) {
        if (!isRecord(body)) {
          throw new CodexAuthClientError("malformed", "Malformed Codex device auth token response: expected a JSON object.")
        }

        return {
          authorizationCode: requireString(body, "authorization_code", "device auth token response"),
          codeChallenge: requireString(body, "code_challenge", "device auth token response"),
          codeVerifier: requireString(body, "code_verifier", "device auth token response"),
        }
      }

      const code = classifyDeviceError(response.status, body)
      if (code === "pending") {
        const remainingMs = Math.max(0, deadline - now().getTime())
        await sleep(Math.min(flow.intervalSeconds * 1000, remainingMs), pollOptions.signal)
        continue
      }

      throw new CodexAuthClientError(
        code,
        `Codex device auth failed with status ${response.status}: ${sanitizeForError(providerErrorText(body) ?? response.statusText, secrets)}.`,
      )
    }
  }

  async function exchangeAuthorizationCode(code: CodexAuthorizationCode, exchangeOptions: { signal?: AbortSignal } = {}): Promise<CodexAuth> {
    throwIfAborted(exchangeOptions.signal)
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code: code.authorizationCode,
      redirect_uri: `${issuer}/deviceauth/callback`,
      client_id: clientId,
      code_verifier: code.codeVerifier,
    })
    const response = await request(`${issuer}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    }, exchangeOptions.signal)
    const body = await tryReadJson(response)
    const secrets = [code.authorizationCode, code.codeChallenge, code.codeVerifier]

    if (!response.ok) {
      throw new CodexAuthClientError(
        "http",
        `Codex token exchange failed with status ${response.status}: ${sanitizeForError(providerErrorText(body) ?? response.statusText, secrets)}.`,
      )
    }

    return buildAuthFromTokenResponse({ body, now: now(), issuer, clientId })
  }

  async function completeDeviceFlow(flow: CodexDeviceFlow, completeOptions: { signal?: AbortSignal } = {}): Promise<CodexAuth> {
    const code = await pollDeviceFlow(flow, completeOptions)
    return exchangeAuthorizationCode(code, completeOptions)
  }

  return {
    startDeviceFlow,
    pollDeviceFlow,
    exchangeAuthorizationCode,
    completeDeviceFlow,

    async login(loginOptions = {}) {
      const flow = await startDeviceFlow(loginOptions)
      await loginOptions.onDeviceFlow?.(flow)
      const auth = await completeDeviceFlow(flow, loginOptions)
      options.repository?.write(auth)
      return auth
    },

    async refreshAuth(auth, refreshOptions = {}) {
      throwIfAborted(refreshOptions.signal)
      const form = new URLSearchParams({
        client_id: auth.clientId || clientId,
        grant_type: "refresh_token",
        refresh_token: auth.refreshToken,
      })
      const response = await request(`${issuer}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      }, refreshOptions.signal)
      const body = await tryReadJson(response)
      const secrets = [auth.accessToken, auth.refreshToken, auth.idToken]

      if (!response.ok) {
        throw new CodexAuthClientError(
          "setup-required",
          `Codex token refresh failed with status ${response.status}: ${sanitizeForError(providerErrorText(body) ?? response.statusText, secrets)}. Run bn ai codex auth login.`,
        )
      }

      return buildAuthFromTokenResponse({ body, now: now(), issuer: auth.issuer || issuer, clientId: auth.clientId || clientId, existing: auth })
    },
  }
}
