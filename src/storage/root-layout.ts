import path from "node:path"
import { lstatSync, mkdirSync } from "node:fs"

import {
  APP_STATE_AI_CONFIG_FILENAME,
  APP_STATE_AI_DIRECTORY,
  APP_STATE_AI_LOGS_DIRECTORY,
  APP_STATE_AI_PROMPTS_DIRECTORY,
  APP_STATE_AI_QUEUE_FILENAME,
  LEGACY_STATE_DIRECTORY,
  STATE_DIRECTORY,
  STATE_LOGS_DIRECTORY,
  STATE_NOTES_DIRECTORY,
  STATE_RECOVERY_DIRECTORY,
  STATE_TMP_DIRECTORY,
} from "../config/root"
import { UsageError } from "../core/errors"
import { assertPathInsideRoot } from "../platform/path-safety"

export const MANAGED_ROOT_LAYOUT = [
  "note",
  "draft",
  STATE_DIRECTORY,
  path.join(STATE_DIRECTORY, "archive"),
  STATE_NOTES_DIRECTORY,
  STATE_RECOVERY_DIRECTORY,
  STATE_TMP_DIRECTORY,
  STATE_LOGS_DIRECTORY,
  APP_STATE_AI_DIRECTORY,
  APP_STATE_AI_PROMPTS_DIRECTORY,
  APP_STATE_AI_LOGS_DIRECTORY,
] as const

const NORMAL_NOTES_DIRECTORY = "note"
const DRAFT_NOTES_DIRECTORY = "draft"
const ARCHIVE_NOTES_DIRECTORY = path.join(STATE_DIRECTORY, "archive")

export function getNotesPath(rootPath: string): string {
  return getNormalNotesPath(rootPath)
}

export function getNormalNotesPath(rootPath: string): string {
  return assertPathInsideRoot(rootPath, path.join(path.resolve(rootPath), NORMAL_NOTES_DIRECTORY))
}

export function getDraftNotesPath(rootPath: string): string {
  return assertPathInsideRoot(rootPath, path.join(path.resolve(rootPath), DRAFT_NOTES_DIRECTORY))
}

export function getArchiveNotesPath(rootPath: string): string {
  return assertPathInsideRoot(rootPath, path.join(path.resolve(rootPath), ARCHIVE_NOTES_DIRECTORY))
}

export function getInboxPath(rootPath: string): string {
  return getNormalNotesPath(rootPath)
}

export function getArchivePath(rootPath: string): string {
  return getArchiveNotesPath(rootPath)
}

export function getStateNotesPath(rootPath: string): string {
  return assertPathInsideRoot(rootPath, path.join(path.resolve(rootPath), STATE_NOTES_DIRECTORY))
}

export function getStatePath(rootPath: string): string {
  return assertPathInsideRoot(rootPath, path.join(path.resolve(rootPath), STATE_DIRECTORY))
}

export function getStateTmpPath(rootPath: string): string {
  return assertPathInsideRoot(rootPath, path.join(path.resolve(rootPath), STATE_TMP_DIRECTORY))
}

export function getAiStatePath(rootPath: string): string {
  return assertPathInsideRoot(rootPath, path.join(path.resolve(rootPath), APP_STATE_AI_DIRECTORY))
}

export function getAiPromptsPath(rootPath: string): string {
  return assertPathInsideRoot(rootPath, path.join(path.resolve(rootPath), APP_STATE_AI_PROMPTS_DIRECTORY))
}

export function getAiLogsPath(rootPath: string): string {
  return assertPathInsideRoot(rootPath, path.join(path.resolve(rootPath), APP_STATE_AI_LOGS_DIRECTORY))
}

export function getAiConfigPath(rootPath: string): string {
  return assertPathInsideRoot(rootPath, path.join(getAiStatePath(rootPath), APP_STATE_AI_CONFIG_FILENAME))
}

export function getAiQueuePath(rootPath: string): string {
  return assertPathInsideRoot(rootPath, path.join(getAiStatePath(rootPath), APP_STATE_AI_QUEUE_FILENAME))
}

export function getLegacyStatePath(rootPath: string): string {
  return assertPathInsideRoot(rootPath, path.join(path.resolve(rootPath), LEGACY_STATE_DIRECTORY))
}

export function getInboxNotePath(rootPath: string, key: string): string {
  return getNormalNotePath(rootPath, key)
}

export function getNormalNotePath(rootPath: string, key: string): string {
  const normalNotesPath = getNormalNotesPath(rootPath)

  return assertPathInsideRoot(normalNotesPath, path.join(normalNotesPath, `${key}.md`))
}

export function getArchiveNotePath(rootPath: string, key: string): string {
  const archivePath = getArchivePath(rootPath)

  return assertPathInsideRoot(archivePath, path.join(archivePath, `${key}.md`))
}

function existingPathIsSymlink(filePath: string): boolean {
  try {
    return lstatSync(filePath).isSymbolicLink()
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return false
    }

    throw error
  }
}

function assertNoExistingLayoutSymlinks(rootPath: string, targetPath: string): void {
  const relativePath = path.relative(rootPath, targetPath)
  const parts = relativePath === "" ? [] : relativePath.split(path.sep).filter(Boolean)
  let currentPath = rootPath

  if (existingPathIsSymlink(currentPath)) {
    throw new UsageError(`Managed root path '${rootPath}' must not be a symlink.`, {
      hint: "Use a real directory for BLUENOTE_ROOT, then retry.",
    })
  }

  for (const part of parts) {
    currentPath = path.join(currentPath, part)
    if (existingPathIsSymlink(currentPath)) {
      throw new UsageError(`Managed root layout path '${path.relative(rootPath, currentPath)}' must not be a symlink.`, {
        hint: "Remove symlinks from BlueNote-managed layout paths before retrying.",
      })
    }
  }
}

export function ensureManagedRoot(rootPath: string): string {
  const normalizedRootPath = path.resolve(rootPath)

  try {
    assertNoExistingLayoutSymlinks(normalizedRootPath, normalizedRootPath)
    mkdirSync(normalizedRootPath, { recursive: true })

    for (const relativePath of MANAGED_ROOT_LAYOUT) {
      const targetPath = path.join(normalizedRootPath, relativePath)
      assertNoExistingLayoutSymlinks(normalizedRootPath, targetPath)
      mkdirSync(targetPath, { recursive: true })
    }
  } catch (error) {
    throw new UsageError(`Could not initialize BlueNote root at '${normalizedRootPath}'.`, {
      hint: "Ensure BLUENOTE_ROOT points to a writable directory path.",
      cause: error,
    })
  }

  return normalizedRootPath
}
