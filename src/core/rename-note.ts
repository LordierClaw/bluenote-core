import path from "node:path"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"

import { resolveBlueNoteRoot, type ResolveBlueNoteRootOptions, STATE_RECOVERY_DIRECTORY } from "../config/root"
import { createNoteKey } from "../domain/note-key"
import { createNoteRepository } from "../storage/note-repository"
import { selectNote } from "./select-note"
import { joinPortableRelativePath } from "../platform/path-safety"
import { UsageError } from "./errors"
import type { NoteVisibilityOptions } from "./note-visibility"

export interface RenameNoteHooks {
  onRecoveryArtifactStaged?: (artifactPath: string) => void
}

export interface RenameNoteOptions extends ResolveBlueNoteRootOptions, NoteVisibilityOptions {
  selector: string
  title: string
  body: string
  updatedAt: string
  randomSource?: () => number
  hooks?: RenameNoteHooks
}

export interface RenameNoteSummary {
  previousKey: string
  key: string
  previousRelativePath: string
  relativePath: string
  notePath: string
}

function buildRecoveryArtifactPath(rootPath: string, previousKey: string, nextKey: string): string {
  const safePreviousKey = previousKey.replace(/[^a-z0-9-]+/gi, "-")
  const safeNextKey = nextKey.replace(/[^a-z0-9-]+/gi, "-")
  return path.join(rootPath, STATE_RECOVERY_DIRECTORY, `${Date.now()}-${safePreviousKey}-to-${safeNextKey}.json`)
}

function updateLatestOpenedPathIfMatched(rootPath: string, previousRelativePath: string, nextRelativePath: string): void {
  const latestPath = path.join(rootPath, ".data", "latest-opened-note.json")
  try {
    const latest = JSON.parse(readFileSync(latestPath, "utf8")) as { relativePath?: unknown }
    if (latest.relativePath === previousRelativePath) {
      writeFileSync(latestPath, JSON.stringify({ ...latest, relativePath: nextRelativePath }, null, 2) + "\n", "utf8")
    }
  } catch {
    // Best-effort state repair; rename success should not depend on optional UI state.
  }
}

export function renameNote(options: RenameNoteOptions): RenameNoteSummary {
  const rootPath = resolveBlueNoteRoot(options)
  const repository = createNoteRepository(rootPath)
  const selected = selectNote({ repository, selector: options.selector, visibility: options.visibility })
  const currentKey = selected.frontmatter.id

  let nextKey: string

  try {
    nextKey = createNoteKey(options.title, {
      isUnique: (candidate) => candidate === currentKey || !repository.keyExists(candidate),
      maxAttempts: 1,
      randomSource: options.randomSource,
    })
  } catch (error) {
    throw new UsageError(`Could not rename note '${selected.sourcePath}'.`, {
      hint: "The generated key already exists. Change the title and retry, or remove the conflicting note first.",
      cause: error,
    })
  }

  const recoveryArtifactPath = buildRecoveryArtifactPath(rootPath, currentKey, nextKey)
  const recoveryArtifact = {
    previousKey: currentKey,
    nextKey,
    previousRelativePath: selected.sourcePath,
    nextRelativePath: joinPortableRelativePath(path.posix.dirname(selected.sourcePath), `${nextKey}.md`),
    stagedAt: options.updatedAt,
  }

  try {
    mkdirSync(path.dirname(recoveryArtifactPath), { recursive: true })
    writeFileSync(recoveryArtifactPath, JSON.stringify(recoveryArtifact, null, 2) + "\n", "utf8")
    options.hooks?.onRecoveryArtifactStaged?.(recoveryArtifactPath)

    const renamed = repository.rename(path.join(rootPath, selected.sourcePath), {
      nextKey,
      title: options.title,
      body: options.body,
      updatedAt: options.updatedAt,
    })

    try {
      rmSync(recoveryArtifactPath, { force: true })
    } catch {
      // Best-effort cleanup: a stale recovery artifact is safer than reporting a successful rename as failed.
    }

    updateLatestOpenedPathIfMatched(rootPath, renamed.previousRelativePath, renamed.relativePath)

    return renamed
  } catch (error) {
    if (error instanceof UsageError) {
      throw error
    }

    throw new UsageError(`Could not rename note '${selected.sourcePath}'.`, {
      hint: "Inspect .data/recovery/ for the staged rename artifact, then repair or retry the rename.",
      cause: error,
    })
  }
}
