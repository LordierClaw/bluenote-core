import { UsageError } from "../core/errors"
import { getDefaultFetch, type FetchLike } from "../platform/fetch"
import type { SyncStatusView } from "./types"
import type {
  DownloadNoteBodyResponse,
  PullChangesRequest,
  PullChangesResponse,
  PushRequest,
  PushResponse,
  SyncChangeView,
  UploadNoteBodyRequest,
  UploadNoteBodyResponse,
} from "./protocol"
import {
  isDownloadNoteBodyResponse,
  isPullChangesRequest,
  isPullChangesResponse,
  isPushRequest,
  isPushResponse,
  isUploadNoteBodyRequest,
  isUploadNoteBodyResponse,
} from "./protocol"

export type SyncHttpFetch = FetchLike

export interface CreateSyncHttpTransportOptions {
  baseUrl: string
  fetch?: SyncHttpFetch
}

export interface SyncHttpTransport {
  /** Async HTTP adapter for daemon/network use. The in-process core SyncTransport remains synchronous. */
  pull(request: PullChangesRequest): Promise<PullChangesResponse>
  push(request: PushRequest & { noteBodies?: Record<string, string> }): Promise<PushResponse>
  uploadNoteBody(request: UploadNoteBodyRequest): Promise<UploadNoteBodyResponse>
  downloadNoteBody(noteId: string, options?: { workspaceId?: string; sequence?: number; serverRevision?: number }): Promise<DownloadNoteBodyResponse>
  status(options?: { workspaceId?: string }): Promise<Record<string, unknown>>
  getStatus(options?: { workspaceId?: string }): Promise<Record<string, unknown>>
}

export type HttpSyncTransportOptions = CreateSyncHttpTransportOptions
export type HttpSyncTransport = SyncHttpTransport

export interface SyncHttpService {
  getChanges(request: PullChangesRequest): PullChangesResponse | Promise<PullChangesResponse>
  acceptPush(request: PushRequest & { noteBodies?: Record<string, string> }): PushResponse | Promise<PushResponse>
  uploadNoteBody?(request: UploadNoteBodyRequest): UploadNoteBodyResponse | Promise<UploadNoteBodyResponse>
  downloadNoteBody(noteId: string, request?: { workspaceId?: string; sequence?: number; serverRevision?: number }): DownloadNoteBodyResponse | Promise<DownloadNoteBodyResponse>
  status?(request?: { workspaceId?: string }): Record<string, unknown> | SyncStatusView | Promise<Record<string, unknown> | SyncStatusView>
}

export type HttpSyncServerService = SyncHttpService

export interface CreateHttpSyncServerHandlerOptions {
  service: SyncHttpService
  status?: (request: { workspaceId?: string }) => Record<string, unknown> | SyncStatusView | Promise<Record<string, unknown> | SyncStatusView>
}

export interface SyncHttpRequest {
  method: string
  path: string
  body?: unknown
  headers?: Record<string, string | string[] | undefined>
}

export interface SyncHttpResponse {
  status: number
  body: unknown
  headers?: Record<string, string>
}

export interface SyncHttpHandlers {
  handle(request: SyncHttpRequest): Promise<SyncHttpResponse>
}

export type HttpSyncServerHandler = SyncHttpHandlers

type JsonValidator<T> = (value: unknown) => value is T

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

function normalizeQueryKey(key: string): string {
  return key.replace(/[-_\s]/gu, "").toLowerCase()
}

function isSecretQueryKey(key: string): boolean {
  const normalized = normalizeQueryKey(key)
  if (secretQueryKeys.has(key.toLowerCase()) || secretQueryKeys.has(normalized)) {
    return true
  }
  return normalized.endsWith("token") || normalized.endsWith("secret") || normalized.endsWith("password")
}

function joinBaseUrl(baseUrl: string, endpoint: string): string {
  const parsed = new URL(baseUrl)
  const endpointUrl = new URL(endpoint, "http://bluenote.local")
  const basePath = parsed.pathname.replace(/\/+$/, "")
  parsed.pathname = `${basePath}/${endpointUrl.pathname.replace(/^\/+/, "")}`
  parsed.search = endpointUrl.search
  return parsed.toString()
}

function logUrlWithBaseSecrets(baseUrl: string, requestUrl: string): string {
  const base = new URL(baseUrl)
  if (base.search === "") {
    return requestUrl
  }
  const parsed = new URL(requestUrl)
  parsed.search = base.search
  return parsed.toString()
}

function sanitizedFetchCause(error: unknown): Error {
  if (error instanceof Error) {
    const sanitized = new Error(redactSyncHttpUrl(error.message))
    sanitized.name = redactSyncHttpUrl(error.name)
    return sanitized
  }
  return new Error(redactSyncHttpUrl(String(error)))
}

