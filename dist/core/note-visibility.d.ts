import type { IndexedNoteSummary, SearchIndexMatch } from "../index/index-store.js";
import type { ParsedNote } from "../storage/note-schema.js";
export type NoteVisibility = "normal" | "drafts" | "all";
export interface NoteVisibilityOptions {
    visibility?: NoteVisibility;
}
type VisibleNoteLike = Pick<IndexedNoteSummary, "relativePath" | "archivedAt"> | SearchIndexMatch | ParsedNote;
export declare function noteIsVisible(note: VisibleNoteLike, visibility?: NoteVisibility): boolean;
export {};
//# sourceMappingURL=note-visibility.d.ts.map