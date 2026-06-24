import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { resolveBlueNoteRoot } from "../config/root.js";
import { enqueueDescribeNoteIfAiEnabled } from "../ai/enqueue-describe-note.js";
import { IndexValidationFailedError, UsageError } from "./errors.js";
import { createNoteDescription } from "../domain/note-description.js";
import { createDraftNoteKey, createNoteKey } from "../domain/note-key.js";
import { rebuildIndexes } from "./rebuild-indexes.js";
import { systemClock } from "../platform/clock.js";
import { createNoteId } from "../platform/ids.js";
import { createNoteRepository } from "../storage/note-repository.js";
import { ensureManagedRoot, getStateNotesPath } from "../storage/root-layout.js";
import { createSidecarRepository } from "../storage/sidecar-repository.js";
import { recordSyncMutationBestEffort } from "../sync/mutation-tracking.js";
const STORAGE_SAFE_NOTE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
function listExistingCreateKeys(rootPath, repository) {
    const existingKeys = new Set(repository.listNotePaths().map((record) => path.basename(record.relativePath, ".md")));
    const stateNotesPath = getStateNotesPath(rootPath);
    const sidecars = createSidecarRepository(rootPath);
    if (!existsSync(stateNotesPath)) {
        return existingKeys;
    }
    for (const entry of readdirSync(stateNotesPath, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) {
            continue;
        }
        const storageIdentifier = path.basename(entry.name, ".json");
        try {
            existingKeys.add(sidecars.read(storageIdentifier).key);
        }
        catch {
            existingKeys.add(storageIdentifier);
        }
    }
    return existingKeys;
}
function enqueueAiDescriptionAfterCreate(rootPath, input) {
    enqueueDescribeNoteIfAiEnabled(rootPath, {
        key: input.key,
        relativePath: input.relativePath,
        title: input.title,
        body: input.body,
        currentDescription: input.description,
    }, { clock: input.clock, warn: (message) => console.warn(message) });
}
export function createNote(options) {
    const rootPath = ensureManagedRoot(resolveBlueNoteRoot(options));
    const clock = options.clock ?? systemClock;
    const timestamp = clock.now().toISOString();
    const repository = createNoteRepository(rootPath);
    const existingKeys = listExistingCreateKeys(rootPath, repository);
    const noteId = (options.noteIdGenerator ?? createNoteId)();
    if (!STORAGE_SAFE_NOTE_ID_PATTERN.test(noteId)) {
        throw new UsageError("Generated noteId must be a non-empty storage-safe string.", {
            hint: "Use a note ID containing only letters, numbers, underscores, and hyphens.",
        });
    }
    const type = options.type ?? "draft";
    let title;
    let key;
    let destination;
    if (type === "normal") {
        if (options.title === undefined || options.title.trim().length === 0) {
            throw new UsageError("Normal note creation requires a title.", {
                hint: "Pass a title when creating a normal note.",
            });
        }
        if (options.destinationFolder === undefined || options.destinationFolder.trim().length === 0) {
            throw new UsageError("Normal note creation requires an explicit destination folder.", {
                hint: "Pass --path note/<folder> or destinationFolder when creating a normal note.",
            });
        }
        const destinationFolder = options.destinationFolder;
        title = options.title;
        key = createNoteKey(title, {
            isUnique: (candidate) => !existingKeys.has(candidate),
            randomSource: options.randomSource,
        });
        destination = { type: "normal", folderRelativePath: destinationFolder };
    }
    else if (options.title === undefined || options.title.trim().length === 0) {
        key = createDraftNoteKey({
            isUnique: (candidate) => !existingKeys.has(candidate),
            randomSource: options.randomSource,
        });
        title = key;
        destination = { type: "draft" };
    }
    else {
        title = options.title;
        key = createNoteKey(title, {
            isUnique: (candidate) => !existingKeys.has(candidate),
            randomSource: options.randomSource,
        });
        destination = { type: "draft" };
    }
    const description = createNoteDescription(options.body ?? "");
    const created = repository.create({
        noteId,
        frontmatter: {
            id: key,
            schemaVersion: 1,
            title,
            mode: "plain",
            tags: [],
            createdAt: timestamp,
            updatedAt: timestamp,
        },
        body: options.body ?? "",
        destination,
    });
    const rebuildSummary = rebuildIndexes({ override: rootPath });
    if (rebuildSummary.validationErrors.length > 0) {
        throw new IndexValidationFailedError([`Created note '${key}', but derived indexes could not be rebuilt.`, ...rebuildSummary.validationErrors].join("\n"), {
            hint: "Run bn rebuild after fixing the reported validation errors.",
        });
    }
    if (options.enqueueAi !== false) {
        enqueueAiDescriptionAfterCreate(rootPath, {
            key,
            title,
            description,
            body: options.body ?? "",
            relativePath: created.relativePath,
            clock,
        });
    }
    recordSyncMutationBestEffort(rootPath, {
        notes: [{
                entityId: noteId,
                markedAt: timestamp,
                metadata: { key, relativePath: created.relativePath, title },
            }],
        folders: destination.type === "normal" ? [{ relativePath: destination.folderRelativePath, markedAt: timestamp }] : undefined,
    });
    return {
        noteId,
        key,
        title,
        description,
        rootPath,
        notePath: created.notePath,
        relativePath: created.relativePath,
    };
}
//# sourceMappingURL=create-note.js.map