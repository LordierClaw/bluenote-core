import type { ResolveBlueNoteRootOptions } from "../config/root"

export type SyncLinkMode = "seed-empty-server-from-local"
export type SyncRuntimeViewMode = "standalone" | "sync-client"
export type SyncConnectionState = "unlinked" | "linked"
export type SyncActivityState = "idle"

export interface SyncStatusView {
  state: SyncConnectionState
  mode: SyncRuntimeViewMode
  activity: SyncActivityState
  workspaceId?: string
  pendingCount: number
  runningCount: number
  failedCount: number
  lastError: string | null
}

export interface SyncLinkOptions {
  mode: SyncLinkMode
  serverUrl: string
  workspaceId?: string
}

export interface SyncLinkSummary {
  state: "linked"
  mode: "sync-client"
  workspaceId: string
  serverUrl: string
  dirtyRecordsMarked: number
  notesMarked: number
  foldersMarked: number
}

export interface SyncUnlinkSummary {
  state: "unlinked"
  mode: "standalone"
  keptLocalNotes: true
}

export interface SyncNowOptions {
  force?: boolean
  transport?: import("./core-sync").SyncTransport
  replicaId?: string
}

export type SyncNowStatus = "not-linked" | "transport-not-configured" | "synced"

export interface SyncNowSummary {
  status: SyncNowStatus
  pushed: number
  pulled: number
}

export interface SyncRepairOptions {
  dryRun?: boolean
  confirm?: "repair-sync-state"
}

export type SyncRepairIssueCode = "missing-sync-database" | "missing-sidecar" | "stale-dirty-record"
export type SyncRepairIssueSeverity = "warning" | "error"

export interface SyncRepairIssue {
  code: SyncRepairIssueCode
  severity: SyncRepairIssueSeverity
  entityType?: string
  entityId?: string
  message: string
  suggestion: string
}

export interface SyncRepairSummary {
  dryRun: boolean
  changed: boolean
  issuesFound: number
  repairsApplied: number
  issues: SyncRepairIssue[]
}

export type SyncRootOptions = ResolveBlueNoteRootOptions
