import path from "node:path"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"

import { STATE_NOTES_DIRECTORY } from "../config/root"
import { UsageError } from "../core/errors"
import { assertPathInsideRoot } from "../platform/path-safety"
import type { NoteSidecar } from "./sidecar-schema"
import { validateNoteSidecar } from "./sidecar-schema"

export interface SidecarRepository {
  getSidecarPath(key: string): string
  read(key: string): NoteSidecar
  write(sidecar: NoteSidecar): string
}

function getWriteValidationSourcePath(sidecar: unknown): string {
  if (typeof sidecar === "object" && sidecar !== null) {
    const candidateKey = (sidecar as { key?: unknown }).key

    if (typeof candidateKey === "string") {
      return path.join(STATE_NOTES_DIRECTORY, `${candidateKey}.json`)
    }
  }

  return path.join(STATE_NOTES_DIRECTORY, "<unknown>.json")
}

function wrapSidecarRepositoryError(action: "read" | "write", relativePath: string, error: unknown): never {
  const message = action === "read" ? `Could not read sidecar '${relativePath}'.` : `Could not write sidecar '${relativePath}'.`
  const hint =
    action === "read"
      ? `Ensure the sidecar exists inside BLUENOTE_ROOT/${STATE_NOTES_DIRECTORY} and is readable.`
      : "Ensure BLUENOTE_ROOT points to a writable directory path."

  throw new UsageError(message, {
    hint,
    cause: error,
  })
}

function getTemporarySidecarPath(sidecarPath: string): string {
  return `${sidecarPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
}

function removeTemporarySidecar(sidecarPath: string): void {
  if (!existsSync(sidecarPath)) {
    return
  }

  try {
    rmSync(sidecarPath, { force: true })
  } catch {
    // Best-effort cleanup: preserve the original filesystem failure and error shape.
  }
}

export function createSidecarRepository(rootPath: string): SidecarRepository {
  const normalizedRootPath = path.resolve(rootPath)
  const normalizedStateNotesPath = path.join(normalizedRootPath, STATE_NOTES_DIRECTORY)

  function getSidecarPath(key: string): string {
    return assertPathInsideRoot(normalizedStateNotesPath, path.join(normalizedStateNotesPath, `${key}.json`))
  }

  return {
    getSidecarPath,

    read(key) {
      const sidecarPath = getSidecarPath(key)
      let rawJson: string

      try {
        rawJson = readFileSync(sidecarPath, "utf8")
      } catch (error) {
        wrapSidecarRepositoryError("read", path.join(STATE_NOTES_DIRECTORY, `${key}.json`), error)
      }

      let parsed: unknown

      try {
        parsed = JSON.parse(rawJson)
      } catch (error) {
        throw new UsageError(`Could not parse sidecar '${path.join(STATE_NOTES_DIRECTORY, `${key}.json`)}'.`, {
          hint: "Ensure sidecar files contain valid JSON metadata.",
          cause: error,
        })
      }

      return validateNoteSidecar(parsed, path.join(STATE_NOTES_DIRECTORY, `${key}.json`))
    },

    write(sidecar) {
      const canonicalSidecar = validateNoteSidecar(sidecar, getWriteValidationSourcePath(sidecar))
      const sidecarPath = getSidecarPath(canonicalSidecar.key)
      const temporarySidecarPath = getTemporarySidecarPath(sidecarPath)

      try {
        mkdirSync(path.dirname(sidecarPath), { recursive: true })
        writeFileSync(temporarySidecarPath, JSON.stringify(canonicalSidecar, null, 2) + "\n", "utf8")
        renameSync(temporarySidecarPath, sidecarPath)
      } catch (error) {
        removeTemporarySidecar(temporarySidecarPath)
        wrapSidecarRepositoryError("write", path.join(STATE_NOTES_DIRECTORY, `${canonicalSidecar.key}.json`), error)
      }

      return sidecarPath
    },
  }
}
