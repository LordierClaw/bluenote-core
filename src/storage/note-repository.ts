import path from "node:path"
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"

import { UsageError } from "../core/errors"
import { createNoteDescription } from "../domain/note-description"
import { assertPathInsideRoot, joinPortableRelativePath, toRootRelativePath } from "../platform/path-safety"
import { parseNoteFile } from "./frontmatter"
import { type PlainNote, validateNoteFrontmatter } from "./note-schema"
import type { NoteFrontmatter, ParsedNote } from "./note-schema"
import { parsePlainNote, serializePlainNote } from "./plain-note"
import { createSidecarRepository } from "./sidecar-repository"
import type { NoteSidecar, NoteType } from "./sidecar-schema"
import { replaceNoteBodyAtomically } from "./atomic-note-writer"
import { getArchiveNotePath, getArchiveNotesPath, getDraftNotesPath, getInboxNotePath, getNormalNotesPath, getStateNotesPath } from "./root-layout"

export interface CreateStoredNoteInput {
  frontmatter: NoteFrontmatter
  body: string
  destination?: CreateStoredNoteDestination
}

export type CreateStoredNoteDestination =
  | { type: "draft" }
  | { type: "normal"; folderRelativePath: string }

export interface StoredNoteRecord {
  notePath: string
  relativePath: string
}

export interface SyncStoredNoteInput {
  title: string
  body: string
  updatedAt: string
}

export interface RenameStoredNoteInput extends SyncStoredNoteInput {
  nextKey: string
}

export interface RenamedStoredNoteRecord extends StoredNoteRecord {
  previousKey: string
  key: string
  previousRelativePath: string
}

export interface NoteRepository {
  create(input: CreateStoredNoteInput): StoredNoteRecord
  read(notePath: string): ParsedNote
  readRaw(notePath: string): string
  syncEditedNote(notePath: string, input: SyncStoredNoteInput): StoredNoteRecord
  rename(notePath: string, input: RenameStoredNoteInput): RenamedStoredNoteRecord
  renameFolder(folderRelativePath: string, nextName: string): { previousRelativePath: string; relativePath: string }
  moveNote(notePath: string, destinationFolderRelativePath: string, updatedAt?: string): RenamedStoredNoteRecord
  keyExists(key: string): boolean
  archive(notePath: string, archivedAt: string): StoredNoteRecord
  delete(notePath: string): StoredNoteRecord
  list(): ParsedNote[]
  listNotePaths(): StoredNoteRecord[]
}

const NOTES_RELATIVE_PATH = "notes"
const NOTE_SCHEMA_VERSION = 1
const NOTE_MODE = "plain"
const NOTE_NAMING_VERSION = 1

class NoteMetadataPathMismatchError extends UsageError {}

function assertCreateFrontmatterIsSupported(frontmatter: NoteFrontmatter): void {
  if (
    frontmatter.schemaVersion !== NOTE_SCHEMA_VERSION ||
    frontmatter.mode !== NOTE_MODE ||
    frontmatter.tags.length > 0 ||
    frontmatter.archivedAt !== undefined
  ) {
    throw new UsageError(
      `Could not create note '${frontmatter.id}': create only supports schemaVersion=${NOTE_SCHEMA_VERSION}, mode='${NOTE_MODE}', an empty tags array, and no archivedAt value.`,
      {
        hint: "Pass canonical plain-note frontmatter or extend note persistence to round-trip additional metadata.",
      },
    )
  }
}

function getCreateValidationSourcePath(frontmatter: unknown): string {
  if (typeof frontmatter === "object" && frontmatter !== null) {
    const candidateId = (frontmatter as { id?: unknown }).id

    if (typeof candidateId === "string" && candidateId.length > 0) {
      return joinPortableRelativePath("note", `${candidateId}.md`)
    }
  }

  return joinPortableRelativePath("note", "<unknown>.md")
}

