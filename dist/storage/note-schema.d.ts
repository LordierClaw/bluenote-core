export interface PlainNote {
    body: string;
    sourcePath: string;
}
export interface NoteFrontmatter {
    id: string;
    schemaVersion: number;
    title: string;
    mode: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
    archivedAt?: string;
}
export interface ParsedNote extends PlainNote {
    frontmatter: NoteFrontmatter;
}
export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function assertKnownFields(record: Record<string, unknown>, allowedFields: readonly string[], sourcePath: string, kind: string): void;
export declare function assertRequiredFields(record: Record<string, unknown>, requiredFields: readonly string[], sourcePath: string, kind: string): void;
export declare function assertStringField(record: Record<string, unknown>, field: string, sourcePath: string, kind: string): string;
export declare function assertNumberField(record: Record<string, unknown>, field: string, sourcePath: string, kind: string): number;
export declare function assertStringArrayField(record: Record<string, unknown>, field: string, sourcePath: string, kind: string): string[];
export declare function assertTimestampField(record: Record<string, unknown>, field: string, sourcePath: string, kind: string): string;
export declare function validateNoteFrontmatter(frontmatter: unknown, sourcePath: string): NoteFrontmatter;
//# sourceMappingURL=note-schema.d.ts.map