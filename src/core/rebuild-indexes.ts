import path from "node:path"
import { existsSync, readdirSync } from "node:fs"

import { resolveBlueNoteRoot, type ResolveBlueNoteRootOptions, STATE_NOTES_DIRECTORY } from "../config/root"
import { UsageError } from "./errors"
import { rebuildIndexStore, type IndexedNoteRecord } from "../index/index-store"
import { parseNoteFile } from "../storage/frontmatter"
import { parsePlainNote } from "../storage/plain-note"
import { createSidecarRepository } from "../storage/sidecar-repository"
import { createNoteRepository, type StoredNoteRecord } from "../storage/note-repository"
import type { ParsedNote } from "../storage/note-schema"
import { ensureManagedRoot, getArchiveNotesPath } from "../storage/root-layout"
import { migrateLegacyAppStateToData } from "../storage/app-state-migration"
import { assertPathInsideRoot } from "../platform/path-safety"

export interface RebuildIndexesOptions extends ResolveBlueNoteRootOptions {
  testHooks?: {
    listSidecarKeys?: (rootPath: string) => string[]
  }
}

export interface RebuildIndexesSummary {
  rootPath: string
  noteCount: number
  validationErrors: string[]
  metadataDatabasePath?: string
  searchIndexPath?: string
}

function keyFromRelativePath(relativePath: string): string {
  return path.basename(relativePath, ".md")
}

function collectErrorMessages(error: unknown): string[] {
  const messages: string[] = []
  const seen = new Set<unknown>()

  function visit(candidate: unknown): void {
    if (candidate === undefined || candidate === null || seen.has(candidate)) {
      return
    }

    seen.add(candidate)

    if (candidate instanceof AggregateError) {
      for (const nested of candidate.errors) {
        visit(nested)
      }
    }

    if (candidate instanceof Error && candidate.message.length > 0) {
      messages.push(candidate.message)
    }

    if (typeof candidate === "object" && candidate !== null && "cause" in candidate) {
      visit((candidate as { cause?: unknown }).cause)
    }
  }

  visit(error)

  return messages.length > 0 ? messages : [String(error)]
}

function listSidecarKeys(rootPath: string, testHooks?: RebuildIndexesOptions["testHooks"]): string[] {
  const sidecarDirectoryPath = path.join(rootPath, STATE_NOTES_DIRECTORY)

  if (!existsSync(sidecarDirectoryPath)) {
    return []
  }

  try {
    if (testHooks?.listSidecarKeys) {
      return testHooks.listSidecarKeys(rootPath)
    }

    return readdirSync(sidecarDirectoryPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.basename(entry.name, ".json"))
      .sort((left, right) => left.localeCompare(right))
  } catch (error) {
    throw new UsageError(`Could not scan sidecar directory '${STATE_NOTES_DIRECTORY}'.`, {
      hint: `Ensure BLUENOTE_ROOT/${STATE_NOTES_DIRECTORY} exists as a readable directory.`,
      cause: error,
    })
  }
}

function readLegacyFrontmatterNote(rawNote: string, relativePath: string) {
  try {
    return parseNoteFile(rawNote, relativePath)
  } catch {
    return null
  }
}

function pathIsInsideDirectory(directoryPath: string, targetPath: string): boolean {
  const relativePath = path.relative(path.resolve(directoryPath), path.resolve(targetPath))

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
}

export function rebuildIndexes(options: RebuildIndexesOptions = {}): RebuildIndexesSummary {
  const rootPath = ensureManagedRoot(resolveBlueNoteRoot(options))
  migrateLegacyAppStateToData(rootPath)
  const repository = createNoteRepository(rootPath)
  const sidecars = createSidecarRepository(rootPath)
  const notes: Array<IndexedNoteRecord | ParsedNote> = []
  const validationErrors: string[] = []
  let noteRecords: StoredNoteRecord[]

  try {
    noteRecords = repository.listNotePaths()
  } catch (error) {
    return {
      rootPath,
      noteCount: 0,
      validationErrors: collectErrorMessages(error),
    }
  }

  const noteRelativePathByKey = new Map<string, string>()

  for (const record of noteRecords) {
    noteRelativePathByKey.set(keyFromRelativePath(record.relativePath), record.relativePath)
  }

  for (const record of noteRecords) {
    const expectedKey = keyFromRelativePath(record.relativePath)
    let rawNote: string

    try {
      rawNote = repository.readRaw(record.notePath)
    } catch (error) {
      validationErrors.push(...collectErrorMessages(error))
      continue
    }

    const sidecarPath = sidecars.getSidecarPath(expectedKey)

    try {
      if (!existsSync(sidecarPath)) {
        const legacyNote = readLegacyFrontmatterNote(rawNote, record.relativePath)

        if (legacyNote !== null) {
          notes.push(legacyNote)
          continue
        }
      }

      const sidecar = sidecars.read(expectedKey)
      const plainNote = parsePlainNote(rawNote, record.relativePath)
      let isValid = true

      if (sidecar.key !== expectedKey) {
        validationErrors.push(
          `Sidecar '${path.join(STATE_NOTES_DIRECTORY, `${expectedKey}.json`)}' declares key '${sidecar.key}' but is stored for note key '${expectedKey}'.`,
        )
        isValid = false
      }

      if (path.normalize(sidecar.relativePath) !== path.normalize(record.relativePath)) {
        validationErrors.push(
          `Note metadata for '${sidecar.key}' points to '${sidecar.relativePath}' instead of '${record.relativePath}'.`,
        )
        isValid = false
      }

      if (!isValid) {
        continue
      }

      notes.push({
        key: sidecar.key,
        title: sidecar.title,
        description: sidecar.description,
        body: plainNote.body,
        relativePath: record.relativePath,
        createdAt: sidecar.createdAt,
        updatedAt: sidecar.updatedAt,
        archivedAt: sidecar.archivedAt,
      })
    } catch (error) {
      validationErrors.push(...collectErrorMessages(error))
    }
  }

  try {
    for (const sidecarKey of listSidecarKeys(rootPath, options.testHooks)) {
      if (noteRelativePathByKey.has(sidecarKey)) {
        continue
      }

      try {
        const sidecar = sidecars.read(sidecarKey)

        if (path.isAbsolute(sidecar.relativePath)) {
          throw new UsageError(
            `Sidecar '${path.join(STATE_NOTES_DIRECTORY, `${sidecarKey}.json`)}' declares absolute relativePath '${sidecar.relativePath}'.`,
          )
        }

        const sidecarNotePath = assertPathInsideRoot(rootPath, path.join(rootPath, sidecar.relativePath))
        const archiveNotesPath = getArchiveNotesPath(rootPath)

        if (pathIsInsideDirectory(archiveNotesPath, sidecarNotePath) && existsSync(sidecarNotePath)) {
          continue
        }

        validationErrors.push(
          `Sidecar '${path.join(STATE_NOTES_DIRECTORY, `${sidecarKey}.json`)}' points to missing note '${sidecar.relativePath}'.`,
        )
      } catch (error) {
        validationErrors.push(...collectErrorMessages(error))
      }
    }
  } catch (error) {
    validationErrors.push(...collectErrorMessages(error))
  }

  if (validationErrors.length > 0) {
    return {
      rootPath,
      noteCount: notes.length,
      validationErrors,
    }
  }

  const rebuilt = rebuildIndexStore({ rootPath, notes })

  return {
    rootPath,
    noteCount: rebuilt.noteCount,
    validationErrors,
    metadataDatabasePath: rebuilt.metadataDatabasePath,
    searchIndexPath: rebuilt.searchIndexPath,
  }
}
