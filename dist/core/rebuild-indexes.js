import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { resolveBlueNoteRoot, STATE_NOTES_DIRECTORY } from "../config/root.js";
import { UsageError } from "./errors.js";
import { rebuildIndexStore } from "../index/index-store.js";
import { parseNoteFile } from "../storage/frontmatter.js";
import { parsePlainNote } from "../storage/plain-note.js";
import { createSidecarRepository } from "../storage/sidecar-repository.js";
import { createNoteRepository } from "../storage/note-repository.js";
import { ensureManagedRoot, getArchiveNotesPath } from "../storage/root-layout.js";
import { migrateLegacyAppStateToData } from "../storage/app-state-migration.js";
import { assertPathInsideRoot } from "../platform/path-safety.js";
function keyFromRelativePath(relativePath) {
    return path.basename(relativePath, ".md");
}
function collectErrorMessages(error) {
    const messages = [];
    const seen = new Set();
    function visit(candidate) {
        if (candidate === undefined || candidate === null || seen.has(candidate)) {
            return;
        }
        seen.add(candidate);
        if (candidate instanceof AggregateError) {
            for (const nested of candidate.errors) {
                visit(nested);
            }
        }
        if (candidate instanceof Error && candidate.message.length > 0) {
            messages.push(candidate.message);
        }
        if (typeof candidate === "object" && candidate !== null && "cause" in candidate) {
            visit(candidate.cause);
        }
    }
    visit(error);
    return messages.length > 0 ? messages : [String(error)];
}
function listSidecarKeys(rootPath, testHooks) {
    const sidecarDirectoryPath = path.join(rootPath, STATE_NOTES_DIRECTORY);
    if (!existsSync(sidecarDirectoryPath)) {
        return [];
    }
    try {
        if (testHooks?.listSidecarKeys) {
            return testHooks.listSidecarKeys(rootPath);
        }
        return readdirSync(sidecarDirectoryPath, { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
            .map((entry) => path.basename(entry.name, ".json"))
            .sort((left, right) => left.localeCompare(right));
    }
    catch (error) {
        throw new UsageError(`Could not scan sidecar directory '${STATE_NOTES_DIRECTORY}'.`, {
            hint: `Ensure BLUENOTE_ROOT/${STATE_NOTES_DIRECTORY} exists as a readable directory.`,
            cause: error,
        });
    }
}
function findSidecarForRebuild(rootPath, sidecars, expectedKey, expectedRelativePath, validationErrors) {
    const legacySidecarPath = sidecars.getSidecarPath(expectedKey);
    if (existsSync(legacySidecarPath)) {
        return sidecars.read(expectedKey);
    }
    for (const sidecarKey of listSidecarKeys(rootPath)) {
        let sidecar;
        try {
            sidecar = sidecars.readByNoteId(sidecarKey);
        }
        catch (error) {
            validationErrors.push(...collectErrorMessages(error));
            continue;
        }
        if (sidecar.key === expectedKey && path.normalize(sidecar.relativePath) === path.normalize(expectedRelativePath)) {
            return sidecar;
        }
    }
    return undefined;
}
function readLegacyFrontmatterNote(rawNote, relativePath) {
    try {
        return parseNoteFile(rawNote, relativePath);
    }
    catch {
        return null;
    }
}
function pathIsInsideDirectory(directoryPath, targetPath) {
    const relativePath = path.relative(path.resolve(directoryPath), path.resolve(targetPath));
    return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}
export function rebuildIndexes(options = {}) {
    const rootPath = ensureManagedRoot(resolveBlueNoteRoot(options));
    migrateLegacyAppStateToData(rootPath);
    const repository = createNoteRepository(rootPath);
    const sidecars = createSidecarRepository(rootPath);
    const notes = [];
    const validationErrors = [];
    let noteRecords;
    try {
        noteRecords = repository.listNotePaths();
    }
    catch (error) {
        return {
            rootPath,
            noteCount: 0,
            validationErrors: collectErrorMessages(error),
        };
    }
    const noteRelativePathByKey = new Map();
    for (const record of noteRecords) {
        noteRelativePathByKey.set(keyFromRelativePath(record.relativePath), record.relativePath);
    }
    for (const record of noteRecords) {
        const expectedKey = keyFromRelativePath(record.relativePath);
        let rawNote;
        try {
            rawNote = repository.readRaw(record.notePath);
        }
        catch (error) {
            validationErrors.push(...collectErrorMessages(error));
            continue;
        }
        try {
            let sidecar = findSidecarForRebuild(rootPath, sidecars, expectedKey, record.relativePath, validationErrors);
            if (sidecar === undefined) {
                const legacyNote = readLegacyFrontmatterNote(rawNote, record.relativePath);
                if (legacyNote !== null) {
                    notes.push(legacyNote);
                    continue;
                }
            }
            if (sidecar === undefined) {
                sidecar = sidecars.read(expectedKey);
            }
            const plainNote = parsePlainNote(rawNote, record.relativePath);
            let isValid = true;
            if (sidecar.key !== expectedKey) {
                validationErrors.push(`Sidecar '${path.join(STATE_NOTES_DIRECTORY, `${expectedKey}.json`)}' declares key '${sidecar.key}' but is stored for note key '${expectedKey}'.`);
                isValid = false;
            }
            if (path.normalize(sidecar.relativePath) !== path.normalize(record.relativePath)) {
                validationErrors.push(`Note metadata for '${sidecar.key}' points to '${sidecar.relativePath}' instead of '${record.relativePath}'.`);
                isValid = false;
            }
            if (!isValid) {
                continue;
            }
            notes.push({
                key: sidecar.key,
                title: sidecar.title,
                description: sidecar.description,
                body: plainNote.body,
                relativePath: record.relativePath,
                createdAt: sidecar.createdAt,
                updatedAt: sidecar.updatedAt,
                archivedAt: sidecar.archivedAt,
            });
        }
        catch (error) {
            validationErrors.push(...collectErrorMessages(error));
        }
    }
    try {
        for (const sidecarKey of listSidecarKeys(rootPath, options.testHooks)) {
            if (noteRelativePathByKey.has(sidecarKey)) {
                continue;
            }
            try {
                const sidecar = sidecars.read(sidecarKey);
                if (noteRelativePathByKey.get(sidecar.key) === sidecar.relativePath) {
                    continue;
                }
                if (path.isAbsolute(sidecar.relativePath)) {
                    throw new UsageError(`Sidecar '${path.join(STATE_NOTES_DIRECTORY, `${sidecarKey}.json`)}' declares absolute relativePath '${sidecar.relativePath}'.`);
                }
                const sidecarNotePath = assertPathInsideRoot(rootPath, path.join(rootPath, sidecar.relativePath));
                const archiveNotesPath = getArchiveNotesPath(rootPath);
                if (pathIsInsideDirectory(archiveNotesPath, sidecarNotePath) && existsSync(sidecarNotePath)) {
                    continue;
                }
                validationErrors.push(`Sidecar '${path.join(STATE_NOTES_DIRECTORY, `${sidecarKey}.json`)}' points to missing note '${sidecar.relativePath}'.`);
            }
            catch (error) {
                validationErrors.push(...collectErrorMessages(error));
            }
        }
    }
    catch (error) {
        validationErrors.push(...collectErrorMessages(error));
    }
    if (validationErrors.length > 0) {
        return {
            rootPath,
            noteCount: notes.length,
            validationErrors,
        };
    }
    const rebuilt = rebuildIndexStore({ rootPath, notes });
    return {
        rootPath,
        noteCount: rebuilt.noteCount,
        validationErrors,
        metadataDatabasePath: rebuilt.metadataDatabasePath,
        searchIndexPath: rebuilt.searchIndexPath,
    };
}
//# sourceMappingURL=rebuild-indexes.js.map