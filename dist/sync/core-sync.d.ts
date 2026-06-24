import { type ResolveBlueNoteRootOptions } from "../config/root.js";
import type { SyncLinkOptions, SyncLinkSummary, SyncNowOptions, SyncNowSummary, SyncRepairOptions, SyncRepairSummary, SyncStatusView, SyncUnlinkSummary } from "./types.js";
export type { SyncLinkOptions, SyncLinkSummary, SyncNowOptions, SyncNowSummary, SyncRepairOptions, SyncRepairSummary, SyncStatusView, SyncUnlinkSummary, } from "./types.js";
export declare function getCoreSyncStatus(options?: ResolveBlueNoteRootOptions): SyncStatusView;
export declare function linkCoreSync(options: SyncLinkOptions & ResolveBlueNoteRootOptions): SyncLinkSummary;
export declare function unlinkCoreSync(options?: ResolveBlueNoteRootOptions): SyncUnlinkSummary;
export declare function syncCoreNow(options?: SyncNowOptions & ResolveBlueNoteRootOptions): SyncNowSummary;
export declare function repairCoreSync(options?: SyncRepairOptions & ResolveBlueNoteRootOptions): SyncRepairSummary;
//# sourceMappingURL=core-sync.d.ts.map