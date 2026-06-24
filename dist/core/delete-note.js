import path from "node:path";
import { resolveBlueNoteRoot } from "../config/root.js";
import { IndexValidationFailedError, UsageError } from "./errors.js";
import { createNoteRepository } from "../storage/note-repository.js";
import { ensureManagedRoot } from "../storage/root-layout.js";
import { getNoteSyncEntityId, recordSyncMutationBestEffort } from "../sync/mutation-tracking.js";
import { rebuildIndexes } from "./rebuild-indexes.js";
import { selectNote } from "./select-note.js";
import { systemClock } from "../platform/clock.js";
export function deleteNote(options) {
    if (!options.force) {
        throw new UsageError("Deleting notes requires --force.", {
            hint: "Run bn delete <key|path> --force to confirm permanent removal.",
        });
    }
    const rootPath = ensureManagedRoot(resolveBlueNoteRoot(options));
    const repository = createNoteRepository(rootPath);
    const selected = selectNote({ repository, selector: options.selector, visibility: options.visibility });
    const syncEntityId = getNoteSyncEntityId(rootPath, selected);
    const deletedAt = (options.clock ?? systemClock).now().toISOString();
    const deleted = repository.delete(path.join(rootPath, selected.sourcePath));
    recordSyncMutationBestEffort(rootPath, {
        tombstones: [{
                entityId: syncEntityId,
                deletedAt,
                previousRelativePath: selected.sourcePath,
                previousTitle: selected.frontmatter.title,
            }],
        notes: [{
                entityId: syncEntityId,
                dirtyType: "delete",
                markedAt: deletedAt,
                metadata: {
                    key: selected.frontmatter.id,
                    previousRelativePath: selected.sourcePath,
                    title: selected.frontmatter.title,
                },
            }],
    });
    const rebuildSummary = rebuildIndexes({ override: rootPath });
    if (rebuildSummary.validationErrors.length > 0) {
        throw new IndexValidationFailedError([`Deleted note '${selected.frontmatter.id}', but derived indexes could not be rebuilt.`, ...rebuildSummary.validationErrors].join("\n"), {
            hint: "Run bn rebuild after fixing the reported validation errors.",
        });
    }
    return {
        rootPath,
        notePath: deleted.notePath,
        relativePath: deleted.relativePath,
    };
}
//# sourceMappingURL=delete-note.js.map