function wrapRepositoryError(action: "create" | "read" | "list" | "archive" | "delete", relativePath: string, error: unknown): never {
  const message =
    action === "create"
      ? `Could not create note '${relativePath}'.`
      : action === "read"
        ? `Could not read note '${relativePath}'.`
        : action === "archive"
          ? `Could not archive note '${relativePath}'.`
          : action === "delete"
            ? `Could not delete note '${relativePath}'.`
            : `Could not list notes in '${relativePath}'.`
  const hint =
    action === "create"
      ? "Ensure BLUENOTE_ROOT points to a writable directory path."
      : action === "read"
        ? "Ensure the note exists inside BLUENOTE_ROOT and is readable."
        : action === "archive"
          ? "Ensure the note exists inside BLUENOTE_ROOT and the archive path is writable."
          : action === "delete"
            ? "Ensure the note exists inside BLUENOTE_ROOT and any matching sidecar is writable."
            : "Ensure BLUENOTE_ROOT points to a readable managed root."

  throw new UsageError(message, {
    hint,
    cause: error,
  })
}

function collectMarkdownFiles(rootPath: string, currentPath: string, files: string[]): void {
  for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
    const entryPath = path.join(currentPath, entry.name)

    if (entry.isDirectory()) {
      collectMarkdownFiles(rootPath, entryPath, files)
      continue
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(assertPathInsideRoot(rootPath, entryPath))
    }
  }
}

function deriveDescription(body: string): string {
  return createNoteDescription(body)
}

function keyFromNotePath(notePath: string): string {
  return path.basename(notePath, ".md")
}

function notePathFromRelativePath(rootPath: string, relativePath: string): string {
  return assertPathInsideRoot(rootPath, path.join(rootPath, relativePath))
}

function normalizeInputRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\.\//, "")
}

function relativePathHasHiddenSegment(relativePath: string): boolean {
  return relativePath.split("/").some((segment) => segment.startsWith("."))
}

function destinationFolderIsUsableNormalFolder(normalNotesPath: string, candidateFolderPath: string): boolean {
  if (!existsSync(candidateFolderPath) || !statSync(candidateFolderPath).isDirectory()) {
    return false
  }

  try {
    assertPathInsideRoot(realpathSync(normalNotesPath), realpathSync(candidateFolderPath))
    return true
  } catch {
    return false
  }
}

function resolveCreateNotePath(
  rootPath: string,
  frontmatter: NoteFrontmatter,
  destination?: CreateStoredNoteDestination,
): { notePath: string; relativePath: string } {
  if (destination?.type === "draft") {
    const draftPath = getDraftNotesPath(rootPath)
    const notePath = assertPathInsideRoot(draftPath, path.join(draftPath, `${frontmatter.id}.md`))

    return { notePath, relativePath: toRootRelativePath(rootPath, notePath) }
  }

  if (destination?.type === "normal") {
    const normalizedFolderRelativePath = normalizeInputRelativePath(destination.folderRelativePath)
    const candidateFolderPath = assertPathInsideRoot(rootPath, path.join(rootPath, normalizedFolderRelativePath))
    const normalNotesPath = getNormalNotesPath(rootPath)
    const relativePath = joinPortableRelativePath(normalizedFolderRelativePath, `${frontmatter.id}.md`)

    if (
      !normalizedFolderRelativePath.startsWith("note") ||
      (normalizedFolderRelativePath !== "note" && !normalizedFolderRelativePath.startsWith("note/")) ||
      relativePathHasHiddenSegment(normalizedFolderRelativePath) ||
      !destinationFolderIsUsableNormalFolder(normalNotesPath, candidateFolderPath)
    ) {
      throw new UsageError(`Could not create note '${relativePath}'.`, {
        hint: "Choose an existing folder under note/ for normal note creation.",
      })
    }

    const notePath = assertPathInsideRoot(normalNotesPath, path.join(candidateFolderPath, `${frontmatter.id}.md`))

    return { notePath, relativePath: toRootRelativePath(rootPath, notePath) }
  }

  const notePath = getInboxNotePath(rootPath, frontmatter.id)

  return { notePath, relativePath: toRootRelativePath(rootPath, notePath) }
}

function createPlainNoteMarkdown(relativePath: string, body: string): string {
  return serializePlainNote({
    body,
    sourcePath: relativePath,
  })
}

