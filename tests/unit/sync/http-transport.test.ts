import { describe, test } from "vitest"
import assert from "node:assert/strict"

import {
  createSyncHttpTransport,
  createSyncHttpHandlers,
  createHttpSyncServerHandler,
  redactSyncHttpUrl,
  type SyncHttpFetch,
  type SyncHttpRequest,
  type SyncHttpService,
} from "../../../src/sync/http-transport"
import type { SyncTransport } from "../../../src/sync/core-sync"
import type { PullChangesRequest, PushRequest, UploadNoteBodyRequest } from "../../../src/sync/protocol"

function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: { "content-type": "application/json" },
  })
}

function createRecordingFetch(): { fetch: SyncHttpFetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetch: SyncHttpFetch = async (input, init = {}) => {
    const url = input.toString()
    calls.push({ url, init })
    const body = init.body == null ? undefined : JSON.parse(init.body.toString())

    const pathname = new URL(url).pathname

    if (pathname.endsWith("/sync/v1/changes/pull")) {
      assert.deepEqual(body, { workspaceId: "workspace-a", sinceSequence: 7, limit: 50 })
      return jsonResponse({
        workspaceId: "workspace-a",
        fromSequence: 7,
        toSequence: 8,
        hasMore: false,
        changes: [{
          sequence: 8,
          entityType: "note",
          entityId: "note-a",
          changeType: "upsert",
          serverRevision: 2,
          changedAt: "2026-06-24T00:00:00.000Z",
          title: "Note A",
          relativePath: "note/note-a.md",
          bodyAvailable: true,
          metadata: { key: "note-a", relativePath: "note/note-a.md", title: "Note A" },
        }],
      })
    }

    if (pathname.endsWith("/sync/v1/changes/push")) {
      assert.deepEqual(body, {
        workspaceId: "workspace-a",
        replicaId: "replica-a",
        baseSequence: 8,
        records: [{ entityType: "note", entityId: "note-a", dirtyType: "upsert", clientUpdatedAt: "2026-06-24T00:00:00.000Z", metadata: { key: "note-a" } }],
        noteBodies: { "note-a": "Body stays separate from change lists.\n" },
      })
      return jsonResponse({ accepted: [{ entityType: "note", entityId: "note-a", serverRevision: 3 }], replacedByServer: [], rejected: [], serverSequence: 9 })
    }

    if (pathname.endsWith("/sync/v1/bodies/upload")) {
      assert.deepEqual(body, { workspaceId: "workspace-a", replicaId: "replica-a", noteId: "note-a", contentHash: "sha256:abc", byteLength: 5, body: "Hello" })
      return jsonResponse({ noteId: "note-a", contentHash: "sha256:abc", byteLength: 5, accepted: true })
    }

    if (pathname.endsWith("/sync/v1/bodies/note-a")) {
      assert.equal(init.method, "GET")
      assert.equal(new URL(url).searchParams.get("workspaceId"), "workspace-a")
      return jsonResponse({ workspaceId: "workspace-a", noteId: "note-a", contentHash: "sha256:def", byteLength: 6, body: "Server" })
    }

    if (pathname.endsWith("/sync/v1/status")) {
      assert.equal(init.method, "GET")
      assert.equal(new URL(url).searchParams.get("workspaceId"), "workspace-a")
      return jsonResponse({ workspaceId: "workspace-a", ok: true })
    }

    return jsonResponse({ error: "not-found" }, { status: 404, statusText: "Not Found" })
  }

  return { fetch, calls }
}

