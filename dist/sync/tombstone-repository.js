import { withSyncDatabase } from "./sync-db.js";
export function createTombstoneRepository(rootPath, dbIdentity) {
    return {
        recordTombstone(tombstone) {
            withSyncDatabase(rootPath, dbIdentity, (handle) => {
                handle.db.run(`
          INSERT INTO tombstones (
            entityType,
            entityId,
            deletedAt,
            serverRevision,
            sourceReplicaId,
            previousRelativePath,
            previousTitle
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(entityType, entityId) DO UPDATE SET
            deletedAt = excluded.deletedAt,
            serverRevision = excluded.serverRevision,
            sourceReplicaId = excluded.sourceReplicaId,
            previousRelativePath = excluded.previousRelativePath,
            previousTitle = excluded.previousTitle
        `, [
                    tombstone.entityType,
                    tombstone.entityId,
                    tombstone.deletedAt,
                    tombstone.serverRevision ?? null,
                    tombstone.sourceReplicaId ?? null,
                    tombstone.previousRelativePath ?? null,
                    tombstone.previousTitle ?? null,
                ]);
            }, { save: true });
        },
        listTombstones() {
            return withSyncDatabase(rootPath, dbIdentity, (handle) => {
                const rows = handle.db.exec(`
            SELECT entityType, entityId, deletedAt, serverRevision, sourceReplicaId, previousRelativePath, previousTitle
            FROM tombstones
            ORDER BY deletedAt ASC, entityType ASC, entityId ASC
          `)[0]?.values ?? [];
                return rows.map((row) => ({
                    entityType: String(row[0]),
                    entityId: String(row[1]),
                    deletedAt: String(row[2]),
                    serverRevision: typeof row[3] === "number" ? row[3] : null,
                    sourceReplicaId: typeof row[4] === "string" ? row[4] : null,
                    previousRelativePath: typeof row[5] === "string" ? row[5] : null,
                    previousTitle: typeof row[6] === "string" ? row[6] : null,
                }));
            });
        },
    };
}
//# sourceMappingURL=tombstone-repository.js.map