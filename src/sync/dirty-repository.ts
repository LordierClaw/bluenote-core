import {
  ensureSyncDatabase,
  openSyncDatabase,
  parseSyncMetadata,
  saveSyncDatabase,
  serializeSyncMetadata,
  type EnsureSyncDatabaseOptions,
  type SyncJsonObject,
} from "./sync-db"

export interface DirtyRecordInput {
  entityType: string
  entityId: string
  dirtyType: string
  markedAt: string
  metadata?: SyncJsonObject | null
}

export interface DirtyRecord {
  entityType: string
  entityId: string
  dirtyType: string
  markedAt: string
  attempts: number
  lastError: string | null
  metadata: SyncJsonObject | null
}

export interface DirtyRecordRepository {
  markDirty(record: DirtyRecordInput): void
  listDirtyRecords(): DirtyRecord[]
  clearDirtyRecord(entityType: string, entityId: string): void
}

export function createDirtyRecordRepository(rootPath: string, dbIdentity: EnsureSyncDatabaseOptions): DirtyRecordRepository {
  return {
    markDirty(record) {
      ensureSyncDatabase(rootPath, dbIdentity)
      const handle = openSyncDatabase(rootPath)

      try {
        handle.db.run(
          `
          INSERT INTO dirty_records (entityType, entityId, dirtyType, markedAt, attempts, lastError, metadataJson)
          VALUES (?, ?, ?, ?, 0, NULL, ?)
          ON CONFLICT(entityType, entityId) DO UPDATE SET
            dirtyType = excluded.dirtyType,
            markedAt = excluded.markedAt,
            metadataJson = excluded.metadataJson
        `,
          [record.entityType, record.entityId, record.dirtyType, record.markedAt, serializeSyncMetadata(record.metadata)],
        )
        saveSyncDatabase(handle)
      } finally {
        handle.db.close()
      }
    },

    listDirtyRecords() {
      ensureSyncDatabase(rootPath, dbIdentity)
      const handle = openSyncDatabase(rootPath)

      try {
        const rows =
          handle.db.exec(
            `
            SELECT entityType, entityId, dirtyType, markedAt, attempts, lastError, metadataJson
            FROM dirty_records
            ORDER BY markedAt ASC, entityType ASC, entityId ASC
          `,
          )[0]?.values ?? []

        return (rows as unknown[][]).map((row): DirtyRecord => ({
          entityType: String(row[0]),
          entityId: String(row[1]),
          dirtyType: String(row[2]),
          markedAt: String(row[3]),
          attempts: Number(row[4]),
          lastError: typeof row[5] === "string" ? row[5] : null,
          metadata: parseSyncMetadata(typeof row[6] === "string" ? row[6] : null),
        }))
      } finally {
        handle.db.close()
      }
    },

    clearDirtyRecord(entityType, entityId) {
      ensureSyncDatabase(rootPath, dbIdentity)
      const handle = openSyncDatabase(rootPath)

      try {
        handle.db.run("DELETE FROM dirty_records WHERE entityType = ? AND entityId = ?", [entityType, entityId])
        saveSyncDatabase(handle)
      } finally {
        handle.db.close()
      }
    },
  }
}
