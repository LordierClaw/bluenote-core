import path from "node:path"
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"

import { resolveBlueNoteRoot, type ResolveBlueNoteRootOptions } from "../config/root"
import { createNoteKey } from "../domain/note-key"
import { assertPathInsideRoot, joinPortableRelativePath } from "../platform/path-safety"
import { createNoteRepository } from "../storage/note-repository"
import { parsePlainNote, serializePlainNote } from "../storage/plain-note"
import { getNormalNotesPath } from "../storage/root-layout"
import { createSidecarRepository } from "../storage/sidecar-repository"
import type { NoteSidecar } from "../storage/sidecar-schema"
import { selectNote } from "./select-note"
import { UsageError } from "./errors"

export interface PromoteDraftOptions extends ResolveBlueNoteRootOptions {
  selector: string
  title: string
  destinationFolder: string
  updatedAt?: string
  randomSource?: () => number
}

export interface PromoteDraftSummary {
  previousKey: string
  key: string
  title: string
  previousRelativePath: string
  relativePath: string
  notePath: string
}

function normalizeFolderRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
}

function assertExistingNormalFolder(rootPath: string, destinationFolder: string): { relativePath: string; folderPath: string } {
  const relativePath = normalizeFolderRelativePath(destinationFolder)
  const normalRoot = getNormalNotesPath(rootPath)
  const folderPath = assertPathInsideRoot(rootPath, path.join(rootPath, relativePath))

  if (
    (relativePath !== "note" && !relativePath.startsWith("note/"))
    || relativePath.split("/").some((part) => part.startsWith("."))
    || !existsSync(folderPath)
    || !statSync(folderPath).isDirectory()
  ) {
    throw new UsageError(`Could not promote draft to '${relativePath}'.`, {
      hint: "Choose an existing folder under note/.",
    })
  }

  try {
    const realRootPath = realpathSync(rootPath)
    const realNormalRoot = realpathSync(normalRoot)
    const realFolderPath = realpathSync(folderPath)
    assertPathInsideRoot(realRootPath, realNormalRoot)
    assertPathInsideRoot(realNormalRoot, realFolderPath)
  } catch (error) {
    throw new UsageError(`Could not promote draft to '${relativePath}'.`, {
      hint: "Choose an existing folder under note/.",
      cause: error,
    })
  }

  return { relativePath, folderPath }
}

function updateLatestOpenedPathIfMatched(rootPath: string, previousRelativePath: string, nextRelativePath: string): void {
  const latestPath = path.join(rootPath, ".data", "latest-opened-note.json")
  try {
    const latest = JSON.parse(readFileSync(latestPath, "utf8")) as { relativePath?: unknown }
    if (latest.relativePath === previousRelativePath) {
      writeFileSync(latestPath, JSON.stringify({ ...latest, relativePath: nextRelativePath }, null, 2) + "\n", "utf8")
    }
  } catch {
    // Best-effort TUI state repair; promotion should not depend on optional UI state.
  }
}

