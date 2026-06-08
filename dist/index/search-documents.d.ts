import type { ParsedNote } from "../storage/note-schema";
export interface IndexedSearchNote {
    key: string;
    title: string;
    description: string;
    body: string;
    relativePath: string;
}
export type SearchDocumentSource = IndexedSearchNote | ParsedNote;
export interface SearchDocument extends IndexedSearchNote {
    id: string;
}
export declare function createSearchDocuments(notes: SearchDocumentSource[]): SearchDocument[];
//# sourceMappingURL=search-documents.d.ts.map