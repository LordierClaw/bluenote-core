import path from "node:path"
import { existsSync } from "node:fs"

import { resolveBlueNoteRoot, type ResolveBlueNoteRootOptions } from "../config/root"
import { createSidecarRepository } from "../storage/sidecar-repository"
import { selectNote } from "./select-note"
import { createNoteRepository } from "../storage/note-repository"
import { createNoteDescription } from "../domain/note-description"
import type { NoteVisibilityOptions } from "./note-visibility"

export interface ShowNoteOptions extends ResolveBlueNoteRootOptions, NoteVisibilityOptions {
  selector: string
}

export interface ShowNoteSummary {
  key: string
  title: string
  description: string
  relativePath: string
  body: string
}

export function showNote(options: ShowNoteOptions): ShowNoteSummary {
  const rootPath = resolveBlueNoteRoot(options)
  const repository = createNoteRepository(rootPath)
  const sidecars = createSidecarRepository(rootPath)
  const selected = selectNote({ repository, selector: options.selector, visibility: options.visibility })
  const sidecarPath = sidecars.getSidecarPath(selected.frontmatter.id)

  if (!existsSync(sidecarPath)) {
    return {
      key: selected.frontmatter.id,
      title: selected.frontmatter.title,
      description: createNoteDescription(selected.body),
      relativePath: selected.sourcePath,
      body: selected.body,
    }
  }

  const sidecar = sidecars.read(selected.frontmatter.id)

  return {
    key: sidecar.key,
    title: sidecar.title,
    description: sidecar.description,
    relativePath: sidecar.relativePath,
    body: repository.readRaw(path.join(rootPath, selected.sourcePath)),
  }
}
