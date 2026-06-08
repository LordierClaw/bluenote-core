import { type ResolveBlueNoteRootOptions } from "../config/root";
export interface RebuildIndexesOptions extends ResolveBlueNoteRootOptions {
    testHooks?: {
        listSidecarKeys?: (rootPath: string) => string[];
    };
}
export interface RebuildIndexesSummary {
    rootPath: string;
    noteCount: number;
    validationErrors: string[];
    metadataDatabasePath?: string;
    searchIndexPath?: string;
}
export declare function rebuildIndexes(options?: RebuildIndexesOptions): RebuildIndexesSummary;
//# sourceMappingURL=rebuild-indexes.d.ts.map