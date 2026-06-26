import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { resolveBlueNoteRoot } from "../config/root.js";
import { createNoteRepository } from "../storage/note-repository.js";
import { getNoteSyncEntityId, recordSyncMutationBestEffort } from "../sync/mutation-tracking.js";
import { selectNote } from "./select-note.js";
import { UsageError } from "./errors.js";
import { createSidecarRepository } from "../storage/sidecar-repository.js";
import { restoreFileSnapshots, snapshotFiles } from "./file-snapshot.js";
function updateLatestOpenedPathIfMatched(rootPath, previousRelativePath, nextRelativePath) {
    const latestPath = path.join(rootPath, ".data", "latest-opened-note.json");
    try {
        const latest = JSON.parse(readFileSync(latestPath, "utf8"));
        if (latest.relativePath === previousRelativePath) {
            writeFileSync(latestPath, JSON.stringify({ ...latest, relativePath: nextRelativePath }, null, 2) + "\n", "utf8");
        }
    }
    catch {
        // Best-effort state repair; move success should not depend on optional UI state.
    }
}
function normalizeDestinationFolder(relativePath) {
    return relativePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+|\/+$/g, "");
}
export function moveNote(options) {
    const rootPath = resolveBlueNoteRoot(options);
    const repository = createNoteRepository(rootPath);
    const selected = selectNote({ repository, selector: options.selector });
    const syncEntityId = getNoteSyncEntityId(rootPath, selected);
    const markedAt = options.updatedAt ?? new Date().toISOString();
    const nextPath = path.join(rootPath, normalizeDestinationFolder(options.destinationFolder), path.basename(selected.sourcePath));
    const snapshots = snapshotFiles([
        path.join(rootPath, selected.sourcePath),
        nextPath,
        createSidecarRepository(rootPath).getSidecarPathByNoteId(syncEntityId),
    ]);
    try {
        const moved = repository.moveNote(path.join(rootPath, selected.sourcePath), options.destinationFolder, markedAt);
        updateLatestOpenedPathIfMatched(rootPath, moved.previousRelativePath, moved.relativePath);
        try {
            recordSyncMutationBestEffort(rootPath, {
                notes: [{
                        entityId: syncEntityId,
                        markedAt,
                        metadata: {
                            key: moved.key,
                            previousRelativePath: moved.previousRelativePath,
                            relativePath: moved.relativePath,
                            title: selected.frontmatter.title,
                        },
                    }],
                folders: [{ relativePath: options.destinationFolder, markedAt }],
            });
        }
        catch (error) {
            restoreFileSnapshots(snapshots);
            throw error;
        }
        return {
            ...moved,
            title: selected.frontmatter.title,
        };
    }
    catch (error) {
        if (error instanceof UsageError) {
            throw error;
        }
        throw new UsageError(`Could not move note '${selected.sourcePath}'.`, {
            hint: "Choose an existing folder under note/ for normal note moves.",
            cause: error,
        });
    }
}
//# sourceMappingURL=move-note.js.map