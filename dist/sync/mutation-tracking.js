import path from "node:path";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { APP_STATE_NOTES_DIRECTORY } from "../config/root.js";
import { createNoteDescription } from "../domain/note-description.js";
import { createNoteId } from "../platform/ids.js";
import { serializePlainNote } from "../storage/plain-note.js";
import { createSidecarRepository } from "../storage/sidecar-repository.js";
import { createDirtyRecordRepository } from "./dirty-repository.js";
import { createFolderRepository } from "./folder-repository.js";
import { getSyncClientRuntimeMode } from "./runtime-mode.js";
import { createSyncStatusRepository } from "./status-repository.js";
import { createTombstoneRepository } from "./tombstone-repository.js";
function sidecarTypeForNote(note) {
    if (note.frontmatter.archivedAt !== undefined || note.sourcePath.startsWith(".data/archive/")) {
        return "archived";
    }
    if (note.sourcePath.startsWith("draft/")) {
        return "draft";
    }
    return "normal";
}
function writeStableSidecarForLegacyNote(rootPath, note) {
    const sidecars = createSidecarRepository(rootPath);
    const noteId = createNoteId();
    const notePath = path.join(rootPath, note.sourcePath);
    sidecars.write({
        type: sidecarTypeForNote(note),
        noteId,
        key: note.frontmatter.id,
        title: note.frontmatter.title,
        description: createNoteDescription(note.body),
        relativePath: note.sourcePath,
        createdAt: note.frontmatter.createdAt,
        updatedAt: note.frontmatter.updatedAt,
        archivedAt: note.frontmatter.archivedAt ?? null,
        namingVersion: 1,
    });
    writeFileSync(notePath, serializePlainNote({ sourcePath: note.sourcePath, body: note.body }), "utf8");
    return noteId;
}
export function getNoteSyncEntityId(rootPath, note) {
    const sidecars = createSidecarRepository(rootPath);
    const notesDirectoryPath = path.join(rootPath, APP_STATE_NOTES_DIRECTORY);
    if (existsSync(notesDirectoryPath)) {
        for (const entry of readdirSync(notesDirectoryPath, { withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.endsWith(".json")) {
                continue;
            }
            const storageIdentifier = path.basename(entry.name, ".json");
            let sidecar;
            try {
                sidecar = sidecars.read(storageIdentifier);
            }
            catch {
                // Ignore malformed optional sidecars; fall back to the note key below.
                continue;
            }
            if (sidecar.key === note.frontmatter.id && path.normalize(sidecar.relativePath) === path.normalize(note.sourcePath)) {
                return sidecar.noteId ?? storageIdentifier;
            }
        }
    }
    return note.frontmatter.id;
}
export function ensureNoteSyncEntityIdForSyncSeed(rootPath, note) {
    const sidecars = createSidecarRepository(rootPath);
    const notesDirectoryPath = path.join(rootPath, APP_STATE_NOTES_DIRECTORY);
    if (existsSync(notesDirectoryPath)) {
        for (const entry of readdirSync(notesDirectoryPath, { withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.endsWith(".json")) {
                continue;
            }
            const storageIdentifier = path.basename(entry.name, ".json");
            let sidecar;
            try {
                sidecar = sidecars.read(storageIdentifier);
            }
            catch {
                continue;
            }
            if (sidecar.key === note.frontmatter.id && path.normalize(sidecar.relativePath) === path.normalize(note.sourcePath)) {
                if (sidecar.noteId !== undefined) {
                    return sidecar.noteId;
                }
                const noteId = createNoteId();
                sidecars.write({ ...sidecar, noteId });
                if (storageIdentifier !== noteId) {
                    rmSync(sidecars.getSidecarPath(storageIdentifier), { force: true });
                }
                return noteId;
            }
        }
    }
    return writeStableSidecarForLegacyNote(rootPath, note);
}
function countPending(rootPath, workspaceId) {
    return createDirtyRecordRepository(rootPath, { role: "client", workspaceId }).listDirtyRecords().length;
}
function normalizeFolderRelativePath(relativePath) {
    return relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}
export function recordSyncMutationBestEffort(rootPath, input) {
    let runtimeMode;
    try {
        runtimeMode = getSyncClientRuntimeMode(rootPath);
    }
    catch (error) {
        console.warn(error instanceof Error ? error.message : "Could not read sync runtime mode config.");
        return;
    }
    if (runtimeMode === null) {
        return;
    }
    try {
        const identity = { role: "client", workspaceId: runtimeMode.workspaceId };
        const dirtyRepository = createDirtyRecordRepository(rootPath, identity);
        const folderRepository = createFolderRepository(rootPath, identity);
        const tombstoneRepository = createTombstoneRepository(rootPath, identity);
        for (const folder of input.folders ?? []) {
            const relativePath = normalizeFolderRelativePath(folder.relativePath);
            folderRepository.upsertFolder({
                relativePath,
                createdAt: folder.markedAt,
                updatedAt: folder.markedAt,
            });
            dirtyRepository.markDirty({
                entityType: "folder",
                entityId: relativePath,
                dirtyType: "upsert",
                markedAt: folder.markedAt,
                metadata: { relativePath },
            });
        }
        for (const tombstone of input.tombstones ?? []) {
            tombstoneRepository.recordTombstone({
                entityType: "note",
                entityId: tombstone.entityId,
                deletedAt: tombstone.deletedAt,
                previousRelativePath: tombstone.previousRelativePath,
                previousTitle: tombstone.previousTitle,
            });
        }
        for (const note of input.notes ?? []) {
            dirtyRepository.markDirty({
                entityType: "note",
                entityId: note.entityId,
                dirtyType: note.dirtyType ?? "upsert",
                markedAt: note.markedAt,
                metadata: note.metadata,
            });
        }
        createSyncStatusRepository(rootPath, identity).writeStatusSummary({
            pendingCount: countPending(rootPath, runtimeMode.workspaceId),
            runningCount: 0,
            failedCount: 0,
            updatedAt: new Date().toISOString(),
            lastError: null,
        });
    }
    catch (error) {
        console.warn(error instanceof Error ? error.message : "Could not record sync dirty state for local mutation.");
    }
}
//# sourceMappingURL=mutation-tracking.js.map