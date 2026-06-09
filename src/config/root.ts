import os from "node:os"
import path from "node:path"

import { UsageError } from "../core/errors"

export const DEFAULT_BLUENOTE_ROOT_DIRECTORY = ".bluenote"
export const APP_STATE_DIRECTORY = ".data"
export const APP_STATE_NOTES_DIRECTORY = path.join(APP_STATE_DIRECTORY, "notes")
export const APP_STATE_RECOVERY_DIRECTORY = path.join(APP_STATE_DIRECTORY, "recovery")
export const APP_STATE_TMP_DIRECTORY = path.join(APP_STATE_DIRECTORY, "tmp")
export const APP_STATE_LOGS_DIRECTORY = path.join(APP_STATE_DIRECTORY, "logs")
export const APP_STATE_AI_DIRECTORY = path.join(APP_STATE_DIRECTORY, "ai")
export const APP_STATE_AI_PROMPTS_DIRECTORY = path.join(APP_STATE_AI_DIRECTORY, "prompts")
export const APP_STATE_AI_LOGS_DIRECTORY = path.join(APP_STATE_AI_DIRECTORY, "logs")
export const APP_STATE_AI_CONFIG_FILENAME = "config.json"
export const APP_STATE_AI_QUEUE_FILENAME = "queue.json"
export const LEGACY_STATE_DIRECTORY = ".state"
export const LEGACY_STATE_NOTES_DIRECTORY = path.join(LEGACY_STATE_DIRECTORY, "notes")
export const STATE_DIRECTORY = APP_STATE_DIRECTORY
export const STATE_NOTES_DIRECTORY = APP_STATE_NOTES_DIRECTORY
export const STATE_RECOVERY_DIRECTORY = APP_STATE_RECOVERY_DIRECTORY
export const STATE_TMP_DIRECTORY = APP_STATE_TMP_DIRECTORY
export const STATE_LOGS_DIRECTORY = APP_STATE_LOGS_DIRECTORY
export const STATE_MANIFEST_FILENAME = "manifest.json"
export const STORAGE_SCHEMA_VERSION = 2

export interface ResolveBlueNoteRootOptions {
  override?: string
  env?: NodeJS.ProcessEnv
  cwd?: string
  homeDir?: string
}

export function resolveBlueNoteRoot(options: ResolveBlueNoteRootOptions = {}): string {
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const homeDir = options.homeDir ?? os.homedir()
  const override = options.override
  const envRoot = env.BLUENOTE_ROOT
  const hasOverride = override !== undefined
  let rootPath: string

  if (override !== undefined) {
    rootPath = override
  } else if (envRoot !== undefined) {
    rootPath = envRoot
  } else {
    rootPath = path.join(homeDir, DEFAULT_BLUENOTE_ROOT_DIRECTORY)
  }

  if (rootPath === "") {
    throw new UsageError(hasOverride ? "BlueNote root override must not be empty." : "BLUENOTE_ROOT must not be empty.")
  }

  return path.resolve(cwd, rootPath)
}
