const syncChangeEntityTypes = new Set(["note", "folder", "config", "tombstone", "ai"]);
const syncPushEntityTypes = new Set(["note", "folder"]);
const syncDirtyTypes = new Set(["upsert", "delete", "folder-upsert", "folder-delete"]);
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}
function isString(value) {
    return typeof value === "string";
}
function isBoolean(value) {
    return typeof value === "boolean";
}
function isNonNegativeInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
function isPositiveInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
}
function isRecord(value) {
    return isObject(value);
}
function isMetadataRecord(value) {
    return isRecord(value) && !hasOwn(value, "body");
}
function optionalString(value, key) {
    return !hasOwn(value, key) || isString(value[key]);
}
function optionalBoolean(value, key) {
    return !hasOwn(value, key) || isBoolean(value[key]);
}
export function isSyncChangeView(value) {
    if (!isObject(value) || hasOwn(value, "body")) {
        return false;
    }
    return (isNonNegativeInteger(value.sequence) &&
        isString(value.entityType) &&
        syncChangeEntityTypes.has(value.entityType) &&
        isString(value.entityId) &&
        isString(value.changeType) &&
        isNonNegativeInteger(value.serverRevision) &&
        isString(value.changedAt) &&
        optionalString(value, "sourceReplicaId") &&
        optionalString(value, "title") &&
        optionalString(value, "relativePath") &&
        optionalBoolean(value, "bodyAvailable") &&
        isMetadataRecord(value.metadata));
}
export function isPullChangesRequest(value) {
    return (isObject(value) &&
        isString(value.workspaceId) &&
        isNonNegativeInteger(value.sinceSequence) &&
        isPositiveInteger(value.limit));
}
export function isPullChangesResponse(value) {
    return (isObject(value) &&
        isString(value.workspaceId) &&
        isNonNegativeInteger(value.fromSequence) &&
        isNonNegativeInteger(value.toSequence) &&
        isBoolean(value.hasMore) &&
        Array.isArray(value.changes) &&
        value.changes.every(isSyncChangeView));
}
export function isSyncBodyUploadDescriptor(value) {
    return (isObject(value) &&
        optionalString(value, "uploadId") &&
        isString(value.contentHash) &&
        isNonNegativeInteger(value.byteLength));
}
export function isSyncPushRecord(value) {
    if (!isObject(value) || hasOwn(value, "body")) {
        return false;
    }
    if (!isString(value.entityType) ||
        !syncPushEntityTypes.has(value.entityType) ||
        !isString(value.entityId) ||
        !isString(value.dirtyType) ||
        !syncDirtyTypes.has(value.dirtyType) ||
        !isString(value.clientUpdatedAt) ||
        !isMetadataRecord(value.metadata)) {
        return false;
    }
    const entityType = value.entityType;
    const dirtyType = value.dirtyType;
    if (entityType === "note" && dirtyType !== "upsert" && dirtyType !== "delete") {
        return false;
    }
    if (entityType === "folder" && dirtyType !== "folder-upsert" && dirtyType !== "folder-delete") {
        return false;
    }
    if (hasOwn(value, "bodyUpload") && (entityType !== "note" || dirtyType !== "upsert" || !isSyncBodyUploadDescriptor(value.bodyUpload))) {
        return false;
    }
    return true;
}
export function isPushRequest(value) {
    return (isObject(value) &&
        isString(value.workspaceId) &&
        isString(value.replicaId) &&
        isNonNegativeInteger(value.baseSequence) &&
        Array.isArray(value.records) &&
        value.records.every(isSyncPushRecord));
}
function isPushAcceptedRecord(value) {
    return (isObject(value) &&
        isString(value.entityType) &&
        syncPushEntityTypes.has(value.entityType) &&
        isString(value.entityId) &&
        isNonNegativeInteger(value.serverRevision));
}
function isPushRejectedRecord(value) {
    return (isObject(value) &&
        isString(value.entityType) &&
        syncPushEntityTypes.has(value.entityType) &&
        isString(value.entityId) &&
        isString(value.code) &&
        isString(value.message));
}
export function isPushResponse(value) {
    return (isObject(value) &&
        Array.isArray(value.accepted) &&
        value.accepted.every(isPushAcceptedRecord) &&
        Array.isArray(value.replacedByServer) &&
        value.replacedByServer.every(isPushAcceptedRecord) &&
        Array.isArray(value.rejected) &&
        value.rejected.every(isPushRejectedRecord) &&
        isNonNegativeInteger(value.serverSequence));
}
export function isUploadNoteBodyRequest(value) {
    return (isObject(value) &&
        isString(value.workspaceId) &&
        isString(value.replicaId) &&
        isString(value.noteId) &&
        isString(value.contentHash) &&
        isNonNegativeInteger(value.byteLength) &&
        isString(value.body));
}
export function isUploadNoteBodyResponse(value) {
    return (isObject(value) &&
        isString(value.noteId) &&
        isString(value.contentHash) &&
        isNonNegativeInteger(value.byteLength) &&
        isBoolean(value.accepted));
}
export function isDownloadNoteBodyResponse(value) {
    return (isObject(value) &&
        isString(value.workspaceId) &&
        isString(value.noteId) &&
        optionalString(value, "contentHash") &&
        (!hasOwn(value, "byteLength") || isNonNegativeInteger(value.byteLength)) &&
        isString(value.body));
}
export function isSnapshotResponse(value) {
    return (isObject(value) &&
        isString(value.workspaceId) &&
        isNonNegativeInteger(value.serverSequence) &&
        isBoolean(value.hasMore) &&
        Array.isArray(value.changes) &&
        value.changes.every(isSyncChangeView));
}
export function isSnapshotRequiredError(value) {
    return (isObject(value) &&
        value.error === "snapshot-required" &&
        value.code === "SNAPSHOT_REQUIRED" &&
        isString(value.message) &&
        isString(value.workspaceId) &&
        isNonNegativeInteger(value.latestSequence));
}
//# sourceMappingURL=protocol.js.map