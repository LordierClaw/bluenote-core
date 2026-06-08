import { type ResolveBlueNoteRootOptions } from "../config/root";
export interface PromoteDraftOptions extends ResolveBlueNoteRootOptions {
    selector: string;
    title: string;
    destinationFolder: string;
    updatedAt?: string;
    randomSource?: () => number;
}
export interface PromoteDraftSummary {
    previousKey: string;
    key: string;
    title: string;
    previousRelativePath: string;
    relativePath: string;
    notePath: string;
}
export declare function promoteDraft(options: PromoteDraftOptions): PromoteDraftSummary;
//# sourceMappingURL=promote-draft.d.ts.map