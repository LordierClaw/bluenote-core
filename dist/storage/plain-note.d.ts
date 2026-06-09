import type { PlainNote } from "./note-schema.js";
export declare function normalizePlainNoteBody(markdownText: string): string;
export declare function parsePlainNote(markdownText: string, sourcePath: string): PlainNote;
export declare function serializePlainNote(note: PlainNote): string;
//# sourceMappingURL=plain-note.d.ts.map