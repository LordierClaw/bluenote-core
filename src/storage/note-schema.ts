import { InvalidFrontmatterError } from "../core/errors"

export interface PlainNote {
  body: string
  sourcePath: string
}

export interface NoteFrontmatter {
  id: string
  schemaVersion: number
  title: string
  mode: string
  tags: string[]
  createdAt: string
  updatedAt: string
  archivedAt?: string
}

export interface ParsedNote extends PlainNote {
  frontmatter: NoteFrontmatter
}

function formatValidationError(kind: string, sourcePath: string, message: string): InvalidFrontmatterError {
  return new InvalidFrontmatterError(`Invalid ${kind} in ${sourcePath}: ${message}`)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function assertKnownFields(
  record: Record<string, unknown>,
  allowedFields: readonly string[],
  sourcePath: string,
  kind: string,
): void {
  const allowed = new Set<string>(allowedFields)

  for (const field of Object.keys(record)) {
    if (!allowed.has(field)) {
      throw formatValidationError(kind, sourcePath, `unknown field '${field}'.`)
    }
  }
}

export function assertRequiredFields(
  record: Record<string, unknown>,
  requiredFields: readonly string[],
  sourcePath: string,
  kind: string,
): void {
  for (const field of requiredFields) {
    if (!(field in record)) {
      throw formatValidationError(kind, sourcePath, `missing required field '${field}'.`)
    }
  }
}

export function assertStringField(
  record: Record<string, unknown>,
  field: string,
  sourcePath: string,
  kind: string,
): string {
  const value = record[field]

  if (typeof value !== "string" || value.length === 0) {
    throw formatValidationError(kind, sourcePath, `'${field}' must be a non-empty string.`)
  }

  return value
}

export function assertNumberField(
  record: Record<string, unknown>,
  field: string,
  sourcePath: string,
  kind: string,
): number {
  const value = record[field]

  if (typeof value !== "number" || Number.isNaN(value)) {
    throw formatValidationError(kind, sourcePath, `'${field}' must be a number.`)
  }

  return value
}

export function assertStringArrayField(
  record: Record<string, unknown>,
  field: string,
  sourcePath: string,
  kind: string,
): string[] {
  const value = record[field]

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw formatValidationError(kind, sourcePath, `'${field}' must be an array of strings.`)
  }

  return value
}

export function assertTimestampField(
  record: Record<string, unknown>,
  field: string,
  sourcePath: string,
  kind: string,
): string {
  const value = assertStringField(record, field, sourcePath, kind)

  try {
    if (new Date(value).toISOString() !== value) {
      throw new Error("timestamp mismatch")
    }
  } catch {
    throw formatValidationError(kind, sourcePath, `'${field}' must be an ISO 8601 timestamp.`)
  }

  return value
}

const FRONTMATTER_REQUIRED_FIELDS = [
  "id",
  "schemaVersion",
  "title",
  "mode",
  "tags",
  "createdAt",
  "updatedAt",
] as const

const FRONTMATTER_OPTIONAL_FIELDS = ["archivedAt"] as const

export function validateNoteFrontmatter(frontmatter: unknown, sourcePath: string): NoteFrontmatter {
  const validationKind = "frontmatter"

  if (!isRecord(frontmatter)) {
    throw formatValidationError(validationKind, sourcePath, "expected a YAML object.")
  }

  assertKnownFields(frontmatter, [...FRONTMATTER_REQUIRED_FIELDS, ...FRONTMATTER_OPTIONAL_FIELDS], sourcePath, validationKind)
  assertRequiredFields(frontmatter, FRONTMATTER_REQUIRED_FIELDS, sourcePath, validationKind)

  return {
    id: assertStringField(frontmatter, "id", sourcePath, validationKind),
    schemaVersion: assertNumberField(frontmatter, "schemaVersion", sourcePath, validationKind),
    title: assertStringField(frontmatter, "title", sourcePath, validationKind),
    mode: assertStringField(frontmatter, "mode", sourcePath, validationKind),
    tags: assertStringArrayField(frontmatter, "tags", sourcePath, validationKind),
    createdAt: assertTimestampField(frontmatter, "createdAt", sourcePath, validationKind),
    updatedAt: assertTimestampField(frontmatter, "updatedAt", sourcePath, validationKind),
    ...(frontmatter.archivedAt === undefined
      ? {}
      : { archivedAt: assertTimestampField(frontmatter, "archivedAt", sourcePath, validationKind) }),
  }
}
