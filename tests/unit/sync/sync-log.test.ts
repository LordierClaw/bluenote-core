import { describe, test } from "vitest"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"

import { createSyncLogWriter, redactSyncLogValue } from "../../../src/sync/sync-log"

async function withTempRoot<T>(fn: (rootPath: string) => Promise<T>): Promise<T> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-sync-log-"))
  try {
    return await fn(rootPath)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
}

describe("sync log", () => {
  test("writes structured JSONL logs under private sync log directory", async () => {
    await withTempRoot(async (rootPath) => {
      const writer = createSyncLogWriter({ rootPath, now: () => new Date("2026-06-24T12:34:56.789Z") })

      await writer.write({
        event: "note.push",
        level: "info",
        note: {
          id: "note-a",
          title: "Visible Note Title",
          relativePath: "notes/visible-note.md",
          body: "Do not leak this body text.",
          content: "Do not leak this content text.",
        },
        url: "https://user:password@sync.example.test/sync?token=secret-token&api_key=secret-key&workspaceId=workspace-a",
        apiKey: "secret-api-key",
        noteBodies: { "note-a": "Do not leak this noteBodies value." },
        request: {
          body: "Do not leak this raw request body.",
          headers: { authorization: "Bearer secret-token" },
        },
        responseBody: "Do not leak this raw response body.",
      })

      const syncDataEntries = await readdir(path.join(rootPath, ".data", "sync"))
      assert.deepEqual(syncDataEntries, ["logs"])

      const logDir = path.join(rootPath, ".data", "sync", "logs")
      const logFiles = await readdir(logDir)
      assert.deepEqual(logFiles, ["2026-06-24.jsonl"])

      const rawLog = await readFile(path.join(logDir, logFiles[0]), "utf8")
      const lines = rawLog.trim().split("\n")
      assert.equal(lines.length, 1)

      const entry = JSON.parse(lines[0]) as Record<string, unknown>
      assert.equal(entry.timestamp, "2026-06-24T12:34:56.789Z")
      assert.equal(entry.event, "note.push")
      assert.equal(entry.level, "info")

      const serialized = JSON.stringify(entry)
      assert.match(serialized, /Visible Note Title/u)
      assert.match(serialized, /notes\/visible-note\.md/u)
      assert.match(serialized, /sync\.example\.test/u)

      assert.doesNotMatch(serialized, /Do not leak/u)
      assert.doesNotMatch(serialized, /secret-token|secret-key|secret-api-key|password/u)
      assert.doesNotMatch(serialized, /authorization|Bearer/u)
      assert.match(serialized, /\[redacted\]/u)
    })
  })

  test("redacts secret URL parts while preserving non-secret context", () => {
    assert.equal(
      redactSyncLogValue("https://alice:hunter2@sync.example.test/path?token=abc&safe=value&client_secret=def"),
      "https://[redacted]@sync.example.test/path?token=%5Bredacted%5D&safe=value&client_secret=%5Bredacted%5D",
    )
  })

  test("redacts token-like query key variants and credential fields", () => {
    assert.equal(
      redactSyncLogValue("https://sync.example.test/path?accessToken=abc&refreshToken=def&auth_token=ghi&sessionToken=jkl&safe=value"),
      "https://sync.example.test/path?accessToken=%5Bredacted%5D&refreshToken=%5Bredacted%5D&auth_token=%5Bredacted%5D&sessionToken=%5Bredacted%5D&safe=value",
    )

    assert.deepEqual(redactSyncLogValue({ credential: "single-secret", credentials: "multi-secret", safe: "visible" }), {
      credential: "[redacted]",
      credentials: "[redacted]",
      safe: "visible",
    })

    assert.deepEqual(redactSyncLogValue({ clientCredentials: "client-secret", oauthCredential: "oauth-secret", safe: "visible" }), {
      clientCredentials: "[redacted]",
      oauthCredential: "[redacted]",
      safe: "visible",
    })
  })

  test("redacts fragment tokens and non-obvious raw body fields", () => {
    assert.equal(
      redactSyncLogValue("https://sync.example.test/callback#access_token=abc&id_token=def&safe=value"),
      "https://sync.example.test/callback#access_token=%5Bredacted%5D&id_token=%5Bredacted%5D&safe=value",
    )

    assert.equal(
      redactSyncLogValue("https://sync.example.test/callback#/oauth?code=AUTH-CODE&safe=1"),
      "https://sync.example.test/callback#/oauth?code=%5Bredacted%5D&safe=1",
    )

    assert.equal(
      redactSyncLogValue("https://sync.example.test/callback#/oauth?key=API-KEY&auth=AUTH-SECRET&safe=1"),
      "https://sync.example.test/callback#/oauth?key=%5Bredacted%5D&auth=%5Bredacted%5D&safe=1",
    )

    assert.deepEqual(redactSyncLogValue({
      noteBody: "Do not leak note body.",
      rawRequest: { url: "https://example.test/?safe=1", payload: "Do not leak payload." },
      rawResponse: { text: "Do not leak text." },
      payload: "Do not leak direct payload.",
      text: "Do not leak direct text.",
      data: "Do not leak direct data.",
      note: {
        bodyText: "BODY-LEAK",
        bodyMarkdown: "BODY-MD-LEAK",
        markdown: "MD-LEAK",
        noteContent: "CONTENT-LEAK",
        noteMarkdown: "NOTE-MD-LEAK",
        rawText: "RAW-TEXT-LEAK",
      },
      safe: "visible",
    }), {
      noteBody: "[redacted]",
      rawRequest: "[redacted]",
      rawResponse: "[redacted]",
      payload: "[redacted]",
      text: "[redacted]",
      data: "[redacted]",
      note: {
        bodyText: "[redacted]",
        bodyMarkdown: "[redacted]",
        markdown: "[redacted]",
        noteContent: "[redacted]",
        noteMarkdown: "[redacted]",
        rawText: "[redacted]",
      },
      safe: "visible",
    })
  })

  test("redacts credential query variants embedded in strings and errors", () => {
    assert.equal(
      redactSyncLogValue("failed fetching https://sync.example.test/path?accessToken=abc&safe=value"),
      "failed fetching https://sync.example.test/path?accessToken=%5Bredacted%5D&safe=value",
    )

    assert.equal(
      redactSyncLogValue("?accessToken=TOKEN-LEAK&safe=1"),
      "?accessToken=%5Bredacted%5D&safe=1",
    )

    assert.equal(
      redactSyncLogValue("accessToken=TOKEN-LEAK&safe=1"),
      "accessToken=%5Bredacted%5D&safe=1",
    )

    assert.equal(
      redactSyncLogValue("refreshToken=REFRESH&safe=1"),
      "refreshToken=%5Bredacted%5D&safe=1",
    )

    assert.equal(
      redactSyncLogValue("foo accessToken=TOKEN-LEAK&safe=1"),
      "foo accessToken=%5Bredacted%5D&safe=1",
    )

    assert.equal(
      redactSyncLogValue("foo accessToken=TOKEN-LEAK"),
      "foo accessToken=%5Bredacted%5D",
    )

    assert.equal(
      redactSyncLogValue("https://sync.example.test/path?redirect_uri=https%3A%2F%2Fevil.test%2Fcb%3Faccess_token%3DTOKEN-LEAK&safe=1"),
      "https://sync.example.test/path?redirect_uri=https%3A%2F%2Fevil.test%2Fcb%3Faccess_token%3D%255Bredacted%255D&safe=1",
    )

    assert.equal(
      redactSyncLogValue("failed ?accessToken=TOKEN-LEAK&safe=1"),
      "failed ?accessToken=%5Bredacted%5D&safe=1",
    )

    assert.equal(
      redactSyncLogValue("failed #accessToken=TOKEN-LEAK&safe=1"),
      "failed #accessToken=%5Bredacted%5D&safe=1",
    )

    assert.deepEqual(redactSyncLogValue(new Error("failed fetching https://sync.example.test/path?accessToken=abc&safe=value")), {
      name: "Error",
      message: "failed fetching https://sync.example.test/path?accessToken=%5Bredacted%5D&safe=value",
    })
  })

  test("logger owns timestamp and default level fields", async () => {
    await withTempRoot(async (rootPath) => {
      const writer = createSyncLogWriter({ rootPath, now: () => new Date("2026-06-24T12:34:56.789Z") })

      await writer.write({ event: "sync.test", timestamp: "caller timestamp", level: undefined })

      const rawLog = await readFile(path.join(rootPath, ".data", "sync", "logs", "2026-06-24.jsonl"), "utf8")
      const entry = JSON.parse(rawLog.trim()) as Record<string, unknown>

      assert.equal(entry.timestamp, "2026-06-24T12:34:56.789Z")
      assert.equal(entry.level, "info")
    })
  })
})
