function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
export function sanitizeAiErrorMessage(error, secrets = []) {
    const raw = error instanceof Error ? error.message : String(error);
    const redactedSecrets = secrets
        .filter((secret) => secret.length > 0)
        .reduce((message, secret) => message.replace(new RegExp(escapeRegex(secret), "gu"), "[redacted]"), raw);
    return redactedSecrets
        .replace(/sk-[A-Za-z0-9_-]+/gu, "[redacted]")
        .replace(/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu, "[redacted]")
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
        .replace(/["']?\b((?:access|refresh|id)[_-]?token)\b["']?\s*[:=]\s*["']?[^"'\s,}]+/giu, "$1=[redacted]")
        .replace(/\*{3,}/gu, "[redacted]")
        .slice(0, 80);
}
export function sanitizeCodexAuthErrorMessage(error, secrets = []) {
    return sanitizeAiErrorMessage(error, secrets);
}
//# sourceMappingURL=error-redaction.js.map