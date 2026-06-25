import { UsageError } from "../core/errors.js";
import { getDefaultFetch } from "../platform/fetch.js";
import { isDownloadNoteBodyResponse, isPullChangesRequest, isPullChangesResponse, isPushRequest, isPushResponse, isUploadNoteBodyRequest, isUploadNoteBodyResponse, } from "./protocol.js";
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
]);
function normalizeQueryKey(key) {
    return key.replace(/[-_\s]/gu, "").toLowerCase();
}
function isSecretQueryKey(key) {
    const normalized = normalizeQueryKey(key);
    if (secretQueryKeys.has(key.toLowerCase()) || secretQueryKeys.has(normalized)) {
        return true;
    }
    return normalized.endsWith("token") || normalized.endsWith("secret") || normalized.endsWith("password");
}
function joinBaseUrl(baseUrl, endpoint) {
    const parsed = new URL(baseUrl);
    const endpointUrl = new URL(endpoint, "http://bluenote.local");
    const basePath = parsed.pathname.replace(/\/+$/, "");
    parsed.pathname = `${basePath}/${endpointUrl.pathname.replace(/^\/+/, "")}`;
    parsed.search = endpointUrl.search;
    return parsed.toString();
}
function logUrlWithBaseSecrets(baseUrl, requestUrl) {
    const base = new URL(baseUrl);
    if (base.search === "") {
        return requestUrl;
    }
    const parsed = new URL(requestUrl);
    parsed.search = base.search;
    return parsed.toString();
}
function sanitizedFetchCause(error) {
    if (error instanceof Error) {
        const sanitized = new Error(redactSyncHttpUrl(error.message));
        sanitized.name = redactSyncHttpUrl(error.name);
        return sanitized;
    }
    return new Error(redactSyncHttpUrl(String(error)));
}
export function redactSyncHttpUrl(rawUrl) {
    try {
        const parsed = new URL(String(rawUrl));
        const query = new URLSearchParams(parsed.search);
        for (const key of [...query.keys()]) {
            if (isSecretQueryKey(key)) {
                query.set(key, "[redacted]");
            }
        }
        const userInfo = parsed.username !== "" || parsed.password !== "" ? "[redacted]@" : "";
        const search = query.toString();
        return `${parsed.protocol}//${userInfo}${parsed.host}${parsed.pathname}${search === "" ? "" : `?${search}`}${parsed.hash}`;
    }
    catch {
        return String(rawUrl)
            .replace(/\/\/[^/@\s]+@/g, "//[redacted]@")
            .replace(/([?&][^=&#\s]*(?:token|secret|password|credential|credentials|access_token|api_key|apikey|auth|authorization|client_secret|code|id_token|key|refresh_token)[^=&#\s]*=)[^&#\s]+/gi, "$1[redacted]");
    }
}
export const redactSyncUrl = redactSyncHttpUrl;
function assertObject(value, context) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new UsageError(`${context} must be a JSON object.`);
    }
    return value;
}
async function parseJsonResponse(response, url, validate, label) {
    let parsed;
    try {
        parsed = await response.json();
    }
    catch (error) {
        throw new UsageError(`Sync HTTP ${label} returned non-JSON from ${redactSyncHttpUrl(url)}.`, { cause: error });
    }
    if (!response.ok) {
        throw new UsageError(`Sync HTTP ${label} failed with ${response.status} ${response.statusText || "HTTP error"} from ${redactSyncHttpUrl(url)}.`);
    }
    if (!validate(parsed)) {
        throw new UsageError(`Sync HTTP ${label} returned an invalid JSON payload from ${redactSyncHttpUrl(url)}.`);
    }
    return parsed;
}
async function requestJson(fetchImpl, baseUrl, endpoint, init, validate, label) {
    const url = joinBaseUrl(baseUrl, endpoint);
    let response;
    try {
        response = await fetchImpl(url, init);
    }
    catch (error) {
        throw new UsageError(`Sync HTTP ${label} request failed for ${redactSyncHttpUrl(logUrlWithBaseSecrets(baseUrl, url))}.`, { cause: sanitizedFetchCause(error) });
    }
    return parseJsonResponse(response, logUrlWithBaseSecrets(baseUrl, url), validate, label);
}
function jsonPostInit(body) {
    return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
function endpointWithWorkspace(endpoint, options) {
    if (options?.workspaceId === undefined && options?.sequence === undefined && options?.serverRevision === undefined) {
        return endpoint;
    }
    const query = new URLSearchParams();
    if (options?.workspaceId !== undefined)
        query.set("workspaceId", options.workspaceId);
    if (options?.sequence !== undefined)
        query.set("sequence", String(options.sequence));
    if (options?.serverRevision !== undefined)
        query.set("serverRevision", String(options.serverRevision));
    return `${endpoint}?${query.toString()}`;
}
export function createSyncHttpTransport(options) {
    const fetchImpl = options.fetch ?? getDefaultFetch();
    const baseUrl = options.baseUrl;
    const transport = {
        pull(request) {
            return requestJson(fetchImpl, baseUrl, "/sync/v1/changes/pull", jsonPostInit(request), isPullChangesResponse, "pull");
        },
        push(request) {
            return requestJson(fetchImpl, baseUrl, "/sync/v1/changes/push", jsonPostInit(request), isPushResponse, "push");
        },
        uploadNoteBody(request) {
            return requestJson(fetchImpl, baseUrl, "/sync/v1/bodies/upload", jsonPostInit(request), isUploadNoteBodyResponse, "body upload");
        },
        downloadNoteBody(noteId, options) {
            return requestJson(fetchImpl, baseUrl, endpointWithWorkspace(`/sync/v1/bodies/${encodeURIComponent(noteId)}`, options), { method: "GET" }, isDownloadNoteBodyResponse, "body download");
        },
        status(options) {
            return requestJson(fetchImpl, baseUrl, endpointWithWorkspace("/sync/v1/status", options), { method: "GET" }, (value) => typeof value === "object" && value !== null && !Array.isArray(value), "status");
        },
        getStatus(options) {
            return this.status(options);
        },
    };
    return transport;
}
export const createHttpSyncTransport = createSyncHttpTransport;
function stripInlineBodiesFromMetadata(metadata) {
    const clean = {};
    for (const [key, value] of Object.entries(metadata)) {
        if (key !== "body") {
            clean[key] = value;
        }
    }
    return clean;
}
function stripInlineBodiesFromChange(change) {
    const { body: _body, metadata, ...rest } = change;
    return { ...rest, metadata: stripInlineBodiesFromMetadata(metadata) };
}
function stripInlineBodiesFromPullResponse(response) {
    return { ...response, changes: response.changes.map(stripInlineBodiesFromChange) };
}
function normalizePath(path) {
    const [pathOnly] = path.split("?", 1);
    return pathOnly.replace(/\/+$/, "") || "/";
}
function optionalNonNegativeIntegerQuery(query, key) {
    const raw = query.get(key);
    if (raw === null) {
        return undefined;
    }
    const value = Number(raw);
    return Number.isInteger(value) && value >= 0 ? value : Number.NaN;
}
function workspaceFromPath(path) {
    const queryStart = path.indexOf("?");
    if (queryStart === -1) {
        return undefined;
    }
    const query = new URLSearchParams(path.slice(queryStart + 1));
    const workspaceId = query.get("workspaceId") ?? undefined;
    const sequence = optionalNonNegativeIntegerQuery(query, "sequence");
    const serverRevision = optionalNonNegativeIntegerQuery(query, "serverRevision");
    const parsed = {
        ...(workspaceId === undefined ? {} : { workspaceId }),
        ...(sequence === undefined ? {} : { sequence }),
        ...(serverRevision === undefined ? {} : { serverRevision }),
    };
    return Object.keys(parsed).length === 0 ? undefined : parsed;
}
function noteIdFromBodyPath(path) {
    const prefix = "/sync/v1/bodies/";
    const normalized = normalizePath(path);
    if (!normalized.startsWith(prefix) || normalized.length <= prefix.length) {
        return null;
    }
    return decodeURIComponent(normalized.slice(prefix.length));
}
function jsonResponse(body, status = 200) {
    return { status, body, headers: { "content-type": "application/json" } };
}
function methodNotAllowed() {
    return jsonResponse({ error: "method-not-allowed" }, 405);
}
function badRequest(message) {
    return jsonResponse({ error: "bad-request", message }, 400);
}
function hasValidNoteBodies(value) {
    if (value.noteBodies === undefined) {
        return true;
    }
    if (typeof value.noteBodies !== "object" || value.noteBodies === null || Array.isArray(value.noteBodies)) {
        return false;
    }
    return Object.values(value.noteBodies).every((body) => typeof body === "string");
}
export function createSyncHttpHandlers(service) {
    return {
        async handle(request) {
            const method = request.method.toUpperCase();
            const path = normalizePath(request.path);
            if (path === "/sync/v1/changes/pull") {
                if (method !== "POST")
                    return methodNotAllowed();
                if (!isPullChangesRequest(request.body))
                    return badRequest("Invalid pull request.");
                return jsonResponse(stripInlineBodiesFromPullResponse(await service.getChanges(request.body)));
            }
            if (path === "/sync/v1/changes/push") {
                if (method !== "POST")
                    return methodNotAllowed();
                if (!isPushRequest(request.body))
                    return badRequest("Invalid push request.");
                if (!hasValidNoteBodies(request.body))
                    return badRequest("Invalid push note bodies.");
                return jsonResponse(await service.acceptPush(request.body));
            }
            if (path === "/sync/v1/bodies/upload") {
                if (method !== "POST")
                    return methodNotAllowed();
                if (!service.uploadNoteBody)
                    return jsonResponse({ error: "not-implemented" }, 501);
                if (!isUploadNoteBodyRequest(request.body))
                    return badRequest("Invalid body upload request.");
                return jsonResponse(await service.uploadNoteBody(request.body));
            }
            let noteId;
            try {
                noteId = noteIdFromBodyPath(path);
            }
            catch {
                return badRequest("Invalid body download path.");
            }
            if (noteId !== null) {
                if (method !== "GET")
                    return methodNotAllowed();
                return jsonResponse(await service.downloadNoteBody(noteId, workspaceFromPath(request.path)));
            }
            if (path === "/sync/v1/status") {
                if (method !== "GET")
                    return methodNotAllowed();
                return jsonResponse(service.status ? await service.status(workspaceFromPath(request.path)) : { ok: true });
            }
            return jsonResponse({ error: "not-found" }, 404);
        },
    };
}
export function createHttpSyncServerHandler(options) {
    const service = options.status === undefined ? options.service : { ...options.service, status: options.status };
    return createSyncHttpHandlers(service);
}
export function isSyncHttpRequestBody(value) {
    return assertObject(value, "Sync HTTP request");
}
//# sourceMappingURL=http-transport.js.map