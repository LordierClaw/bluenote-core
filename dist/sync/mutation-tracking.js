import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { APP_STATE_NOTES_DIRECTORY } from "../config/root.js";
import { createSidecarRepository } from "../storage/sidecar-repository.js";
import { createDirtyRecordRepository } from "./dirty-repository.js";
import { createFolderRepository } from "./folder-repository.js";
import { getSyncClientRuntimeMode } from "./runtime-mode.js";
import { createSyncStatusRepository } from "./status-repository.js";
import { createTombstoneRepository } from "./tombstone-repository.js";
export function getNoteSyncEntityId(rootPath, note) {
    const sidecars = createSidecarRepository(rootPath);
    const notesDirectoryPath = path.join(rootPath, APP_STATE_NOTES_DIRECTORY);
    if (existsSync(notesDirectoryPath)) {
        for (const entry of readdirSync(notesDirectoryPath, { withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.endsWith(".json")) {
                continue;
            }
            const storageIdentifier = path.basename(entry.name, ".json");
            try {
                const sidecar = sidecars.read(storageIdentifier);
                if (sidecar.key === note.frontmatter.id && path.normalize(sidecar.relativePath) === path.normalize(note.sourcePath)) {
                    return sidecar.noteId ?? sidecar.key;
                }
            }
            catch {
                // Ignore malformed optional sidecars; fall back to the note key below.
            }
        }
    }
    return note.frontmatter.id;
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
    try {
        createSyncStatusRepository(rootPath, identity).writeStatusSummary({
            pendingCount: countPending(rootPath, runtimeMode.workspaceId),
            runningCount: 0,
            failedCount: 0,
            updatedAt: new Date().toISOString(),
            lastError: null,
        });
    }
    catch {
        // Non-critical status logging must not block the local mutation.
    }
}
//# sourceMappingURL=mutation-tracking.js.map