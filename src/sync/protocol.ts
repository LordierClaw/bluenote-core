export type SyncChangeEntityType = "note" | "folder" | "config" | "tombstone" | "ai"
export type SyncPushEntityType = "note" | "folder"
export type SyncDirtyType = "upsert" | "delete" | "folder-upsert" | "folder-delete"

export interface PullChangesRequest {
  workspaceId: string
  sinceSequence: number
  limit: number
}

export interface PullChangesResponse {
  workspaceId: string
  fromSequence: number
  toSequence: number
  hasMore: boolean
  changes: SyncChangeView[]
}

export interface SyncChangeView {
  sequence: number
  entityType: SyncChangeEntityType
  entityId: string
  changeType: string
  serverRevision: number
  changedAt: string
  sourceReplicaId?: string
  title?: string
  relativePath?: string
  bodyAvailable?: boolean
  metadata: Record<string, unknown>
}

export interface SyncBodyUploadDescriptor {
  uploadId?: string
  contentHash: string
  byteLength: number
}

export interface SyncPushRecord {
  entityType: SyncPushEntityType
  entityId: string
  dirtyType: SyncDirtyType
  clientUpdatedAt: string
  metadata: Record<string, unknown>
  bodyUpload?: SyncBodyUploadDescriptor
}

export interface PushRequest {
  workspaceId: string
  replicaId: string
  baseSequence: number
  records: SyncPushRecord[]
}

export interface PushAcceptedRecord {
  entityType: SyncPushEntityType
  entityId: string
  serverRevision: number
}

export interface PushRejectedRecord {
  entityType: SyncPushEntityType
  entityId: string
  code: string
  message: string
}

export interface PushResponse {
  accepted: PushAcceptedRecord[]
  replacedByServer: PushAcceptedRecord[]
  rejected: PushRejectedRecord[]
  serverSequence: number
}

export interface UploadNoteBodyRequest {
  workspaceId: string
  replicaId: string
  noteId: string
  contentHash: string
  byteLength: number
  body: string
}

export interface UploadNoteBodyResponse {
  noteId: string
  contentHash: string
  byteLength: number
  accepted: boolean
}

export interface DownloadNoteBodyResponse {
  workspaceId: string
  noteId: string
  sequence?: number
  serverRevision?: number
  contentHash?: string
  byteLength?: number
  body: string
}

export interface SnapshotResponse {
  workspaceId: string
  serverSequence: number
  hasMore: boolean
  changes: SyncChangeView[]
}

export interface SnapshotRequiredError {
  error: "snapshot-required"
  code: "SNAPSHOT_REQUIRED"
  message: string
  workspaceId: string
  latestSequence: number
}

const syncChangeEntityTypes = new Set<SyncChangeEntityType>(["note", "folder", "config", "tombstone", "ai"])
const syncPushEntityTypes = new Set<SyncPushEntityType>(["note", "folder"])
const syncDirtyTypes = new Set<SyncDirtyType>(["upsert", "delete", "folder-upsert", "folder-delete"])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean"
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value)
}

function isMetadataRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !hasOwn(value, "body")
}

function optionalString(value: Record<string, unknown>, key: string): boolean {
  return !hasOwn(value, key) || isString(value[key])
}

function optionalBoolean(value: Record<string, unknown>, key: string): boolean {
  return !hasOwn(value, key) || isBoolean(value[key])
}

export function isSyncChangeView(value: unknown): value is SyncChangeView {
  if (!isObject(value) || hasOwn(value, "body")) {
    return false
  }

  return (
    isNonNegativeInteger(value.sequence) &&
    isString(value.entityType) &&
    syncChangeEntityTypes.has(value.entityType as SyncChangeEntityType) &&
    isString(value.entityId) &&
    isString(value.changeType) &&
    isNonNegativeInteger(value.serverRevision) &&
    isString(value.changedAt) &&
    optionalString(value, "sourceReplicaId") &&
    optionalString(value, "title") &&
    optionalString(value, "relativePath") &&
    optionalBoolean(value, "bodyAvailable") &&
    isMetadataRecord(value.metadata)
  )
}

export function isPullChangesRequest(value: unknown): value is PullChangesRequest {
  return (
    isObject(value) &&
    isString(value.workspaceId) &&
    isNonNegativeInteger(value.sinceSequence) &&
    isPositiveInteger(value.limit)
  )
}

export function isPullChangesResponse(value: unknown): value is PullChangesResponse {
  return (
    isObject(value) &&
    isString(value.workspaceId) &&
    isNonNegativeInteger(value.fromSequence) &&
    isNonNegativeInteger(value.toSequence) &&
    isBoolean(value.hasMore) &&
    Array.isArray(value.changes) &&
    value.changes.every(isSyncChangeView)
  )
}

