import { describe, test } from "vitest"
import assert from "node:assert/strict"

import {
  isDownloadNoteBodyResponse,
  isPullChangesRequest,
  isPullChangesResponse,
  isPushRequest,
  isPushResponse,
  isSnapshotRequiredError,
  isSnapshotResponse,
  isSyncChangeView,
  isUploadNoteBodyRequest,
  isUploadNoteBodyResponse,
} from "../../../src/sync/protocol"

describe("sync protocol runtime guards", () => {
  test("validates pull changes requests", () => {
    assert.equal(isPullChangesRequest({ workspaceId: "workspace-123", sinceSequence: 10, limit: 50 }), true)
    assert.equal(isPullChangesRequest({ workspaceId: "workspace-123", sinceSequence: -1, limit: 50 }), false)
    assert.equal(isPullChangesRequest({ workspaceId: "workspace-123", sinceSequence: 10, limit: 0 }), false)
  })

  test("validates pull changes responses with body metadata only", () => {
    const response = {
      workspaceId: "workspace-123",
      fromSequence: 10,
      toSequence: 12,
      hasMore: false,
      changes: [
        {
          sequence: 11,
          entityType: "note",
          entityId: "note-1",
          changeType: "upsert",
          serverRevision: 3,
          changedAt: "2026-06-24T00:00:00.000Z",
          title: "Protocol Note",
          relativePath: "note/protocol-note.md",
          bodyAvailable: true,
          metadata: { contentHash: "sha256:abc", byteLength: 42 },
        },
      ],
    }

    assert.equal(isPullChangesResponse(response), true)
    assert.equal(isSyncChangeView(response.changes[0]), true)
  })

  test("rejects change-list records that include raw note bodies", () => {
    const changeWithBody = {
      sequence: 1,
      entityType: "note",
      entityId: "note-1",
      changeType: "upsert",
      serverRevision: 1,
      changedAt: "2026-06-24T00:00:00.000Z",
      body: "Raw Markdown must be transferred through body endpoints, not change lists.",
      bodyAvailable: true,
      metadata: {},
    }

    assert.equal(isSyncChangeView(changeWithBody), false)
    assert.equal(isSyncChangeView({ ...changeWithBody, body: undefined, metadata: { body: "Nested raw Markdown is also forbidden." } }), false)
    assert.equal(
      isPullChangesResponse({
        workspaceId: "workspace-123",
        fromSequence: 0,
        toSequence: 1,
        hasMore: false,
        changes: [changeWithBody],
      }),
      false,
    )
  })

  test("validates push requests with body upload descriptors", () => {
    assert.equal(
      isPushRequest({
        workspaceId: "workspace-123",
        replicaId: "replica-abc",
        baseSequence: 12,
        records: [
          {
            entityType: "note",
            entityId: "note-1",
            dirtyType: "upsert",
            clientUpdatedAt: "2026-06-24T00:01:00.000Z",
            metadata: { title: "Uploaded Later" },
            bodyUpload: {
              uploadId: "upload-1",
              contentHash: "sha256:def",
              byteLength: 128,
            },
          },
          {
            entityType: "folder",
            entityId: "note/projects",
            dirtyType: "folder-upsert",
            clientUpdatedAt: "2026-06-24T00:02:00.000Z",
            metadata: { relativePath: "note/projects" },
          },
        ],
      }),
      true,
    )
  })

  test("rejects invalid push entity and dirty type combinations", () => {
    const baseRecord = {
      entityId: "entity-1",
      clientUpdatedAt: "2026-06-24T00:01:00.000Z",
      metadata: {},
    }

    assert.equal(
      isPushRequest({
        workspaceId: "workspace-123",
        replicaId: "replica-abc",
        baseSequence: 12,
        records: [{ ...baseRecord, entityType: "folder", dirtyType: "upsert" }],
      }),
      false,
    )
    assert.equal(
      isPushRequest({
        workspaceId: "workspace-123",
        replicaId: "replica-abc",
        baseSequence: 12,
        records: [{ ...baseRecord, entityType: "note", dirtyType: "folder-upsert" }],
      }),
      false,
    )
    assert.equal(
      isPushRequest({
        workspaceId: "workspace-123",
        replicaId: "replica-abc",
        baseSequence: 12,
        records: [{
          ...baseRecord,
          entityType: "folder",
          dirtyType: "folder-upsert",
          bodyUpload: { contentHash: "sha256:def", byteLength: 128 },
        }],
      }),
      false,
    )
    assert.equal(
      isPushRequest({
        workspaceId: "workspace-123",
        replicaId: "replica-abc",
        baseSequence: 12,
        records: [{
          ...baseRecord,
          entityType: "note",
          dirtyType: "delete",
          bodyUpload: { contentHash: "sha256:def", byteLength: 128 },
        }],
      }),
      false,
    )
  })

  test("rejects pushed records that inline raw note bodies", () => {
    assert.equal(
      isPushRequest({
        workspaceId: "workspace-123",
        replicaId: "replica-abc",
        baseSequence: 12,
        records: [
          {
            entityType: "note",
            entityId: "note-1",
            dirtyType: "upsert",
            clientUpdatedAt: "2026-06-24T00:01:00.000Z",
            metadata: {},
            body: "Inline body is not part of the protocol record shape.",
          },
        ],
      }),
      false,
    )
    assert.equal(
      isPushRequest({
        workspaceId: "workspace-123",
        replicaId: "replica-abc",
        baseSequence: 12,
        records: [
          {
            entityType: "note",
            entityId: "note-1",
            dirtyType: "upsert",
            clientUpdatedAt: "2026-06-24T00:01:00.000Z",
            metadata: { body: "Nested raw Markdown is also forbidden." },
          },
        ],
      }),
      false,
    )
  })

  test("validates push responses", () => {
    assert.equal(
      isPushResponse({
        accepted: [{ entityType: "note", entityId: "note-1", serverRevision: 5 }],
        replacedByServer: [{ entityType: "folder", entityId: "note/projects", serverRevision: 4 }],
        rejected: [{ entityType: "note", entityId: "note-2", code: "invalid", message: "Invalid note." }],
        serverSequence: 25,
      }),
      true,
    )
    assert.equal(
      isPushResponse({ accepted: [{ entityType: "unknown", entityId: "x", serverRevision: 1 }], replacedByServer: [], rejected: [], serverSequence: 1 }),
      false,
    )
  })

  test("validates body upload and download protocol shapes", () => {
    assert.equal(
      isUploadNoteBodyRequest({
        workspaceId: "workspace-123",
        replicaId: "replica-abc",
        noteId: "note-1",
        contentHash: "sha256:body",
        byteLength: 12,
        body: "# Body\n",
      }),
      true,
    )
    assert.equal(isUploadNoteBodyRequest({ workspaceId: "workspace-123", noteId: "note-1", body: "# Body\n" }), false)
    assert.equal(isUploadNoteBodyResponse({ noteId: "note-1", contentHash: "sha256:body", byteLength: 12, accepted: true }), true)
    assert.equal(isDownloadNoteBodyResponse({ workspaceId: "workspace-123", noteId: "note-1", contentHash: "sha256:body", byteLength: 12, body: "# Body\n" }), true)
    assert.equal(isDownloadNoteBodyResponse({ workspaceId: "workspace-123", noteId: "note-1", body: 12 }), false)
  })

  test("validates snapshot responses", () => {
    assert.equal(
      isSnapshotResponse({
        workspaceId: "workspace-123",
        serverSequence: 20,
        hasMore: false,
        changes: [{
          sequence: 20,
          entityType: "folder",
          entityId: "note/projects",
          changeType: "folder-upsert",
          serverRevision: 4,
          changedAt: "2026-06-24T00:00:00.000Z",
          metadata: { relativePath: "note/projects" },
        }],
      }),
      true,
    )
    assert.equal(isSnapshotResponse({ workspaceId: "workspace-123", serverSequence: 20, hasMore: false, changes: [{ body: "nope" }] }), false)
  })

  test("validates snapshot-required error shape", () => {
    assert.equal(
      isSnapshotRequiredError({
        error: "snapshot-required",
        code: "SNAPSHOT_REQUIRED",
        message: "Cursor is too old; request a full snapshot.",
        workspaceId: "workspace-123",
        latestSequence: 100,
      }),
      true,
    )
    assert.equal(isSnapshotRequiredError({ code: "SNAPSHOT_REQUIRED", latestSequence: "100" }), false)
  })
})
