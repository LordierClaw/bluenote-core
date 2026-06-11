export interface ShortNoteSuffixOptions {
    suffixLength?: number;
    randomSource?: () => number;
}
export interface CreateNoteKeyOptions extends ShortNoteSuffixOptions {
    isUnique?: (candidate: string) => boolean;
    onCollision?: (candidate: string, attempt: number) => void;
    maxAttempts?: number;
}
export interface CreateDraftNoteKeyOptions extends ShortNoteSuffixOptions {
    isUnique?: (candidate: string) => boolean;
    onCollision?: (candidate: string, attempt: number) => void;
    maxAttempts?: number;
}
export declare function slugifyNoteTitle(title: string): string;
export declare function createShortNoteSuffix(options?: ShortNoteSuffixOptions): string;
export declare function createNoteKey(title: string, options?: CreateNoteKeyOptions): string;
export declare function createDraftNoteKey(options?: CreateDraftNoteKeyOptions): string;
//# sourceMappingURL=note-key.d.ts.map