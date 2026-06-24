import { resolveBlueNoteRoot, type ResolveBlueNoteRootOptions } from "../config/root"
import { UsageError } from "./errors"
import { createDefaultStateManifest, getStateManifestPath, readStateManifest, writeStateManifest } from "../storage/state-manifest"
import { ensureManagedRoot } from "../storage/root-layout"
import { migrateLegacyAppStateToData } from "../storage/app-state-migration"
import { existsSync } from "node:fs"

export interface InitRootSummary {
  rootPath: string
}

export function initRoot(options: ResolveBlueNoteRootOptions = {}): InitRootSummary {
  const rootPath = ensureManagedRoot(resolveBlueNoteRoot(options))
  migrateLegacyAppStateToData(rootPath)

  try {
    const existingWorkspaceId = existsSync(getStateManifestPath(rootPath))
      ? readStateManifest(rootPath).workspaceId
      : undefined
    writeStateManifest(rootPath, existingWorkspaceId === undefined
      ? undefined
      : createDefaultStateManifest({ createWorkspaceId: () => existingWorkspaceId }))
  } catch (error) {
    throw new UsageError(`Could not initialize BlueNote root at '${rootPath}'.`, {
      hint: "Ensure BLUENOTE_ROOT points to a writable directory path.",
      cause: error,
    })
  }

  return {
    rootPath,
  }
}
