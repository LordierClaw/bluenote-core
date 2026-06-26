import { type ResolveBlueNoteRootOptions } from "../config/root.js";
import { type Clock } from "../platform/clock.js";
export interface CreateNoteOptions extends ResolveBlueNoteRootOptions {
    type?: "draft" | "normal";
    title?: string;
    body?: string;
    destinationFolder?: string;
    clock?: Clock;
    randomSource?: () => number;
    noteIdGenerator?: () => string;
    enqueueAi?: boolean;
}
export interface CreateNoteSummary {
    noteId: string;
    key: string;
    title: string;
    description: string;
    rootPath: string;
    notePath: string;
    relativePath: string;
}
export declare function createNote(options: CreateNoteOptions): CreateNoteSummary;
//# sourceMappingURL=create-note.d.ts.map