import type { NoteFrontmatter, ParsedNote } from "./note-schema.js";
export interface CreateStoredNoteInput {
    noteId?: string;
    frontmatter: NoteFrontmatter;
    body: string;
    destination?: CreateStoredNoteDestination;
}
export type CreateStoredNoteDestination = {
    type: "draft";
} | {
    type: "normal";
    folderRelativePath: string;
};
export interface StoredNoteRecord {
    notePath: string;
    relativePath: string;
}
export interface SyncStoredNoteInput {
    title: string;
    body: string;
    updatedAt: string;
}
export interface RenameStoredNoteInput extends SyncStoredNoteInput {
    nextKey: string;
}
export interface RenamedStoredNoteRecord extends StoredNoteRecord {
    previousKey: string;
    key: string;
    previousRelativePath: string;
}
export interface NoteRepository {
    create(input: CreateStoredNoteInput): StoredNoteRecord;
    read(notePath: string): ParsedNote;
    readRaw(notePath: string): string;
    syncEditedNote(notePath: string, input: SyncStoredNoteInput): StoredNoteRecord;
    rename(notePath: string, input: RenameStoredNoteInput): RenamedStoredNoteRecord;
    renameFolder(folderRelativePath: string, nextName: string): {
        previousRelativePath: string;
        relativePath: string;
    };
    moveNote(notePath: string, destinationFolderRelativePath: string, updatedAt?: string): RenamedStoredNoteRecord;
    keyExists(key: string): boolean;
    archive(notePath: string, archivedAt: string): StoredNoteRecord;
    delete(notePath: string): StoredNoteRecord;
    list(): ParsedNote[];
    listNotePaths(): StoredNoteRecord[];
}
export declare function createNoteRepository(rootPath: string): NoteRepository;
//# sourceMappingURL=note-repository.d.ts.map