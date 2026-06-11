import { type ResolveBlueNoteRootOptions } from "../config/root.js";
import type { NoteVisibilityOptions } from "./note-visibility.js";
export interface DeleteNoteOptions extends ResolveBlueNoteRootOptions, NoteVisibilityOptions {
    selector: string;
    force?: boolean;
}
export interface DeleteNoteSummary {
    rootPath: string;
    notePath: string;
    relativePath: string;
}
export declare function deleteNote(options: DeleteNoteOptions): DeleteNoteSummary;
//# sourceMappingURL=delete-note.d.ts.map