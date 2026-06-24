import { type EnsureSyncDatabaseOptions } from "./sync-db.js";
export interface FolderInput {
    relativePath: string;
    createdAt: string;
    updatedAt: string;
    deletedAt?: string | null;
}
export interface FolderRecord {
    relativePath: string;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}
export interface FolderRepository {
    upsertFolder(folder: FolderInput): void;
    listFolders(): FolderRecord[];
}
export declare function createFolderRepository(rootPath: string, dbIdentity: EnsureSyncDatabaseOptions): FolderRepository;
//# sourceMappingURL=folder-repository.d.ts.map