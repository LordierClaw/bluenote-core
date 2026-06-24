import { parseSyncMetadata, serializeSyncMetadata, withSyncDatabase, } from "./sync-db.js";
export function createDirtyRecordRepository(rootPath, dbIdentity) {
    return {
        markDirty(record) {
            withSyncDatabase(rootPath, dbIdentity, (handle) => {
                handle.db.run(`
          INSERT INTO dirty_records (entityType, entityId, dirtyType, markedAt, attempts, lastError, metadataJson)
          VALUES (?, ?, ?, ?, 0, NULL, ?)
          ON CONFLICT(entityType, entityId) DO UPDATE SET
            dirtyType = excluded.dirtyType,
            markedAt = excluded.markedAt,
            attempts = 0,
            lastError = NULL,
            metadataJson = excluded.metadataJson
        `, [record.entityType, record.entityId, record.dirtyType, record.markedAt, serializeSyncMetadata(record.metadata)]);
            }, { save: true });
        },
        listDirtyRecords() {
            return withSyncDatabase(rootPath, dbIdentity, (handle) => {
                const rows = handle.db.exec(`
            SELECT entityType, entityId, dirtyType, markedAt, attempts, lastError, metadataJson
            FROM dirty_records
            ORDER BY markedAt ASC, entityType ASC, entityId ASC
          `)[0]?.values ?? [];
                return rows.map((row) => ({
                    entityType: String(row[0]),
                    entityId: String(row[1]),
                    dirtyType: String(row[2]),
                    markedAt: String(row[3]),
                    attempts: Number(row[4]),
                    lastError: typeof row[5] === "string" ? row[5] : null,
                    metadata: parseSyncMetadata(typeof row[6] === "string" ? row[6] : null),
                }));
            });
        },
        clearDirtyRecord(entityType, entityId) {
            withSyncDatabase(rootPath, dbIdentity, (handle) => {
                handle.db.run("DELETE FROM dirty_records WHERE entityType = ? AND entityId = ?", [entityType, entityId]);
            }, { save: true });
        },
        markPushRejected(entityType, entityId, errorMessage) {
            withSyncDatabase(rootPath, dbIdentity, (handle) => {
                handle.db.run(`
            UPDATE dirty_records
            SET attempts = attempts + 1,
                lastError = ?
            WHERE entityType = ? AND entityId = ?
          `, [errorMessage, entityType, entityId]);
            }, { save: true });
        },
    };
}
//# sourceMappingURL=dirty-repository.js.map