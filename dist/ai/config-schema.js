import { UsageError } from "../core/errors.js";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function invalidAiConfig(sourcePath, message) {
    throw new UsageError(`Invalid AI config '${sourcePath}': ${message}.`, {
        hint: "Update the AI config with valid provider settings.",
    });
}
function requireStringField(input, fieldName, sourcePath) {
    const value = input[fieldName];
    if (typeof value !== "string" || value.trim() === "") {
        invalidAiConfig(sourcePath, `${fieldName} must be a non-empty string`);
    }
    return value;
}
function validateBaseUrl(value, sourcePath) {
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch (error) {
        throw new UsageError(`Invalid AI config '${sourcePath}': baseUrl must be a valid URL.`, {
            hint: "Set baseUrl to an absolute http:// or https:// URL for an OpenAI-compatible API.",
            cause: error,
        });
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        invalidAiConfig(sourcePath, "baseUrl must use http:// or https://");
    }
    return value;
}
function validateLogging(input, sourcePath) {
    if (!isRecord(input.logging)) {
        invalidAiConfig(sourcePath, "logging must be a JSON object");
    }
    const logging = input.logging;
    for (const fieldName of ["usage", "conversations", "results"]) {
        if (typeof logging[fieldName] !== "boolean") {
            invalidAiConfig(sourcePath, `logging.${fieldName} must be a boolean`);
        }
    }
    return {
        usage: logging.usage,
        conversations: logging.conversations,
        results: logging.results,
    };
}
function validateMaxAttempts(input, sourcePath) {
    const value = input.maxAttempts ?? 3;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 10) {
        invalidAiConfig(sourcePath, "maxAttempts must be an integer from 1 to 10");
    }
    return value;
}
function validateOutputLanguage(input, sourcePath) {
    if (input.outputLanguage === undefined) {
        return "English";
    }
    return requireStringField(input, "outputLanguage", sourcePath);
}
export function validateAiConfig(input, sourcePath) {
    if (!isRecord(input)) {
        invalidAiConfig(sourcePath, "expected a JSON object");
    }
    if (input.version !== 1) {
        invalidAiConfig(sourcePath, "version must be 1");
    }
    if (typeof input.enabled !== "boolean") {
        invalidAiConfig(sourcePath, "enabled must be a boolean");
    }
    if (input.provider !== "openai-compatible" && input.provider !== "codex") {
        invalidAiConfig(sourcePath, "provider must be openai-compatible or codex");
    }
    const model = requireStringField(input, "model", sourcePath);
    const logging = validateLogging(input, sourcePath);
    const maxAttempts = validateMaxAttempts(input, sourcePath);
    const outputLanguage = validateOutputLanguage(input, sourcePath);
    if (input.provider === "codex") {
        return {
            version: 1,
            enabled: input.enabled,
            provider: "codex",
            model,
            logging,
            maxAttempts,
            outputLanguage,
        };
    }
    const baseUrl = validateBaseUrl(requireStringField(input, "baseUrl", sourcePath), sourcePath);
    const apiKey = requireStringField(input, "apiKey", sourcePath);
    return {
        version: 1,
        enabled: input.enabled,
        provider: "openai-compatible",
        baseUrl,
        apiKey,
        model,
        logging,
        maxAttempts,
        outputLanguage,
    };
}
export function maskApiKey(value) {
    if (value.length === 0) {
        return "";
    }
    if (/^\*+$/.test(value)) {
        return value;
    }
    if (value.length <= 8) {
        return "***";
    }
    return `${value.slice(0, 3)}***${value.slice(-4)}`;
}
//# sourceMappingURL=config-schema.js.map