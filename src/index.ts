import type { ResolveBlueNoteRootOptions } from "./config/root"
import { initRoot, type InitRootSummary } from "./core/init-root"
import { listNotes, type NoteSummary } from "./core/list-notes"
import { showNote, type ShowNoteOptions, type ShowNoteSummary } from "./core/show-note"
import { createNote, type CreateNoteOptions, type CreateNoteSummary } from "./core/create-note"
import { deleteNote, type DeleteNoteOptions, type DeleteNoteSummary } from "./core/delete-note"
import { archiveNote, type ArchiveNoteOptions, type ArchiveNoteSummary } from "./core/archive-note"
import { renameNote, type RenameNoteOptions, type RenameNoteSummary } from "./core/rename-note"
import { moveNote, type MoveNoteOptions, type MoveNoteSummary } from "./core/move-note"
import { promoteDraft, type PromoteDraftOptions, type PromoteDraftSummary } from "./core/promote-draft"
import { searchNotes, type SearchNoteMatch } from "./core/search-notes"
import { rebuildIndexes, type RebuildIndexesOptions, type RebuildIndexesSummary } from "./core/rebuild-indexes"
import type { NoteVisibilityOptions } from "./core/note-visibility"

export * from "./core/errors"
export type * from "./core/types"
export * from "./core/archive-note"
export * from "./core/init-root"
export * from "./core/create-note"
export * from "./core/delete-note"
export * from "./core/list-notes"
export * from "./core/move-note"
export * from "./core/note-visibility"
export * from "./core/promote-draft"
export * from "./core/rename-note"
export * from "./core/rebuild-indexes"
export * from "./core/select-note"
export * from "./core/search-notes"
export * from "./core/show-note"
export * from "./config/root"
export * from "./ai/codex-auth-client"
export * from "./ai/codex-auth-repository"
export * from "./ai/codex-client"
export * from "./ai/config"
export * from "./ai/config-repository"
export * from "./ai/config-schema"
export * from "./ai/description-policy"
export * from "./ai/description-service"
export * from "./ai/enqueue-describe-note"
export * from "./ai/error-redaction"
export * from "./ai/openai-compatible-client"
export * from "./ai/prompt-repository"
export * from "./ai/provider"
export * from "./ai/queue-repository"
export * from "./ai/queue-service"
export * from "./ai/stale-description-scan"
export * from "./ai/types"
export * from "./ai/usage-log"
export * from "./domain/note-description"
export * from "./domain/note-key"
export * from "./index/index-store"
export * from "./index/search-documents"
export * from "./platform/clock"
export * from "./platform/ids"
export * from "./platform/path-safety"
export * from "./storage/app-config-repository"
export * from "./storage/app-state-migration"
export * from "./storage/atomic-note-writer"
export * from "./storage/atomic-replace"
export * from "./storage/frontmatter"
export * from "./storage/note-repository"
export * from "./storage/note-schema"
export * from "./storage/plain-note"
export * from "./storage/root-layout"
export * from "./storage/sidecar-repository"
export * from "./storage/sidecar-schema"
export * from "./storage/state-manifest"
export * from "./search/contains-match"

export type {
  InitRootSummary,
  NoteSummary,
  ShowNoteSummary,
  CreateNoteOptions,
  CreateNoteSummary,
  DeleteNoteSummary,
  ArchiveNoteSummary,
  RenameNoteSummary,
  MoveNoteSummary,
  PromoteDraftSummary,
  SearchNoteMatch,
  RebuildIndexesSummary,
}

export interface BlueNoteCoreConfig extends Omit<ResolveBlueNoteRootOptions, "override"> {
  rootPath?: string
}

export type BlueNoteCoreRootOptions = Omit<ResolveBlueNoteRootOptions, "override"> & {
  rootPath?: string
}

type RootedOptions = BlueNoteCoreRootOptions & { override?: string }

