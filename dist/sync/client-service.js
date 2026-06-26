import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { createHash } from "node:crypto";
import { createNoteDescription } from "../domain/note-description.js";
import { UsageError } from "../core/errors.js";
import { rebuildIndexes } from "../core/rebuild-indexes.js";
import { createReplicaId } from "../platform/ids.js";
import { assertPathInsideRoot, toRootRelativePath } from "../platform/path-safety.js";
import { createNoteRepository } from "../storage/note-repository.js";
import { serializePlainNote } from "../storage/plain-note.js";
import { getArchiveNotesPath, getDraftNotesPath, getNormalNotesPath, getStateNotesPath } from "../storage/root-layout.js";
import { createSidecarRepository } from "../storage/sidecar-repository.js";
import { createDirtyRecordRepository } from "./dirty-repository.js";
import { createFolderRepository } from "./folder-repository.js";
import { withSyncDatabase } from "./sync-db.js";
function metadataString(metadata, key) {
    const value = metadata?.[key];
    return typeof value === "string" ? value : null;
}
function metadataObject(metadata, key) {
    const value = metadata?.[key];
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}
function basenameKey(relativePath) {
    return path.posix.basename(relativePath, ".md");
}
function assertMetadataKeyMatchesRelativePath(key, relativePath) {
    if (key !== basenameKey(relativePath)) {
        throw new UsageError("Pulled note metadata key must match the relativePath basename.", {
            hint: "Rejecting inconsistent server note metadata to avoid writing a note to the wrong local path.",
        });
    }
}
function normalizeNoteRelativePath(rootPath, relativePath) {
    const portableRelativePath = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
    const isSyncNotePath = portableRelativePath.startsWith("note/") || portableRelativePath.startsWith("draft/");
    if (!isSyncNotePath || !portableRelativePath.endsWith(".md")) {
        throw new Error(`Invalid pulled note relativePath '${relativePath}'.`);
    }
    if (portableRelativePath.startsWith("draft/") && path.posix.dirname(portableRelativePath) !== "draft") {
        throw new UsageError(`Invalid pulled note relativePath '${relativePath}'.`, {
            hint: "Draft note sync paths must be direct children of draft/.",
        });
    }
    const normalizedRelativePath = toRootRelativePath(rootPath, assertPathInsideRoot(rootPath, path.join(rootPath, portableRelativePath)));
    const isNormalizedSyncNotePath = normalizedRelativePath.startsWith("note/") || normalizedRelativePath.startsWith("draft/");
    if (!isNormalizedSyncNotePath || !normalizedRelativePath.endsWith(".md")) {
        throw new Error(`Invalid pulled note relativePath '${relativePath}'.`);
    }
    if (normalizedRelativePath.startsWith("draft/") && path.posix.dirname(normalizedRelativePath) !== "draft") {
        throw new UsageError(`Invalid pulled note relativePath '${relativePath}'.`, {
            hint: "Draft note sync paths must be direct children of draft/.",
        });
    }
    if (normalizedRelativePath.split("/").some((segment) => segment.startsWith("."))) {
        throw new UsageError(`Invalid pulled note relativePath '${relativePath}'.`, {
            hint: "Pulled note sync paths must not contain hidden path segments.",
        });
    }
    return normalizedRelativePath;
}
function destinationForPulledNote(relativePath) {
    return relativePath.startsWith("draft/")
        ? { type: "draft" }
        : { type: "normal", folderRelativePath: path.posix.dirname(relativePath) };
}
function noteTypeForRelativePath(relativePath) {
    return relativePath.startsWith("draft/") ? "draft" : "normal";
}
function assertExistingPathIsNotSymlink(filePath, relativeLabel) {
    try {
        if (fs.lstatSync(filePath).isSymbolicLink()) {
            throw new UsageError(`Pulled note path '${relativeLabel}' must not be a symlink.`, {
                hint: "Remove symlinks from BlueNote-managed note paths before syncing.",
            });
        }
    }
    catch (error) {
        if (error instanceof UsageError) {
            throw error;
        }
        if (typeof error === "object" && error !== null && error.code === "ENOENT") {
            return;
        }
        throw error;
    }
}
function assertPathAndParentsAreNotSymlinks(rootPath, targetPath) {
    const normalizedRootPath = path.resolve(rootPath);
    const normalizedTargetPath = assertPathInsideRoot(normalizedRootPath, targetPath);
    const relativePath = path.relative(normalizedRootPath, normalizedTargetPath);
    const parts = relativePath === "" ? [] : relativePath.split(path.sep).filter(Boolean);
    let currentPath = normalizedRootPath;
    assertExistingPathIsNotSymlink(currentPath, path.relative(normalizedRootPath, currentPath) || ".");
    for (const part of parts) {
        currentPath = path.join(currentPath, part);
        assertExistingPathIsNotSymlink(currentPath, path.relative(normalizedRootPath, currentPath));
    }
}
function snapshotFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return { filePath, existed: false, content: null };
    }
    return { filePath, existed: true, content: fs.readFileSync(filePath) };
}
function restoreFileSnapshots(rootPath, snapshots) {
    for (const snapshot of [...snapshots].reverse()) {
        assertPathAndParentsAreNotSymlinks(rootPath, snapshot.filePath);
        if (snapshot.existed) {
            fs.mkdirSync(path.dirname(snapshot.filePath), { recursive: true });
            fs.writeFileSync(snapshot.filePath, snapshot.content ?? Buffer.alloc(0));
        }
        else {
            fs.rmSync(snapshot.filePath, { force: true });
        }
    }
}
function readLastPulledSequence(rootPath, identity, replicaId) {
    return withSyncDatabase(rootPath, identity, (handle) => {
        const rows = handle.db.exec("SELECT lastPulledSequence FROM replicas WHERE replicaId = ?", [replicaId])[0]?.values ?? [];
        const value = rows[0]?.[0];
        return typeof value === "number" ? value : 0;
    });
}
function writeReplicaProgress(rootPath, identity, replicaId, sequence, pushedAt) {
    withSyncDatabase(rootPath, identity, (handle) => {
        handle.db.run(`
        INSERT INTO replicas (replicaId, workspaceId, lastSeenAt, lastPulledSequence, lastPushedAt, status)
        VALUES (?, ?, ?, ?, ?, 'active')
        ON CONFLICT(replicaId) DO UPDATE SET
          workspaceId = excluded.workspaceId,
          lastSeenAt = excluded.lastSeenAt,
          lastPulledSequence = excluded.lastPulledSequence,
          lastPushedAt = COALESCE(excluded.lastPushedAt, replicas.lastPushedAt),
          status = 'active'
      `, [replicaId, identity.workspaceId, new Date().toISOString(), sequence, pushedAt ?? null]);
    }, { save: true });
}
function machineLocalReplicaIdPath(rootPath, workspaceId) {
    const key = createHash("sha256").update(`${workspaceId}\u0000${path.resolve(rootPath)}`).digest("hex");
    const configRoot = process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.trim().length > 0
        ? process.env.XDG_CONFIG_HOME
        : path.join(os.homedir(), ".config");
    return path.join(configRoot, "bluenote", "sync-replicas", `${key}.json`);
}
function readOrCreateLocalReplicaId(rootPath, identity) {
    withSyncDatabase(rootPath, identity, () => undefined, { save: true });
    const replicaIdPath = machineLocalReplicaIdPath(rootPath, identity.workspaceId);
    try {
        const parsed = JSON.parse(fs.readFileSync(replicaIdPath, "utf8"));
        const replicaId = typeof parsed === "object" && parsed !== null ? parsed.replicaId : undefined;
        if (typeof replicaId === "string" && replicaId.trim().length > 0) {
            return replicaId;
        }
    }
    catch {
        // Missing or invalid machine-local replica files are regenerated below.
    }
    const replicaId = createReplicaId();
    fs.mkdirSync(path.dirname(replicaIdPath), { recursive: true });
    fs.writeFileSync(replicaIdPath, `${JSON.stringify({ replicaId }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    return replicaId;
}
function readSidecarIfExists(rootPath, noteId) {
    const sidecars = createSidecarRepository(rootPath);
    if (!fs.existsSync(sidecars.getSidecarPathByNoteId(noteId))) {
        return null;
    }
    return sidecars.readByNoteId(noteId);
}
function findSidecarOwnerForRelativePath(rootPath, relativePath) {
    const stateNotesPath = getStateNotesPath(rootPath);
    const sidecars = createSidecarRepository(rootPath);
    if (!fs.existsSync(stateNotesPath)) {
        return null;
    }
    for (const entry of fs.readdirSync(stateNotesPath, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) {
            continue;
        }
        const noteId = path.basename(entry.name, ".json");
        const sidecar = sidecars.readByNoteId(noteId);
        if (sidecar.relativePath === relativePath) {
            return sidecar.noteId ?? noteId;
        }
    }
    return null;
}
function findRawNoteRelativePathByKey(rootPath, key, allowedRelativePaths) {
    const pending = [getNormalNotesPath(rootPath), getDraftNotesPath(rootPath), getArchiveNotesPath(rootPath)];
    while (pending.length > 0) {
        const directoryPath = pending.pop();
        if (directoryPath === undefined) {
            continue;
        }
        if (!fs.existsSync(directoryPath)) {
            continue;
        }
        for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
            const entryPath = assertPathInsideRoot(rootPath, path.join(directoryPath, entry.name));
            if (entry.isDirectory()) {
                if (!entry.name.startsWith(".")) {
                    pending.push(entryPath);
                }
                continue;
            }
            if (!entry.isFile() || !entry.name.endsWith(".md") || path.basename(entry.name, ".md") !== key) {
                continue;
            }
            const relativePath = toRootRelativePath(rootPath, entryPath);
            if (!allowedRelativePaths.has(relativePath)) {
                return relativePath;
            }
        }
    }
    return null;
}
function findSidecarOwnerForKey(rootPath, key) {
    const stateNotesPath = getStateNotesPath(rootPath);
    const sidecars = createSidecarRepository(rootPath);
    if (!fs.existsSync(stateNotesPath)) {
        return null;
    }
    for (const entry of fs.readdirSync(stateNotesPath, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) {
            continue;
        }
        const noteId = path.basename(entry.name, ".json");
        const sidecar = sidecars.readByNoteId(noteId);
        if (sidecar.key === key) {
            return sidecar.noteId ?? noteId;
        }
    }
    return null;
}
function assertPulledNotePathAvailable(rootPath, relativePath, noteId) {
    const owner = findSidecarOwnerForRelativePath(rootPath, relativePath);
    if (owner !== null && owner !== noteId) {
        throw new UsageError(`Pulled note path '${relativePath}' is already owned by another note.`, {
            hint: "Rejecting pulled note relocation to avoid overwriting local note content.",
        });
    }
    const notePath = assertPathInsideRoot(rootPath, path.join(rootPath, relativePath));
    assertPathAndParentsAreNotSymlinks(rootPath, notePath);
    if (fs.existsSync(notePath) && owner !== noteId) {
        throw new UsageError(`Pulled note path '${relativePath}' already exists.`, {
            hint: "Rejecting pulled note to avoid overwriting an existing local Markdown file.",
        });
    }
}
function assertPulledNoteKeyAvailable(rootPath, key, noteId) {
    const owner = findSidecarOwnerForKey(rootPath, key);
    if (owner !== null && owner !== noteId) {
        throw new UsageError(`Pulled note key '${key}' is already owned by another note.`, {
            hint: "Rejecting pulled note relocation to avoid duplicate local note keys.",
        });
    }
    const ownerSidecar = readSidecarIfExists(rootPath, noteId);
    const allowedRelativePaths = new Set(ownerSidecar === null ? [] : [ownerSidecar.relativePath]);
    const rawCollisionPath = findRawNoteRelativePathByKey(rootPath, key, allowedRelativePaths);
    if (rawCollisionPath !== null) {
        throw new UsageError(`Pulled note key '${key}' is already used by another Markdown note.`, {
            hint: `Rejecting pulled note relocation because '${rawCollisionPath}' already uses that key.`,
        });
    }
}
function applyPulledNoteUpsert(rootPath, change, body) {
    const notes = createNoteRepository(rootPath);
    const sidecars = createSidecarRepository(rootPath);
    const existingSidecar = readSidecarIfExists(rootPath, change.entityId);
    const relativePath = normalizeNoteRelativePath(rootPath, metadataString(change.metadata, "relativePath") ?? change.relativePath ?? `note/${change.entityId}.md`);
    const key = metadataString(change.metadata, "key") ?? basenameKey(relativePath);
    assertMetadataKeyMatchesRelativePath(key, relativePath);
    assertPulledNotePathAvailable(rootPath, relativePath, change.entityId);
    assertPulledNoteKeyAvailable(rootPath, key, change.entityId);
    const title = metadataString(change.metadata, "title") ?? change.title ?? key;
    const description = metadataString(change.metadata, "description") ?? createNoteDescription(body);
    const updatedAt = metadataString(change.metadata, "updatedAt") ?? change.changedAt;
    const createdAt = metadataString(change.metadata, "createdAt") ?? updatedAt;
    const ai = metadataObject(change.metadata, "ai");
    const notePath = assertPathInsideRoot(rootPath, path.join(rootPath, relativePath));
    if (existingSidecar === null) {
        const snapshots = [snapshotFile(notePath), snapshotFile(sidecars.getSidecarPathByNoteId(change.entityId))];
        try {
            fs.mkdirSync(path.dirname(notePath), { recursive: true });
            notes.create({
                noteId: change.entityId,
                body,
                frontmatter: {
                    id: key,
                    schemaVersion: 1,
                    title,
                    mode: "plain",
                    tags: [],
                    createdAt,
                    updatedAt,
                },
                destination: destinationForPulledNote(relativePath),
            });
            if (description !== createNoteDescription(body) || ai !== undefined) {
                sidecars.write({
                    ...sidecars.readByNoteId(change.entityId),
                    ...(description === createNoteDescription(body) ? {} : { description }),
                    ...(ai === undefined ? {} : { ai }),
                });
            }
        }
        catch (error) {
            restoreFileSnapshots(rootPath, snapshots);
            throw error;
        }
        return;
    }
    const existingPath = assertPathInsideRoot(rootPath, path.join(rootPath, existingSidecar.relativePath));
    if (existingSidecar.relativePath === relativePath && existingSidecar.key === key) {
        const snapshots = [snapshotFile(existingPath), snapshotFile(sidecars.getSidecarPathByNoteId(change.entityId))];
        try {
            notes.syncEditedNote(existingPath, { title, body, updatedAt });
            if (description !== createNoteDescription(body) || ai !== undefined) {
                sidecars.write({
                    ...sidecars.readByNoteId(change.entityId),
                    ...(description === createNoteDescription(body) ? {} : { description }),
                    ...(ai === undefined ? {} : { ai }),
                });
            }
        }
        catch (error) {
            restoreFileSnapshots(rootPath, snapshots);
            throw error;
        }
        return;
    }
    const snapshots = [snapshotFile(notePath), snapshotFile(existingPath), snapshotFile(sidecars.getSidecarPathByNoteId(change.entityId))];
    try {
        assertPathAndParentsAreNotSymlinks(rootPath, existingPath);
        assertPathAndParentsAreNotSymlinks(rootPath, sidecars.getSidecarPathByNoteId(change.entityId));
        fs.mkdirSync(path.dirname(notePath), { recursive: true });
        fs.writeFileSync(notePath, serializePlainNote({ sourcePath: relativePath, body }), "utf8");
        if (existingPath !== notePath && fs.existsSync(existingPath)) {
            fs.rmSync(existingPath, { force: true });
        }
        sidecars.write({
            ...existingSidecar,
            type: noteTypeForRelativePath(relativePath),
            key,
            title,
            description,
            relativePath,
            updatedAt,
            ...(ai === undefined ? {} : { ai }),
        });
    }
    catch (error) {
        restoreFileSnapshots(rootPath, snapshots);
        throw error;
    }
}
function applyPulledNoteDelete(rootPath, change) {
    const sidecar = readSidecarIfExists(rootPath, change.entityId);
    if (sidecar === null) {
        return;
    }
    const notePath = assertPathInsideRoot(rootPath, path.join(rootPath, sidecar.relativePath));
    const sidecarPath = createSidecarRepository(rootPath).getSidecarPathByNoteId(change.entityId);
    assertPathAndParentsAreNotSymlinks(rootPath, notePath);
    assertPathAndParentsAreNotSymlinks(rootPath, sidecarPath);
    if (fs.existsSync(notePath)) {
        createNoteRepository(rootPath).delete(notePath);
    }
    else {
        fs.rmSync(sidecarPath, { force: true });
    }
}
function normalizeFolderRelativePath(rootPath, change) {
    const rawRelativePath = metadataString(change.metadata, "relativePath") ?? change.relativePath ?? change.entityId;
    const portableRelativePath = rawRelativePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/u, "");
    if (portableRelativePath !== "note" && !portableRelativePath.startsWith("note/")) {
        throw new UsageError(`Invalid pulled folder relativePath '${rawRelativePath}'.`, {
            hint: "Pulled folder sync changes must target folders under note/.",
        });
    }
    const normalizedRelativePath = toRootRelativePath(rootPath, assertPathInsideRoot(rootPath, path.join(rootPath, portableRelativePath)));
    if (normalizedRelativePath !== "note" && !normalizedRelativePath.startsWith("note/")) {
        throw new UsageError(`Invalid pulled folder relativePath '${rawRelativePath}'.`, {
            hint: "Pulled folder sync changes must target folders under note/.",
        });
    }
    return normalizedRelativePath;
}
function applyPulledFolderChange(rootPath, identity, change) {
    const relativePath = normalizeFolderRelativePath(rootPath, change);
    const deletedAt = change.changeType === "folder-delete" ? metadataString(change.metadata, "deletedAt") ?? change.changedAt : null;
    if (deletedAt !== null && relativePath === "note") {
        throw new UsageError("Cannot sync delete the managed note root folder.", {
            hint: "Pulled folder deletes may target custom folders under note/, not the top-level note directory.",
        });
    }
    const folderPath = assertPathInsideRoot(rootPath, path.join(rootPath, relativePath));
    assertPathAndParentsAreNotSymlinks(rootPath, folderPath);
    if (deletedAt === null) {
        fs.mkdirSync(folderPath, { recursive: true });
    }
    else if (fs.existsSync(folderPath)) {
        fs.rmdirSync(folderPath);
    }
    createFolderRepository(rootPath, identity).upsertFolder({
        relativePath,
        createdAt: change.changedAt,
        updatedAt: change.changedAt,
        deletedAt,
    });
}
function applyPulledChange(rootPath, identity, change, transport) {
    if (change.entityType === "folder" && (change.changeType === "folder-upsert" || change.changeType === "folder-delete")) {
        applyPulledFolderChange(rootPath, identity, change);
        return true;
    }
    if (change.entityType !== "note") {
        return false;
    }
    if (change.changeType === "delete") {
        applyPulledNoteDelete(rootPath, change);
        return true;
    }
    if (change.changeType !== "upsert") {
        return false;
    }
    if (change.bodyAvailable === false) {
        throw new UsageError("Pulled note upsert is missing an available body.", {
            hint: "Note upsert changes must provide a downloadable body before local content can be replaced.",
        });
    }
    const body = transport.downloadNoteBody(change.entityId, {
        workspaceId: identity.workspaceId,
        sequence: change.sequence,
        serverRevision: change.serverRevision,
    }).body;
    applyPulledNoteUpsert(rootPath, change, body);
    return true;
}
function toProtocolDirtyType(record) {
    if (record.entityType === "folder") {
        return record.dirtyType === "delete" || record.dirtyType === "folder-delete" ? "folder-delete" : "folder-upsert";
    }
    return record.dirtyType;
}
function toPushRecord(record) {
    return {
        entityType: record.entityType,
        entityId: record.entityId,
        dirtyType: toProtocolDirtyType(record),
        clientUpdatedAt: record.markedAt,
        metadata: record.metadata ?? {},
    };
}
function buildPushRequest(rootPath, workspaceId, replicaId, baseSequence, records) {
    const noteBodies = {};
    const pushRecords = records.map((record) => {
        let pushRecord = toPushRecord(record);
        if (record.entityType === "note" && record.dirtyType === "upsert") {
            const sidecar = readSidecarIfExists(rootPath, record.entityId);
            const relativePath = sidecar?.relativePath ?? metadataString(record.metadata, "relativePath");
            if (relativePath !== null) {
                const notePath = assertPathInsideRoot(rootPath, path.join(rootPath, relativePath));
                noteBodies[record.entityId] = createNoteRepository(rootPath).read(notePath).body;
            }
            if (sidecar !== null) {
                pushRecord = {
                    ...pushRecord,
                    metadata: {
                        ...pushRecord.metadata,
                        key: sidecar.key,
                        title: sidecar.title,
                        relativePath: sidecar.relativePath,
                        description: sidecar.description,
                        createdAt: sidecar.createdAt,
                        updatedAt: sidecar.updatedAt,
                        ...(sidecar.ai === undefined ? {} : { ai: sidecar.ai }),
                    },
                };
            }
        }
        return pushRecord;
    });
    return {
        workspaceId,
        replicaId,
        baseSequence,
        records: pushRecords,
        ...(Object.keys(noteBodies).length === 0 ? {} : { noteBodies }),
    };
}
function clearAcceptedDirty(rootPath, identity, response) {
    const dirty = createDirtyRecordRepository(rootPath, identity);
    for (const record of [...response.accepted, ...response.replacedByServer]) {
        dirty.clearDirtyRecord(record.entityType, record.entityId);
    }
}
function markRejectedDirty(rootPath, identity, response) {
    if (response.rejected.length === 0) {
        return;
    }
    const dirty = createDirtyRecordRepository(rootPath, identity);
    for (const record of response.rejected) {
        dirty.markPushRejected(record.entityType, record.entityId, record.message);
    }
}
function rejectedPushMessage(response) {
    return response.rejected
        .map((record) => `${record.entityType}:${record.entityId} ${record.code}: ${record.message}`)
        .join("; ");
}
function isOwnEcho(change, replicaId) {
    return change.sourceReplicaId === replicaId;
}
function hasLocalDirtyRecord(dirty, change) {
    return dirty.listDirtyRecords().some((record) => record.entityType === change.entityType && record.entityId === change.entityId);
}
function applyPulledChangeBeforeCursorAdvance(rootPath, identity, change, transport, dirty) {
    const applied = applyPulledChange(rootPath, identity, change, transport);
    if (applied && hasLocalDirtyRecord(dirty, change)) {
        dirty.clearDirtyRecord(change.entityType, change.entityId);
    }
    return applied;
}
export function createSyncClientService(options) {
    const rootPath = path.resolve(options.rootPath);
    const identity = { role: "client", workspaceId: options.workspaceId };
    const replicaId = options.replicaId ?? readOrCreateLocalReplicaId(rootPath, identity);
    const pullLimit = options.pullLimit ?? 100;
    return {
        syncNow() {
            let pulled = 0;
            let pushed = 0;
            let needsRebuild = false;
            let sinceSequence = readLastPulledSequence(rootPath, identity, replicaId);
            const dirty = createDirtyRecordRepository(rootPath, identity);
            for (;;) {
                const response = options.transport.pull({ workspaceId: options.workspaceId, sinceSequence, limit: pullLimit });
                for (const change of response.changes) {
                    if (isOwnEcho(change, replicaId)) {
                        continue;
                    }
                    if (applyPulledChangeBeforeCursorAdvance(rootPath, identity, change, options.transport, dirty)) {
                        needsRebuild = true;
                    }
                }
                pulled += response.changes.length;
                if (response.toSequence <= sinceSequence) {
                    break;
                }
                sinceSequence = response.toSequence;
                writeReplicaProgress(rootPath, identity, replicaId, sinceSequence);
                if (!response.hasMore) {
                    break;
                }
            }
            if (needsRebuild) {
                rebuildIndexes({ override: rootPath });
            }
            const dirtyRecords = dirty.listDirtyRecords();
            if (dirtyRecords.length > 0) {
                const pushResponse = options.transport.push(buildPushRequest(rootPath, options.workspaceId, replicaId, sinceSequence, dirtyRecords));
                pushed = pushResponse.accepted.length;
                clearAcceptedDirty(rootPath, identity, pushResponse);
                markRejectedDirty(rootPath, identity, pushResponse);
                if (pushResponse.rejected.length > 0) {
                    throw new UsageError(`Sync push rejected by server: ${rejectedPushMessage(pushResponse)}`);
                }
                const pushedAt = new Date().toISOString();
                while (pushResponse.serverSequence > sinceSequence) {
                    const response = options.transport.pull({ workspaceId: options.workspaceId, sinceSequence, limit: pullLimit });
                    for (const change of response.changes) {
                        if (isOwnEcho(change, replicaId)) {
                            continue;
                        }
                        if (applyPulledChangeBeforeCursorAdvance(rootPath, identity, change, options.transport, dirty)) {
                            needsRebuild = true;
                        }
                    }
                    pulled += response.changes.length;
                    if (response.toSequence <= sinceSequence) {
                        break;
                    }
                    sinceSequence = response.toSequence;
                    writeReplicaProgress(rootPath, identity, replicaId, sinceSequence, pushedAt);
                    if (!response.hasMore) {
                        break;
                    }
                }
                writeReplicaProgress(rootPath, identity, replicaId, sinceSequence, pushedAt);
                if (needsRebuild) {
                    rebuildIndexes({ override: rootPath });
                }
            }
            return { status: "synced", pushed, pulled };
        },
    };
}
//# sourceMappingURL=client-service.js.map