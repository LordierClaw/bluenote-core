import path from "node:path"
import { appendFile, mkdir } from "node:fs/promises"

export type SyncLogLevel = "debug" | "info" | "warn" | "error"

export type SyncLogValue = null | boolean | number | string | SyncLogValue[] | { [key: string]: SyncLogValue | undefined }

export interface SyncLogRecord {
  event: string
  level?: SyncLogLevel
  [key: string]: unknown
}

export interface CreateSyncLogWriterOptions {
  rootPath: string
  now?: () => Date
}

export interface SyncLogWriter {
  write(record: SyncLogRecord): Promise<void>
}

const redacted = "[redacted]"

const secretQueryKeys = new Set([
  "access_token",
  "apikey",
  "api_key",
  "auth",
  "authorization",
  "client_secret",
  "code",
  "id_token",
  "key",
  "password",
  "refresh_token",
  "secret",
  "token",
])

const redactedFieldNames = new Set([
  "authorization",
  "apikey",
  "body",
  "bodies",
  "clientsecret",
  "content",
  "contenttext",
  "cookie",
  "credential",
  "credentials",
  "headers",
  "idtoken",
  "notebodies",
  "password",
  "rawbody",
  "refreshtoken",
  "request",
  "requestbody",
  "response",
  "responsebody",
  "secret",
  "setcookie",
  "token",
])

function normalizeFieldName(key: string): string {
  return key.replace(/[-_\s]/gu, "").toLowerCase()
}

function isRedactedFieldName(key: string): boolean {
  const normalized = normalizeFieldName(key)
  if (redactedFieldNames.has(normalized)) {
    return true
  }
  return normalized.endsWith("token") || normalized.endsWith("secret") || normalized.endsWith("password")
}

function isRedactedQueryKey(key: string): boolean {
  const normalized = normalizeFieldName(key)
  if (secretQueryKeys.has(key.toLowerCase()) || secretQueryKeys.has(normalized)) {
    return true
  }
  return normalized.endsWith("token") || normalized.endsWith("secret") || normalized.endsWith("password")
}

function redactUrl(rawValue: string): string | undefined {
  try {
    const parsed = new URL(rawValue)
    const query = new URLSearchParams(parsed.search)
    for (const key of [...query.keys()]) {
      if (isRedactedQueryKey(key)) {
        query.set(key, redacted)
      }
    }
    const userInfo = parsed.username !== "" || parsed.password !== "" ? `${redacted}@` : ""
    const search = query.toString()
    return `${parsed.protocol}//${userInfo}${parsed.host}${parsed.pathname}${search === "" ? "" : `?${search}`}${parsed.hash}`
  } catch {
    return undefined
  }
}

function redactString(value: string): string {
  const url = redactUrl(value)
  if (url !== undefined) {
    return url
  }

  return value
    .replace(/\/\/[^/@\s]+@/gu, `//${redacted}@`)
    .replace(/([?&](?:access_token|api_key|apikey|auth|authorization|client_secret|code|id_token|key|password|refresh_token|secret|token)=)[^&#\s]+/giu, `$1${redacted}`)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, `Bearer ${redacted}`)
}

export function redactSyncLogValue(value: unknown): SyncLogValue {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value
  }

  if (typeof value === "string") {
    return redactString(value)
  }

  if (value instanceof URL) {
    return redactString(value.toString())
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSyncLogValue(item))
  }

  if (typeof value === "object" && value !== null) {
    const output: { [key: string]: SyncLogValue } = {}
    for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
      if (childValue === undefined) {
        continue
      }
      output[key] = isRedactedFieldName(key) ? redacted : redactSyncLogValue(childValue)
    }
    return output
  }

  return redactString(String(value))
}

export function createSyncLogWriter(options: CreateSyncLogWriterOptions): SyncLogWriter {
  const now = options.now ?? (() => new Date())
  const logDir = path.join(options.rootPath, ".data", "sync", "logs")

  return {
    async write(record: SyncLogRecord): Promise<void> {
      const timestamp = now().toISOString()
      const entry = redactSyncLogValue({ timestamp, level: record.level ?? "info", ...record })
      const logPath = path.join(logDir, `${timestamp.slice(0, 10)}.jsonl`)
      await mkdir(logDir, { recursive: true })
      await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8")
    },
  }
}
