import type { IndexedNoteSummary, SearchIndexMatch } from "../index/index-store"
import type { ParsedNote } from "../storage/note-schema"

export type NoteVisibility = "normal" | "drafts" | "all"

export interface NoteVisibilityOptions {
  visibility?: NoteVisibility
}

type VisibleNoteLike = Pick<IndexedNoteSummary, "relativePath" | "archivedAt"> | SearchIndexMatch | ParsedNote

function getRelativePath(note: VisibleNoteLike): string {
  if ("sourcePath" in note) {
    return note.sourcePath
  }

  return note.relativePath
}

function getArchivedAt(note: VisibleNoteLike): string | null {
  if ("frontmatter" in note) {
    return note.frontmatter.archivedAt ?? null
  }

  if ("archivedAt" in note) {
    return note.archivedAt
  }

  return note.relativePath.startsWith(".data/archive/") ? "archived" : null
}

export function noteIsVisible(note: VisibleNoteLike, visibility: NoteVisibility = "normal"): boolean {
  const relativePath = getRelativePath(note)
  const archivedAt = getArchivedAt(note)
  const isArchived = archivedAt !== null || relativePath.startsWith(".data/archive/")
  const isDraft = !isArchived && relativePath.startsWith("draft/")
  const isNormal = !isArchived && relativePath.startsWith("note/")

  if (visibility === "all") {
    return isNormal || isDraft || isArchived
  }

  if (visibility === "drafts") {
    return isNormal || isDraft
  }

  return isNormal
}
