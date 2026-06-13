import type { ParsedNote } from "../storage/note-schema.js";
import type { NoteRepository } from "../storage/note-repository.js";
import { type NoteVisibilityOptions } from "./note-visibility.js";
export interface SelectNoteOptions extends NoteVisibilityOptions {
    repository: NoteRepository;
    selector: string;
}
export declare function selectNote(options: SelectNoteOptions): ParsedNote;
//# sourceMappingURL=select-note.d.ts.map