export function promoteDraft(options: PromoteDraftOptions): PromoteDraftSummary {
  const rootPath = resolveBlueNoteRoot(options)
  const repository = createNoteRepository(rootPath)
  const sidecars = createSidecarRepository(rootPath)
  const selected = selectNote({ repository, selector: options.selector, visibility: "drafts" })
  const previousKey = selected.frontmatter.id
  const previousRelativePath = selected.sourcePath
  const previousNotePath = assertPathInsideRoot(rootPath, path.join(rootPath, previousRelativePath))
  const previousSidecarPath = sidecars.getSidecarPath(previousKey)
  const existingSidecar = existsSync(previousSidecarPath) ? sidecars.read(previousKey) : null

  if (existingSidecar?.type !== "draft" || !previousRelativePath.startsWith("draft/")) {
    throw new UsageError(`Could not promote note '${previousRelativePath}'.`, {
      hint: "Only draft notes under draft/ can be saved as normal notes.",
    })
  }

  const destination = assertExistingNormalFolder(rootPath, options.destinationFolder)
  const title = options.title.trim()
  if (!title) {
    throw new UsageError(`Could not promote draft '${previousRelativePath}'.`, { hint: "Title is required." })
  }

  let nextKey: string
  try {
    nextKey = createNoteKey(title, {
      isUnique: (candidate) => candidate !== previousKey && !repository.keyExists(candidate),
      maxAttempts: 1,
      randomSource: options.randomSource,
    })
  } catch (error) {
    throw new UsageError(`Could not promote draft '${previousRelativePath}'.`, {
      hint: "The generated key already exists. Change the title and retry, or remove the conflicting note first.",
      cause: error,
    })
  }

  const nextRelativePath = joinPortableRelativePath(destination.relativePath, `${nextKey}.md`)
  const nextNotePath = assertPathInsideRoot(rootPath, path.join(rootPath, nextRelativePath))
  const nextSidecarPath = sidecars.getSidecarPath(nextKey)
  if ((nextNotePath !== previousNotePath && existsSync(nextNotePath)) || (nextKey !== previousKey && existsSync(nextSidecarPath))) {
    throw new UsageError(`Could not promote draft '${previousRelativePath}'.`, {
      hint: "A note with the generated key already exists in the destination.",
    })
  }

  const plain = parsePlainNote(readFileSync(previousNotePath, "utf8"), previousRelativePath)
  const nextMarkdown = serializePlainNote({ body: plain.body, sourcePath: nextRelativePath })
  const nextSidecar: NoteSidecar = {
    ...existingSidecar,
    type: "normal",
    key: nextKey,
    title,
    relativePath: nextRelativePath,
    updatedAt: options.updatedAt ?? new Date().toISOString(),
    archivedAt: null,
  }

  let wroteNextNote = false
  let wroteNextSidecar = false
  let removedPreviousNote = false
  let removedPreviousSidecar = false
  try {
    mkdirSync(path.dirname(nextNotePath), { recursive: true })
    writeFileSync(nextNotePath, nextMarkdown, { encoding: "utf8", flag: nextNotePath === previousNotePath ? "w" : "wx" })
    wroteNextNote = true
    sidecars.write(nextSidecar)
    wroteNextSidecar = true
    if (nextNotePath !== previousNotePath) {
      rmSync(previousNotePath)
      removedPreviousNote = true
    }
    if (nextSidecarPath !== previousSidecarPath) {
      rmSync(previousSidecarPath, { force: true })
      removedPreviousSidecar = true
    }
  } catch (error) {
    const rollbackErrors: unknown[] = []
    if (removedPreviousNote) {
      try {
        writeFileSync(previousNotePath, serializePlainNote({ body: plain.body, sourcePath: previousRelativePath }), "utf8")
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    if (removedPreviousSidecar && existingSidecar) {
      try { sidecars.write(existingSidecar) } catch (rollbackError) { rollbackErrors.push(rollbackError) }
    }
    if (wroteNextNote && nextNotePath !== previousNotePath && existsSync(nextNotePath)) {
      try { rmSync(nextNotePath, { force: true }) } catch (rollbackError) { rollbackErrors.push(rollbackError) }
    }
    if (wroteNextSidecar && nextSidecarPath !== previousSidecarPath && existsSync(nextSidecarPath)) {
      try { rmSync(nextSidecarPath, { force: true }) } catch (rollbackError) { rollbackErrors.push(rollbackError) }
    }
    throw new UsageError(`Could not promote draft '${previousRelativePath}'.`, {
      hint: "Ensure the draft, destination folder, and sidecars are writable inside BLUENOTE_ROOT.",
      cause: rollbackErrors.length > 0 ? new AggregateError([error, ...rollbackErrors], "Promotion failed and rollback also failed.") : error,
    })
  }

  updateLatestOpenedPathIfMatched(rootPath, previousRelativePath, nextRelativePath)
  return { previousKey, key: nextKey, title, previousRelativePath, relativePath: nextRelativePath, notePath: nextNotePath }
}
