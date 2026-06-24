import path from "node:path"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"

import { APP_STATE_SYNC_DIRECTORY } from "../config/root"
import { assertPathInsideRoot } from "../platform/path-safety"
import { ensureManagedRoot } from "../storage/root-layout"

export type SyncRuntimeMode = "standalone" | "sync-client"

export interface SyncRuntimeModeConfig {
  mode: SyncRuntimeMode
  workspaceId?: string
}

export interface SyncClientRuntimeModeConfig {
  mode: "sync-client"
  workspaceId: string
}

const RUNTIME_MODE_FILENAME = "runtime-mode.json"

export function getSyncRuntimeModePath(rootPath: string): string {
  const normalizedRootPath = path.resolve(rootPath)
  const syncDirectoryPath = assertPathInsideRoot(normalizedRootPath, path.join(normalizedRootPath, APP_STATE_SYNC_DIRECTORY))

  return assertPathInsideRoot(syncDirectoryPath, path.join(syncDirectoryPath, RUNTIME_MODE_FILENAME))
}

function parseRuntimeMode(value: unknown): SyncRuntimeModeConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { mode: "standalone" }
  }

  const record = value as Record<string, unknown>
  if (record.mode === "sync-client" && typeof record.workspaceId === "string" && record.workspaceId.trim().length > 0) {
    return { mode: "sync-client", workspaceId: record.workspaceId }
  }

  return { mode: "standalone" }
}

export function readSyncRuntimeMode(rootPath: string): SyncRuntimeModeConfig {
  const runtimeModePath = getSyncRuntimeModePath(rootPath)

  if (!existsSync(runtimeModePath)) {
    return { mode: "standalone" }
  }

  try {
    return parseRuntimeMode(JSON.parse(readFileSync(runtimeModePath, "utf8")) as unknown)
  } catch {
    return { mode: "standalone" }
  }
}

export function getSyncClientRuntimeMode(rootPath: string): SyncClientRuntimeModeConfig | null {
  const config = readSyncRuntimeMode(rootPath)
  return config.mode === "sync-client" && config.workspaceId ? { mode: "sync-client", workspaceId: config.workspaceId } : null
}

export function setSyncRuntimeMode(rootPath: string, config: SyncRuntimeModeConfig): void {
  const managedRootPath = ensureManagedRoot(rootPath)
  const runtimeModePath = getSyncRuntimeModePath(managedRootPath)
  const normalizedConfig = parseRuntimeMode(config)

  mkdirSync(path.dirname(runtimeModePath), { recursive: true })
  writeFileSync(runtimeModePath, JSON.stringify(normalizedConfig, null, 2) + "\n", "utf8")
}
