import { existsSync } from "node:fs";
import { UsageError } from "../core/errors.js";
import { createSidecarRepository } from "../storage/sidecar-repository.js";
import { createDirtyRecordRepository } from "./dirty-repository.js";
import { getSyncDatabasePath } from "./sync-db.js";
import { readSyncRuntimeMode } from "./runtime-mode.js";
const REPAIR_CONFIRMATION = "repair-sync-state";
function createIssue(issue) {
    return issue;
}
export function repairSyncState(rootPath, options = {}) {
    const dryRun = options.dryRun ?? true;
    if (!dryRun && options.confirm !== REPAIR_CONFIRMATION) {
        throw new UsageError("Sync repair requires explicit confirmation.", {
            hint: `Pass dryRun: false and confirm: '${REPAIR_CONFIRMATION}' to allow mutating sync repair.`,
        });
    }
    const issues = [];
    const syncDatabasePath = getSyncDatabasePath(rootPath);
    const syncDatabaseExists = existsSync(syncDatabasePath);
    if (!syncDatabaseExists) {
        issues.push(createIssue({
            code: "missing-sync-database",
            severity: "warning",
            message: "Sync database is missing.",
            suggestion: "Recreate .data/sync/sync.sqlite before running linked sync operations.",
        }));
    }
    const runtimeMode = readSyncRuntimeMode(rootPath);
    if (syncDatabaseExists && runtimeMode.mode === "sync-client" && runtimeMode.workspaceId) {
        const dirtyRepository = createDirtyRecordRepository(rootPath, { role: "client", workspaceId: runtimeMode.workspaceId });
        const sidecars = createSidecarRepository(rootPath);
        for (const record of dirtyRepository.listDirtyRecords()) {
            if (record.entityType !== "note") {
                continue;
            }
            const sidecarPath = sidecars.getSidecarPathByNoteId(record.entityId);
            if (!existsSync(sidecarPath)) {
                issues.push(createIssue({
                    code: "missing-sidecar",
                    severity: "error",
                    entityType: record.entityType,
                    entityId: record.entityId,
                    message: `Dirty note '${record.entityId}' is missing its sidecar.`,
                    suggestion: "Rebuild the note sidecar or clear/recreate the dirty sync record after verifying the note file state.",
                }));
                issues.push(createIssue({
                    code: "stale-dirty-record",
                    severity: "warning",
                    entityType: record.entityType,
                    entityId: record.entityId,
                    message: `Dirty record for note '${record.entityId}' points at missing local metadata.`,
                    suggestion: "Review the dirty record before the next sync; dry-run repair does not remove it.",
                }));
            }
        }
    }
    return {
        dryRun,
        changed: false,
        issuesFound: issues.length,
        repairsApplied: 0,
        issues,
    };
}
//# sourceMappingURL=repair.js.map