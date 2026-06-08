import path from "node:path"
import { existsSync, readdirSync } from "node:fs"

import { resolveBlueNoteRoot, type ResolveBlueNoteRootOptions } from "../config/root"
import { enqueueDescribeNoteIfAiEnabled } from "../ai/enqueue-describe-note"
import { IndexValidationFailedError, UsageError } from "./errors"
import { createNoteDescription } from "../domain/note-description"
import { createDraftNoteKey, createNoteKey } from "../domain/note-key"
import { rebuildIndexes } from "./rebuild-indexes"
import { systemClock, type Clock } from "../platform/clock"
import { createNoteRepository } from "../storage/note-repository"
import { ensureManagedRoot, getStateNotesPath } from "../storage/root-layout"

export interface CreateNoteOptions extends ResolveBlueNoteRootOptions {
  type?: "draft" | "normal"
  title?: string
  body?: string
  destinationFolder?: string
  clock?: Clock
  randomSource?: () => number
  enqueueAi?: boolean
}

export interface CreateNoteSummary {
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

  if (!existsSync(stateNotesPath)) {
    return existingKeys
  }

  for (const entry of readdirSync(stateNotesPath, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue
    }

    existingKeys.add(path.basename(entry.name, ".json"))
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


export function createNote(options: CreateNoteOptions): CreateNoteSummary {
  const rootPath = ensureManagedRoot(resolveBlueNoteRoot(options))
  const clock = options.clock ?? systemClock
  const timestamp = clock.now().toISOString()
  const repository = createNoteRepository(rootPath)
  const existingKeys = listExistingCreateKeys(rootPath, repository)
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

  const rebuildSummary = rebuildIndexes({ override: rootPath })

  if (rebuildSummary.validationErrors.length > 0) {
    throw new IndexValidationFailedError(
      [`Created note '${key}', but derived indexes could not be rebuilt.`, ...rebuildSummary.validationErrors].join("\n"),
      {
        hint: "Run bn rebuild after fixing the reported validation errors.",
      },
    )
  }

  if (options.enqueueAi !== false) {
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
    key,
    title,
    description,
    rootPath,
    notePath: created.notePath,
    relativePath: created.relativePath,
  }
}
