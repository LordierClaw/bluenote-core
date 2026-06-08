import type {
  AiChatCompletionRequest,
  AiCompletionResult,
  AiTokenUsage,
  OpenAiCompatibleChatCompletionRequestBody,
  OpenAiCompatibleChatCompletionResponse,
} from "./types"

export type OpenAiCompatibleFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export interface OpenAiCompatibleClientOptions {
  fetch: OpenAiCompatibleFetch
}

export interface OpenAiCompatibleClient {
  createChatCompletion(request: AiChatCompletionRequest): Promise<AiCompletionResult>
}

export class OpenAiCompatibleClientError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options)
    this.name = "OpenAiCompatibleClientError"
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "")
}

function requireOpenAiCompatibleRequestField(value: string | undefined, fieldName: "baseUrl" | "apiKey"): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new OpenAiCompatibleClientError(`OpenAI-compatible provider request is missing ${fieldName}.`)
  }

  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readProviderErrorType(body: unknown): string | undefined {
  if (!isRecord(body) || !isRecord(body.error)) {
    return undefined
  }

  const type = body.error.type ?? body.error.code
  return typeof type === "string" && type.trim() !== "" ? type : undefined
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    throw new OpenAiCompatibleClientError("Malformed OpenAI-compatible provider response: expected JSON.", {
      cause: error,
    })
  }
}

async function tryReadJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

function normalizeUsage(usage: OpenAiCompatibleChatCompletionResponse["usage"]): AiTokenUsage | undefined {
  if (!usage || !isRecord(usage)) {
    return undefined
  }

  const normalized: AiTokenUsage = {}
  if (typeof usage.prompt_tokens === "number") {
    normalized.promptTokens = usage.prompt_tokens
  }
  if (typeof usage.completion_tokens === "number") {
    normalized.completionTokens = usage.completion_tokens
  }
  if (typeof usage.total_tokens === "number") {
    normalized.totalTokens = usage.total_tokens
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function normalizeResponse(body: unknown, response: Response): AiCompletionResult {
  if (!isRecord(body)) {
    throw new OpenAiCompatibleClientError("Malformed OpenAI-compatible provider response: expected a JSON object.")
  }

  const providerResponse = body as OpenAiCompatibleChatCompletionResponse
  const content = providerResponse.choices?.[0]?.message?.content
  if (typeof content !== "string") {
    throw new OpenAiCompatibleClientError(
      "Malformed OpenAI-compatible provider response: missing choices[0].message.content.",
    )
  }

  const result: AiCompletionResult = { text: content }
  const usage = normalizeUsage(providerResponse.usage)
  if (usage) {
    result.usage = usage
  }

  const requestId = response.headers.get("x-request-id") ?? response.headers.get("openai-request-id")
  if (requestId) {
    result.providerRequestId = requestId
  }

  return result
}

export function createOpenAiCompatibleClient(options: OpenAiCompatibleClientOptions): OpenAiCompatibleClient {
  return {
    async createChatCompletion(request: AiChatCompletionRequest): Promise<AiCompletionResult> {
      const baseUrl = requireOpenAiCompatibleRequestField(request.baseUrl, "baseUrl")
      const apiKey = requireOpenAiCompatibleRequestField(request.apiKey, "apiKey")
      const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`
      const body: OpenAiCompatibleChatCompletionRequestBody = {
        model: request.model,
        messages: request.messages,
      }

      const response = await options.fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const responseBody = await tryReadJson(response)
        const providerErrorType = readProviderErrorType(responseBody)
        const providerContext = providerErrorType ? ` (${providerErrorType})` : ""
        throw new OpenAiCompatibleClientError(
          `OpenAI-compatible provider request failed with status ${response.status}${providerContext}.`,
        )
      }

      const responseBody = await readJson(response)
      return normalizeResponse(responseBody, response)
    },
  }
}
