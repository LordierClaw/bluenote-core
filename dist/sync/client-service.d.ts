import type { SyncTransport } from "./core-sync.js";
import type { SyncNowSummary } from "./types.js";
export interface CreateSyncClientServiceOptions {
    rootPath: string;
    workspaceId: string;
    replicaId?: string;
    transport: SyncTransport;
    pullLimit?: number;
}
export interface SyncClientService {
    syncNow(): SyncNowSummary;
}
export declare function createSyncClientService(options: CreateSyncClientServiceOptions): SyncClientService;
//# sourceMappingURL=client-service.d.ts.map