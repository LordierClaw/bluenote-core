import { resolveBlueNoteRoot } from "../config/root.js";
import { loadIndexStore } from "../index/index-store.js";
import { noteIsVisible } from "./note-visibility.js";
export function listNotes(options = {}) {
    const store = loadIndexStore(resolveBlueNoteRoot(options));
    return store.listAllSummaries().filter((summary) => noteIsVisible(summary, options.visibility)).map((summary) => ({
        key: summary.key,
        title: summary.title,
        description: summary.description,
        relativePath: summary.relativePath,
        createdAt: summary.createdAt,
    }));
}
//# sourceMappingURL=list-notes.js.map