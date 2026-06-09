import type { CodexAuth } from "./codex-auth-repository"
import { sanitizeAiErrorMessage } from "./error-redaction"
import type { AiChatCompletionRequest, AiCompletionResult, AiTokenUsage } from "./types"

export type CodexProviderFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface CodexTextGenerationAuthProvider {
  getAccessToken?: () => Promise<string | null>
  getAuth?: () => Promise<CodexAuth | null>
  refreshAuth?: (auth: CodexAuth) => Promise<CodexAuth>
}

export interface CodexTextGenerationClientOptions {
  fetch: CodexProviderFetch
  auth: CodexTextGenerationAuthProvider
  model: string
  baseUrl?: string
  now?: () => Date
}

export class CodexTextGenerationClientError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message)
    this.name = "CodexTextGenerationClientError"
    if (options.cause !== undefined) {
      this.cause = options.cause
    }
  }
}

const DEFAULT_CODEX_RESPONSES_BASE_URL = "https://chatgpt.com/backend-api/codex"
const REFRESH_SKEW_MS = 5 * 60 * 1000

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const payload = token.split(".")[1]
  if (!payload) {
    return undefined
  }

  try {
    const normalized = payload.replace(/-/gu, "+").replace(/_/gu, "/")
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=")
    const decoded = JSON.parse(Buffer.from(padded, "base64").toString("utf8"))
    return isRecord(decoded) ? decoded : undefined
  } catch {
    return undefined
  }
}

function getChatGptAccountId(auth: CodexAuth): string | undefined {
  const payload = decodeJwtPayload(auth.idToken)
  if (!payload) {
    return undefined
  }

  const accountId = payload.chatgpt_account_id ?? payload.account_id
  return typeof accountId === "string" && accountId.trim() !== "" ? accountId : undefined
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/u, "")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getString(input: Record<string, unknown>, field: string): string | undefined {
  const value = input[field]
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

async function tryReadJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

function providerErrorType(body: unknown): string | undefined {
  if (!isRecord(body)) {
    return undefined
  }
  if (isRecord(body.error)) {
    return getString(body.error, "type") ?? getString(body.error, "code")
  }
  return getString(body, "error") ?? getString(body, "code")
}

function providerErrorMessage(body: unknown): string | undefined {
  if (!isRecord(body)) {
    return undefined
  }
  if (isRecord(body.error)) {
    return [getString(body.error, "type"), getString(body.error, "code"), getString(body.error, "message")].filter(Boolean).join(" ")
  }
  return [getString(body, "error"), getString(body, "error_description"), getString(body, "message"), getString(body, "detail")].filter(Boolean).join(" ")
}

function normalizeCodexModel(model: string): string {
  return model.trim().replace(/\s+/gu, "-")
}

function buildInstructions(messages: AiChatCompletionRequest["messages"]): string {
  return messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n\n")
}

function buildInput(messages: AiChatCompletionRequest["messages"]): Array<Record<string, unknown>> {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      type: "message",
      role: message.role,
      content: [{ type: "input_text", text: message.content }],
    }))
}

