import path from "node:path";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { UsageError } from "../core/errors.js";
import { replaceFileAtomically } from "../storage/atomic-replace.js";
import { getAiStatePath } from "../storage/root-layout.js";
import { sanitizeCodexAuthErrorMessage } from "./error-redaction.js";
const CODEX_AUTH_FILENAME = "codex-auth.json";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function getTemporaryAuthPath(authPath) {
    return `${authPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
}
function removeTemporaryAuth(authPath) {
    try {
        rmSync(authPath, { force: true });
    }
    catch {
        // Best-effort cleanup must not hide the original write error.
    }
}
function relativeAuthPath(rootPath, authPath) {
    return path.relative(rootPath, authPath) || authPath;
}
function invalidCodexAuth(sourcePath, message) {
    throw new UsageError(`Invalid Codex auth '${sourcePath}': ${sanitizeCodexAuthErrorMessage(message)}.`, {
        hint: "Run bn ai codex auth login to create a fresh local auth file.",
    });
}
function requireStringField(input, fieldName, sourcePath) {
    const value = input[fieldName];
    if (typeof value !== "string" || value.trim() === "") {
        invalidCodexAuth(sourcePath, `${fieldName} must be a non-empty string`);
    }
    return value;
}
function requireIsoDateField(input, fieldName, sourcePath) {
    const value = requireStringField(input, fieldName, sourcePath);
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
        invalidCodexAuth(sourcePath, `${fieldName} must be an ISO timestamp`);
    }
    return value;
}
function requireUrlField(input, fieldName, sourcePath) {
    const value = requireStringField(input, fieldName, sourcePath);
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
            invalidCodexAuth(sourcePath, `${fieldName} must use http:// or https://`);
        }
    }
    catch (error) {
        throw new UsageError(`Invalid Codex auth '${sourcePath}': ${fieldName} must be a valid URL.`, {
            hint: "Run bn ai codex auth login to create a fresh local auth file.",
            cause: error,
        });
    }
    return value;
}
export function getCodexAuthPath(rootPath) {
    return path.join(getAiStatePath(path.resolve(rootPath)), CODEX_AUTH_FILENAME);
}
export function validateCodexAuth(input, sourcePath) {
    if (!isRecord(input)) {
        invalidCodexAuth(sourcePath, "expected a JSON object");
    }
    if (input.version !== 1) {
        invalidCodexAuth(sourcePath, "version must be 1");
    }
    if (input.provider !== "codex") {
        invalidCodexAuth(sourcePath, "provider must be codex");
    }
    if (input.authType !== "device-code-oauth") {
        invalidCodexAuth(sourcePath, "authType must be device-code-oauth");
    }
    return {
        version: 1,
        provider: "codex",
        authType: "device-code-oauth",
        idToken: requireStringField(input, "idToken", sourcePath),
        accessToken: requireStringField(input, "accessToken", sourcePath),
        refreshToken: requireStringField(input, "refreshToken", sourcePath),
        expiresAt: requireIsoDateField(input, "expiresAt", sourcePath),
        createdAt: requireIsoDateField(input, "createdAt", sourcePath),
        updatedAt: requireIsoDateField(input, "updatedAt", sourcePath),
        issuer: requireUrlField(input, "issuer", sourcePath),
        clientId: requireStringField(input, "clientId", sourcePath),
    };
}
export function formatCodexAuthStatus(status) {
    switch (status.state) {
        case "not-configured":
            return "Codex auth not configured.";
        case "setup-required":
            return "Codex auth setup required. Run bn ai codex auth login.";
        case "authenticated":
            return `Codex auth authenticated. Expires at ${status.expiresAt}.`;
        case "expired":
            return `Codex auth expired. ${status.hint}`;
        case "invalid":
            return `Codex auth invalid. ${status.hint}`;
    }
}
export function createCodexAuthRepository(rootPath, options = {}) {
    const normalizedRootPath = path.resolve(rootPath);
    const authPath = getCodexAuthPath(normalizedRootPath);
    const relativePath = relativeAuthPath(normalizedRootPath, authPath);
    const now = options.now ?? (() => new Date());
    function readAuth() {
        let rawJson;
        try {
            rawJson = readFileSync(authPath, "utf8");
        }
        catch (error) {
            throw new UsageError(`Could not read Codex auth '${relativePath}'.`, {
                hint: "Run bn ai codex auth login if Codex is the selected AI provider.",
                cause: error,
            });
        }
        let parsed;
        try {
            parsed = JSON.parse(rawJson);
        }
        catch (error) {
            throw new UsageError(`Could not parse Codex auth '${relativePath}'.`, {
                hint: "Run bn ai codex auth login to create a fresh local auth file.",
                cause: error,
            });
        }
        return validateCodexAuth(parsed, relativePath);
    }
    return {
        exists() {
            return existsSync(authPath);
        },
        read() {
            return readAuth();
        },
        write(auth) {
            const canonicalAuth = validateCodexAuth(auth, relativePath);
            const temporaryAuthPath = getTemporaryAuthPath(authPath);
            try {
                mkdirSync(path.dirname(authPath), { recursive: true });
                writeFileSync(temporaryAuthPath, `${JSON.stringify(canonicalAuth, null, 2)}\n`, {
                    encoding: "utf8",
                    mode: 0o600,
                });
                replaceFileAtomically(temporaryAuthPath, authPath);
                try {
                    chmodSync(authPath, 0o600);
                }
                catch {
                    // Restrictive mode is best effort on filesystems/platforms that support it.
                }
            }
            catch (error) {
                removeTemporaryAuth(temporaryAuthPath);
                throw new UsageError(`Could not write Codex auth '${relativePath}'.`, {
                    hint: "Ensure BLUENOTE_ROOT points to a writable directory path.",
                    cause: error,
                });
            }
            return authPath;
        },
        delete() {
            try {
                rmSync(authPath, { force: true });
            }
            catch (error) {
                throw new UsageError(`Could not delete Codex auth '${relativePath}'.`, {
                    hint: "Ensure BLUENOTE_ROOT points to a writable directory path.",
                    cause: error,
                });
            }
        },
        getStatus(selection) {
            if (!existsSync(authPath)) {
                return selection.provider === "codex" ? { state: "setup-required" } : { state: "not-configured" };
            }
            try {
                const auth = readAuth();
                if (new Date(auth.expiresAt).getTime() <= now().getTime()) {
                    return { state: "expired", hint: "Run bn ai codex auth login." };
                }
                return { state: "authenticated", expiresAt: auth.expiresAt, issuer: auth.issuer };
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    state: "invalid",
                    message: sanitizeCodexAuthErrorMessage(message),
                    hint: "Run bn ai codex auth login to create a fresh local auth file.",
                };
            }
        },
    };
}
//# sourceMappingURL=codex-auth-repository.js.map