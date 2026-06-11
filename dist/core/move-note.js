import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { resolveBlueNoteRoot } from "../config/root.js";
import { createNoteRepository } from "../storage/note-repository.js";
import { selectNote } from "./select-note.js";
import { UsageError } from "./errors.js";
function updateLatestOpenedPathIfMatched(rootPath, previousRelativePath, nextRelativePath) {
    const latestPath = path.join(rootPath, ".data", "latest-opened-note.json");
    try {
        const latest = JSON.parse(readFileSync(latestPath, "utf8"));
        if (latest.relativePath === previousRelativePath) {
            writeFileSync(latestPath, JSON.stringify({ ...latest, relativePath: nextRelativePath }, null, 2) + "\n", "utf8");
        }
    }
    catch {
        // Best-effort state repair; move success should not depend on optional UI state.
    }
}
export function moveNote(options) {
    const rootPath = resolveBlueNoteRoot(options);
    const repository = createNoteRepository(rootPath);
    const selected = selectNote({ repository, selector: options.selector });
    try {
        const moved = repository.moveNote(path.join(rootPath, selected.sourcePath), options.destinationFolder, options.updatedAt ?? new Date().toISOString());
        updateLatestOpenedPathIfMatched(rootPath, moved.previousRelativePath, moved.relativePath);
        return {
            ...moved,
            title: selected.frontmatter.title,
        };
    }
    catch (error) {
        if (error instanceof UsageError) {
            throw error;
        }
        throw new UsageError(`Could not move note '${selected.sourcePath}'.`, {
            hint: "Choose an existing folder under note/ for normal note moves.",
            cause: error,
        });
    }
}
//# sourceMappingURL=move-note.js.map