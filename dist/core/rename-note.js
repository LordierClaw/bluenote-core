import path from "node:path";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolveBlueNoteRoot, STATE_RECOVERY_DIRECTORY } from "../config/root.js";
import { createNoteKey } from "../domain/note-key.js";
import { createNoteRepository } from "../storage/note-repository.js";
import { selectNote } from "./select-note.js";
import { joinPortableRelativePath } from "../platform/path-safety.js";
import { getNoteSyncEntityId, recordSyncMutationBestEffort } from "../sync/mutation-tracking.js";
import { UsageError } from "./errors.js";
import { createSidecarRepository } from "../storage/sidecar-repository.js";
import { restoreFileSnapshots, snapshotFiles } from "./file-snapshot.js";
function buildRecoveryArtifactPath(rootPath, previousKey, nextKey) {
    const safePreviousKey = previousKey.replace(/[^a-z0-9-]+/gi, "-");
    const safeNextKey = nextKey.replace(/[^a-z0-9-]+/gi, "-");
    return path.join(rootPath, STATE_RECOVERY_DIRECTORY, `${Date.now()}-${safePreviousKey}-to-${safeNextKey}.json`);
}
function updateLatestOpenedPathIfMatched(rootPath, previousRelativePath, nextRelativePath) {
    const latestPath = path.join(rootPath, ".data", "latest-opened-note.json");
    try {
        const latest = JSON.parse(readFileSync(latestPath, "utf8"));
        if (latest.relativePath === previousRelativePath) {
            writeFileSync(latestPath, JSON.stringify({ ...latest, relativePath: nextRelativePath }, null, 2) + "\n", "utf8");
        }
    }
    catch {
        // Best-effort state repair; rename success should not depend on optional UI state.
    }
}
export function renameNote(options) {
    const rootPath = resolveBlueNoteRoot(options);
    const repository = createNoteRepository(rootPath);
    const selected = selectNote({ repository, selector: options.selector, visibility: options.visibility });
    const currentKey = selected.frontmatter.id;
    const syncEntityId = getNoteSyncEntityId(rootPath, selected);
    let nextKey;
    try {
        nextKey = createNoteKey(options.title, {
            isUnique: (candidate) => candidate === currentKey || !repository.keyExists(candidate),
            maxAttempts: 1,
            randomSource: options.randomSource,
        });
    }
    catch (error) {
        throw new UsageError(`Could not rename note '${selected.sourcePath}'.`, {
            hint: "The generated key already exists. Change the title and retry, or remove the conflicting note first.",
            cause: error,
        });
    }
    const recoveryArtifactPath = buildRecoveryArtifactPath(rootPath, currentKey, nextKey);
    const nextRelativePath = joinPortableRelativePath(path.posix.dirname(selected.sourcePath), `${nextKey}.md`);
    const snapshots = snapshotFiles([
        path.join(rootPath, selected.sourcePath),
        path.join(rootPath, nextRelativePath),
        createSidecarRepository(rootPath).getSidecarPathByNoteId(syncEntityId),
    ]);
    const recoveryArtifact = {
        previousKey: currentKey,
        nextKey,
        previousRelativePath: selected.sourcePath,
        nextRelativePath,
        stagedAt: options.updatedAt,
    };
    try {
        mkdirSync(path.dirname(recoveryArtifactPath), { recursive: true });
        writeFileSync(recoveryArtifactPath, JSON.stringify(recoveryArtifact, null, 2) + "\n", "utf8");
        options.hooks?.onRecoveryArtifactStaged?.(recoveryArtifactPath);
        const renamed = repository.rename(path.join(rootPath, selected.sourcePath), {
            nextKey,
            title: options.title,
            body: options.body,
            updatedAt: options.updatedAt,
        });
        try {
            rmSync(recoveryArtifactPath, { force: true });
        }
        catch {
            // Best-effort cleanup: a stale recovery artifact is safer than reporting a successful rename as failed.
        }
        updateLatestOpenedPathIfMatched(rootPath, renamed.previousRelativePath, renamed.relativePath);
        try {
            recordSyncMutationBestEffort(rootPath, {
                notes: [{
                        entityId: syncEntityId,
                        markedAt: options.updatedAt,
                        metadata: {
                            key: renamed.key,
                            previousKey: renamed.previousKey,
                            previousRelativePath: renamed.previousRelativePath,
                            relativePath: renamed.relativePath,
                            title: options.title,
                        },
                    }],
            });
        }
        catch (error) {
            restoreFileSnapshots(snapshots);
            throw error;
        }
        return renamed;
    }
    catch (error) {
        if (error instanceof UsageError) {
            throw error;
        }
        throw new UsageError(`Could not rename note '${selected.sourcePath}'.`, {
            hint: "Inspect .data/recovery/ for the staged rename artifact, then repair or retry the rename.",
            cause: error,
        });
    }
}
//# sourceMappingURL=rename-note.js.map