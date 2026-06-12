export type ContainsMatchField = "key" | "filename" | "title" | "description" | "path" | "body" | "command";
export interface ContainsMatchCandidate {
    field: ContainsMatchField;
    value: string;
    weight?: number;
}
export interface ContainsFieldMatch {
    field: ContainsMatchField;
    score: number;
}
export declare function normalizeSearchQuery(query: string): string;
export declare function containsSearchQuery(value: string, query: string): boolean;
export declare function scoreContainsMatch(value: string, query: string, weight?: number): number;
export declare function collectContainsFieldMatches(query: string, candidates: readonly ContainsMatchCandidate[]): ContainsFieldMatch[];
//# sourceMappingURL=contains-match.d.ts.map