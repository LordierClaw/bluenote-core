import { type ResolveBlueNoteRootOptions } from "../config/root.js";
import { type NoteVisibilityOptions } from "./note-visibility.js";
export type SearchMatchSource = "title" | "description" | "content" | "key-path";
export interface SearchNoteExplanation {
    source: SearchMatchSource;
    label: string;
    excerpt?: string;
}
export interface SearchNoteMatch {
    key: string;
    title: string;
    relativePath: string;
    match: SearchNoteExplanation;
}
export declare function searchNotes(query: string, options?: ResolveBlueNoteRootOptions & NoteVisibilityOptions): SearchNoteMatch[];
//# sourceMappingURL=search-notes.d.ts.map