import path from "node:path"
import { readFileSync, writeFileSync } from "node:fs"

import { resolveBlueNoteRoot, type ResolveBlueNoteRootOptions } from "../config/root"
import { createNoteRepository } from "../storage/note-repository"
import { getNoteSyncEntityId, recordSyncMutationBestEffort } from "../sync/mutation-tracking"
import { selectNote } from "./select-note"
import { UsageError } from "./errors"
import { createSidecarRepository } from "../storage/sidecar-repository"
import { restoreFileSnapshots, snapshotFiles } from "./file-snapshot"

export interface MoveNoteOptions extends ResolveBlueNoteRootOptions {
  selector: string
  destinationFolder: string
  updatedAt?: string
}

export interface MoveNoteSummary {
  previousKey: string
  key: string
  title: string
  previousRelativePath: string
  relativePath: string
  notePath: string
}

function updateLatestOpenedPathIfMatched(rootPath: string, previousRelativePath: string, nextRelativePath: string): void {
  const latestPath = path.join(rootPath, ".data", "latest-opened-note.json")
  try {
    const latest = JSON.parse(readFileSync(latestPath, "utf8")) as { relativePath?: unknown }
    if (latest.relativePath === previousRelativePath) {
      writeFileSync(latestPath, JSON.stringify({ ...latest, relativePath: nextRelativePath }, null, 2) + "\n", "utf8")
    }
  } catch {
    // Best-effort state repair; move success should not depend on optional UI state.
  }
}

function normalizeDestinationFolder(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+|\/+$/g, "")
}

export function moveNote(options: MoveNoteOptions): MoveNoteSummary {
  const rootPath = resolveBlueNoteRoot(options)
  const repository = createNoteRepository(rootPath)
  const selected = selectNote({ repository, selector: options.selector })
  const syncEntityId = getNoteSyncEntityId(rootPath, selected)
  const markedAt = options.updatedAt ?? new Date().toISOString()
  const nextPath = path.join(rootPath, normalizeDestinationFolder(options.destinationFolder), path.basename(selected.sourcePath))
  const snapshots = snapshotFiles([
    path.join(rootPath, selected.sourcePath),
    nextPath,
    createSidecarRepository(rootPath).getSidecarPathByNoteId(syncEntityId),
  ])

  try {
    const moved = repository.moveNote(path.join(rootPath, selected.sourcePath), options.destinationFolder, markedAt)
    updateLatestOpenedPathIfMatched(rootPath, moved.previousRelativePath, moved.relativePath)
    try {
      recordSyncMutationBestEffort(rootPath, {
        notes: [{
          entityId: syncEntityId,
          markedAt,
          metadata: {
            key: moved.key,
            previousRelativePath: moved.previousRelativePath,
            relativePath: moved.relativePath,
            title: selected.frontmatter.title,
          },
        }],
        folders: [{ relativePath: options.destinationFolder, markedAt }],
      })
    } catch (error) {
      restoreFileSnapshots(snapshots)
      throw error
    }
    return {
      ...moved,
      title: selected.frontmatter.title,
    }
  } catch (error) {
    if (error instanceof UsageError) {
      throw error
    }

    throw new UsageError(`Could not move note '${selected.sourcePath}'.`, {
      hint: "Choose an existing folder under note/ for normal note moves.",
      cause: error,
    })
  }
}
