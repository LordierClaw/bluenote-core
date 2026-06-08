import fs from "node:fs"
import path from "node:path"

import {
  LEGACY_STATE_NOTES_DIRECTORY,
  STATE_DIRECTORY,
  STATE_LOGS_DIRECTORY,
  STATE_MANIFEST_FILENAME,
  STATE_NOTES_DIRECTORY,
  STATE_RECOVERY_DIRECTORY,
  STATE_TMP_DIRECTORY,
} from "../config/root"
import { UsageError } from "../core/errors"
import { assertPathInsideRoot } from "../platform/path-safety"
import { getLegacyStatePath, getStatePath } from "./root-layout"

export interface AppStateMigrationResult {
  status: "noop" | "migrated"
  migratedFileCount: number
  legacyStatePath: string
  dataStatePath: string
}

const CONFLICT_MESSAGE = "Cannot migrate legacy .state because .data already contains conflicting app state."
const CONFLICT_HINT = "Review .state and .data, keep the desired BlueNote metadata under .data, then retry."
const UNSAFE_PATH_MESSAGE = "Cannot migrate legacy .state because .data contains unsafe app-state paths."
const UNSAFE_PATH_HINT = "Remove symlinks from .data app-state paths before retrying migration."
const UNSAFE_LEGACY_PATH_MESSAGE = "Cannot migrate legacy .state because .state contains unsafe app-state paths."
const UNSAFE_LEGACY_PATH_HINT = "Remove symlinks from .state app-state paths before retrying migration."
const SUPPORT_DIRECTORIES = [
  ["recovery", STATE_RECOVERY_DIRECTORY],
  ["tmp", STATE_TMP_DIRECTORY],
  ["logs", STATE_LOGS_DIRECTORY],
] as const
const DATA_LAYOUT_DIRECTORIES = [
  STATE_DIRECTORY,
  STATE_NOTES_DIRECTORY,
  STATE_RECOVERY_DIRECTORY,
  STATE_TMP_DIRECTORY,
  STATE_LOGS_DIRECTORY,
] as const

function pathExists(filePath: string): boolean {
  try {
    fs.lstatSync(filePath)
    return true
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return false
    }

    throw error
  }
}

function getResult(
  status: AppStateMigrationResult["status"],
  migratedFileCount: number,
  legacyStatePath: string,
  dataStatePath: string,
): AppStateMigrationResult {
  return {
    status,
    migratedFileCount,
    legacyStatePath,
    dataStatePath,
  }
}

function throwConflict(): never {
  throw new UsageError(CONFLICT_MESSAGE, {
    hint: CONFLICT_HINT,
  })
}

function throwUnsafePath(): never {
  throw new UsageError(UNSAFE_PATH_MESSAGE, {
    hint: UNSAFE_PATH_HINT,
  })
}

function throwUnsafeLegacyPath(): never {
  throw new UsageError(UNSAFE_LEGACY_PATH_MESSAGE, {
    hint: UNSAFE_LEGACY_PATH_HINT,
  })
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "EEXIST"
}

function assertExistingDestinationParentsAreSafe(rootPath: string, destinationPath: string): string {
  const safeDestinationPath = assertPathInsideRoot(rootPath, destinationPath)
  const relativeParentPath = path.relative(path.resolve(rootPath), path.dirname(safeDestinationPath))
  let currentPath = path.resolve(rootPath)

  if (relativeParentPath === "") {
    return safeDestinationPath
  }

  for (const segment of relativeParentPath.split(path.sep)) {
    currentPath = path.join(currentPath, segment)

    if (!pathExists(currentPath)) {
      continue
    }

    if (fs.lstatSync(currentPath).isSymbolicLink()) {
      throwUnsafePath()
    }
  }

  return safeDestinationPath
}

function assertDestinationDirectoryIsSafe(rootPath: string, destinationDirectory: string): string {
  assertExistingDestinationParentsAreSafe(rootPath, path.join(destinationDirectory, ".keep"))
  return assertPathInsideRoot(rootPath, destinationDirectory)
}

function ensureDataStateLayout(rootPath: string): void {
  for (const relativeDirectory of DATA_LAYOUT_DIRECTORIES) {
    const directoryPath = assertDestinationDirectoryIsSafe(rootPath, path.join(path.resolve(rootPath), relativeDirectory))
    fs.mkdirSync(directoryPath, { recursive: true })
  }
}

function assertExistingDestinationFileIsSafe(destinationPath: string): void {
  if (!pathExists(destinationPath)) {
    return
  }

  const stats = fs.lstatSync(destinationPath)
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throwUnsafePath()
  }
}

function getSafeSourceStats(sourcePath: string): fs.Stats {
  const stats = fs.lstatSync(sourcePath)
  if (stats.isSymbolicLink()) {
    throwUnsafeLegacyPath()
  }

  return stats
}