function noteKeyExists(rootPath: string, key: string): boolean {
  const notePaths: string[] = []

  for (const notesPath of [getNormalNotesPath(rootPath), getDraftNotesPath(rootPath)]) {
    if (!existsSync(notesPath)) {
      continue
    }

    collectMarkdownFiles(rootPath, notesPath, notePaths)
  }

  return notePaths.some((notePath) => keyFromNotePath(notePath) === key)
}

function assertUniqueNoteKeys(rootPath: string, notePaths: readonly string[]): void {
  const firstRelativePathByKey = new Map<string, string>()

  for (const notePath of notePaths) {
    const key = keyFromNotePath(notePath)
    const relativePath = toRootRelativePath(rootPath, notePath)
    const firstRelativePath = firstRelativePathByKey.get(key)

    if (firstRelativePath !== undefined) {
      throw new UsageError(
        `Found duplicate note key '${key}' for '${firstRelativePath}' and '${relativePath}'. Note basenames must be globally unique across note, draft, and archive storage.`,
        {
          hint: "Rename or remove one of the duplicate note files so each note basename/key is unique under note/, draft/, and .data/archive/.",
        },
      )
    }

    firstRelativePathByKey.set(key, relativePath)
  }
}

function inferNoteType(relativePath: string, archivedAt: string | null): NoteType {
  if (archivedAt !== null || relativePath.startsWith(".data/archive/")) {
    return "archived"
  }

  if (relativePath.startsWith("draft/")) {
    return "draft"
  }

  return "normal"
}

function buildSidecar(frontmatter: NoteFrontmatter, relativePath: string, body: string, archivedAt: string | null): NoteSidecar {
  return {
    type: inferNoteType(relativePath, archivedAt),
    key: frontmatter.id,
    title: frontmatter.title,
    description: deriveDescription(body),
    relativePath,
    createdAt: frontmatter.createdAt,
    updatedAt: frontmatter.updatedAt,
    archivedAt,
    namingVersion: NOTE_NAMING_VERSION,
  }
}

function buildParsedNote(sidecar: NoteSidecar, plainNote: PlainNote): ParsedNote {
  return {
    body: plainNote.body,
    sourcePath: plainNote.sourcePath,
    frontmatter: {
      id: sidecar.key,
      schemaVersion: NOTE_SCHEMA_VERSION,
      title: sidecar.title,
      mode: NOTE_MODE,
      tags: [],
      createdAt: sidecar.createdAt,
      updatedAt: sidecar.updatedAt,
      ...(sidecar.archivedAt === null ? {} : { archivedAt: sidecar.archivedAt }),
    },
  }
}

function buildExistingSidecar(note: ParsedNote): NoteSidecar {
  return buildSidecar(note.frontmatter, note.sourcePath, note.body, note.frontmatter.archivedAt ?? null)
}

function normalizeFolderRelativePath(relativePath: string): string {
  return normalizeInputRelativePath(relativePath).replace(/^\/+|\/+$/g, "")
}

function assertNormalFolderRelativePath(rootPath: string, folderRelativePath: string): { relativePath: string; folderPath: string } {
  const normalizedFolderRelativePath = normalizeFolderRelativePath(folderRelativePath)
  const normalNotesPath = getNormalNotesPath(rootPath)
  const folderPath = assertPathInsideRoot(rootPath, path.join(rootPath, normalizedFolderRelativePath))

  if (
    (normalizedFolderRelativePath !== "note" && !normalizedFolderRelativePath.startsWith("note/"))
    || normalizedFolderRelativePath.split("/").some((part) => part.startsWith("."))
    || !destinationFolderIsUsableNormalFolder(normalNotesPath, folderPath)
  ) {
    throw new UsageError(`Could not move note to '${normalizedFolderRelativePath}'.`, {
      hint: "Choose an existing folder under note/.",
    })
  }

  return { relativePath: normalizedFolderRelativePath, folderPath }
}

function listSidecarKeys(rootPath: string): string[] {
  const stateNotesPath = getStateNotesPath(rootPath)
  if (!existsSync(stateNotesPath)) {
    return []
  }

  return readdirSync(stateNotesPath)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => path.basename(entry, ".json"))
}

