import path from "node:path";
import { resolveBlueNoteRoot } from "../config/root.js";
import { createSidecarRepository } from "../storage/sidecar-repository.js";
import { selectNote } from "./select-note.js";
import { createNoteRepository } from "../storage/note-repository.js";
import { createNoteDescription } from "../domain/note-description.js";
export function showNote(options) {
    const rootPath = resolveBlueNoteRoot(options);
    const repository = createNoteRepository(rootPath);
    const sidecars = createSidecarRepository(rootPath);
    const selected = selectNote({ repository, selector: options.selector, visibility: options.visibility });
    let sidecar;
    try {
        sidecar = sidecars.read(selected.frontmatter.id);
    }
    catch {
        return {
            key: selected.frontmatter.id,
            title: selected.frontmatter.title,
            description: createNoteDescription(selected.body),
            relativePath: selected.sourcePath,
            body: selected.body,
        };
    }
    return {
        key: sidecar.key,
        title: sidecar.title,
        description: sidecar.description,
        relativePath: sidecar.relativePath,
        body: repository.readRaw(path.join(rootPath, selected.sourcePath)),
    };
}
//# sourceMappingURL=show-note.js.map