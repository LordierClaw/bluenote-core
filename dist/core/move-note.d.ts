import { type ResolveBlueNoteRootOptions } from "../config/root";
export interface MoveNoteOptions extends ResolveBlueNoteRootOptions {
    selector: string;
    destinationFolder: string;
    updatedAt?: string;
}
export interface MoveNoteSummary {
    previousKey: string;
    key: string;
    title: string;
    previousRelativePath: string;
    relativePath: string;
    notePath: string;
}
export declare function moveNote(options: MoveNoteOptions): MoveNoteSummary;
//# sourceMappingURL=move-note.d.ts.map