function assertCustomNormalFolderRename(rootPath: string, folderRelativePath: string, nextName: string): { previousRelativePath: string; nextRelativePath: string; previousPath: string; nextPath: string } {
  const previousRelativePath = normalizeFolderRelativePath(folderRelativePath)
  const nextSegment = folderNameFromInput(nextName)
  const parts = previousRelativePath.split("/").filter(Boolean)

  if (parts.length < 2 || parts[0] !== "note" || !nextSegment || nextSegment.startsWith(".") || nextSegment.includes("/")) {
    throw new UsageError(`Could not rename folder '${previousRelativePath}'.`, {
      hint: "Only custom folders under note/ can be renamed.",
    })
  }

  const parentRelativePath = parts.slice(0, -1).join("/")
  const nextRelativePath = joinPortableRelativePath(parentRelativePath, nextSegment)
  const previousPath = assertPathInsideRoot(rootPath, path.join(rootPath, previousRelativePath))
  const nextPath = assertPathInsideRoot(rootPath, path.join(rootPath, nextRelativePath))

  if (!destinationFolderIsUsableNormalFolder(getNormalNotesPath(rootPath), previousPath) || existsSync(nextPath)) {
    throw new UsageError(`Could not rename folder '${previousRelativePath}'.`, {
      hint: "Choose an existing custom note folder and a free destination name.",
    })
  }

  return { previousRelativePath, nextRelativePath, previousPath, nextPath }
}

function folderNameFromInput(input: string): string {
  return input.trim().replaceAll("\\", "/").split("/").filter(Boolean).at(-1)?.trim() ?? ""
}

