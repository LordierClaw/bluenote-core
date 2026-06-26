import { resolveBlueNoteRoot } from "../config/root.js";
import { IndexValidationFailedError, UsageError } from "./errors.js";
import { joinPortableRelativePath } from "../platform/path-safety.js";
import { systemClock } from "../platform/clock.js";
import { createNoteRepository } from "../storage/note-repository.js";
import { getNoteSyncEntityId, recordSyncMutationBestEffort } from "../sync/mutation-tracking.js";
import { ensureManagedRoot } from "../storage/root-layout.js";
import { rebuildIndexes } from "./rebuild-indexes.js";
import { selectNote } from "./select-note.js";
import { createSidecarRepository } from "../storage/sidecar-repository.js";
import { restoreFileSnapshots, snapshotFiles } from "./file-snapshot.js";
import path from "node:path";
function isArchivedNote(note) {
    return note.frontmatter.archivedAt !== undefined || note.sourcePath.startsWith(joinPortableRelativePath(".data", "archive") + "/");
}
function throwArchiveValidationError(stage, sourcePath, validationErrors) {
    throw new IndexValidationFailedError(`Validation failed ${stage} archiving ${sourcePath}.\n${validationErrors.join("\n")}`, {
        hint: "Fix the reported note data and rerun bn rebuild.",
    });
}
export function archiveNote(options) {
    const rootPath = ensureManagedRoot(resolveBlueNoteRoot(options));
    const repository = createNoteRepository(rootPath);
    const selected = selectNote({ repository, selector: options.selector, visibility: options.visibility ?? "normal" });
    if (isArchivedNote(selected)) {
        throw new UsageError(`Note '${selected.sourcePath}' is already archived.`, {
            hint: "Choose an active note from bn list instead.",
        });
    }
    if (!selected.sourcePath.startsWith("note/")) {
        throw new UsageError(`Cannot archive non-normal note '${selected.sourcePath}'.`, {
            hint: "Only normal notes under note/ can be archived.",
        });
    }
    const preflightRebuildSummary = rebuildIndexes({ override: rootPath });
    if (preflightRebuildSummary.validationErrors.length > 0) {
        throwArchiveValidationError("before", selected.sourcePath, preflightRebuildSummary.validationErrors);
    }
    const syncEntityId = getNoteSyncEntityId(rootPath, selected);
    const archivedAt = (options.clock ?? systemClock).now().toISOString();
    const snapshots = snapshotFiles([
        path.join(rootPath, selected.sourcePath),
        path.join(rootPath, ".data", "archive", `${selected.frontmatter.id}.md`),
        createSidecarRepository(rootPath).getSidecarPathByNoteId(syncEntityId),
    ]);
    const archived = repository.archive(`${rootPath}/${selected.sourcePath}`, archivedAt);
    try {
        recordSyncMutationBestEffort(rootPath, {
            notes: [{
                    entityId: syncEntityId,
                    dirtyType: "delete",
                    markedAt: archivedAt,
                    metadata: {
                        archivedAt,
                        key: selected.frontmatter.id,
                        previousRelativePath: selected.sourcePath,
                        title: selected.frontmatter.title,
                    },
                }],
        });
    }
    catch (error) {
        restoreFileSnapshots(snapshots);
        throw error;
    }
    const rebuildSummary = rebuildIndexes({ override: rootPath });
    if (rebuildSummary.validationErrors.length > 0) {
        throwArchiveValidationError("after", selected.sourcePath, rebuildSummary.validationErrors);
    }
    return {
        rootPath,
        notePath: archived.notePath,
        relativePath: archived.relativePath,
        archivedAt,
    };
}
//# sourceMappingURL=archive-note.js.map