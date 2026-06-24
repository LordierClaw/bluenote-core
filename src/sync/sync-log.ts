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
  "bodytext",
  "clientsecret",
  "content",
  "contenttext",
  "cookie",
  "credential",
  "credentials",
  "data",
  "headers",
  "idtoken",
  "markdown",
  "notebodies",
  "notebody",
  "password",
  "payload",
  "rawbody",
  "rawrequest",
  "rawresponse",
  "refreshtoken",
  "request",
  "requestbody",
  "response",
  "responsebody",
  "secret",
  "setcookie",
  "text",
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
  return normalized.endsWith("token") || normalized.endsWith("secret") || normalized.endsWith("password") || normalized.endsWith("credential") || normalized.endsWith("credentials") || normalized.endsWith("body") || normalized.endsWith("bodies") || normalized.endsWith("content") || normalized.endsWith("markdown") || normalized.endsWith("text")
}

function isRedactedQueryKey(key: string): boolean {
  const normalized = normalizeFieldName(key)
  if (secretQueryKeys.has(key.toLowerCase()) || secretQueryKeys.has(normalized)) {
    return true
  }
  return normalized.endsWith("token") || normalized.endsWith("secret") || normalized.endsWith("password")
}

function redactParams(rawValue: string): { value: string; changed: boolean } {
  const params = new URLSearchParams(rawValue)
  let changed = false
  for (const key of [...params.keys()]) {
    if (isRedactedQueryKey(key)) {
      params.set(key, redacted)
      changed = true
    }
  }
  return { value: changed ? params.toString() : rawValue, changed }
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

    const fragment = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash
    const fragmentQuery = new URLSearchParams(fragment)
    let redactedFragment = fragment
    if (fragment !== "") {
      let changed = false
      for (const key of [...fragmentQuery.keys()]) {
        if (isRedactedQueryKey(key)) {
          fragmentQuery.set(key, redacted)
          changed = true
        }
      }
      redactedFragment = changed ? fragmentQuery.toString() : fragment
    }

    const userInfo = parsed.username !== "" || parsed.password !== "" ? `${redacted}@` : ""
    const search = query.toString()
    return `${parsed.protocol}//${userInfo}${parsed.host}${parsed.pathname}${search === "" ? "" : `?${search}`}${redactedFragment === "" ? "" : `#${redactedFragment}`}`
  } catch {
    return undefined
  }
}

function redactString(value: string): string {
  const url = redactUrl(value)
  if (url !== undefined) {
    return url
  }

  if (value.startsWith("?") || value.startsWith("#")) {
    const prefix = value.slice(0, 1)
    const params = redactParams(value.slice(1))
    if (params.changed) {
      return `${prefix}${params.value}`
    }
  }

  const withEmbeddedUrls = value.replace(/https?:\/\/[^\s"'<>]+/giu, (match) => redactUrl(match) ?? match)
  const withEmbeddedParams = withEmbeddedUrls.replace(/([?#])([^\s"'<>]+)/gu, (match, prefix: string, rawParams: string) => {
    const params = redactParams(rawParams)
    return params.changed ? `${prefix}${params.value}` : match
  })

  return withEmbeddedParams
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
      const { timestamp: _recordTimestamp, level: recordLevel, ...recordFields } = record
      const entry = redactSyncLogValue({ ...recordFields, timestamp, level: recordLevel ?? "info" })
      const logPath = path.join(logDir, `${timestamp.slice(0, 10)}.jsonl`)
      await mkdir(logDir, { recursive: true })
      await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8")
    },
  }
}