export function createNoteRepository(rootPath: string): NoteRepository {
  const normalizedRootPath = path.resolve(rootPath)
  const sidecars = createSidecarRepository(normalizedRootPath)

  return {
    create(input) {
      const canonicalFrontmatter = validateNoteFrontmatter(input.frontmatter, getCreateValidationSourcePath(input.frontmatter))
      assertCreateFrontmatterIsSupported(canonicalFrontmatter)

      const { notePath, relativePath } = resolveCreateNotePath(
        normalizedRootPath,
        canonicalFrontmatter,
        input.destination,
      )
      const sidecarPath = sidecars.getSidecarPath(canonicalFrontmatter.id)

      if (existsSync(notePath) || existsSync(sidecarPath) || noteKeyExists(normalizedRootPath, canonicalFrontmatter.id)) {
        throw new UsageError(`Could not create note '${relativePath}'.`, {
          hint: "A note with the same basename/key already exists somewhere under note/, draft/, or in sidecar metadata. Use a different id or remove/archive the existing note first.",
        })
      }

      const markdown = serializePlainNote({
        body: input.body,
        sourcePath: relativePath,
      })
      const sidecar = buildSidecar(canonicalFrontmatter, relativePath, input.body, canonicalFrontmatter.archivedAt ?? null)
      let wroteNoteFile = false

      try {
        mkdirSync(path.dirname(notePath), { recursive: true })
        writeFileSync(notePath, markdown, { encoding: "utf8", flag: "wx" })
        wroteNoteFile = true
        sidecars.write(sidecar)
      } catch (error) {
        const rollbackErrors: unknown[] = []

        if (wroteNoteFile && existsSync(notePath)) {
          try {
            rmSync(notePath, { force: true })
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError)
          }
        }

        if (rollbackErrors.length > 0) {
          wrapRepositoryError(
            "create",
            relativePath,
            new AggregateError([error, ...rollbackErrors], "Create failed and rollback also failed."),
          )
        }

        wrapRepositoryError("create", relativePath, error)
      }

      return {
        notePath,
        relativePath,
      }
    },

    read(notePath) {
      const normalizedNotePath = assertPathInsideRoot(normalizedRootPath, notePath)
      const relativePath = toRootRelativePath(normalizedRootPath, normalizedNotePath)
      const key = keyFromNotePath(normalizedNotePath)
      let markdown: string

      try {
        markdown = readFileSync(normalizedNotePath, "utf8")
      } catch (error) {
        wrapRepositoryError("read", relativePath, error)
      }

      const sidecarPath = sidecars.getSidecarPath(key)

      try {
        const plainNote = parsePlainNote(markdown, relativePath)

        if (!existsSync(sidecarPath)) {
          return parseNoteFile(markdown, relativePath)
        }

        const sidecar = sidecars.read(key)

        if (path.normalize(sidecar.relativePath) !== path.normalize(relativePath)) {
          throw new NoteMetadataPathMismatchError(
            `Note metadata for '${sidecar.key}' points to '${sidecar.relativePath}' instead of '${relativePath}'.`,
            {
              hint: "Rebuild or repair the note sidecar so its relativePath matches the note file.",
            },
          )
        }

        return buildParsedNote(sidecar, plainNote)
      } catch (error) {
        if (error instanceof NoteMetadataPathMismatchError) {
          throw error
        }

        wrapRepositoryError("read", relativePath, error)
      }
    },

    readRaw(notePath) {
      const normalizedNotePath = assertPathInsideRoot(normalizedRootPath, notePath)
      const relativePath = toRootRelativePath(normalizedRootPath, normalizedNotePath)

      try {
        return readFileSync(normalizedNotePath, "utf8")
      } catch (error) {
        wrapRepositoryError("read", relativePath, error)
      }
    },

    syncEditedNote(notePath, input) {
      const normalizedNotePath = assertPathInsideRoot(normalizedRootPath, notePath)
      const relativePath = toRootRelativePath(normalizedRootPath, normalizedNotePath)
      const existing = this.read(normalizedNotePath)
      const existingSidecarPath = sidecars.getSidecarPath(existing.frontmatter.id)
      const existingSidecar = existsSync(existingSidecarPath) ? sidecars.read(existing.frontmatter.id) : buildExistingSidecar(existing)
      const previousMarkdown = createPlainNoteMarkdown(relativePath, existing.body)
      const updatedMarkdown = createPlainNoteMarkdown(relativePath, input.body)
      const updatedSidecar: NoteSidecar = {
        ...existingSidecar,
        title: input.title,
        description: deriveDescription(input.body),
        relativePath,
        updatedAt: input.updatedAt,
      }
      let wroteUpdatedNote = false

      try {
        replaceNoteBodyAtomically(normalizedRootPath, normalizedNotePath, updatedMarkdown)
        wroteUpdatedNote = true
        sidecars.write(updatedSidecar)
      } catch (error) {
        const rollbackErrors: unknown[] = []

        if (wroteUpdatedNote) {
          try {
            replaceNoteBodyAtomically(normalizedRootPath, normalizedNotePath, previousMarkdown)
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError)
          }
        }

        throw new UsageError(`Could not update note '${relativePath}'.`, {
          hint: "Ensure the note and its sidecar are writable inside BLUENOTE_ROOT.",
          cause:
            rollbackErrors.length > 0
              ? new AggregateError([error, ...rollbackErrors], "Update failed and rollback also failed.")
              : error,
        })
      }

      return {
        notePath: normalizedNotePath,
        relativePath,
      }
    },

    rename(notePath, input) {
      const normalizedNotePath = assertPathInsideRoot(normalizedRootPath, notePath)
      const previousRelativePath = toRootRelativePath(normalizedRootPath, normalizedNotePath)
      const existing = this.read(normalizedNotePath)
      const previousKey = existing.frontmatter.id
      const nextRelativePath = joinPortableRelativePath(path.posix.dirname(previousRelativePath), `${input.nextKey}.md`)
      const nextNotePath = notePathFromRelativePath(normalizedRootPath, nextRelativePath)
      const previousSidecarPath = sidecars.getSidecarPath(previousKey)
      const nextSidecarPath = sidecars.getSidecarPath(input.nextKey)
      const existingSidecar = existsSync(previousSidecarPath) ? sidecars.read(previousKey) : buildExistingSidecar(existing)

      if (
        input.nextKey !== previousKey &&
        (existsSync(nextNotePath) || existsSync(nextSidecarPath) || noteKeyExists(normalizedRootPath, input.nextKey))
      ) {
        throw new UsageError(`Could not rename note '${previousRelativePath}'.`, {
          hint: `The generated key '${input.nextKey}' already exists. Change the title and retry, or remove the conflicting note first.`,
        })
      }

      const nextSidecar: NoteSidecar = {
        ...existingSidecar,
        key: input.nextKey,
        title: input.title,
        description: deriveDescription(input.body),
        relativePath: nextRelativePath,
        updatedAt: input.updatedAt,
      }

      let wroteNextNote = false
      let wroteNextSidecar = false
      let removedPreviousNote = false
      let removedPreviousSidecar = false

      try {
        mkdirSync(path.dirname(nextNotePath), { recursive: true })
        writeFileSync(nextNotePath, createPlainNoteMarkdown(nextRelativePath, input.body), {
          encoding: "utf8",
          flag: nextNotePath === normalizedNotePath ? "w" : "wx",
        })
        wroteNextNote = true

        sidecars.write(nextSidecar)
        wroteNextSidecar = true

        if (nextNotePath !== normalizedNotePath) {
          rmSync(normalizedNotePath)
          removedPreviousNote = true
        }

        if (nextSidecarPath !== previousSidecarPath && existsSync(previousSidecarPath)) {
          rmSync(previousSidecarPath)
          removedPreviousSidecar = true
        }
      } catch (error) {
        const rollbackErrors: unknown[] = []

        if (removedPreviousNote) {
          try {
            writeFileSync(normalizedNotePath, createPlainNoteMarkdown(previousRelativePath, existing.body), "utf8")
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError)
          }
        }

        if (removedPreviousSidecar) {
          try {
            sidecars.write(existingSidecar)
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError)
          }
        }

        if (wroteNextNote && nextNotePath !== normalizedNotePath && existsSync(nextNotePath)) {
          try {
            rmSync(nextNotePath, { force: true })
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError)
          }
        }

        if (wroteNextSidecar && nextSidecarPath !== previousSidecarPath && existsSync(nextSidecarPath)) {
          try {
            rmSync(nextSidecarPath, { force: true })
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError)
          }
        }

        throw new UsageError(`Could not rename note '${previousRelativePath}'.`, {
          hint:
            input.nextKey === previousKey
              ? "Ensure the edited note and its sidecar are writable inside BLUENOTE_ROOT."
              : `Ensure the generated key '${input.nextKey}' is free and the note plus sidecar are writable inside BLUENOTE_ROOT.`,
          cause:
            rollbackErrors.length > 0
              ? new AggregateError([error, ...rollbackErrors], "Rename failed and rollback also failed.")
              : error,
        })
      }

      return {
        notePath: nextNotePath,
        relativePath: nextRelativePath,
        previousKey,
        key: input.nextKey,
        previousRelativePath,
      }
    },

    renameFolder(folderRelativePath, nextName) {
      const renameTarget = assertCustomNormalFolderRename(normalizedRootPath, folderRelativePath, nextName)
      const affectedSidecars: Array<{ previous: NoteSidecar; next: NoteSidecar }> = []
      let renamedFolder = false
      const writtenSidecars: NoteSidecar[] = []

      try {
        for (const key of listSidecarKeys(normalizedRootPath)) {
          const sidecar = sidecars.read(key)
          if (
            sidecar.type === "normal" &&
            (sidecar.relativePath === renameTarget.previousRelativePath || sidecar.relativePath.startsWith(`${renameTarget.previousRelativePath}/`))
          ) {
            affectedSidecars.push({
              previous: sidecar,
              next: {
                ...sidecar,
                relativePath: joinPortableRelativePath(
                  renameTarget.nextRelativePath,
                  sidecar.relativePath.slice(renameTarget.previousRelativePath.length).replace(/^\//, ""),
                ),
              },
            })
          }
        }

        renameSync(renameTarget.previousPath, renameTarget.nextPath)
        renamedFolder = true

        for (const { next } of affectedSidecars) {
          sidecars.write(next)
          writtenSidecars.push(next)
        }
      } catch (error) {
        const rollbackErrors: unknown[] = []
        for (const written of [...writtenSidecars].reverse()) {
          const previous = affectedSidecars.find((entry) => entry.previous.key === written.key)?.previous
          if (previous) {
            try {
              sidecars.write(previous)
            } catch (rollbackError) {
              rollbackErrors.push(rollbackError)
            }
          }
        }
        if (renamedFolder) {
          try {
            renameSync(renameTarget.nextPath, renameTarget.previousPath)
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError)
          }
        }
        if (error instanceof UsageError && rollbackErrors.length === 0) {
          throw error
        }
        throw new UsageError(`Could not rename folder '${renameTarget.previousRelativePath}'.`, {
          hint: "Ensure the folder and note sidecars are writable inside BLUENOTE_ROOT.",
          cause: rollbackErrors.length > 0
            ? new AggregateError([error, ...rollbackErrors], "Folder rename failed and rollback also failed.")
            : error,
        })
      }

      return {
        previousRelativePath: renameTarget.previousRelativePath,
        relativePath: renameTarget.nextRelativePath,
      }
    },

    moveNote(notePath, destinationFolderRelativePath, updatedAt) {
      const normalizedNotePath = assertPathInsideRoot(normalizedRootPath, notePath)
      const previousRelativePath = toRootRelativePath(normalizedRootPath, normalizedNotePath)
      const existing = this.read(normalizedNotePath)
      const previousKey = existing.frontmatter.id
      const previousSidecarPath = sidecars.getSidecarPath(previousKey)
      const existingSidecar = existsSync(previousSidecarPath) ? sidecars.read(previousKey) : buildExistingSidecar(existing)
      const destination = assertNormalFolderRelativePath(normalizedRootPath, destinationFolderRelativePath)

      if (existingSidecar.type !== "normal" || existing.frontmatter.archivedAt !== undefined || !previousRelativePath.startsWith("note/")) {
        throw new UsageError(`Could not move note '${previousRelativePath}'.`, {
          hint: "Only normal notes under note/ can be moved.",
        })
      }

      const nextRelativePath = joinPortableRelativePath(destination.relativePath, path.basename(previousRelativePath))
      const nextNotePath = assertPathInsideRoot(normalizedRootPath, path.join(normalizedRootPath, nextRelativePath))
      if (nextNotePath !== normalizedNotePath && existsSync(nextNotePath)) {
        throw new UsageError(`Could not move note '${previousRelativePath}'.`, {
          hint: "A note file already exists in the destination folder.",
        })
      }

      let movedNoteFile = false
      try {
        if (nextNotePath !== normalizedNotePath) {
          renameSync(normalizedNotePath, nextNotePath)
          movedNoteFile = true
        }
        sidecars.write({ ...existingSidecar, relativePath: nextRelativePath, updatedAt: updatedAt ?? existingSidecar.updatedAt })
      } catch (error) {
        const rollbackErrors: unknown[] = []
        if (movedNoteFile) {
          try {
            renameSync(nextNotePath, normalizedNotePath)
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError)
          }
        }
        throw new UsageError(`Could not move note '${previousRelativePath}'.`, {
          hint: "Ensure the note and its sidecar are writable inside BLUENOTE_ROOT.",
          cause: rollbackErrors.length > 0
            ? new AggregateError([error, ...rollbackErrors], "Move failed and rollback also failed.")
            : error,
        })
      }

      return {
        notePath: nextNotePath,
        relativePath: nextRelativePath,
        previousKey,
        key: previousKey,
        previousRelativePath,
      }
    },

    keyExists(key) {
      return noteKeyExists(normalizedRootPath, key) || existsSync(sidecars.getSidecarPath(key))
    },

    archive(notePath, archivedAt) {
      const normalizedNotePath = assertPathInsideRoot(normalizedRootPath, notePath)
      const currentRelativePath = toRootRelativePath(normalizedRootPath, normalizedNotePath)
      const existing = this.read(normalizedNotePath)
      const existingSidecarPath = sidecars.getSidecarPath(existing.frontmatter.id)
      const existingSidecar = existsSync(existingSidecarPath)
        ? sidecars.read(existing.frontmatter.id)
        : buildSidecar(
            existing.frontmatter,
            currentRelativePath,
            existing.body,
            existing.frontmatter.archivedAt ?? null,
          )
      const archivedNotePath = getArchiveNotePath(normalizedRootPath, existing.frontmatter.id)
      const archivedRelativePath = toRootRelativePath(normalizedRootPath, archivedNotePath)
      const markdown = serializePlainNote({
        body: existing.body,
        sourcePath: archivedRelativePath,
      })
      const archivedSidecar: NoteSidecar = {
        ...existingSidecar,
        type: "archived",
        relativePath: archivedRelativePath,
        updatedAt: archivedAt,
        archivedAt,
      }
      let wroteArchivedCopy = false
      let removedSourceNote = false

      try {
        mkdirSync(path.dirname(archivedNotePath), { recursive: true })

        if (archivedNotePath !== normalizedNotePath && existsSync(archivedNotePath)) {
          throw new Error(`Archive destination already exists: ${archivedRelativePath}.`)
        }

        writeFileSync(archivedNotePath, markdown, { encoding: "utf8", flag: "wx" })
        wroteArchivedCopy = true

        if (archivedNotePath !== normalizedNotePath) {
          rmSync(normalizedNotePath)
          removedSourceNote = true
        }

        sidecars.write(archivedSidecar)
      } catch (error) {
        const rollbackErrors: unknown[] = []

        if (removedSourceNote && archivedNotePath !== normalizedNotePath) {
          try {
            writeFileSync(
              normalizedNotePath,
              serializePlainNote({
                body: existing.body,
                sourcePath: currentRelativePath,
              }),
              "utf8",
            )
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError)
          }
        }

        if (wroteArchivedCopy && archivedNotePath !== normalizedNotePath && existsSync(archivedNotePath)) {
          try {
            rmSync(archivedNotePath, { force: true })
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError)
          }
        }

        if (rollbackErrors.length > 0) {
          wrapRepositoryError(
            "archive",
            currentRelativePath,
            new AggregateError([error, ...rollbackErrors], "Archive failed and rollback also failed."),
          )
        }

        wrapRepositoryError("archive", currentRelativePath, error)
      }

      return {
        notePath: archivedNotePath,
        relativePath: archivedRelativePath,
      }
    },

    delete(notePath) {
      const normalizedNotePath = assertPathInsideRoot(normalizedRootPath, notePath)
      const relativePath = toRootRelativePath(normalizedRootPath, normalizedNotePath)
      const existing = this.read(normalizedNotePath)
      const sidecarPath = sidecars.getSidecarPath(existing.frontmatter.id)
      const previousRaw = readFileSync(normalizedNotePath, "utf8")
      const existingSidecar = existsSync(sidecarPath) ? sidecars.read(existing.frontmatter.id) : undefined
      let removedNote = false
      let removedSidecar = false

      try {
        rmSync(normalizedNotePath)
        removedNote = true

        if (existsSync(sidecarPath)) {
          rmSync(sidecarPath)
          removedSidecar = true
        }
      } catch (error) {
        const rollbackErrors: unknown[] = []

        if (removedNote && !existsSync(normalizedNotePath)) {
          try {
            mkdirSync(path.dirname(normalizedNotePath), { recursive: true })
            writeFileSync(normalizedNotePath, previousRaw, "utf8")
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError)
          }
        }

        if (removedSidecar && existingSidecar !== undefined && !existsSync(sidecarPath)) {
          try {
            sidecars.write(existingSidecar)
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError)
          }
        }

        if (rollbackErrors.length > 0) {
          wrapRepositoryError(
            "delete",
            relativePath,
            new AggregateError([error, ...rollbackErrors], "Delete failed and rollback also failed."),
          )
        }

        wrapRepositoryError("delete", relativePath, error)
      }

      return {
        notePath: normalizedNotePath,
        relativePath,
      }
    },

    list() {
      return this.listNotePaths().map((record) => this.read(record.notePath))
    },

    listNotePaths() {
      const notePaths: string[] = []

      try {
        for (const notesPath of [getNormalNotesPath(normalizedRootPath), getDraftNotesPath(normalizedRootPath), getArchiveNotesPath(normalizedRootPath)]) {
          if (!existsSync(notesPath)) {
            continue
          }

          collectMarkdownFiles(normalizedRootPath, notesPath, notePaths)
        }
      } catch (error) {
        wrapRepositoryError("list", NOTES_RELATIVE_PATH, error)
      }

      notePaths.sort((left, right) => left.localeCompare(right))
      assertUniqueNoteKeys(normalizedRootPath, notePaths)

      return notePaths.map((notePath) => ({
        notePath,
        relativePath: toRootRelativePath(normalizedRootPath, notePath),
      }))
    },
  }
}
