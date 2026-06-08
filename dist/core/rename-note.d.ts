import { type ResolveBlueNoteRootOptions } from "../config/root";
import type { NoteVisibilityOptions } from "./note-visibility";
export interface RenameNoteHooks {
    onRecoveryArtifactStaged?: (artifactPath: string) => void;
}
export interface RenameNoteOptions extends ResolveBlueNoteRootOptions, NoteVisibilityOptions {
    selector: string;
    title: string;
    body: string;
    updatedAt: string;
    randomSource?: () => number;
    hooks?: RenameNoteHooks;
}
export interface RenameNoteSummary {
    previousKey: string;
    key: string;
    previousRelativePath: string;
    relativePath: string;
    notePath: string;
}
export declare function renameNote(options: RenameNoteOptions): RenameNoteSummary;
//# sourceMappingURL=rename-note.d.ts.map