export function redactSyncHttpUrl(rawUrl: string | URL): string {
  try {
    const parsed = new URL(String(rawUrl))
    const query = new URLSearchParams(parsed.search)
    for (const key of [...query.keys()]) {
      if (isSecretQueryKey(key)) {
        query.set(key, "[redacted]")
      }
    }
    const userInfo = parsed.username !== "" || parsed.password !== "" ? "[redacted]@" : ""
    const search = query.toString()
    return `${parsed.protocol}//${userInfo}${parsed.host}${parsed.pathname}${search === "" ? "" : `?${search}`}${parsed.hash}`
  } catch {
    return String(rawUrl)
      .replace(/\/\/[^/@\s]+@/g, "//[redacted]@")
      .replace(/([?&][^=&#\s]*(?:token|secret|password|credential|credentials|access_token|api_key|apikey|auth|authorization|client_secret|code|id_token|key|refresh_token)[^=&#\s]*=)[^&#\s]+/gi, "$1[redacted]")
  }
}

export const redactSyncUrl = redactSyncHttpUrl

function assertObject(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UsageError(`${context} must be a JSON object.`)
  }
  return value as Record<string, unknown>
}

async function parseJsonResponse<T>(response: Response, url: string, validate: JsonValidator<T>, label: string): Promise<T> {
  let parsed: unknown
  try {
    parsed = await response.json()
  } catch (error) {
    throw new UsageError(`Sync HTTP ${label} returned non-JSON from ${redactSyncHttpUrl(url)}.`, { cause: error })
  }

  if (!response.ok) {
    throw new UsageError(`Sync HTTP ${label} failed with ${response.status} ${response.statusText || "HTTP error"} from ${redactSyncHttpUrl(url)}.`)
  }

  if (!validate(parsed)) {
    throw new UsageError(`Sync HTTP ${label} returned an invalid JSON payload from ${redactSyncHttpUrl(url)}.`)
  }

  return parsed
}

async function requestJson<T>(fetchImpl: SyncHttpFetch, baseUrl: string, endpoint: string, init: RequestInit, validate: JsonValidator<T>, label: string): Promise<T> {
  const url = joinBaseUrl(baseUrl, endpoint)
  let response: Response
  try {
    response = await fetchImpl(url, init)
  } catch (error) {
    throw new UsageError(`Sync HTTP ${label} request failed for ${redactSyncHttpUrl(logUrlWithBaseSecrets(baseUrl, url))}.`, { cause: sanitizedFetchCause(error) })
  }
  return parseJsonResponse(response, logUrlWithBaseSecrets(baseUrl, url), validate, label)
}

function jsonPostInit(body: unknown): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
}

function endpointWithWorkspace(endpoint: string, options?: { workspaceId?: string; sequence?: number; serverRevision?: number }): string {
  if (options?.workspaceId === undefined && options?.sequence === undefined && options?.serverRevision === undefined) {
    return endpoint
  }
  const query = new URLSearchParams()
  if (options?.workspaceId !== undefined) query.set("workspaceId", options.workspaceId)
  if (options?.sequence !== undefined) query.set("sequence", String(options.sequence))
  if (options?.serverRevision !== undefined) query.set("serverRevision", String(options.serverRevision))
  return `${endpoint}?${query.toString()}`
}

export function createSyncHttpTransport(options: CreateSyncHttpTransportOptions): SyncHttpTransport {
  const fetchImpl = options.fetch ?? getDefaultFetch()
  const baseUrl = options.baseUrl
  const transport: SyncHttpTransport = {
    pull(request) {
      return requestJson(fetchImpl, baseUrl, "/sync/v1/changes/pull", jsonPostInit(request), isPullChangesResponse, "pull")
    },
    push(request) {
      return requestJson(fetchImpl, baseUrl, "/sync/v1/changes/push", jsonPostInit(request), isPushResponse, "push")
    },
    uploadNoteBody(request) {
      return requestJson(fetchImpl, baseUrl, "/sync/v1/bodies/upload", jsonPostInit(request), isUploadNoteBodyResponse, "body upload")
    },
    downloadNoteBody(noteId, options) {
      return requestJson(fetchImpl, baseUrl, endpointWithWorkspace(`/sync/v1/bodies/${encodeURIComponent(noteId)}`, options), { method: "GET" }, isDownloadNoteBodyResponse, "body download")
    },
    status(options) {
      return requestJson(fetchImpl, baseUrl, endpointWithWorkspace("/sync/v1/status", options), { method: "GET" }, (value): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value), "status")
    },
    getStatus(options) {
      return this.status(options)
    },
  }
  return transport
}

export const createHttpSyncTransport = createSyncHttpTransport

function stripInlineBodiesFromMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (key !== "body") {
      clean[key] = value
    }
  }
  return clean
}

function stripInlineBodiesFromChange(change: SyncChangeView): SyncChangeView {
  const { body: _body, metadata, ...rest } = change as SyncChangeView & { body?: unknown }
  return { ...rest, metadata: stripInlineBodiesFromMetadata(metadata) }
}

