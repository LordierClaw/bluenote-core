import { InvalidFrontmatterError } from "../core/errors.js";
import { parsePlainNote, serializePlainNote } from "./plain-note.js";
import { validateNoteFrontmatter } from "./note-schema.js";
import yaml from "js-yaml";
const yamlApi = yaml;
const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
function toCanonicalFrontmatter(frontmatter) {
    return {
        id: frontmatter.id,
        schemaVersion: frontmatter.schemaVersion,
        title: frontmatter.title,
        mode: frontmatter.mode,
        tags: [...frontmatter.tags],
        createdAt: frontmatter.createdAt,
        updatedAt: frontmatter.updatedAt,
        ...(frontmatter.archivedAt === undefined ? {} : { archivedAt: frontmatter.archivedAt }),
    };
}
export function parseNoteFile(markdownText, sourcePath) {
    const { body: normalizedMarkdown } = parsePlainNote(markdownText, sourcePath);
    const match = normalizedMarkdown.match(FRONTMATTER_PATTERN);
    if (!match) {
        throw new InvalidFrontmatterError(`Invalid frontmatter in ${sourcePath}: missing YAML frontmatter block.`);
    }
    const [, rawFrontmatter, body] = match;
    let loadedFrontmatter;
    try {
        loadedFrontmatter = yamlApi.load(rawFrontmatter, { schema: yamlApi.JSON_SCHEMA });
    }
    catch (error) {
        throw new InvalidFrontmatterError(`Invalid frontmatter in ${sourcePath}: could not parse YAML.`, {
            cause: error,
        });
    }
    return {
        frontmatter: validateNoteFrontmatter(loadedFrontmatter, sourcePath),
        body,
        sourcePath,
    };
}
export function serializeNoteFile(parsedNote) {
    const frontmatter = toCanonicalFrontmatter(validateNoteFrontmatter(parsedNote.frontmatter, parsedNote.sourcePath));
    const body = serializePlainNote(parsedNote);
    const serializedFrontmatter = yamlApi.dump(frontmatter, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        schema: yamlApi.JSON_SCHEMA,
    });
    return `---\n${serializedFrontmatter}---\n${body}`;
}
//# sourceMappingURL=frontmatter.js.map