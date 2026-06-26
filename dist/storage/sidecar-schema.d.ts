export type NoteType = "normal" | "draft" | "archived";
export interface NoteSidecar {
    type: NoteType;
    noteId?: string;
    key: string;
    title: string;
    description: string;
    relativePath: string;
    createdAt: string;
    updatedAt: string;
    archivedAt: string | null;
    namingVersion: number;
    ai?: {
        description?: {
            lastProcessedAt?: string;
        };
    };
}
export interface ValidateNoteSidecarOptions {
    requireNoteId?: boolean;
}
export declare function validateNoteSidecar(sidecar: unknown, sourcePath: string, options?: ValidateNoteSidecarOptions): NoteSidecar;
//# sourceMappingURL=sidecar-schema.d.ts.map