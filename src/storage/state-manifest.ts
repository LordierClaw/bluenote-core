import path from "node:path"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"

import {
  STATE_DIRECTORY,
  STATE_MANIFEST_FILENAME,
  STORAGE_SCHEMA_VERSION,
} from "../config/root"
import { RootNotInitializedError } from "../core/errors"

export interface StateManifest {
  schemaVersion: number
}

export function createDefaultStateManifest(): StateManifest {
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
  }
}

export function getStateManifestPath(rootPath: string): string {
  return path.join(path.resolve(rootPath), STATE_DIRECTORY, STATE_MANIFEST_FILENAME)
}

export function writeStateManifest(rootPath: string, manifest: StateManifest = createDefaultStateManifest()): string {
  const manifestPath = getStateManifestPath(rootPath)
  mkdirSync(path.dirname(manifestPath), { recursive: true })
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8")
  return manifestPath
}

function isStateManifest(value: unknown): value is StateManifest {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { schemaVersion?: unknown }).schemaVersion === "number"
  )
}

export function readStateManifest(rootPath: string): StateManifest {
  try {
    const manifest = JSON.parse(readFileSync(getStateManifestPath(rootPath), "utf8")) as unknown

    if (!isStateManifest(manifest)) {
      throw new Error("Invalid state manifest structure.")
    }

    return manifest
  } catch (error) {
    throw new RootNotInitializedError("BlueNote root is not initialized.", {
      hint: `Run 'bn init' to create a valid ${STATE_DIRECTORY}/${STATE_MANIFEST_FILENAME}.`,
      cause: error,
    })
  }
}
