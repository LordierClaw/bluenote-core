import path from "node:path";
import fs from "node:fs";
import { resolveBlueNoteRoot } from "../config/root.js";
import { createNoteKey } from "../domain/note-key.js";
import { assertPathInsideRoot, joinPortableRelativePath } from "../platform/path-safety.js";
import { createNoteRepository } from "../storage/note-repository.js";
import { parsePlainNote, serializePlainNote } from "../storage/plain-note.js";
import { getNormalNotesPath } from "../storage/root-layout.js";
import { createSidecarRepository } from "../storage/sidecar-repository.js";
import { getNoteSyncEntityId, recordSyncMutationBestEffort } from "../sync/mutation-tracking.js";
import { selectNote } from "./select-note.js";
import { UsageError } from "./errors.js";
function normalizeFolderRelativePath(relativePath) {
    return relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}
function assertExistingNormalFolder(rootPath, destinationFolder) {
    const relativePath = normalizeFolderRelativePath(destinationFolder);
    const normalRoot = getNormalNotesPath(rootPath);
    const folderPath = assertPathInsideRoot(rootPath, path.join(rootPath, relativePath));
    if ((relativePath !== "note" && !relativePath.startsWith("note/"))
        || relativePath.split("/").some((part) => part.startsWith("."))
        || !fs.existsSync(folderPath)
        || !fs.statSync(folderPath).isDirectory()) {
        throw new UsageError(`Could not promote draft to '${relativePath}'.`, {
            hint: "Choose an existing folder under note/.",
        });
    }
    try {
        const realRootPath = fs.realpathSync(rootPath);
        const realNormalRoot = fs.realpathSync(normalRoot);
        const realFolderPath = fs.realpathSync(folderPath);
        assertPathInsideRoot(realRootPath, realNormalRoot);
        assertPathInsideRoot(realNormalRoot, realFolderPath);
    }
    catch (error) {
        throw new UsageError(`Could not promote draft to '${relativePath}'.`, {
            hint: "Choose an existing folder under note/.",
            cause: error,
        });
    }
    return { relativePath, folderPath };
}
function updateLatestOpenedPathIfMatched(rootPath, previousRelativePath, nextRelativePath) {
    const latestPath = path.join(rootPath, ".data", "latest-opened-note.json");
    try {
        const latest = JSON.parse(fs.readFileSync(latestPath, "utf8"));
        if (latest.relativePath === previousRelativePath) {
            fs.writeFileSync(latestPath, JSON.stringify({ ...latest, relativePath: nextRelativePath }, null, 2) + "\n", "utf8");
        }
    }
    catch {
        // Best-effort TUI state repair; promotion should not depend on optional UI state.
    }
}
function listSidecarKeys(rootPath) {
    const stateNotesPath = path.join(rootPath, ".data", "notes");
    if (!fs.existsSync(stateNotesPath)) {
        return [];
    }
    return fs.readdirSync(stateNotesPath)
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => path.basename(entry, ".json"));
}
function findSidecarForNote(rootPath, sidecars, key, relativePath) {
    const legacySidecarPath = sidecars.getSidecarPath(key);
    if (fs.existsSync(legacySidecarPath)) {
        return sidecars.read(key);
    }
    for (const sidecarKey of listSidecarKeys(rootPath)) {
        let sidecar;
        try {
            sidecar = sidecars.read(sidecarKey);
        }
        catch (error) {
            if (sidecarKey === key) {
                throw error;
            }
            continue;
        }
        if (sidecar.key === key && path.normalize(sidecar.relativePath) === path.normalize(relativePath)) {
            return sidecar;
        }
    }
    return null;
}
function getSidecarPathForMetadata(sidecars, sidecar) {
    return sidecar.noteId === undefined ? sidecars.getSidecarPath(sidecar.key) : sidecars.getSidecarPathByNoteId(sidecar.noteId);
}
export function promoteDraft(options) {
    const rootPath = resolveBlueNoteRoot(options);
    const repository = createNoteRepository(rootPath);
    const sidecars = createSidecarRepository(rootPath);
    const selected = selectNote({ repository, selector: options.selector, visibility: "drafts" });
    const previousKey = selected.frontmatter.id;
    const syncEntityId = getNoteSyncEntityId(rootPath, selected);
    const previousRelativePath = selected.sourcePath;
    const previousNotePath = assertPathInsideRoot(rootPath, path.join(rootPath, previousRelativePath));
    const existingSidecar = findSidecarForNote(rootPath, sidecars, previousKey, previousRelativePath);
    const previousSidecarPath = existingSidecar === null
        ? sidecars.getSidecarPath(previousKey)
        : getSidecarPathForMetadata(sidecars, existingSidecar);
    if (existingSidecar?.type !== "draft" || !previousRelativePath.startsWith("draft/")) {
        throw new UsageError(`Could not promote note '${previousRelativePath}'.`, {
            hint: "Only draft notes under draft/ can be saved as normal notes.",
        });
    }
    const destination = assertExistingNormalFolder(rootPath, options.destinationFolder);
    const title = options.title.trim();
    if (!title) {
        throw new UsageError(`Could not promote draft '${previousRelativePath}'.`, { hint: "Title is required." });
    }
    let nextKey;
    try {
        nextKey = createNoteKey(title, {
            isUnique: (candidate) => candidate !== previousKey && !repository.keyExists(candidate),
            maxAttempts: 1,
            randomSource: options.randomSource,
        });
    }
    catch (error) {
        throw new UsageError(`Could not promote draft '${previousRelativePath}'.`, {
            hint: "The generated key already exists. Change the title and retry, or remove the conflicting note first.",
            cause: error,
        });
    }
    const nextRelativePath = joinPortableRelativePath(destination.relativePath, `${nextKey}.md`);
    const nextNotePath = assertPathInsideRoot(rootPath, path.join(rootPath, nextRelativePath));
    const conflictingLegacySidecarPath = sidecars.getSidecarPath(nextKey);
    if ((nextNotePath !== previousNotePath && fs.existsSync(nextNotePath)) || (nextKey !== previousKey && fs.existsSync(conflictingLegacySidecarPath))) {
        throw new UsageError(`Could not promote draft '${previousRelativePath}'.`, {
            hint: "A note with the generated key already exists in the destination.",
        });
    }
    const plain = parsePlainNote(fs.readFileSync(previousNotePath, "utf8"), previousRelativePath);
    const nextMarkdown = serializePlainNote({ body: plain.body, sourcePath: nextRelativePath });
    const nextSidecar = {
        ...existingSidecar,
        type: "normal",
        key: nextKey,
        title,
        relativePath: nextRelativePath,
        updatedAt: options.updatedAt ?? new Date().toISOString(),
        archivedAt: null,
    };
    const nextSidecarPath = getSidecarPathForMetadata(sidecars, nextSidecar);
    let wroteNextNote = false;
    let wroteNextSidecar = false;
    let removedPreviousNote = false;
    let removedPreviousSidecar = false;
    try {
        fs.mkdirSync(path.dirname(nextNotePath), { recursive: true });
        fs.writeFileSync(nextNotePath, nextMarkdown, { encoding: "utf8", flag: nextNotePath === previousNotePath ? "w" : "wx" });
        wroteNextNote = true;
        sidecars.write(nextSidecar);
        wroteNextSidecar = true;
        if (nextNotePath !== previousNotePath) {
            fs.rmSync(previousNotePath);
            removedPreviousNote = true;
        }
        if (nextSidecarPath !== previousSidecarPath) {
            fs.rmSync(previousSidecarPath, { force: true });
            removedPreviousSidecar = true;
        }
    }
    catch (error) {
        const rollbackErrors = [];
        if (removedPreviousNote) {
            try {
                fs.writeFileSync(previousNotePath, serializePlainNote({ body: plain.body, sourcePath: previousRelativePath }), "utf8");
            }
            catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
        }
        if (removedPreviousSidecar || (wroteNextSidecar && nextSidecarPath === previousSidecarPath && existingSidecar)) {
            try {
                sidecars.write(existingSidecar);
            }
            catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
        }
        if (wroteNextNote && nextNotePath !== previousNotePath && fs.existsSync(nextNotePath)) {
            try {
                fs.rmSync(nextNotePath, { force: true });
            }
            catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
        }
        if (wroteNextSidecar && nextSidecarPath !== previousSidecarPath && fs.existsSync(nextSidecarPath)) {
            try {
                fs.rmSync(nextSidecarPath, { force: true });
            }
            catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
        }
        throw new UsageError(`Could not promote draft '${previousRelativePath}'.`, {
            hint: "Ensure the draft, destination folder, and sidecars are writable inside BLUENOTE_ROOT.",
            cause: rollbackErrors.length > 0 ? new AggregateError([error, ...rollbackErrors], "Promotion failed and rollback also failed.") : error,
        });
    }
    updateLatestOpenedPathIfMatched(rootPath, previousRelativePath, nextRelativePath);
    recordSyncMutationBestEffort(rootPath, {
        notes: [{
                entityId: syncEntityId,
                markedAt: nextSidecar.updatedAt,
                metadata: {
                    key: nextKey,
                    previousKey,
                    previousRelativePath,
                    relativePath: nextRelativePath,
                    title,
                },
            }],
        folders: [{ relativePath: destination.relativePath, markedAt: nextSidecar.updatedAt }],
    });
    return { previousKey, key: nextKey, title, previousRelativePath, relativePath: nextRelativePath, notePath: nextNotePath };
}
//# sourceMappingURL=promote-draft.js.map