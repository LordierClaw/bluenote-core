import path from "node:path"
import { existsSync, readdirSync } from "node:fs"

import { resolveBlueNoteRoot, type ResolveBlueNoteRootOptions } from "../config/root"
import { UsageError } from "../core/errors"
import { ensureManagedRoot, getNormalNotesPath } from "../storage/root-layout"
import { createNoteRepository } from "../storage/note-repository"
import { readStateManifest } from "../storage/state-manifest"
import { createDirtyRecordRepository } from "./dirty-repository"
import { createFolderRepository } from "./folder-repository"
import { createSyncClientService } from "./client-service"
import { getNoteSyncEntityId } from "./mutation-tracking"
import { readSyncRuntimeMode, setSyncRuntimeMode } from "./runtime-mode"
import { createSyncStatusRepository } from "./status-repository"
import type { DownloadNoteBodyResponse, PullChangesRequest, PullChangesResponse, PushRequest, PushResponse } from "./protocol"
import type {
  SyncLinkOptions,
  SyncLinkSummary,
  SyncNowOptions,
  SyncNowSummary,
  SyncRepairOptions,
  SyncRepairSummary,
  SyncStatusView,
  SyncUnlinkSummary,
} from "./types"

export interface SyncTransport {
  pull(request: PullChangesRequest): PullChangesResponse
  push(request: PushRequest & { noteBodies?: Record<string, string> }): PushResponse
  downloadNoteBody(noteId: string): DownloadNoteBodyResponse
}

export type {
  SyncLinkOptions,
  SyncLinkSummary,
  SyncNowOptions,
  SyncNowSummary,
  SyncRepairOptions,
  SyncRepairSummary,
  SyncStatusView,
  SyncUnlinkSummary,
} from "./types"

function resolveManagedRoot(options: ResolveBlueNoteRootOptions = {}): string {
  return ensureManagedRoot(resolveBlueNoteRoot(options))
}

function normalizeFolderRelativePath(rootPath: string, folderPath: string): string {
  return path.relative(rootPath, folderPath).replace(/\\/g, "/")
}

function collectExistingNoteFolders(rootPath: string): string[] {
  const normalNotesPath = getNormalNotesPath(rootPath)
  const folders: string[] = []

  if (!existsSync(normalNotesPath)) {
    return folders
  }

  function visit(directoryPath: string): void {
    for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue
      }

      const entryPath = path.join(directoryPath, entry.name)
      folders.push(normalizeFolderRelativePath(rootPath, entryPath))
      visit(entryPath)
    }
  }

  visit(normalNotesPath)
  return folders.sort()
}

function assertSupportedLinkMode(mode: string): asserts mode is "seed-empty-server-from-local" {
  if (mode !== "seed-empty-server-from-local") {
    throw new UsageError("Unsupported sync link mode.", {
      hint: "Use mode 'seed-empty-server-from-local'.",
    })
  }
}

function assertValidServerUrl(serverUrl: string): void {
  try {
    const parsed = new URL(serverUrl)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Unsupported protocol")
    }
  } catch (error) {
    throw new UsageError("Invalid sync server URL.", {
      hint: "Provide an http:// or https:// sync server URL.",
      cause: error,
    })
  }
}

export function getCoreSyncStatus(options: ResolveBlueNoteRootOptions = {}): SyncStatusView {
  const rootPath = resolveBlueNoteRoot(options)
  const runtimeMode = readSyncRuntimeMode(rootPath)

  if (runtimeMode.mode === "standalone") {
    return {
      state: "unlinked",
      mode: "standalone",
      activity: "idle",
      pendingCount: 0,
      runningCount: 0,
      failedCount: 0,
      lastError: null,
    }
  }

  const workspaceId = runtimeMode.workspaceId
  if (!workspaceId) {
    throw new Error("Sync client runtime mode is missing a workspace ID.")
  }

  const identity = { role: "client" as const, workspaceId }
  const statusSummary = createSyncStatusRepository(rootPath, identity).readStatusSummary()
  const pendingCount = createDirtyRecordRepository(rootPath, identity).listDirtyRecords().length

  return {
    state: "linked",
    mode: "sync-client",
    activity: "idle",
    workspaceId,
    pendingCount,
    runningCount: statusSummary?.runningCount ?? 0,
    failedCount: statusSummary?.failedCount ?? 0,
    lastError: statusSummary?.lastError ?? null,
  }
}

