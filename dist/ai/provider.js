import { UsageError } from "../core/errors.js";
import { createCodexTextGenerationClient } from "./codex-client.js";
import { createOpenAiCompatibleClient } from "./openai-compatible-client.js";
export class CodexProviderSetupRequiredError extends UsageError {
    constructor() {
        super("Codex auth setup is required before using the Codex provider. Run bn ai codex auth status for current setup guidance.", {
            hint: "No Codex auth was run and no tokens were stored. Run bn ai codex auth login before Codex generation.",
        });
        this.name = "CodexProviderSetupRequiredError";
    }
}
export function createAiTextGenerationClient(config, options = {}) {
    if (config.provider === "openai-compatible") {
        const client = createOpenAiCompatibleClient({ fetch: options.fetch ?? fetch });
        return {
            createChatCompletion(request) {
                return client.createChatCompletion({
                    ...request,
                    baseUrl: config.baseUrl,
                    apiKey: config.apiKey,
                    model: config.model,
                });
            },
        };
    }
    if (!options.codexAuth || options.codexAuth.hasAuth?.() === false) {
        throw new CodexProviderSetupRequiredError();
    }
    const client = createCodexTextGenerationClient({
        fetch: options.fetch ?? fetch,
        auth: options.codexAuth,
        model: config.model,
        now: options.now,
    });
    return {
        createChatCompletion(request) {
            return client.createChatCompletion({
                ...request,
                model: config.model,
            });
        },
    };
}
//# sourceMappingURL=provider.js.map