describe("sync HTTP transport", () => {
  test("client uses expected JSON paths without auth headers", async () => {
    const { fetch, calls } = createRecordingFetch()
    const transport = createSyncHttpTransport({ baseUrl: "https://sync.example.test/base?token=secret", fetch })

    assert.deepEqual(await transport.pull({ workspaceId: "workspace-a", sinceSequence: 7, limit: 50 }), {
      workspaceId: "workspace-a",
      fromSequence: 7,
      toSequence: 8,
      hasMore: false,
      changes: [{
        sequence: 8,
        entityType: "note",
        entityId: "note-a",
        changeType: "upsert",
        serverRevision: 2,
        changedAt: "2026-06-24T00:00:00.000Z",
        title: "Note A",
        relativePath: "note/note-a.md",
        bodyAvailable: true,
        metadata: { key: "note-a", relativePath: "note/note-a.md", title: "Note A" },
      }],
    })
    assert.deepEqual(await transport.push({
      workspaceId: "workspace-a",
      replicaId: "replica-a",
      baseSequence: 8,
      records: [{ entityType: "note", entityId: "note-a", dirtyType: "upsert", clientUpdatedAt: "2026-06-24T00:00:00.000Z", metadata: { key: "note-a" } }],
      noteBodies: { "note-a": "Body stays separate from change lists.\n" },
    }), { accepted: [{ entityType: "note", entityId: "note-a", serverRevision: 3 }], replacedByServer: [], rejected: [], serverSequence: 9 })
    assert.deepEqual(await transport.uploadNoteBody({ workspaceId: "workspace-a", replicaId: "replica-a", noteId: "note-a", contentHash: "sha256:abc", byteLength: 5, body: "Hello" }), { noteId: "note-a", contentHash: "sha256:abc", byteLength: 5, accepted: true })
    assert.deepEqual(await transport.downloadNoteBody("note-a", { workspaceId: "workspace-a" }), { workspaceId: "workspace-a", noteId: "note-a", contentHash: "sha256:def", byteLength: 6, body: "Server" })
    assert.deepEqual(await transport.status({ workspaceId: "workspace-a" }), { workspaceId: "workspace-a", ok: true })

    assert.deepEqual(calls.map((call) => [call.init.method, new URL(call.url).pathname]), [
      ["POST", "/base/sync/v1/changes/pull"],
      ["POST", "/base/sync/v1/changes/push"],
      ["POST", "/base/sync/v1/bodies/upload"],
      ["GET", "/base/sync/v1/bodies/note-a"],
      ["GET", "/base/sync/v1/status"],
    ])
    for (const call of calls) {
      const headers = new Headers(call.init.headers)
      assert.equal(headers.get("authorization"), null)
      assert.equal(headers.get("content-type"), call.init.method === "GET" ? null : "application/json")
    }
  })

  test("server handlers route JSON requests without inlining bodies in change lists", async () => {
    const pullRequests: PullChangesRequest[] = []
    const pushRequests: Array<PushRequest & { noteBodies?: Record<string, string> }> = []
    const uploads: UploadNoteBodyRequest[] = []
    const downloads: Array<{ noteId: string; workspaceId?: string }> = []
    const statuses: Array<{ workspaceId?: string } | undefined> = []
    const service: SyncHttpService = {
      getChanges(request) {
        pullRequests.push(request)
        return {
          workspaceId: request.workspaceId,
          fromSequence: request.sinceSequence,
          toSequence: 4,
          hasMore: false,
          changes: [{
            sequence: 4,
            entityType: "note",
            entityId: "note-a",
            changeType: "upsert",
            serverRevision: 1,
            changedAt: "2026-06-24T00:00:00.000Z",
            title: "Note A",
            relativePath: "note/note-a.md",
            bodyAvailable: true,
            metadata: { key: "note-a", relativePath: "note/note-a.md", title: "Note A" },
          }],
        }
      },
      acceptPush(request) {
        pushRequests.push(request)
        return { accepted: request.records.map((record, index) => ({ entityType: record.entityType, entityId: record.entityId, serverRevision: index + 1 })), replacedByServer: [], rejected: [], serverSequence: 5 }
      },
      uploadNoteBody(request) {
        uploads.push(request)
        return { noteId: request.noteId, contentHash: request.contentHash, byteLength: request.byteLength, accepted: true }
      },
      downloadNoteBody(noteId, request) {
        downloads.push({ noteId, workspaceId: request?.workspaceId })
        return { workspaceId: "workspace-a", noteId, body: "Downloaded body.\n" }
      },
      status(request) {
        statuses.push(request)
        return { workspaceId: "workspace-a", ok: true }
      },
    }
    const handlers = createSyncHttpHandlers(service)

    const pull = await handlers.handle({ method: "POST", path: "/sync/v1/changes/pull", body: { workspaceId: "workspace-a", sinceSequence: 3, limit: 10 }, headers: {} })
    assert.equal(pull.status, 200)
    assert.equal(JSON.stringify(pull.body).includes("Downloaded body"), false)
    assert.equal(JSON.stringify(pull.body).includes("\"body\""), false)
    assert.deepEqual(pullRequests, [{ workspaceId: "workspace-a", sinceSequence: 3, limit: 10 }])

    const push = await handlers.handle({ method: "POST", path: "/sync/v1/changes/push", body: { workspaceId: "workspace-a", replicaId: "replica-a", baseSequence: 3, records: [{ entityType: "note", entityId: "note-a", dirtyType: "upsert", clientUpdatedAt: "2026-06-24T00:00:00.000Z", metadata: { key: "note-a" } }], noteBodies: { "note-a": "Uploaded body.\n" } }, headers: {} })
    assert.equal(push.status, 200)
    assert.equal(pushRequests[0].noteBodies?.["note-a"], "Uploaded body.\n")

    const upload = await handlers.handle({ method: "POST", path: "/sync/v1/bodies/upload", body: { workspaceId: "workspace-a", replicaId: "replica-a", noteId: "note-a", contentHash: "sha256:abc", byteLength: 5, body: "Hello" }, headers: {} })
    assert.equal(upload.status, 200)
    assert.equal(uploads.length, 1)

    const download = await handlers.handle({ method: "GET", path: "/sync/v1/bodies/note-a?workspaceId=workspace-a", headers: {} })
    assert.deepEqual(download.body, { workspaceId: "workspace-a", noteId: "note-a", body: "Downloaded body.\n" })
    assert.deepEqual(downloads, [{ noteId: "note-a", workspaceId: "workspace-a" }])

    const status = await handlers.handle({ method: "GET", path: "/sync/v1/status?workspaceId=workspace-a", headers: {} })
    assert.deepEqual(status.body, { workspaceId: "workspace-a", ok: true })
    assert.deepEqual(statuses, [{ workspaceId: "workspace-a" }])

    const invalidPush = await handlers.handle({ method: "POST", path: "/sync/v1/changes/push", body: { workspaceId: "workspace-a", replicaId: "replica-a", baseSequence: 3, records: [], noteBodies: { "note-a": 123 } }, headers: {} })
    assert.equal(invalidPush.status, 400)

    const malformedDownload = await handlers.handle({ method: "GET", path: "/sync/v1/bodies/%E0%A4%A?workspaceId=workspace-a", headers: {} })
    assert.equal(malformedDownload.status, 400)
  })

  test("redacts credentials and query tokens in URL helpers and HTTP errors", async () => {
    assert.equal(redactSyncHttpUrl("https://user:pass@example.test/sync?token=abc&api_key=def&safe=value"), "https://[redacted]@example.test/sync?token=%5Bredacted%5D&api_key=%5Bredacted%5D&safe=value")

    const fetch: SyncHttpFetch = async () => jsonResponse({ error: "bad" }, { status: 500, statusText: "Server Error" })
    const transport = createSyncHttpTransport({ baseUrl: "https://user:pass@example.test/sync?token=abc", fetch })
    await assert.rejects(
      () => transport.pull({ workspaceId: "workspace-a", sinceSequence: 0, limit: 10 }),
      (error: unknown) => {
        assert(error instanceof Error)
        assert.match(error.message, /https:\/\/\[redacted\]@example\.test\/sync\/sync\/v1\/changes\/pull\?token=%5Bredacted%5D/)
        assert.equal(error.message.includes("user:pass"), false)
        assert.equal(error.message.includes("token=abc"), false)
        return true
      },
    )
  })

  test("redacts credentials when the fetch implementation throws", async () => {
    const fetch: SyncHttpFetch = async (input) => {
      throw new Error(`request to ${input.toString()} failed with raw network error`)
    }
    const transport = createSyncHttpTransport({ baseUrl: "https://user:pass@example.invalid/sync?token=abc", fetch })

    await assert.rejects(
      () => transport.pull({ workspaceId: "workspace-a", sinceSequence: 0, limit: 10 }),
      (error: unknown) => {
        assert(error instanceof Error)
        assert.match(error.message, /https:\/\/\[redacted\]@example\.invalid\/sync\/sync\/v1\/changes\/pull\?token=%5Bredacted%5D/)
        assert.equal(error.message.includes("user:pass"), false)
        assert.equal(error.message.includes("token=abc"), false)
        return true
      },
    )
  })

  test("server handler alias is Node 16 safe and does not require global Request or Response", async () => {
    const previousRequest = globalThis.Request
    const previousResponse = globalThis.Response
    try {
      Reflect.deleteProperty(globalThis, "Request")
      Reflect.deleteProperty(globalThis, "Response")
      const handlers = createHttpSyncServerHandler({
        service: {
          getChanges(request) {
            return { workspaceId: request.workspaceId, fromSequence: request.sinceSequence, toSequence: request.sinceSequence, hasMore: false, changes: [] }
          },
          acceptPush() {
            return { accepted: [], replacedByServer: [], rejected: [], serverSequence: 0 }
          },
          downloadNoteBody(noteId) {
            return { workspaceId: "workspace-a", noteId, body: "Body" }
          },
        },
      })

      assert.deepEqual(await handlers.handle({ method: "GET", path: "/sync/v1/status", headers: {} }), { status: 200, body: { ok: true }, headers: { "content-type": "application/json" } })
    } finally {
      Object.defineProperty(globalThis, "Request", { value: previousRequest, configurable: true, writable: true })
      Object.defineProperty(globalThis, "Response", { value: previousResponse, configurable: true, writable: true })
    }
  })
})
