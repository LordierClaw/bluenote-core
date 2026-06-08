import path from "node:path"

import { toPortableRelativePath } from "../platform/path-safety"
import { InvalidFrontmatterError } from "../core/errors"
import {
  assertKnownFields,
  assertNumberField,
  assertRequiredFields,
  assertStringField,
  assertTimestampField,
  isRecord,
} from "./note-schema"

export type NoteType = "normal" | "draft" | "archived"

export interface NoteSidecar {
  type: NoteType
  key: string
  title: string
  description: string
  relativePath: string
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  namingVersion: number
  ai?: {
    description?: {
      lastProcessedAt?: string
    }
  }
}

const REQUIRED_SIDECAR_FIELDS = [
  "type",
  "key",
  "title",
  "description",
  "relativePath",
  "createdAt",
  "updatedAt",
  "archivedAt",
  "namingVersion",
] as const

const OPTIONAL_SIDECAR_FIELDS = ["ai"] as const
const AI_FIELDS = ["description"] as const
const AI_DESCRIPTION_FIELDS = ["lastProcessedAt"] as const

function inferNoteType(relativePath: string, archivedAt: string | null): NoteType {
  if (archivedAt !== null || relativePath.startsWith(".data/archive/")) {
    return "archived"
  }

  if (relativePath.startsWith("draft/")) {
    return "draft"
  }

  return "normal"
}

function assertNoteTypeField(
  record: Record<string, unknown>,
  sourcePath: string,
  relativePath: string,
  archivedAt: string | null,
): NoteType {
  if (record.type === undefined) {
    return inferNoteType(relativePath, archivedAt)
  }

  const value = assertStringField(record, "type", sourcePath, "sidecar metadata")

  if (value !== "normal" && value !== "draft" && value !== "archived") {
    throw new InvalidFrontmatterError(
      `Invalid sidecar metadata in ${sourcePath}: 'type' must be one of 'normal', 'draft', or 'archived'.`,
    )
  }

  return value
}

function assertSidecarInvariants(
  noteType: NoteType,
  relativePath: string,
  archivedAt: string | null,
  sourcePath: string,
): void {
  const validationKind = "sidecar metadata"

  function relativePathIsUnder(expectedDirectory: "note" | "draft" | ".data/archive"): boolean {
    if (relativePath === "" || path.posix.isAbsolute(relativePath) || /^[A-Za-z]:\//.test(relativePath)) {
      return false
    }

    const segments = relativePath.split("/")
    if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
      return false
    }

    if (!relativePath.endsWith(".md")) {
      return false
    }

    const normalizedSegments = path.posix.normalize(relativePath).split("/")
    const expectedSegments = expectedDirectory.split("/")

    return (
      normalizedSegments.length > expectedSegments.length &&
      expectedSegments.every((segment, index) => normalizedSegments[index] === segment)
    )
  }

  if (noteType === "normal") {
    if (!relativePathIsUnder("note")) {
      throw new InvalidFrontmatterError(
        `Invalid ${validationKind} in ${sourcePath}: type 'normal' must use a relativePath under 'note/'.`,
      )
    }

    if (archivedAt !== null) {
      throw new InvalidFrontmatterError(
        `Invalid ${validationKind} in ${sourcePath}: active sidecars must have archivedAt set to null.`,
      )
    }

    return
  }

  if (noteType === "draft") {
    if (!relativePathIsUnder("draft")) {
      throw new InvalidFrontmatterError(
        `Invalid ${validationKind} in ${sourcePath}: type 'draft' must use a relativePath under 'draft/'.`,
      )
    }

    if (archivedAt !== null) {
      throw new InvalidFrontmatterError(
        `Invalid ${validationKind} in ${sourcePath}: active sidecars must have archivedAt set to null.`,
      )
    }

    return
  }

  if (!relativePathIsUnder(".data/archive")) {
    throw new InvalidFrontmatterError(
      `Invalid ${validationKind} in ${sourcePath}: type 'archived' must use a relativePath under '.data/archive/'.`,
    )
  }

  if (archivedAt === null) {
    throw new InvalidFrontmatterError(
      `Invalid ${validationKind} in ${sourcePath}: archived sidecars must have a non-null archivedAt timestamp.`,
    )
  }
}

function assertArchivedAtField(record: Record<string, unknown>, sourcePath: string): string | null {
  const value = record.archivedAt

  if (value === null) {
    return null
  }

  return assertTimestampField(record, "archivedAt", sourcePath, "sidecar metadata")
}

function assertDescriptionField(record: Record<string, unknown>, sourcePath: string): string {
  const value = record.description

  if (typeof value !== "string") {
    throw new InvalidFrontmatterError(`Invalid sidecar metadata in ${sourcePath}: 'description' must be a string.`)
  }

  return value
}

function validateAiMetadata(
  value: unknown,
  sourcePath: string,
  validationKind: string,
): NoteSidecar["ai"] | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value)) {
    throw new InvalidFrontmatterError(`Invalid ${validationKind} in ${sourcePath}: 'ai' must be a JSON object.`)
  }

  assertKnownFields(value, AI_FIELDS, sourcePath, validationKind)

  if (value.description === undefined) {
    return undefined
  }

  if (!isRecord(value.description)) {
    throw new InvalidFrontmatterError(
      `Invalid ${validationKind} in ${sourcePath}: 'description' must be a JSON object.`,
    )
  }

  assertKnownFields(value.description, AI_DESCRIPTION_FIELDS, sourcePath, validationKind)

  if (value.description.lastProcessedAt === undefined) {
    return undefined
  }

  return {
    description: {
      lastProcessedAt: assertTimestampField(value.description, "lastProcessedAt", sourcePath, validationKind),
    },
  }
}

export function validateNoteSidecar(sidecar: unknown, sourcePath: string): NoteSidecar {
  const validationKind = "sidecar metadata"

  if (!isRecord(sidecar)) {
    throw new InvalidFrontmatterError(`Invalid ${validationKind} in ${sourcePath}: expected a JSON object.`)
  }

  assertKnownFields(sidecar, [...REQUIRED_SIDECAR_FIELDS, ...OPTIONAL_SIDECAR_FIELDS], sourcePath, validationKind)
  assertRequiredFields(sidecar, REQUIRED_SIDECAR_FIELDS.filter((field) => field !== "type"), sourcePath, validationKind)
  const ai = validateAiMetadata(sidecar.ai, sourcePath, validationKind)
  const relativePath = toPortableRelativePath(assertStringField(sidecar, "relativePath", sourcePath, validationKind))
  const archivedAt = assertArchivedAtField(sidecar, sourcePath)
  const noteType = assertNoteTypeField(sidecar, sourcePath, relativePath, archivedAt)

  assertSidecarInvariants(noteType, relativePath, archivedAt, sourcePath)

  return {
    type: noteType,
    key: assertStringField(sidecar, "key", sourcePath, validationKind),
    title: assertStringField(sidecar, "title", sourcePath, validationKind),
    description: assertDescriptionField(sidecar, sourcePath),
    relativePath,
    createdAt: assertTimestampField(sidecar, "createdAt", sourcePath, validationKind),
    updatedAt: assertTimestampField(sidecar, "updatedAt", sourcePath, validationKind),
    archivedAt,
    namingVersion: assertNumberField(sidecar, "namingVersion", sourcePath, validationKind),
    ...(ai === undefined ? {} : { ai }),
  }
}
