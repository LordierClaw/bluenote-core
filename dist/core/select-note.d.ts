import type { ParsedNote } from "../storage/note-schema";
import type { NoteRepository } from "../storage/note-repository";
import { type NoteVisibilityOptions } from "./note-visibility";
export interface SelectNoteOptions extends NoteVisibilityOptions {
    repository: NoteRepository;
    selector: string;
}
export declare function selectNote(options: SelectNoteOptions): ParsedNote;
//# sourceMappingURL=select-note.d.ts.map