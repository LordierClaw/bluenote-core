import { type ResolveBlueNoteRootOptions } from "../config/root.js";
import { type Clock } from "../platform/clock.js";
import type { NoteVisibilityOptions } from "./note-visibility.js";
export interface ArchiveNoteOptions extends ResolveBlueNoteRootOptions, NoteVisibilityOptions {
    selector: string;
    clock?: Clock;
}
export interface ArchiveNoteSummary {
    rootPath: string;
    notePath: string;
    relativePath: string;
    archivedAt: string;
}
export declare function archiveNote(options: ArchiveNoteOptions): ArchiveNoteSummary;
//# sourceMappingURL=archive-note.d.ts.map