import { type ResolveBlueNoteRootOptions } from "../config/root.js";
import type { NoteVisibilityOptions } from "./note-visibility.js";
export interface ShowNoteOptions extends ResolveBlueNoteRootOptions, NoteVisibilityOptions {
    selector: string;
}
export interface ShowNoteSummary {
    key: string;
    title: string;
    description: string;
    relativePath: string;
    body: string;
}
export declare function showNote(options: ShowNoteOptions): ShowNoteSummary;
//# sourceMappingURL=show-note.d.ts.map