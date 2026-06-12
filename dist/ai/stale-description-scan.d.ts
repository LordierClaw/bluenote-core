import type { Clock } from "../platform/clock.js";
export interface ScanAndEnqueueStaleDescriptionsOptions {
    clock: Clock;
    warn?: (message: string) => void;
}
export interface ScanAndEnqueueStaleDescriptionsResult {
    scanned: number;
    enqueued: number;
}
export declare function scanAndEnqueueStaleDescriptions(rootPath: string, options: ScanAndEnqueueStaleDescriptionsOptions): ScanAndEnqueueStaleDescriptionsResult;
//# sourceMappingURL=stale-description-scan.d.ts.map