export function linkCoreSync(options: SyncLinkOptions & ResolveBlueNoteRootOptions): SyncLinkSummary {
  const { mode, serverUrl, workspaceId: requestedWorkspaceId, ...rootOptions } = options
  assertSupportedLinkMode(mode)
  assertValidServerUrl(serverUrl)

  const rootPath = resolveManagedRoot(rootOptions)
  const workspaceId = requestedWorkspaceId ?? readStateManifest(rootPath).workspaceId
  if (!workspaceId) {
    throw new UsageError("Cannot link sync without a workspace ID.", {
      hint: "Initialize or repair the BlueNote root before linking sync.",
    })
  }

  const markedAt = new Date().toISOString()
  const identity = { role: "client" as const, workspaceId }
  const dirtyRepository = createDirtyRecordRepository(rootPath, identity)
  const folderRepository = createFolderRepository(rootPath, identity)
  const notes = createNoteRepository(rootPath).list()
  const folders = collectExistingNoteFolders(rootPath)

  for (const folder of folders) {
    folderRepository.upsertFolder({ relativePath: folder, createdAt: markedAt, updatedAt: markedAt })
    dirtyRepository.markDirty({
      entityType: "folder",
      entityId: folder,
      dirtyType: "upsert",
      markedAt,
      metadata: { relativePath: folder },
    })
  }

  for (const note of notes) {
    dirtyRepository.markDirty({
      entityType: "note",
      entityId: getNoteSyncEntityId(rootPath, note),
      dirtyType: "upsert",
      markedAt,
      metadata: { key: note.frontmatter.id, relativePath: note.sourcePath, title: note.frontmatter.title },
    })
  }

  createSyncStatusRepository(rootPath, identity).writeStatusSummary({
    pendingCount: notes.length + folders.length,
    runningCount: 0,
    failedCount: 0,
    updatedAt: markedAt,
    lastError: null,
  })

  setSyncRuntimeMode(rootPath, { mode: "sync-client", workspaceId })

  return {
    state: "linked",
    mode: "sync-client",
    workspaceId,
    serverUrl,
    dirtyRecordsMarked: notes.length + folders.length,
    notesMarked: notes.length,
    foldersMarked: folders.length,
  }
}

export function unlinkCoreSync(options: ResolveBlueNoteRootOptions = {}): SyncUnlinkSummary {
  const rootPath = resolveManagedRoot(options)
  setSyncRuntimeMode(rootPath, { mode: "standalone" })

  return {
    state: "unlinked",
    mode: "standalone",
    keptLocalNotes: true,
  }
}

export function syncCoreNow(options: SyncNowOptions & ResolveBlueNoteRootOptions = {}): SyncNowSummary {
  const { force: _force, transport, replicaId, ...rootOptions } = options
  const rootPath = resolveBlueNoteRoot(rootOptions)
  const runtimeMode = readSyncRuntimeMode(rootPath)

  if (runtimeMode.mode === "standalone") {
    return { status: "not-linked", pushed: 0, pulled: 0 }
  }

  if (!transport) {
    return { status: "transport-not-configured", pushed: 0, pulled: 0 }
  }

  if (!runtimeMode.workspaceId) {
    throw new Error("Sync client runtime mode is missing a workspace ID.")
  }

  return createSyncClientService({
    rootPath: resolveManagedRoot(rootOptions),
    workspaceId: runtimeMode.workspaceId,
    replicaId,
    transport,
  }).syncNow()
}

export function repairCoreSync(options: SyncRepairOptions & ResolveBlueNoteRootOptions = {}): SyncRepairSummary {
  return {
    dryRun: options.dryRun ?? true,
    changed: false,
    issuesFound: 0,
    repairsApplied: 0,
  }
}
