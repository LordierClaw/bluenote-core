import path from "node:path"

import { resolveBlueNoteRoot, type ResolveBlueNoteRootOptions } from "../config/root"
import { IndexValidationFailedError, UsageError } from "./errors"
import { createNoteRepository } from "../storage/note-repository"
import { ensureManagedRoot } from "../storage/root-layout"
import { rebuildIndexes } from "./rebuild-indexes"
import { selectNote } from "./select-note"
import type { NoteVisibilityOptions } from "./note-visibility"

export interface DeleteNoteOptions extends ResolveBlueNoteRootOptions, NoteVisibilityOptions {
  selector: string
  force?: boolean
}

export interface DeleteNoteSummary {
  rootPath: string
  notePath: string
  relativePath: string
}

export function deleteNote(options: DeleteNoteOptions): DeleteNoteSummary {
  if (!options.force) {
    throw new UsageError("Deleting notes requires --force.", {
      hint: "Run bn delete <key|path> --force to confirm permanent removal.",
    })
  }

  const rootPath = ensureManagedRoot(resolveBlueNoteRoot(options))
  const repository = createNoteRepository(rootPath)
  const selected = selectNote({ repository, selector: options.selector, visibility: options.visibility })
  const deleted = repository.delete(path.join(rootPath, selected.sourcePath))
  const rebuildSummary = rebuildIndexes({ override: rootPath })

  if (rebuildSummary.validationErrors.length > 0) {
    throw new IndexValidationFailedError(
      [`Deleted note '${selected.frontmatter.id}', but derived indexes could not be rebuilt.`, ...rebuildSummary.validationErrors].join("\n"),
      {
        hint: "Run bn rebuild after fixing the reported validation errors.",
      },
    )
  }

  return {
    rootPath,
    notePath: deleted.notePath,
    relativePath: deleted.relativePath,
  }
}