export type NotesListOptions = BlueNoteCoreRootOptions & NoteVisibilityOptions
export type NotesGetOptions = BlueNoteCoreRootOptions & Omit<ShowNoteOptions, keyof ResolveBlueNoteRootOptions | "selector">
export type NotesCreateOptions = BlueNoteCoreRootOptions & Omit<CreateNoteOptions, keyof ResolveBlueNoteRootOptions>
export type NotesDeleteOptions = BlueNoteCoreRootOptions & Omit<DeleteNoteOptions, keyof ResolveBlueNoteRootOptions | "selector">
export type NotesArchiveOptions = BlueNoteCoreRootOptions & Omit<ArchiveNoteOptions, keyof ResolveBlueNoteRootOptions | "selector">
export type NotesRenameOptions = BlueNoteCoreRootOptions & Omit<RenameNoteOptions, keyof ResolveBlueNoteRootOptions | "selector">
export type NotesMoveOptions = BlueNoteCoreRootOptions & Omit<MoveNoteOptions, keyof ResolveBlueNoteRootOptions | "selector">
export type NotesPromoteDraftOptions = BlueNoteCoreRootOptions & Omit<PromoteDraftOptions, keyof ResolveBlueNoteRootOptions | "selector">
export type SearchOptions = BlueNoteCoreRootOptions & NoteVisibilityOptions
export type RebuildOptions = BlueNoteCoreRootOptions & Omit<RebuildIndexesOptions, keyof ResolveBlueNoteRootOptions>

export interface BlueNoteCore {
  init(options?: BlueNoteCoreRootOptions): InitRootSummary
  notes: {
    list(options?: NotesListOptions): NoteSummary[]
    get(selector: string, options?: NotesGetOptions): ShowNoteSummary
    create(options: NotesCreateOptions): CreateNoteSummary
    delete(selector: string, options?: NotesDeleteOptions): DeleteNoteSummary
    archive(selector: string, options?: NotesArchiveOptions): ArchiveNoteSummary
    rename(selector: string, options: NotesRenameOptions): RenameNoteSummary
    move(selector: string, options: NotesMoveOptions): MoveNoteSummary
    promoteDraft(selector: string, options: NotesPromoteDraftOptions): PromoteDraftSummary
  }
  search: {
    search(query: string, options?: SearchOptions): SearchNoteMatch[]
  }
  rebuild(options?: RebuildOptions): RebuildIndexesSummary
}

function applyRoot(config: BlueNoteCoreConfig, options: RootedOptions = {}): ResolveBlueNoteRootOptions {
  const { rootPath, override, env, cwd, homeDir } = options
  return {
    env: env ?? config.env,
    cwd: cwd ?? config.cwd,
    homeDir: homeDir ?? config.homeDir,
    override: override ?? rootPath ?? config.rootPath,
  }
}

function withRoot<TOptions extends RootedOptions>(config: BlueNoteCoreConfig, options: TOptions): Omit<TOptions, "rootPath"> & ResolveBlueNoteRootOptions {
  const { rootPath, override, env, cwd, homeDir, ...rest } = options
  return {
    ...rest,
    ...applyRoot(config, { rootPath, override, env, cwd, homeDir }),
  } as Omit<TOptions, "rootPath"> & ResolveBlueNoteRootOptions
}

export function createBlueNoteCore(config: BlueNoteCoreConfig = {}): BlueNoteCore {
  return {
    init(options = {}) {
      return initRoot(applyRoot(config, options))
    },
    notes: {
      list(options = {}) {
        return listNotes(withRoot(config, options))
      },
      get(selector, options = {}) {
        return showNote({ ...withRoot(config, options), selector })
      },
      create(options) {
        return createNote(withRoot(config, options))
      },
      delete(selector, options = {}) {
        return deleteNote({ ...withRoot(config, options), selector })
      },
      archive(selector, options = {}) {
        return archiveNote({ ...withRoot(config, options), selector })
      },
      rename(selector, options) {
        return renameNote({ ...withRoot(config, options), selector })
      },
      move(selector, options) {
        return moveNote({ ...withRoot(config, options), selector })
      },
      promoteDraft(selector, options) {
        return promoteDraft({ ...withRoot(config, options), selector })
      },
    },
    search: {
      search(query, options = {}) {
        return searchNotes(query, withRoot(config, options))
      },
    },
    rebuild(options = {}) {
      return rebuildIndexes(withRoot(config, options))
    },
  }
}
