export interface NoteDescriptionOptions {
  edgeWordCount?: number
}

const DEFAULT_EDGE_WORD_COUNT = 3

export function createNoteDescription(body: string, options: NoteDescriptionOptions = {}): string {
  const normalized = body.replace(/\s+/g, " ").trim()

  if (normalized.length === 0) {
    return ""
  }

  const words = normalized.split(" ")
  const edgeWordCount = options.edgeWordCount ?? DEFAULT_EDGE_WORD_COUNT

  if (words.length <= edgeWordCount * 2) {
    return normalized
  }

  const opening = words.slice(0, edgeWordCount).join(" ")
  const closing = words.slice(-edgeWordCount).join(" ")

  return `${opening} … ${closing}`
}
