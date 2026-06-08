import path from "node:path"
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"

import { UsageError } from "../core/errors"
import { replaceFileAtomically } from "./atomic-replace"
import { getStatePath } from "./root-layout"

export interface AppConfig {
  latestOpenedNoteTtlDays: number
}

export interface AppConfigRepository {
  exists(): boolean
  read(): AppConfig
  write(config: Partial<AppConfig>): string
}

const DEFAULT_APP_CONFIG: AppConfig = {
  latestOpenedNoteTtlDays: 7,
}

function getAppConfigPath(rootPath: string): string {
  return path.join(getStatePath(rootPath), "config.json")
}

function temporaryPath(targetPath: string): string {
  return `${targetPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
}

function cleanup(filePath: string): void {
  try {
    rmSync(filePath, { force: true })
  } catch {
    // best effort
  }
}

export function normalizeAppConfig(input: unknown): AppConfig {
  if (typeof input !== "object" || input === null) {
    return { ...DEFAULT_APP_CONFIG }
  }

  const candidateTtlDays = (input as { latestOpenedNoteTtlDays?: unknown }).latestOpenedNoteTtlDays
  return {
    latestOpenedNoteTtlDays: typeof candidateTtlDays === "number" && Number.isFinite(candidateTtlDays) && candidateTtlDays >= 0
      ? candidateTtlDays
      : DEFAULT_APP_CONFIG.latestOpenedNoteTtlDays,
  }
}

export function createAppConfigRepository(rootPath: string): AppConfigRepository {
  const configPath = getAppConfigPath(rootPath)
  const relativePath = path.relative(rootPath, configPath) || configPath

  return {
    exists() {
      return existsSync(configPath)
    },

    read() {
      if (!existsSync(configPath)) {
        return { ...DEFAULT_APP_CONFIG }
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(readFileSync(configPath, "utf8"))
      } catch {
        return { ...DEFAULT_APP_CONFIG }
      }

      return normalizeAppConfig(parsed)
    },

    write(config) {
      const canonical = normalizeAppConfig(config)
      const tempPath = temporaryPath(configPath)
      try {
        mkdirSync(path.dirname(configPath), { recursive: true })
        writeFileSync(tempPath, `${JSON.stringify(canonical, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
        replaceFileAtomically(tempPath, configPath)
        chmodSync(configPath, 0o600)
      } catch (error) {
        cleanup(tempPath)
        throw new UsageError(`Could not write app config '${relativePath}'.`, {
          hint: "Ensure BLUENOTE_ROOT points to a writable directory path.",
          cause: error,
        })
      }
      return configPath
    },
  }
}
