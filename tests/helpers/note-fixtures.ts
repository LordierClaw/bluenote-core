import { serializeNoteFile } from "../../src/storage/frontmatter"

export type NoteFixtureInput = {
  id: string
  title: string
  body?: string
  createdAt?: string
  updatedAt?: string
  archivedAt?: string
  tags?: string[]
}

export function legacyNoteMarkdown({
  id,
  title,
  body = "",
  createdAt = "2026-05-21T10:15:00.000Z",
  updatedAt = createdAt,
  archivedAt,
  tags = [],
}: NoteFixtureInput): string {
  return serializeNoteFile({
    frontmatter: {
      id,
      schemaVersion: 1,
      title,
      mode: "plain",
      tags,
      createdAt,
      updatedAt,
      ...(archivedAt ? { archivedAt } : {}),
    },
    body,
    sourcePath: "tests/fixtures/generated.md",
  })
}

export const noteMarkdown = legacyNoteMarkdown

export function sidecarJson(input: {
  type?: "normal" | "draft" | "archived"
  key: string
  title: string
  description: string
  relativePath: string
  createdAt?: string
  updatedAt?: string
  archivedAt?: string | null
  namingVersion?: number
}): string {
  const archivedAt = input.archivedAt ?? null
  const type =
    input.type ??
    (archivedAt !== null || input.relativePath.startsWith(".data/archive/")
      ? "archived"
      : input.relativePath.startsWith("draft/")
        ? "draft"
        : "normal")

  return `${JSON.stringify(
    {
      type,
      key: input.key,
      title: input.title,
      description: input.description,
      relativePath: input.relativePath,
      createdAt: input.createdAt ?? "2026-05-21T10:15:00.000Z",
      updatedAt: input.updatedAt ?? input.createdAt ?? "2026-05-21T10:15:00.000Z",
      archivedAt,
      namingVersion: input.namingVersion ?? 1,
    },
    null,
    2,
  )}\n`
}

export function timestampFieldPattern(fieldName: string): RegExp {
  return new RegExp(`${fieldName}: '?\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z'?`)
}
