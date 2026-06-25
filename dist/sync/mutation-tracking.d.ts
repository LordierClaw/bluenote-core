import type { ParsedNote } from "../storage/note-schema.js";
import type { SyncJsonObject } from "./sync-db.js";
export interface DirtyNoteInput {
    entityId: string;
    dirtyType?: "upsert" | "delete";
    markedAt: string;
    metadata?: SyncJsonObject;
}
export interface DirtyFolderInput {
    relativePath: string;
    markedAt: string;
}
export interface TombstoneInput {
    entityId: string;
    deletedAt: string;
    previousRelativePath: string;
    previousTitle: string;
}
export interface SyncMutationInput {
    notes?: DirtyNoteInput[];
    folders?: DirtyFolderInput[];
    tombstones?: TombstoneInput[];
}
export declare function getNoteSyncEntityId(rootPath: string, note: Pick<ParsedNote, "frontmatter" | "sourcePath" | "body">): string;
export declare function recordSyncMutationBestEffort(rootPath: string, input: SyncMutationInput): void;
//# sourceMappingURL=mutation-tracking.d.ts.map