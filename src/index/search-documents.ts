import type { ParsedNote } from "../storage/note-schema"

export interface IndexedSearchNote {
  key: string
  title: string
  description: string
  body: string
  relativePath: string
}

export type SearchDocumentSource = IndexedSearchNote | ParsedNote

export interface SearchDocument extends IndexedSearchNote {
  id: string
}

function getDescription(note: SearchDocumentSource): string {
  if ("description" in note) {
    return note.description
  }

  return note.body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? note.frontmatter.title
}

export function createSearchDocuments(notes: SearchDocumentSource[]): SearchDocument[] {
  return notes.map((note) => ({
    id: "key" in note ? note.key : note.frontmatter.id,
    key: "key" in note ? note.key : note.frontmatter.id,
    title: "title" in note ? note.title : note.frontmatter.title,
    description: getDescription(note),
    body: note.body,
    relativePath: "relativePath" in note ? note.relativePath : note.sourcePath,
  }))
}
