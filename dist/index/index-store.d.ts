import { type ContainsFieldMatch } from "../search/contains-match.js";
import type { ParsedNote } from "../storage/note-schema.js";
import { type IndexedSearchNote } from "./search-documents.js";
export interface IndexedNoteSummary {
    key: string;
    id: string;
    title: string;
    description: string;
    relativePath: string;
    createdAt: string;
    updatedAt: string;
    archivedAt: string | null;
}
export interface IndexedNoteRecord extends IndexedSearchNote {
    createdAt: string;
    updatedAt: string;
    archivedAt: string | null;
}
type RebuildableIndexNote = IndexedNoteRecord | ParsedNote;
export interface RebuildIndexStoreInput {
    rootPath: string;
    notes: RebuildableIndexNote[];
}
export interface RebuildIndexStoreResult {
    noteCount: number;
    metadataDatabasePath: string;
    searchIndexPath: string;
}
export interface SearchIndexMatch {
    key: string;
    id: string;
    title: string;
    description: string;
    body: string;
    relativePath: string;
    score?: number;
    termMatches?: Record<string, string[]>;
    containsMatches?: ContainsFieldMatch[];
}
export interface LoadedIndexStore {
    listSummaries(): IndexedNoteSummary[];
    listAllSummaries(): IndexedNoteSummary[];
    search(query: string, options?: {
        includeArchived?: boolean;
    }): SearchIndexMatch[];
}
export declare function rebuildIndexStore(input: RebuildIndexStoreInput): RebuildIndexStoreResult;
export declare function updateIndexedNote(rootPath: string, note: IndexedNoteRecord): RebuildIndexStoreResult;
export declare function loadIndexStore(rootPath: string): LoadedIndexStore;
export {};
//# sourceMappingURL=index-store.d.ts.map