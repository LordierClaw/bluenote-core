import path from "node:path"
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"

import { UsageError } from "../core/errors"
import { replaceFileAtomically } from "../storage/atomic-replace"
import { getAiConfigPath } from "../storage/root-layout"
import { toPortableRelativePath } from "../platform/path-safety"
import type { AiConfig } from "./config-schema"
import { validateAiConfig } from "./config-schema"

export interface AiConfigRepository {
  exists(): boolean
  read(): AiConfig
  write(config: AiConfig): string
}

function getTemporaryConfigPath(configPath: string): string {
  return `${configPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
}

function removeTemporaryConfig(configPath: string): void {
  try {
    rmSync(configPath, { force: true })
  } catch {
    // Best-effort cleanup must not hide the original write error.
  }
}

function relativeConfigPath(rootPath: string, configPath: string): string {
  return toPortableRelativePath(path.relative(rootPath, configPath) || configPath)
}

export function createAiConfigRepository(rootPath: string): AiConfigRepository {
  const normalizedRootPath = path.resolve(rootPath)
  const configPath = getAiConfigPath(normalizedRootPath)
  const relativePath = relativeConfigPath(normalizedRootPath, configPath)

  return {
    exists() {
      return existsSync(configPath)
    },

    read() {
      let rawJson: string

      try {
        rawJson = readFileSync(configPath, "utf8")
      } catch (error) {
        throw new UsageError(`Could not read AI config '${relativePath}'.`, {
          hint: "Ensure AI has been configured and the config file is readable.",
          cause: error,
        })
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(rawJson)
      } catch (error) {
        throw new UsageError(`Could not parse AI config '${relativePath}'.`, {
          hint: "Ensure .data/ai/config.json contains valid JSON.",
          cause: error,
        })
      }

      return validateAiConfig(parsed, relativePath)
    },

    write(config) {
      const canonicalConfig = validateAiConfig(config, relativePath)
      const temporaryConfigPath = getTemporaryConfigPath(configPath)

      try {
        mkdirSync(path.dirname(configPath), { recursive: true })
        writeFileSync(temporaryConfigPath, `${JSON.stringify(canonicalConfig, null, 2)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        })
        replaceFileAtomically(temporaryConfigPath, configPath)
        chmodSync(configPath, 0o600)
      } catch (error) {
        removeTemporaryConfig(temporaryConfigPath)
        throw new UsageError(`Could not write AI config '${relativePath}'.`, {
          hint: "Ensure BLUENOTE_ROOT points to a writable directory path.",
          cause: error,
        })
      }

      return configPath
    },
  }
}
