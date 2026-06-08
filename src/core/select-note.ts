import path from "node:path"

import { toPortableRelativePath } from "../platform/path-safety"
import { AmbiguousSelectorError, SelectorNotFoundError } from "./errors"
import type { ParsedNote } from "../storage/note-schema"
import type { NoteRepository } from "../storage/note-repository"
import { noteIsVisible, type NoteVisibilityOptions } from "./note-visibility"

export interface SelectNoteOptions extends NoteVisibilityOptions {
  repository: NoteRepository
  selector: string
}

function selectorKeyFor(note: ParsedNote): string {
  return path.basename(note.sourcePath, ".md")
}

function levenshteinDistance(left: string, right: string): number {
  const previous = new Array(right.length + 1).fill(0)
  const current = new Array(right.length + 1).fill(0)

  for (let column = 0; column <= right.length; column += 1) {
    previous[column] = column
  }

  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row

    for (let column = 1; column <= right.length; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + substitutionCost,
      )
    }

    for (let column = 0; column <= right.length; column += 1) {
      previous[column] = current[column]
    }
  }

  return previous[right.length]
}

function findSuggestedKeys(selector: string, notes: readonly ParsedNote[]): string[] {
  const normalizedSelector = selector.trim().toLowerCase()

  return notes
    .map((note) => selectorKeyFor(note))
    .filter((key, index, keys) => keys.indexOf(key) === index)
    .map((key) => ({
      key,
      distance: levenshteinDistance(normalizedSelector, key.toLowerCase()),
    }))
    .filter(({ distance }) => distance <= 3)
    .sort((left, right) => left.distance - right.distance || left.key.localeCompare(right.key))
    .slice(0, 3)
    .map(({ key }) => key)
}

function assertSingleMatch(selector: string, matches: ParsedNote[]): ParsedNote {
  if (matches.length === 1) {
    return matches[0]
  }

  throw new AmbiguousSelectorError(
    `Ambiguous note selector: ${selector}. Matches: ${matches.map((note) => note.sourcePath).join(", ")}.`,
    {
      hint: "Use a note key or managed-root-relative path to disambiguate.",
    },
  )
}

export function selectNote(options: SelectNoteOptions): ParsedNote {
  const visibility = options.visibility ?? "normal"
  const notes = options.repository.list().filter((note) => noteIsVisible(note, visibility))
  const trimmedSelector = options.selector.trim()

  const exactKeyMatches = notes.filter((note) => selectorKeyFor(note) === trimmedSelector)

  if (exactKeyMatches.length > 0) {
    return assertSingleMatch(trimmedSelector, exactKeyMatches)
  }

  const exactPathSelector = toPortableRelativePath(trimmedSelector)
  const exactPathMatches = notes.filter((note) => note.sourcePath === exactPathSelector)
  if (exactPathMatches.length > 0) {
    return assertSingleMatch(trimmedSelector, exactPathMatches)
  }

  const suggestions = findSuggestedKeys(trimmedSelector, notes)

  throw new SelectorNotFoundError(`Could not find a note matching selector '${options.selector}'.`, {
    hint: suggestions.length > 0 ? `Did you mean: ${suggestions.join(", ")}?` : "Use bn list to inspect available notes.",
  })
}
