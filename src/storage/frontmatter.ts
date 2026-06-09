import { InvalidFrontmatterError } from "../core/errors"
import { parsePlainNote, serializePlainNote } from "./plain-note"
import { type NoteFrontmatter, type ParsedNote, validateNoteFrontmatter } from "./note-schema"
import yaml from "js-yaml"

type YamlApi = {
  load(input: string, options: { schema: unknown }): unknown
  dump(input: NoteFrontmatter, options: {
    indent: number
    lineWidth: number
    noRefs: boolean
    schema: unknown
  }): string
  JSON_SCHEMA: unknown
}

const yamlApi = yaml as YamlApi

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/

function toCanonicalFrontmatter(frontmatter: NoteFrontmatter): NoteFrontmatter {
  return {
    id: frontmatter.id,
    schemaVersion: frontmatter.schemaVersion,
    title: frontmatter.title,
    mode: frontmatter.mode,
    tags: [...frontmatter.tags],
    createdAt: frontmatter.createdAt,
    updatedAt: frontmatter.updatedAt,
    ...(frontmatter.archivedAt === undefined ? {} : { archivedAt: frontmatter.archivedAt }),
  }
}

export function parseNoteFile(markdownText: string, sourcePath: string): ParsedNote {
  const { body: normalizedMarkdown } = parsePlainNote(markdownText, sourcePath)
  const match = normalizedMarkdown.match(FRONTMATTER_PATTERN)

  if (!match) {
    throw new InvalidFrontmatterError(`Invalid frontmatter in ${sourcePath}: missing YAML frontmatter block.`)
  }

  const [, rawFrontmatter, body] = match

  let loadedFrontmatter: unknown

  try {
    loadedFrontmatter = yamlApi.load(rawFrontmatter, { schema: yamlApi.JSON_SCHEMA })
  } catch (error) {
    throw new InvalidFrontmatterError(`Invalid frontmatter in ${sourcePath}: could not parse YAML.`, {
      cause: error,
    })
  }

  return {
    frontmatter: validateNoteFrontmatter(loadedFrontmatter, sourcePath),
    body,
    sourcePath,
  }
}

export function serializeNoteFile(parsedNote: ParsedNote): string {
  const frontmatter = toCanonicalFrontmatter(
    validateNoteFrontmatter(parsedNote.frontmatter, parsedNote.sourcePath),
  )
  const body = serializePlainNote(parsedNote)
  const serializedFrontmatter = yamlApi.dump(frontmatter, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    schema: yamlApi.JSON_SCHEMA,
  })

  return `---\n${serializedFrontmatter}---\n${body}`
}
