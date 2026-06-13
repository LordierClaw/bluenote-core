import { initRoot } from "./core/init-root.js";
import { listNotes } from "./core/list-notes.js";
import { showNote } from "./core/show-note.js";
import { createNote } from "./core/create-note.js";
import { deleteNote } from "./core/delete-note.js";
import { archiveNote } from "./core/archive-note.js";
import { renameNote } from "./core/rename-note.js";
import { moveNote } from "./core/move-note.js";
import { promoteDraft } from "./core/promote-draft.js";
import { searchNotes } from "./core/search-notes.js";
import { rebuildIndexes } from "./core/rebuild-indexes.js";
export * from "./core/errors.js";
export * from "./core/archive-note.js";
export * from "./core/init-root.js";
export * from "./core/create-note.js";
export * from "./core/delete-note.js";
export * from "./core/list-notes.js";
export * from "./core/move-note.js";
export * from "./core/note-visibility.js";
export * from "./core/promote-draft.js";
export * from "./core/rename-note.js";
export * from "./core/rebuild-indexes.js";
export * from "./core/select-note.js";
export * from "./core/search-notes.js";
export * from "./core/show-note.js";
export * from "./api/daemon-contract.js";
export * from "./config/root.js";
export * from "./ai/codex-auth-client.js";
export * from "./ai/codex-auth-repository.js";
export * from "./ai/codex-client.js";
export * from "./ai/config.js";
export * from "./ai/config-repository.js";
export * from "./ai/config-schema.js";
export * from "./ai/description-policy.js";
export * from "./ai/description-service.js";
export * from "./ai/enqueue-describe-note.js";
export * from "./ai/error-redaction.js";
export * from "./ai/openai-compatible-client.js";
export * from "./ai/prompt-repository.js";
export * from "./ai/provider.js";
export * from "./ai/queue-repository.js";
export * from "./ai/queue-service.js";
export * from "./ai/stale-description-scan.js";
export * from "./ai/types.js";
export * from "./ai/usage-log.js";
export * from "./domain/note-description.js";
export * from "./domain/note-key.js";
export * from "./index/index-store.js";
export * from "./index/search-documents.js";
export * from "./platform/clock.js";
export * from "./platform/ids.js";
export * from "./platform/path-safety.js";
export * from "./storage/app-config-repository.js";
export * from "./storage/app-state-migration.js";
export * from "./storage/atomic-note-writer.js";
export * from "./storage/atomic-replace.js";
export * from "./storage/frontmatter.js";
export * from "./storage/note-repository.js";
export * from "./storage/note-schema.js";
export * from "./storage/plain-note.js";
export * from "./storage/root-layout.js";
export * from "./storage/sidecar-repository.js";
export * from "./storage/sidecar-schema.js";
export * from "./storage/state-manifest.js";
export * from "./search/contains-match.js";
function applyRoot(config, options = {}) {
    const { rootPath, override, env, cwd, homeDir } = options;
    return {
        env: env ?? config.env,
        cwd: cwd ?? config.cwd,
        homeDir: homeDir ?? config.homeDir,
        override: override ?? rootPath ?? config.rootPath,
    };
}
function withRoot(config, options) {
    const { rootPath, override, env, cwd, homeDir, ...rest } = options;
    return {
        ...rest,
        ...applyRoot(config, { rootPath, override, env, cwd, homeDir }),
    };
}
export function createBlueNoteCore(config = {}) {
    return {
        init(options = {}) {
            return initRoot(applyRoot(config, options));
        },
        notes: {
            list(options = {}) {
                return listNotes(withRoot(config, options));
            },
            get(selector, options = {}) {
                return showNote({ ...withRoot(config, options), selector });
            },
            create(options) {
                return createNote(withRoot(config, options));
            },
            delete(selector, options = {}) {
                return deleteNote({ ...withRoot(config, options), selector });
            },
            archive(selector, options = {}) {
                return archiveNote({ ...withRoot(config, options), selector });
            },
            rename(selector, options) {
                return renameNote({ ...withRoot(config, options), selector });
            },
            move(selector, options) {
                return moveNote({ ...withRoot(config, options), selector });
            },
            promoteDraft(selector, options) {
                return promoteDraft({ ...withRoot(config, options), selector });
            },
        },
        search: {
            search(query, options = {}) {
                return searchNotes(query, withRoot(config, options));
            },
        },
        rebuild(options = {}) {
            return rebuildIndexes(withRoot(config, options));
        },
    };
}
//# sourceMappingURL=index.js.map