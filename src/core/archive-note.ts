import { resolveBlueNoteRoot, type ResolveBlueNoteRootOptions } from "../config/root"
import { IndexValidationFailedError, UsageError } from "./errors"
import { joinPortableRelativePath } from "../platform/path-safety"
import { systemClock, type Clock } from "../platform/clock"
import { createNoteRepository } from "../storage/note-repository"
import type { ParsedNote } from "../storage/note-schema"
import { ensureManagedRoot } from "../storage/root-layout"
import { rebuildIndexes } from "./rebuild-indexes"
import { selectNote } from "./select-note"
import type { NoteVisibilityOptions } from "./note-visibility"

export interface ArchiveNoteOptions extends ResolveBlueNoteRootOptions, NoteVisibilityOptions {
  selector: string
  clock?: Clock
}

export interface ArchiveNoteSummary {
  rootPath: string
  notePath: string
  relativePath: string
  archivedAt: string
}

function isArchivedNote(note: ParsedNote): boolean {
  return note.frontmatter.archivedAt !== undefined || note.sourcePath.startsWith(joinPortableRelativePath(".data", "archive") + "/")
}

function throwArchiveValidationError(stage: "before" | "after", sourcePath: string, validationErrors: string[]): never {
  throw new IndexValidationFailedError(
    `Validation failed ${stage} archiving ${sourcePath}.\n${validationErrors.join("\n")}`,
    {
      hint: "Fix the reported note data and rerun bn rebuild.",
    },
  )
}

export function archiveNote(options: ArchiveNoteOptions): ArchiveNoteSummary {
  const rootPath = ensureManagedRoot(resolveBlueNoteRoot(options))
  const repository = createNoteRepository(rootPath)
  const selected = selectNote({ repository, selector: options.selector, visibility: options.visibility ?? "normal" })

  if (isArchivedNote(selected)) {
    throw new UsageError(`Note '${selected.sourcePath}' is already archived.`, {
      hint: "Choose an active note from bn list instead.",
    })
  }

  if (!selected.sourcePath.startsWith("note/")) {
    throw new UsageError(`Cannot archive non-normal note '${selected.sourcePath}'.`, {
      hint: "Only normal notes under note/ can be archived.",
    })
  }

  const preflightRebuildSummary = rebuildIndexes({ override: rootPath })

  if (preflightRebuildSummary.validationErrors.length > 0) {
    throwArchiveValidationError("before", selected.sourcePath, preflightRebuildSummary.validationErrors)
  }

  const archivedAt = (options.clock ?? systemClock).now().toISOString()
  const archived = repository.archive(`${rootPath}/${selected.sourcePath}`, archivedAt)

  const rebuildSummary = rebuildIndexes({ override: rootPath })

  if (rebuildSummary.validationErrors.length > 0) {
    throwArchiveValidationError("after", selected.sourcePath, rebuildSummary.validationErrors)
  }

  return {
    rootPath,
    notePath: archived.notePath,
    relativePath: archived.relativePath,
    archivedAt,
  }
}