function stripInlineBodiesFromPullResponse(response: PullChangesResponse): PullChangesResponse {
  return { ...response, changes: response.changes.map(stripInlineBodiesFromChange) }
}

function normalizePath(path: string): string {
  const [pathOnly] = path.split("?", 1)
  return pathOnly.replace(/\/+$/, "") || "/"
}

function optionalNonNegativeIntegerQuery(query: URLSearchParams, key: string): number | undefined {
  const raw = query.get(key)
  if (raw === null) {
    return undefined
  }
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) {
    throw new UsageError(`Invalid sync HTTP query '${key}'.`, {
      hint: `${key} must be a non-negative integer when provided.`,
    })
  }
  return value
}

function workspaceFromPath(path: string): { workspaceId?: string; sequence?: number; serverRevision?: number } | undefined {
  const queryStart = path.indexOf("?")
  if (queryStart === -1) {
    return undefined
  }
  const query = new URLSearchParams(path.slice(queryStart + 1))
  const workspaceId = query.get("workspaceId") ?? undefined
  const sequence = optionalNonNegativeIntegerQuery(query, "sequence")
  const serverRevision = optionalNonNegativeIntegerQuery(query, "serverRevision")
  const parsed = {
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...(sequence === undefined ? {} : { sequence }),
    ...(serverRevision === undefined ? {} : { serverRevision }),
  }
  return Object.keys(parsed).length === 0 ? undefined : parsed
}

function noteIdFromBodyPath(path: string): string | null {
  const prefix = "/sync/v1/bodies/"
  const normalized = normalizePath(path)
  if (!normalized.startsWith(prefix) || normalized.length <= prefix.length) {
    return null
  }
  return decodeURIComponent(normalized.slice(prefix.length))
}

function jsonResponse(body: unknown, status = 200): SyncHttpResponse {
  return { status, body, headers: { "content-type": "application/json" } }
}

function methodNotAllowed(): SyncHttpResponse {
  return jsonResponse({ error: "method-not-allowed" }, 405)
}

function badRequest(message: string): SyncHttpResponse {
  return jsonResponse({ error: "bad-request", message }, 400)
}

function hasValidNoteBodies(value: PushRequest & { noteBodies?: unknown }): value is PushRequest & { noteBodies?: Record<string, string> } {
  if (value.noteBodies === undefined) {
    return true
  }
  if (typeof value.noteBodies !== "object" || value.noteBodies === null || Array.isArray(value.noteBodies)) {
    return false
  }
  return Object.values(value.noteBodies).every((body) => typeof body === "string")
}

export function createSyncHttpHandlers(service: SyncHttpService): SyncHttpHandlers {
  return {
    async handle(request) {
      const method = request.method.toUpperCase()
      const path = normalizePath(request.path)

      if (path === "/sync/v1/changes/pull") {
        if (method !== "POST") return methodNotAllowed()
        if (!isPullChangesRequest(request.body)) return badRequest("Invalid pull request.")
        return jsonResponse(stripInlineBodiesFromPullResponse(await service.getChanges(request.body)))
      }

      if (path === "/sync/v1/changes/push") {
        if (method !== "POST") return methodNotAllowed()
        if (!isPushRequest(request.body)) return badRequest("Invalid push request.")
        if (!hasValidNoteBodies(request.body as PushRequest & { noteBodies?: unknown })) return badRequest("Invalid push note bodies.")
        return jsonResponse(await service.acceptPush(request.body))
      }

      if (path === "/sync/v1/bodies/upload") {
        if (method !== "POST") return methodNotAllowed()
        if (!service.uploadNoteBody) return jsonResponse({ error: "not-implemented" }, 501)
        if (!isUploadNoteBodyRequest(request.body)) return badRequest("Invalid body upload request.")
        return jsonResponse(await service.uploadNoteBody(request.body))
      }

      let noteId: string | null
      try {
        noteId = noteIdFromBodyPath(path)
      } catch {
        return badRequest("Invalid body download path.")
      }
      if (noteId !== null) {
        if (method !== "GET") return methodNotAllowed()
        let downloadOptions: { workspaceId?: string; sequence?: number; serverRevision?: number } | undefined
        try {
          downloadOptions = workspaceFromPath(request.path)
        } catch {
          return badRequest("Invalid body download query.")
        }
        return jsonResponse(await service.downloadNoteBody(noteId, downloadOptions))
      }

      if (path === "/sync/v1/status") {
        if (method !== "GET") return methodNotAllowed()
        return jsonResponse(service.status ? await service.status(workspaceFromPath(request.path)) : { ok: true })
      }

      return jsonResponse({ error: "not-found" }, 404)
    },
  }
}

export function createHttpSyncServerHandler(options: CreateHttpSyncServerHandlerOptions): HttpSyncServerHandler {
  const service = options.status === undefined ? options.service : { ...options.service, status: options.status }
  return createSyncHttpHandlers(service)
}

export function isSyncHttpRequestBody(value: unknown): Record<string, unknown> {
  return assertObject(value, "Sync HTTP request")
}
