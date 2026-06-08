import { type ResolveBlueNoteRootOptions } from "../config/root";
import { type NoteVisibilityOptions } from "./note-visibility";
export interface NoteSummary {
    key: string;
    title: string;
    description: string;
    relativePath: string;
    createdAt?: string;
}
export declare function listNotes(options?: ResolveBlueNoteRootOptions & NoteVisibilityOptions): NoteSummary[];
//# sourceMappingURL=list-notes.d.ts.map