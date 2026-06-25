import path from "node:path"
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs"

import { APP_STATE_NOTES_DIRECTORY } from "../config/root"
import { createNoteDescription } from "../domain/note-description"
import { createNoteId } from "../platform/ids"
import type { ParsedNote } from "../storage/note-schema"
import { serializePlainNote } from "../storage/plain-note"
import type { NoteSidecar } from "../storage/sidecar-schema"
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

function sidecarTypeForNote(note: Pick<ParsedNote, "frontmatter" | "sourcePath">): NoteSidecar["type"] {
  if (note.frontmatter.archivedAt !== undefined || note.sourcePath.startsWith(".data/archive/")) {
    return "archived"
  }
  if (note.sourcePath.startsWith("draft/")) {
    return "draft"
  }
  return "normal"
}

function writeStableSidecarForLegacyNote(rootPath: string, note: Pick<ParsedNote, "frontmatter" | "sourcePath" | "body">): string {
  const sidecars = createSidecarRepository(rootPath)
  const noteId = createNoteId()
  const notePath = path.join(rootPath, note.sourcePath)
  sidecars.write({
    type: sidecarTypeForNote(note),
    noteId,
    key: note.frontmatter.id,
    title: note.frontmatter.title,
    description: createNoteDescription(note.body),
    relativePath: note.sourcePath,
    createdAt: note.frontmatter.createdAt,
    updatedAt: note.frontmatter.updatedAt,
    archivedAt: note.frontmatter.archivedAt ?? null,
    namingVersion: 1,
  })
  writeFileSync(notePath, serializePlainNote({ sourcePath: note.sourcePath, body: note.body }), "utf8")
  return noteId
}

export function getNoteSyncEntityId(rootPath: string, note: Pick<ParsedNote, "frontmatter" | "sourcePath" | "body">): string {
  const sidecars = createSidecarRepository(rootPath)
  const notesDirectoryPath = path.join(rootPath, APP_STATE_NOTES_DIRECTORY)

  if (existsSync(notesDirectoryPath)) {
    for (const entry of readdirSync(notesDirectoryPath, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue
      }

      const storageIdentifier = path.basename(entry.name, ".json")
      let sidecar: NoteSidecar
      try {
        sidecar = sidecars.read(storageIdentifier)
      } catch {
        // Ignore malformed optional sidecars; fall back to the note key below.
        continue
      }

      if (sidecar.key === note.frontmatter.id && path.normalize(sidecar.relativePath) === path.normalize(note.sourcePath)) {
        return sidecar.noteId ?? storageIdentifier
      }
    }
  }

  return note.frontmatter.id
}

export function ensureNoteSyncEntityIdForSyncSeed(rootPath: string, note: Pick<ParsedNote, "frontmatter" | "sourcePath" | "body">): string {
  const sidecars = createSidecarRepository(rootPath)
  const notesDirectoryPath = path.join(rootPath, APP_STATE_NOTES_DIRECTORY)

  if (existsSync(notesDirectoryPath)) {
    for (const entry of readdirSync(notesDirectoryPath, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue
      }

      const storageIdentifier = path.basename(entry.name, ".json")
      let sidecar: NoteSidecar
      try {
        sidecar = sidecars.read(storageIdentifier)
      } catch {
        continue
      }

      if (sidecar.key === note.frontmatter.id && path.normalize(sidecar.relativePath) === path.normalize(note.sourcePath)) {
        if (sidecar.noteId !== undefined) {
          return sidecar.noteId
        }

        const noteId = createNoteId()
        sidecars.write({ ...sidecar, noteId })
        if (storageIdentifier !== noteId) {
          rmSync(sidecars.getSidecarPath(storageIdentifier), { force: true })
        }
        return noteId
      }
    }
  }

  return writeStableSidecarForLegacyNote(rootPath, note)
}

function countPending(rootPath: string, workspaceId: string): number {
  return createDirtyRecordRepository(rootPath, { role: "client", workspaceId }).listDirtyRecords().length
}

function normalizeFolderRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
}

export function recordSyncMutationBestEffort(rootPath: string, input: SyncMutationInput): void {
  let runtimeMode: ReturnType<typeof getSyncClientRuntimeMode>
  try {
    runtimeMode = getSyncClientRuntimeMode(rootPath)
  } catch (error) {
    console.warn(error instanceof Error ? error.message : "Could not read sync runtime mode config.")
    return
  }

  if (runtimeMode === null) {
    return
  }

  try {
    const identity = { role: "client" as const, workspaceId: runtimeMode.workspaceId }
    const dirtyRepository = createDirtyRecordRepository(rootPath, identity)
    const folderRepository = createFolderRepository(rootPath, identity)
    const tombstoneRepository = createTombstoneRepository(rootPath, identity)

    for (const folder of input.folders ?? []) {
      const relativePath = normalizeFolderRelativePath(folder.relativePath)
      folderRepository.upsertFolder({
        relativePath,
        createdAt: folder.markedAt,
        updatedAt: folder.markedAt,
      })
      dirtyRepository.markDirty({
        entityType: "folder",
        entityId: relativePath,
        dirtyType: "upsert",
        markedAt: folder.markedAt,
        metadata: { relativePath },
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

    createSyncStatusRepository(rootPath, identity).writeStatusSummary({
      pendingCount: countPending(rootPath, runtimeMode.workspaceId),
      runningCount: 0,
      failedCount: 0,
      updatedAt: new Date().toISOString(),
      lastError: null,
    })
  } catch {
    // Sync tracking is best-effort after local note mutations have already been persisted.
  }
}