export function isSyncBodyUploadDescriptor(value: unknown): value is SyncBodyUploadDescriptor {
  return (
    isObject(value) &&
    optionalString(value, "uploadId") &&
    isString(value.contentHash) &&
    isNonNegativeInteger(value.byteLength)
  )
}

export function isSyncPushRecord(value: unknown): value is SyncPushRecord {
  if (!isObject(value) || hasOwn(value, "body")) {
    return false
  }

  if (
    !isString(value.entityType) ||
    !syncPushEntityTypes.has(value.entityType as SyncPushEntityType) ||
    !isString(value.entityId) ||
    !isString(value.dirtyType) ||
    !syncDirtyTypes.has(value.dirtyType as SyncDirtyType) ||
    !isString(value.clientUpdatedAt) ||
    !isMetadataRecord(value.metadata)
  ) {
    return false
  }

  const entityType = value.entityType as SyncPushEntityType
  const dirtyType = value.dirtyType as SyncDirtyType
  if (entityType === "note" && dirtyType !== "upsert" && dirtyType !== "delete") {
    return false
  }
  if (entityType === "folder" && dirtyType !== "folder-upsert" && dirtyType !== "folder-delete") {
    return false
  }
  if (hasOwn(value, "bodyUpload") && (entityType !== "note" || dirtyType !== "upsert" || !isSyncBodyUploadDescriptor(value.bodyUpload))) {
    return false
  }

  return true
}

export function isPushRequest(value: unknown): value is PushRequest {
  return (
    isObject(value) &&
    isString(value.workspaceId) &&
    isString(value.replicaId) &&
    isNonNegativeInteger(value.baseSequence) &&
    Array.isArray(value.records) &&
    value.records.every(isSyncPushRecord)
  )
}

function isPushAcceptedRecord(value: unknown): value is PushAcceptedRecord {
  return (
    isObject(value) &&
    isString(value.entityType) &&
    syncPushEntityTypes.has(value.entityType as SyncPushEntityType) &&
    isString(value.entityId) &&
    isNonNegativeInteger(value.serverRevision)
  )
}

function isPushRejectedRecord(value: unknown): value is PushRejectedRecord {
  return (
    isObject(value) &&
    isString(value.entityType) &&
    syncPushEntityTypes.has(value.entityType as SyncPushEntityType) &&
    isString(value.entityId) &&
    isString(value.code) &&
    isString(value.message)
  )
}

export function isPushResponse(value: unknown): value is PushResponse {
  return (
    isObject(value) &&
    Array.isArray(value.accepted) &&
    value.accepted.every(isPushAcceptedRecord) &&
    Array.isArray(value.replacedByServer) &&
    value.replacedByServer.every(isPushAcceptedRecord) &&
    Array.isArray(value.rejected) &&
    value.rejected.every(isPushRejectedRecord) &&
    isNonNegativeInteger(value.serverSequence)
  )
}

export function isUploadNoteBodyRequest(value: unknown): value is UploadNoteBodyRequest {
  return (
    isObject(value) &&
    isString(value.workspaceId) &&
    isString(value.replicaId) &&
    isString(value.noteId) &&
    isString(value.contentHash) &&
    isNonNegativeInteger(value.byteLength) &&
    isString(value.body)
  )
}

export function isUploadNoteBodyResponse(value: unknown): value is UploadNoteBodyResponse {
  return (
    isObject(value) &&
    isString(value.noteId) &&
    isString(value.contentHash) &&
    isNonNegativeInteger(value.byteLength) &&
    isBoolean(value.accepted)
  )
}

export function isDownloadNoteBodyResponse(value: unknown): value is DownloadNoteBodyResponse {
  return (
    isObject(value) &&
    isString(value.workspaceId) &&
    isString(value.noteId) &&
    (!hasOwn(value, "sequence") || isNonNegativeInteger(value.sequence)) &&
    (!hasOwn(value, "serverRevision") || isNonNegativeInteger(value.serverRevision)) &&
    optionalString(value, "contentHash") &&
    (!hasOwn(value, "byteLength") || isNonNegativeInteger(value.byteLength)) &&
    isString(value.body)
  )
}

export function isSnapshotResponse(value: unknown): value is SnapshotResponse {
  return (
    isObject(value) &&
    isString(value.workspaceId) &&
    isNonNegativeInteger(value.serverSequence) &&
    isBoolean(value.hasMore) &&
    Array.isArray(value.changes) &&
    value.changes.every(isSyncChangeView)
  )
}

export function isSnapshotRequiredError(value: unknown): value is SnapshotRequiredError {
  return (
    isObject(value) &&
    value.error === "snapshot-required" &&
    value.code === "SNAPSHOT_REQUIRED" &&
    isString(value.message) &&
    isString(value.workspaceId) &&
    isNonNegativeInteger(value.latestSequence)
  )
}
