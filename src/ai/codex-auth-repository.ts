import path from "node:path"
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"

import { UsageError } from "../core/errors"
import { replaceFileAtomically } from "../storage/atomic-replace"
import { getAiStatePath } from "../storage/root-layout"
import { sanitizeCodexAuthErrorMessage } from "./error-redaction"

const CODEX_AUTH_FILENAME = "codex-auth.json"

export type CodexAuthStatusState = "not-configured" | "setup-required" | "authenticated" | "expired" | "invalid"

export interface CodexAuth {
  version: 1
  provider: "codex"
  authType: "device-code-oauth"
  idToken: string
  accessToken: string
  refreshToken: string
  expiresAt: string
  createdAt: string
  updatedAt: string
  issuer: string
  clientId: string
}

export type CodexAuthStatus =
  | { state: "not-configured" }
  | { state: "setup-required" }
  | { state: "authenticated"; expiresAt: string; issuer: string }
  | { state: "expired"; hint: string }
  | { state: "invalid"; message: string; hint: string }

export interface CodexAuthRepository {
  exists(): boolean
  read(): CodexAuth
  write(auth: CodexAuth): string
  delete(): void
  getStatus(selection: { provider: "codex" | "openai-compatible" }): CodexAuthStatus
}

export interface CodexAuthRepositoryOptions {
  now?: () => Date
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getTemporaryAuthPath(authPath: string): string {
  return `${authPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
}

function removeTemporaryAuth(authPath: string): void {
  try {
    rmSync(authPath, { force: true })
  } catch {
    // Best-effort cleanup must not hide the original write error.
  }
}

function relativeAuthPath(rootPath: string, authPath: string): string {
  return path.relative(rootPath, authPath) || authPath
}

function invalidCodexAuth(sourcePath: string, message: string): never {
  throw new UsageError(`Invalid Codex auth '${sourcePath}': ${sanitizeCodexAuthErrorMessage(message)}.`, {
    hint: "Run bn ai codex auth login to create a fresh local auth file.",
  })
}

function requireStringField(input: Record<string, unknown>, fieldName: keyof CodexAuth, sourcePath: string): string {
  const value = input[fieldName]

  if (typeof value !== "string" || value.trim() === "") {
    invalidCodexAuth(sourcePath, `${fieldName} must be a non-empty string`)
  }

  return value
}

function requireIsoDateField(input: Record<string, unknown>, fieldName: "expiresAt" | "createdAt" | "updatedAt", sourcePath: string): string {
  const value = requireStringField(input, fieldName, sourcePath)
  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    invalidCodexAuth(sourcePath, `${fieldName} must be an ISO timestamp`)
  }

  return value
}

function requireUrlField(input: Record<string, unknown>, fieldName: "issuer", sourcePath: string): string {
  const value = requireStringField(input, fieldName, sourcePath)

  try {
    const parsed = new URL(value)
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      invalidCodexAuth(sourcePath, `${fieldName} must use http:// or https://`)
    }
  } catch (error) {
    throw new UsageError(`Invalid Codex auth '${sourcePath}': ${fieldName} must be a valid URL.`, {
      hint: "Run bn ai codex auth login to create a fresh local auth file.",
      cause: error,
    })
  }

  return value
}

export function getCodexAuthPath(rootPath: string): string {
  return path.join(getAiStatePath(path.resolve(rootPath)), CODEX_AUTH_FILENAME)
}

export function validateCodexAuth(input: unknown, sourcePath: string): CodexAuth {
  if (!isRecord(input)) {
    invalidCodexAuth(sourcePath, "expected a JSON object")
  }

  if (input.version !== 1) {
    invalidCodexAuth(sourcePath, "version must be 1")
  }

  if (input.provider !== "codex") {
    invalidCodexAuth(sourcePath, "provider must be codex")
  }

  if (input.authType !== "device-code-oauth") {
    invalidCodexAuth(sourcePath, "authType must be device-code-oauth")
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
  }
}

export function formatCodexAuthStatus(status: CodexAuthStatus): string {
  switch (status.state) {
    case "not-configured":
      return "Codex auth not configured."
    case "setup-required":
      return "Codex auth setup required. Run bn ai codex auth login."
    case "authenticated":
      return `Codex auth authenticated. Expires at ${status.expiresAt}.`
    case "expired":
      return `Codex auth expired. ${status.hint}`
    case "invalid":
      return `Codex auth invalid. ${status.hint}`
  }
}

export function createCodexAuthRepository(rootPath: string, options: CodexAuthRepositoryOptions = {}): CodexAuthRepository {
  const normalizedRootPath = path.resolve(rootPath)
  const authPath = getCodexAuthPath(normalizedRootPath)
  const relativePath = relativeAuthPath(normalizedRootPath, authPath)
  const now = options.now ?? (() => new Date())

  function readAuth(): CodexAuth {
    let rawJson: string

    try {
      rawJson = readFileSync(authPath, "utf8")
    } catch (error) {
      throw new UsageError(`Could not read Codex auth '${relativePath}'.`, {
        hint: "Run bn ai codex auth login if Codex is the selected AI provider.",
        cause: error,
      })
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(rawJson)
    } catch (error) {
      throw new UsageError(`Could not parse Codex auth '${relativePath}'.`, {
        hint: "Run bn ai codex auth login to create a fresh local auth file.",
        cause: error,
      })
    }

    return validateCodexAuth(parsed, relativePath)
  }

  return {
    exists() {
      return existsSync(authPath)
    },

    read() {
      return readAuth()
    },

    write(auth) {
      const canonicalAuth = validateCodexAuth(auth, relativePath)
      const temporaryAuthPath = getTemporaryAuthPath(authPath)

      try {
        mkdirSync(path.dirname(authPath), { recursive: true })
        writeFileSync(temporaryAuthPath, `${JSON.stringify(canonicalAuth, null, 2)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        })
        replaceFileAtomically(temporaryAuthPath, authPath)
        try {
          chmodSync(authPath, 0o600)
        } catch {
          // Restrictive mode is best effort on filesystems/platforms that support it.
        }
      } catch (error) {
        removeTemporaryAuth(temporaryAuthPath)
        throw new UsageError(`Could not write Codex auth '${relativePath}'.`, {
          hint: "Ensure BLUENOTE_ROOT points to a writable directory path.",
          cause: error,
        })
      }

      return authPath
    },

    delete() {
      try {
        rmSync(authPath, { force: true })
      } catch (error) {
        throw new UsageError(`Could not delete Codex auth '${relativePath}'.`, {
          hint: "Ensure BLUENOTE_ROOT points to a writable directory path.",
          cause: error,
        })
      }
    },

    getStatus(selection) {
      if (!existsSync(authPath)) {
        return selection.provider === "codex" ? { state: "setup-required" } : { state: "not-configured" }
      }

      try {
        const auth = readAuth()
        if (new Date(auth.expiresAt).getTime() <= now().getTime()) {
          return { state: "expired", hint: "Run bn ai codex auth login." }
        }

        return { state: "authenticated", expiresAt: auth.expiresAt, issuer: auth.issuer }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          state: "invalid",
          message: sanitizeCodexAuthErrorMessage(message),
          hint: "Run bn ai codex auth login to create a fresh local auth file.",
        }
      }
    },
  }
}