function normalizeUsage(usage: unknown): AiTokenUsage | undefined {
  if (!isRecord(usage)) {
    return undefined
  }

  const normalized: AiTokenUsage = {}
  const inputTokens = usage.input_tokens ?? usage.prompt_tokens
  const outputTokens = usage.output_tokens ?? usage.completion_tokens
  const totalTokens = usage.total_tokens

  if (typeof inputTokens === "number") {
    normalized.promptTokens = inputTokens
  }
  if (typeof outputTokens === "number") {
    normalized.completionTokens = outputTokens
  }
  if (typeof totalTokens === "number") {
    normalized.totalTokens = totalTokens
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function normalizeSseResponse(text: string): { body: Record<string, unknown>; requestId?: string } {
  const outputDeltas: string[] = []
  let outputDone: string | undefined
  let completedResponse: Record<string, unknown> | undefined

  for (const block of text.split(/\n\n/u)) {
    for (const line of block.split(/\n/u)) {
      if (!line.startsWith("data:")) {
        continue
      }
      const data = line.slice("data:".length).trim()
      if (data === "" || data === "[DONE]") {
        continue
      }

      let event: unknown
      try {
        event = JSON.parse(data)
      } catch {
        continue
      }
      if (!isRecord(event)) {
        continue
      }

      const type = getString(event, "type")
      if (type === "response.output_text.delta" && typeof event.delta === "string") {
        outputDeltas.push(event.delta)
      } else if (type === "response.output_text.done" && typeof event.text === "string") {
        outputDone = event.text
      } else if (type === "response.completed" && isRecord(event.response)) {
        completedResponse = event.response
      }
    }
  }

  const textOutput = outputDone ?? outputDeltas.join("")
  const body: Record<string, unknown> = {
    output_text: textOutput,
    usage: completedResponse?.usage,
  }

  return { body, requestId: completedResponse ? getString(completedResponse, "id") : undefined }
}

async function readCodexResponseBody(response: Response): Promise<{ body: unknown; requestId?: string }> {
  const rawText = await response.text()
  const trimmed = rawText.trimStart()
  if (trimmed.startsWith("event:") || trimmed.startsWith("data:")) {
    return normalizeSseResponse(rawText)
  }

  try {
    return { body: JSON.parse(rawText) }
  } catch (error) {
    throw new CodexTextGenerationClientError("Malformed Codex provider response: expected JSON or SSE.", { cause: error })
  }
}

function readOutputText(body: Record<string, unknown>): string | undefined {
  const direct = body.output_text
  if (typeof direct === "string") {
    return direct
  }

  const output = body.output
  if (Array.isArray(output)) {
    const parts: string[] = []
    for (const item of output) {
      if (!isRecord(item) || !Array.isArray(item.content)) {
        continue
      }
      for (const content of item.content) {
        if (!isRecord(content)) {
          continue
        }
        const text = content.text
        if (typeof text === "string") {
          parts.push(text)
        }
      }
    }
    if (parts.length > 0) {
      return parts.join("")
    }
  }

  const choices = body.choices
  if (Array.isArray(choices)) {
    const first = choices[0]
    if (isRecord(first) && isRecord(first.message) && typeof first.message.content === "string") {
      return first.message.content
    }
  }

  return undefined
}

function normalizeResponse(body: unknown, response: Response, providerRequestId?: string): AiCompletionResult {
  if (!isRecord(body)) {
    throw new CodexTextGenerationClientError("Malformed Codex provider response: expected a JSON object.")
  }

  const text = readOutputText(body)
  if (typeof text !== "string") {
    throw new CodexTextGenerationClientError("Malformed Codex provider response: missing output text.")
  }

  const result: AiCompletionResult = { text }
  const usage = normalizeUsage(body.usage)
  if (usage) {
    result.usage = usage
  }

  const requestId = response.headers.get("x-request-id") ?? response.headers.get("openai-request-id") ?? providerRequestId
  if (requestId) {
    result.providerRequestId = requestId
  }

  return result
}

function isNearExpired(auth: CodexAuth, now: Date): boolean {
  const expiresAt = new Date(auth.expiresAt).getTime()
  return Number.isNaN(expiresAt) || expiresAt - now.getTime() <= REFRESH_SKEW_MS
}

async function getAccessToken(options: CodexTextGenerationClientOptions): Promise<{ token: string; secrets: string[]; accountId?: string }> {
  if (options.auth.getAuth) {
    let auth: CodexAuth | null
    try {
      auth = await options.auth.getAuth()
    } catch (error) {
      throw new CodexTextGenerationClientError(`Codex auth setup is required: ${sanitizeAiErrorMessage(error)}. Run bn ai codex auth login.`, { cause: error })
    }

    if (!auth) {
      throw new CodexTextGenerationClientError("Codex auth setup is required. Run bn ai codex auth login.")
    }

    const originalSecrets = [auth.accessToken, auth.refreshToken, auth.idToken]
    if (isNearExpired(auth, options.now?.() ?? new Date())) {
      if (!options.auth.refreshAuth) {
        throw new CodexTextGenerationClientError("Codex auth is expired or near expiry. Run bn ai codex auth login.")
      }
      try {
        auth = await options.auth.refreshAuth(auth)
      } catch (error) {
        throw new CodexTextGenerationClientError(`Codex auth refresh failed: ${sanitizeAiErrorMessage(error, originalSecrets)}. Run bn ai codex auth login.`, { cause: error })
      }
    }

    return { token: auth.accessToken, accountId: getChatGptAccountId(auth), secrets: [...originalSecrets, auth.accessToken, auth.refreshToken, auth.idToken] }
  }

  if (options.auth.getAccessToken) {
    const token = await options.auth.getAccessToken()
    if (!token) {
      throw new CodexTextGenerationClientError("Codex auth setup is required. Run bn ai codex auth login.")
    }
    return { token, secrets: [token] }
  }

  throw new CodexTextGenerationClientError("Codex auth setup is required. Run bn ai codex auth login.")
}

export function createCodexTextGenerationClient(options: CodexTextGenerationClientOptions) {
  return {
    async createChatCompletion(request: AiChatCompletionRequest): Promise<AiCompletionResult> {
      const auth = await getAccessToken(options)
      const url = `${normalizeBaseUrl(options.baseUrl ?? DEFAULT_CODEX_RESPONSES_BASE_URL)}/responses`
      const body = {
        model: normalizeCodexModel(options.model),
        instructions: buildInstructions(request.messages),
        input: buildInput(request.messages),
        tools: [],
        tool_choice: "none",
        parallel_tool_calls: false,
        store: false,
        stream: true,
      }

      let response: Response
      const headers: Record<string, string> = {
        authorization: `Bearer ${auth.token}`,
        "content-type": "application/json",
      }
      if (auth.accountId) {
        headers["ChatGPT-Account-ID"] = auth.accountId
      }

      try {
        response = await options.fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        })
      } catch (error) {
        throw new CodexTextGenerationClientError(`Codex provider request failed: ${sanitizeAiErrorMessage(error, auth.secrets)}`, { cause: error })
      }

      if (!response.ok) {
        const responseBody = await tryReadJson(response)
        const context = providerErrorType(responseBody) ? ` (${providerErrorType(responseBody)})` : ""
        const details = sanitizeAiErrorMessage(providerErrorMessage(responseBody) ?? response.statusText, auth.secrets)
        throw new CodexTextGenerationClientError(
          `Codex provider request failed with status ${response.status}${context}: ${details}.`,
        )
      }

      const { body: responseBody, requestId } = await readCodexResponseBody(response)
      try {
        return normalizeResponse(responseBody, response, requestId)
      } catch (error) {
        throw new CodexTextGenerationClientError(sanitizeAiErrorMessage(error, auth.secrets), { cause: error })
      }
    },
  }
}
