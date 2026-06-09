import type { PlainNote } from "./note-schema"

export function normalizePlainNoteBody(markdownText: string): string {
  return markdownText.replace(/\r\n/g, "\n")
}

export function parsePlainNote(markdownText: string, sourcePath: string): PlainNote {
  return {
    body: normalizePlainNoteBody(markdownText),
    sourcePath,
  }
}

export function serializePlainNote(note: PlainNote): string {
  return normalizePlainNoteBody(note.body)
}
