import { describe, test } from "vitest"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  BLUENOTE_DAEMON_API_CAPABILITY_KEYS,
  BLUENOTE_DAEMON_API_VERSION,
  type AiConfigView,
  type AiDescribeRequest,
  type AiDescribeResult,
  type AiProcessQueueRequest,
  type AiProcessQueueResult,
  type AiQueueView,
  type AiStatusSummary,
  type ApiErrorBody,
  type CreateNoteRequest,
  type FolderView,
  type NoteDetailView,
  type NoteSummaryView,
  type SearchResultView,
  type UpdateNoteRequest,
  type WorkspaceStatus,
} from "@lordierclaw/bluenote-core"
import {
  BLUENOTE_DAEMON_API_CAPABILITY_KEYS as SUBPATH_CAPABILITY_KEYS,
  BLUENOTE_DAEMON_API_VERSION as SUBPATH_API_VERSION,
  type BlueNoteDaemonCapabilities,
} from "@lordierclaw/bluenote-core/api/daemon-contract"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

describe("daemon API contract exports", () => {
  test("exports runtime-light API constants and contract types from the package entrypoint", () => {
    assert.equal(BLUENOTE_DAEMON_API_VERSION, "1")
    assert.deepEqual(BLUENOTE_DAEMON_API_CAPABILITY_KEYS, ["workspaceApi", "notesApi", "aiApi"])

    const apiError: ApiErrorBody = {
      error: { code: "unauthorized", message: "Missing daemon token.", hint: "Run bluenote daemon status." },
    }
    const workspace: WorkspaceStatus = { selected: true, initialized: true, rootPath: "/tmp/notes", noteCount: 1 }
    const folder: FolderView = { relativePath: "note/projects", name: "projects", noteCount: 1 }
    const summary: NoteSummaryView = {
      key: "hello-world-000000",
      title: "Hello World",
      description: "A note",
      relativePath: "note/hello-world-000000.md",
      folder: "note",
    }
    const detail: NoteDetailView = { ...summary, body: "Body" }
    const search: SearchResultView = { ...summary, source: "body", score: 1, match: "Hello" }
    const create: CreateNoteRequest = { type: "normal", title: "Hello World", body: "Body", destinationFolder: "note/projects" }
    const update: UpdateNoteRequest = { title: "Hello Again", body: "Updated" }
    const aiStatus: AiStatusSummary = {
      status: "connected",
      provider: "openai-compatible",
      model: "test-model",
      queue: { pending: 0, running: 0, failed: 0 },
    }
    const aiConfig: AiConfigView = {
      configured: true,
      enabled: true,
      provider: "openai-compatible",
      model: "test-model",
      baseUrl: "https://example.test/v1",
      apiKeyMasked: "sk-***cret",
      logging: { usage: false, conversations: false, results: false },
      maxAttempts: 3,
      outputLanguage: "English",
    }
    const aiQueue: AiQueueView = { jobs: [] }
    const describeRequest: AiDescribeRequest = { selector: "hello-world-000000" }
    const describeResult: AiDescribeResult = {
      key: "hello-world-000000",
      relativePath: "note/hello-world-000000.md",
      status: "applied",
      description: "Short description",
    }
    const processRequest: AiProcessQueueRequest = { limit: 1 }
    const processResult: AiProcessQueueResult = { applied: 1, failed: 0, remaining: 0, setupBlocked: false }

    assert.equal(apiError.error.code, "unauthorized")
    assert.equal(workspace.initialized, true)
    assert.equal(folder.name, "projects")
    assert.equal(detail.body, "Body")
    assert.equal(search.source, "body")
    assert.equal(create.type, "normal")
    assert.equal(update.title, "Hello Again")
    assert.equal(aiStatus.status, "connected")
    assert.equal(aiConfig.configured, true)
    assert.deepEqual(aiQueue.jobs, [])
    assert.equal(describeRequest.selector, "hello-world-000000")
    assert.equal(describeResult.status, "applied")
    assert.equal(processRequest.limit, 1)
    assert.equal(processResult.applied, 1)
  })

  test("exports a runtime-light public subpath for daemon clients", () => {
    const capabilities: BlueNoteDaemonCapabilities = {
      apiVersion: SUBPATH_API_VERSION,
      workspaceApi: true,
      notesApi: false,
      aiApi: false,
    }

    assert.equal(SUBPATH_API_VERSION, "1")
    assert.deepEqual(SUBPATH_CAPABILITY_KEYS, ["workspaceApi", "notesApi", "aiApi"])
    assert.equal(capabilities.apiVersion, "1")
  })

  test("contract module has no client, daemon server, UI, or Node runtime imports", async () => {
    const source = await readFile(path.join(repoRoot, "src/api/daemon-contract.ts"), "utf8")
    const forbidden = [
      "bluenote-term",
      "bluenote-webui",
      "from \"@opentui/core\"",
      "from \"react\"",
      "from \"vite\"",
      "from \"node:",
      "../daemon",
      "../../bluenote",
    ]

    assert.deepEqual(forbidden.filter((text) => source.includes(text)), [])
  })
})
