import { resolveBlueNoteRoot, type ResolveBlueNoteRootOptions } from "../config/root"
import { loadIndexStore } from "../index/index-store"
import { noteIsVisible, type NoteVisibilityOptions } from "./note-visibility"

export interface NoteSummary {
  key: string
  title: string
  description: string
  relativePath: string
  createdAt?: string
}

export function listNotes(options: ResolveBlueNoteRootOptions & NoteVisibilityOptions = {}): NoteSummary[] {
  const store = loadIndexStore(resolveBlueNoteRoot(options))

  return store.listAllSummaries().filter((summary) => noteIsVisible(summary, options.visibility)).map((summary) => ({
    key: summary.key,
    title: summary.title,
    description: summary.description,
    relativePath: summary.relativePath,
    createdAt: summary.createdAt,
  }))
}
