export type AiChatMessageRole = "system" | "user" | "assistant"

export interface AiChatMessage {
  role: AiChatMessageRole
  content: string
}

export interface AiChatCompletionRequest {
  baseUrl?: string
  apiKey?: string
  model: string
  messages: AiChatMessage[]
}

export interface AiTokenUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export interface AiCompletionResult {
  text: string
  usage?: AiTokenUsage
  providerRequestId?: string
}

export interface OpenAiCompatibleChatCompletionRequestBody {
  model: string
  messages: AiChatMessage[]
}

export interface OpenAiCompatibleChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown
    }
  }>
  usage?: {
    prompt_tokens?: unknown
    completion_tokens?: unknown
    total_tokens?: unknown
  }
}
