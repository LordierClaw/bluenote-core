export type NoteType = "normal" | "draft" | "archived";
export interface NoteSidecar {
    type: NoteType;
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
export declare function validateNoteSidecar(sidecar: unknown, sourcePath: string): NoteSidecar;
//# sourceMappingURL=sidecar-schema.d.ts.map