function copyFileIfMissingOrIdentical(rootPath: string, sourcePath: string, destinationPath: string): boolean {
  const sourceStats = getSafeSourceStats(sourcePath)
  if (!sourceStats.isFile()) {
    return false
  }

  const safeDestinationPath = assertExistingDestinationParentsAreSafe(rootPath, destinationPath)
  assertExistingDestinationFileIsSafe(safeDestinationPath)

  if (pathExists(safeDestinationPath)) {
    const source = fs.readFileSync(sourcePath)
    const destination = fs.readFileSync(safeDestinationPath)

    if (!source.equals(destination)) {
      throwConflict()
    }

    return false
  }

  fs.mkdirSync(path.dirname(safeDestinationPath), { recursive: true })
  try {
    fs.copyFileSync(sourcePath, safeDestinationPath, fs.constants.COPYFILE_EXCL)
    return true
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error
    }

    assertExistingDestinationFileIsSafe(safeDestinationPath)
    const source = fs.readFileSync(sourcePath)
    const destination = fs.readFileSync(safeDestinationPath)

    if (!source.equals(destination)) {
      throwConflict()
    }

    return false
  }
}

function copyDirectoryIfMissingOrIdentical(rootPath: string, sourceDirectory: string, destinationDirectory: string): number {
  if (!pathExists(sourceDirectory)) {
    return 0
  }

  const sourceStats = getSafeSourceStats(sourceDirectory)
  if (!sourceStats.isDirectory()) {
    return 0
  }

  const safeDestinationDirectory = assertDestinationDirectoryIsSafe(rootPath, destinationDirectory)
  fs.mkdirSync(safeDestinationDirectory, { recursive: true })

  let migratedFileCount = 0
  for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDirectory, entry.name)
    const destinationPath = assertPathInsideRoot(rootPath, path.join(safeDestinationDirectory, entry.name))

    if (entry.isSymbolicLink()) {
      throwUnsafeLegacyPath()
    }

    if (entry.isDirectory()) {
      migratedFileCount += copyDirectoryIfMissingOrIdentical(rootPath, sourcePath, destinationPath)
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    if (copyFileIfMissingOrIdentical(rootPath, sourcePath, destinationPath)) {
      migratedFileCount += 1
    }
  }

  return migratedFileCount
}

function copyLegacyNotes(rootPath: string, legacyNotesPath: string, dataNotesPath: string): number {
  if (!pathExists(legacyNotesPath)) {
    return 0
  }

  const legacyNotesStats = getSafeSourceStats(legacyNotesPath)
  if (!legacyNotesStats.isDirectory()) {
    return 0
  }

  const safeDataNotesPath = assertDestinationDirectoryIsSafe(rootPath, dataNotesPath)
  fs.mkdirSync(safeDataNotesPath, { recursive: true })

  let migratedFileCount = 0
  for (const entry of fs.readdirSync(legacyNotesPath, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      throwUnsafeLegacyPath()
    }

    if (!entry.isFile() || path.extname(entry.name) !== ".json") {
      continue
    }

    const sourcePath = path.join(legacyNotesPath, entry.name)
    const destinationPath = path.join(dataNotesPath, entry.name)
    if (copyFileIfMissingOrIdentical(rootPath, sourcePath, destinationPath)) {
      migratedFileCount += 1
    }
  }

  return migratedFileCount
}

export function migrateLegacyAppStateToData(rootPath: string): AppStateMigrationResult {
  const normalizedRootPath = path.resolve(rootPath)
  const legacyStatePath = getLegacyStatePath(normalizedRootPath)
  const dataStatePath = getStatePath(normalizedRootPath)

  if (!pathExists(legacyStatePath)) {
    return getResult("noop", 0, legacyStatePath, dataStatePath)
  }

  const legacyStateStats = getSafeSourceStats(legacyStatePath)
  if (!legacyStateStats.isDirectory()) {
    return getResult("noop", 0, legacyStatePath, dataStatePath)
  }

  if (!pathExists(dataStatePath)) {
    ensureDataStateLayout(normalizedRootPath)
  } else {
    assertDestinationDirectoryIsSafe(normalizedRootPath, dataStatePath)
  }

  let migratedFileCount = 0

  const legacyManifestPath = path.join(legacyStatePath, STATE_MANIFEST_FILENAME)
  if (pathExists(legacyManifestPath) && getSafeSourceStats(legacyManifestPath).isFile()) {
    const dataManifestPath = path.join(dataStatePath, STATE_MANIFEST_FILENAME)
    if (copyFileIfMissingOrIdentical(normalizedRootPath, legacyManifestPath, dataManifestPath)) {
      migratedFileCount += 1
    }
  }

  migratedFileCount += copyLegacyNotes(
    normalizedRootPath,
    assertPathInsideRoot(normalizedRootPath, path.join(normalizedRootPath, LEGACY_STATE_NOTES_DIRECTORY)),
    assertPathInsideRoot(normalizedRootPath, path.join(normalizedRootPath, STATE_NOTES_DIRECTORY)),
  )

  for (const [legacyDirectoryName, stateDirectory] of SUPPORT_DIRECTORIES) {
    migratedFileCount += copyDirectoryIfMissingOrIdentical(
      normalizedRootPath,
      assertPathInsideRoot(normalizedRootPath, path.join(legacyStatePath, legacyDirectoryName)),
      assertPathInsideRoot(normalizedRootPath, path.join(normalizedRootPath, stateDirectory)),
    )
  }

  return getResult(migratedFileCount > 0 ? "migrated" : "noop", migratedFileCount, legacyStatePath, dataStatePath)
}
