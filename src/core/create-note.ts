import path from "node:path"
import { existsSync, readdirSync, rmSync } from "node:fs"

import { resolveBlueNoteRoot, type ResolveBlueNoteRootOptions } from "../config/root"
import { enqueueDescribeNoteIfAiEnabled } from "../ai/enqueue-describe-note"
import { IndexValidationFailedError, UsageError } from "./errors"
import { createNoteDescription } from "../domain/note-description"
import { createDraftNoteKey, createNoteKey } from "../domain/note-key"
import { rebuildIndexes } from "./rebuild-indexes"
import { systemClock, type Clock } from "../platform/clock"
import { createNoteId } from "../platform/ids"
import { createNoteRepository } from "../storage/note-repository"
import { ensureManagedRoot, getStateNotesPath } from "../storage/root-layout"
import { createSidecarRepository } from "../storage/sidecar-repository"
import { recordSyncMutationBestEffort } from "../sync/mutation-tracking"
import { readSyncRuntimeMode } from "../sync/runtime-mode"

const STORAGE_SAFE_NOTE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

export interface CreateNoteOptions extends ResolveBlueNoteRootOptions {
  type?: "draft" | "normal"
  title?: string
  body?: string
  destinationFolder?: string
  clock?: Clock
  randomSource?: () => number
  noteIdGenerator?: () => string
  enqueueAi?: boolean
}

export interface CreateNoteSummary {
  noteId: string
  key: string
  title: string
  description: string
  rootPath: string
  notePath: string
  relativePath: string
}

function listExistingCreateKeys(rootPath: string, repository: ReturnType<typeof createNoteRepository>): Set<string> {
  const existingKeys = new Set(repository.listNotePaths().map((record) => path.basename(record.relativePath, ".md")))
  const stateNotesPath = getStateNotesPath(rootPath)
  const sidecars = createSidecarRepository(rootPath)

  if (!existsSync(stateNotesPath)) {
    return existingKeys
  }

  for (const entry of readdirSync(stateNotesPath, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue
    }

    const storageIdentifier = path.basename(entry.name, ".json")

    try {
      existingKeys.add(sidecars.read(storageIdentifier).key)
    } catch {
      existingKeys.add(storageIdentifier)
    }
  }
  return existingKeys
}

function enqueueAiDescriptionAfterCreate(
  rootPath: string,
  input: { key: string; title: string; description: string; body: string; relativePath: string; clock: Clock },
): void {
  enqueueDescribeNoteIfAiEnabled(rootPath, {
    key: input.key,
    relativePath: input.relativePath,
    title: input.title,
    body: input.body,
    currentDescription: input.description,
  }, { clock: input.clock, warn: (message) => console.warn(message) })
}

function shouldEnqueueLocalAiDescription(rootPath: string): boolean {
  try {
    return readSyncRuntimeMode(rootPath).mode !== "sync-client"
  } catch {
    return true
  }
}


function rollbackCreatedNoteArtifacts(rootPath: string, created: { notePath: string }, noteId: string): void {
  rmSync(created.notePath, { force: true })
  rmSync(createSidecarRepository(rootPath).getSidecarPathByNoteId(noteId), { force: true })
}

export function createNote(options: CreateNoteOptions): CreateNoteSummary {
  const rootPath = ensureManagedRoot(resolveBlueNoteRoot(options))
  const clock = options.clock ?? systemClock
  const timestamp = clock.now().toISOString()
  const repository = createNoteRepository(rootPath)
  const existingKeys = listExistingCreateKeys(rootPath, repository)
  const noteId = (options.noteIdGenerator ?? createNoteId)()
  if (!STORAGE_SAFE_NOTE_ID_PATTERN.test(noteId)) {
    throw new UsageError("Generated noteId must be a non-empty storage-safe string.", {
      hint: "Use a note ID containing only letters, numbers, underscores, and hyphens.",
    })
  }
  const type = options.type ?? "draft"
  let title: string
  let key: string
  let destination: { type: "draft" } | { type: "normal"; folderRelativePath: string }

  if (type === "normal") {
    if (options.title === undefined || options.title.trim().length === 0) {
      throw new UsageError("Normal note creation requires a title.", {
        hint: "Pass a title when creating a normal note.",
      })
    }

    if (options.destinationFolder === undefined || options.destinationFolder.trim().length === 0) {
      throw new UsageError("Normal note creation requires an explicit destination folder.", {
        hint: "Pass --path note/<folder> or destinationFolder when creating a normal note.",
      })
    }

    const destinationFolder = options.destinationFolder

    title = options.title
    key = createNoteKey(title, {
      isUnique: (candidate) => !existingKeys.has(candidate),
      randomSource: options.randomSource,
    })
    destination = { type: "normal", folderRelativePath: destinationFolder }
  } else if (options.title === undefined || options.title.trim().length === 0) {
    key = createDraftNoteKey({
      isUnique: (candidate) => !existingKeys.has(candidate),
      randomSource: options.randomSource,
    })
    title = key
    destination = { type: "draft" }
  } else {
    title = options.title
    key = createNoteKey(title, {
      isUnique: (candidate) => !existingKeys.has(candidate),
      randomSource: options.randomSource,
    })
    destination = { type: "draft" }
  }

  const description = createNoteDescription(options.body ?? "")
  const created = repository.create({
    noteId,
    frontmatter: {
      id: key,
      schemaVersion: 1,
      title,
      mode: "plain",
      tags: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    body: options.body ?? "",
    destination,
  })

  try {
    recordSyncMutationBestEffort(rootPath, {
      notes: [{
        entityId: noteId,
        markedAt: timestamp,
        metadata: { key, relativePath: created.relativePath, title },
      }],
      folders: destination.type === "normal" ? [{ relativePath: destination.folderRelativePath, markedAt: timestamp }] : undefined,
    })
  } catch (error) {
    rollbackCreatedNoteArtifacts(rootPath, created, noteId)
    throw error
  }

  const rebuildSummary = rebuildIndexes({ override: rootPath })

  if (rebuildSummary.validationErrors.length > 0) {
    throw new IndexValidationFailedError(
      [`Created note '${key}', but derived indexes could not be rebuilt.`, ...rebuildSummary.validationErrors].join("\n"),
      {
        hint: "Run bn rebuild after fixing the reported validation errors.",
      },
    )
  }

  if (options.enqueueAi !== false && shouldEnqueueLocalAiDescription(rootPath)) {
    enqueueAiDescriptionAfterCreate(rootPath, {
      key,
      title,
      description,
      body: options.body ?? "",
      relativePath: created.relativePath,
      clock,
    })
  }

  return {
    noteId,
    key,
    title,
    description,
    rootPath,
    notePath: created.notePath,
    relativePath: created.relativePath,
  }
}
