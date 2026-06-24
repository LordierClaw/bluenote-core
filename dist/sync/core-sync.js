import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { resolveBlueNoteRoot } from "../config/root.js";
import { UsageError } from "../core/errors.js";
import { ensureManagedRoot, getNormalNotesPath } from "../storage/root-layout.js";
import { createNoteRepository } from "../storage/note-repository.js";
import { readStateManifest } from "../storage/state-manifest.js";
import { createDirtyRecordRepository } from "./dirty-repository.js";
import { createFolderRepository } from "./folder-repository.js";
import { createSyncClientService } from "./client-service.js";
import { getNoteSyncEntityId } from "./mutation-tracking.js";
import { readSyncRuntimeMode, setSyncRuntimeMode } from "./runtime-mode.js";
import { createSyncStatusRepository } from "./status-repository.js";
import { repairSyncState } from "./repair.js";
function resolveManagedRoot(options = {}) {
    return ensureManagedRoot(resolveBlueNoteRoot(options));
}
function normalizeFolderRelativePath(rootPath, folderPath) {
    return path.relative(rootPath, folderPath).replace(/\\/g, "/");
}
function collectExistingNoteFolders(rootPath) {
    const normalNotesPath = getNormalNotesPath(rootPath);
    const folders = [];
    if (!existsSync(normalNotesPath)) {
        return folders;
    }
    function visit(directoryPath) {
        for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.name.startsWith(".")) {
                continue;
            }
            const entryPath = path.join(directoryPath, entry.name);
            folders.push(normalizeFolderRelativePath(rootPath, entryPath));
            visit(entryPath);
        }
    }
    visit(normalNotesPath);
    return folders.sort();
}
function assertSupportedLinkMode(mode) {
    if (mode !== "seed-empty-server-from-local") {
        throw new UsageError("Unsupported sync link mode.", {
            hint: "Use mode 'seed-empty-server-from-local'.",
        });
    }
}
function assertValidServerUrl(serverUrl) {
    try {
        const parsed = new URL(serverUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            throw new Error("Unsupported protocol");
        }
    }
    catch (error) {
        throw new UsageError("Invalid sync server URL.", {
            hint: "Provide an http:// or https:// sync server URL.",
            cause: error,
        });
    }
}
export function getCoreSyncStatus(options = {}) {
    const rootPath = resolveBlueNoteRoot(options);
    const runtimeMode = readSyncRuntimeMode(rootPath);
    if (runtimeMode.mode === "standalone") {
        return {
            state: "unlinked",
            mode: "standalone",
            activity: "idle",
            pendingCount: 0,
            runningCount: 0,
            failedCount: 0,
            lastError: null,
        };
    }
    const workspaceId = runtimeMode.workspaceId;
    if (!workspaceId) {
        throw new Error("Sync client runtime mode is missing a workspace ID.");
    }
    const identity = { role: "client", workspaceId };
    const statusSummary = createSyncStatusRepository(rootPath, identity).readStatusSummary();
    const pendingCount = createDirtyRecordRepository(rootPath, identity).listDirtyRecords().length;
    return {
        state: "linked",
        mode: "sync-client",
        activity: "idle",
        workspaceId,
        pendingCount,
        runningCount: statusSummary?.runningCount ?? 0,
        failedCount: statusSummary?.failedCount ?? 0,
        lastError: statusSummary?.lastError ?? null,
    };
}
export function linkCoreSync(options) {
    const { mode, serverUrl, workspaceId: requestedWorkspaceId, ...rootOptions } = options;
    assertSupportedLinkMode(mode);
    assertValidServerUrl(serverUrl);
    const rootPath = resolveManagedRoot(rootOptions);
    const workspaceId = requestedWorkspaceId ?? readStateManifest(rootPath).workspaceId;
    if (!workspaceId) {
        throw new UsageError("Cannot link sync without a workspace ID.", {
            hint: "Initialize or repair the BlueNote root before linking sync.",
        });
    }
    const markedAt = new Date().toISOString();
    const identity = { role: "client", workspaceId };
    const dirtyRepository = createDirtyRecordRepository(rootPath, identity);
    const folderRepository = createFolderRepository(rootPath, identity);
    const notes = createNoteRepository(rootPath).list();
    const folders = collectExistingNoteFolders(rootPath);
    for (const folder of folders) {
        folderRepository.upsertFolder({ relativePath: folder, createdAt: markedAt, updatedAt: markedAt });
        dirtyRepository.markDirty({
            entityType: "folder",
            entityId: folder,
            dirtyType: "upsert",
            markedAt,
            metadata: { relativePath: folder },
        });
    }
    for (const note of notes) {
        dirtyRepository.markDirty({
            entityType: "note",
            entityId: getNoteSyncEntityId(rootPath, note),
            dirtyType: "upsert",
            markedAt,
            metadata: { key: note.frontmatter.id, relativePath: note.sourcePath, title: note.frontmatter.title },
        });
    }
    createSyncStatusRepository(rootPath, identity).writeStatusSummary({
        pendingCount: notes.length + folders.length,
        runningCount: 0,
        failedCount: 0,
        updatedAt: markedAt,
        lastError: null,
    });
    setSyncRuntimeMode(rootPath, { mode: "sync-client", workspaceId });
    return {
        state: "linked",
        mode: "sync-client",
        workspaceId,
        serverUrl,
        dirtyRecordsMarked: notes.length + folders.length,
        notesMarked: notes.length,
        foldersMarked: folders.length,
    };
}
export function unlinkCoreSync(options = {}) {
    const rootPath = resolveManagedRoot(options);
    setSyncRuntimeMode(rootPath, { mode: "standalone" });
    return {
        state: "unlinked",
        mode: "standalone",
        keptLocalNotes: true,
    };
}
export function syncCoreNow(options = {}) {
    const { force: _force, transport, replicaId, ...rootOptions } = options;
    const rootPath = resolveBlueNoteRoot(rootOptions);
    const runtimeMode = readSyncRuntimeMode(rootPath);
    if (runtimeMode.mode === "standalone") {
        return { status: "not-linked", pushed: 0, pulled: 0 };
    }
    if (!transport) {
        return { status: "transport-not-configured", pushed: 0, pulled: 0 };
    }
    if (!runtimeMode.workspaceId) {
        throw new Error("Sync client runtime mode is missing a workspace ID.");
    }
    return createSyncClientService({
        rootPath: resolveManagedRoot(rootOptions),
        workspaceId: runtimeMode.workspaceId,
        replicaId,
        transport,
    }).syncNow();
}
export function repairCoreSync(options = {}) {
    const { dryRun, confirm, ...rootOptions } = options;
    return repairSyncState(resolveBlueNoteRoot(rootOptions), { dryRun, confirm });
}
//# sourceMappingURL=core-sync.js.map