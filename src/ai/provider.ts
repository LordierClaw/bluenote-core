import { UsageError } from "../core/errors"
import type { AiConfig } from "./config-schema"
import { createCodexTextGenerationClient, type CodexProviderFetch, type CodexTextGenerationAuthProvider } from "./codex-client"
import type { CodexAuth } from "./codex-auth-repository"
import { createOpenAiCompatibleClient, type OpenAiCompatibleFetch } from "./openai-compatible-client"
import type { AiChatCompletionRequest, AiCompletionResult } from "./types"

export interface AiTextGenerationClient {
  createChatCompletion(request: AiChatCompletionRequest): Promise<AiCompletionResult>
}

export interface CodexAuthProvider extends CodexTextGenerationAuthProvider {
  hasAuth?: () => boolean
  getAuth?: () => Promise<CodexAuth | null>
  refreshAuth?: (auth: CodexAuth) => Promise<CodexAuth>
  getAccessToken?: () => Promise<string | null>
}

export interface AiProviderFactoryOptions {
  fetch?: OpenAiCompatibleFetch & CodexProviderFetch
  codexAuth?: CodexAuthProvider
  now?: () => Date
}

export class CodexProviderSetupRequiredError extends UsageError {
  constructor() {
    super("Codex auth setup is required before using the Codex provider. Run bn ai codex auth status for current setup guidance.", {
      hint: "No Codex auth was run and no tokens were stored. Run bn ai codex auth login before Codex generation.",
    })
    this.name = "CodexProviderSetupRequiredError"
  }
}

export function createAiTextGenerationClient(config: AiConfig, options: AiProviderFactoryOptions = {}): AiTextGenerationClient {
  if (config.provider === "openai-compatible") {
    const client = createOpenAiCompatibleClient({ fetch: options.fetch ?? fetch })
    return {
      createChatCompletion(request) {
        return client.createChatCompletion({
          ...request,
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: config.model,
        })
      },
    }
  }

  if (!options.codexAuth || options.codexAuth.hasAuth?.() === false) {
    throw new CodexProviderSetupRequiredError()
  }

  const client = createCodexTextGenerationClient({
    fetch: options.fetch ?? fetch,
    auth: options.codexAuth,
    model: config.model,
    now: options.now,
  })

  return {
    createChatCompletion(request) {
      return client.createChatCompletion({
        ...request,
        model: config.model,
      })
    },
  }
}
