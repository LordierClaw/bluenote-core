import path from "node:path"
import { existsSync, readdirSync } from "node:fs"

import { APP_STATE_NOTES_DIRECTORY } from "../config/root"
import type { ParsedNote } from "../storage/note-schema"
import { createSidecarRepository } from "../storage/sidecar-repository"
import { createDirtyRecordRepository } from "./dirty-repository"
import { createFolderRepository } from "./folder-repository"
import { getSyncClientRuntimeMode } from "./runtime-mode"
import { createSyncStatusRepository } from "./status-repository"
import { createTombstoneRepository } from "./tombstone-repository"
import type { SyncJsonObject } from "./sync-db"

export interface DirtyNoteInput {
  entityId: string
  dirtyType?: "upsert" | "delete"
  markedAt: string
  metadata?: SyncJsonObject
}

export interface DirtyFolderInput {
  relativePath: string
  markedAt: string
}

export interface TombstoneInput {
  entityId: string
  deletedAt: string
  previousRelativePath: string
  previousTitle: string
}

export interface SyncMutationInput {
  notes?: DirtyNoteInput[]
  folders?: DirtyFolderInput[]
  tombstones?: TombstoneInput[]
}

export function getNoteSyncEntityId(rootPath: string, note: Pick<ParsedNote, "frontmatter" | "sourcePath">): string {
  const sidecars = createSidecarRepository(rootPath)
  const notesDirectoryPath = path.join(rootPath, APP_STATE_NOTES_DIRECTORY)

  if (existsSync(notesDirectoryPath)) {
    for (const entry of readdirSync(notesDirectoryPath, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue
      }

      const storageIdentifier = path.basename(entry.name, ".json")
      try {
        const sidecar = sidecars.read(storageIdentifier)
        if (sidecar.key === note.frontmatter.id && path.normalize(sidecar.relativePath) === path.normalize(note.sourcePath)) {
          return sidecar.noteId ?? sidecar.key
        }
      } catch {
        // Ignore malformed optional sidecars; fall back to the note key below.
      }
    }
  }

  return note.frontmatter.id
}

function countPending(rootPath: string, workspaceId: string): number {
  return createDirtyRecordRepository(rootPath, { role: "client", workspaceId }).listDirtyRecords().length
}

export function recordSyncMutationBestEffort(rootPath: string, input: SyncMutationInput): void {
  const runtimeMode = getSyncClientRuntimeMode(rootPath)

  if (runtimeMode === null) {
    return
  }

  try {
    const identity = { role: "client" as const, workspaceId: runtimeMode.workspaceId }
    const dirtyRepository = createDirtyRecordRepository(rootPath, identity)
    const folderRepository = createFolderRepository(rootPath, identity)
    const tombstoneRepository = createTombstoneRepository(rootPath, identity)

    for (const folder of input.folders ?? []) {
      folderRepository.upsertFolder({
        relativePath: folder.relativePath,
        createdAt: folder.markedAt,
        updatedAt: folder.markedAt,
      })
      dirtyRepository.markDirty({
        entityType: "folder",
        entityId: folder.relativePath,
        dirtyType: "upsert",
        markedAt: folder.markedAt,
        metadata: { relativePath: folder.relativePath },
      })
    }

    for (const tombstone of input.tombstones ?? []) {
      tombstoneRepository.recordTombstone({
        entityType: "note",
        entityId: tombstone.entityId,
        deletedAt: tombstone.deletedAt,
        previousRelativePath: tombstone.previousRelativePath,
        previousTitle: tombstone.previousTitle,
      })
    }

    for (const note of input.notes ?? []) {
      dirtyRepository.markDirty({
        entityType: "note",
        entityId: note.entityId,
        dirtyType: note.dirtyType ?? "upsert",
        markedAt: note.markedAt,
        metadata: note.metadata,
      })
    }

    try {
      createSyncStatusRepository(rootPath, identity).writeStatusSummary({
        pendingCount: countPending(rootPath, runtimeMode.workspaceId),
        runningCount: 0,
        failedCount: 0,
        updatedAt: new Date().toISOString(),
        lastError: null,
      })
    } catch {
      // Non-critical status logging must not block the local mutation.
    }
  } catch {
    // Dirty tracking is retryable sync bookkeeping; local persistence remains authoritative.
  }
}
