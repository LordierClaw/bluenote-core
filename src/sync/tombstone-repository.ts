import { ensureSyncDatabase, openSyncDatabase, saveSyncDatabase, type EnsureSyncDatabaseOptions } from "./sync-db"

export interface TombstoneInput {
  entityType: string
  entityId: string
  deletedAt: string
  previousRelativePath?: string | null
  previousTitle?: string | null
  sourceReplicaId?: string | null
  serverRevision?: number | null
}

export interface TombstoneRecord {
  entityType: string
  entityId: string
  deletedAt: string
  serverRevision: number | null
  sourceReplicaId: string | null
  previousRelativePath: string | null
  previousTitle: string | null
}

export interface TombstoneRepository {
  recordTombstone(tombstone: TombstoneInput): void
  listTombstones(): TombstoneRecord[]
}

export function createTombstoneRepository(rootPath: string, dbIdentity: EnsureSyncDatabaseOptions): TombstoneRepository {
  return {
    recordTombstone(tombstone) {
      ensureSyncDatabase(rootPath, dbIdentity)
      const handle = openSyncDatabase(rootPath)

      try {
        handle.db.run(
          `
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
        `,
          [
            tombstone.entityType,
            tombstone.entityId,
            tombstone.deletedAt,
            tombstone.serverRevision ?? null,
            tombstone.sourceReplicaId ?? null,
            tombstone.previousRelativePath ?? null,
            tombstone.previousTitle ?? null,
          ],
        )
        saveSyncDatabase(handle)
      } finally {
        handle.db.close()
      }
    },

    listTombstones() {
      ensureSyncDatabase(rootPath, dbIdentity)
      const handle = openSyncDatabase(rootPath)

      try {
        const rows =
          handle.db.exec(
            `
            SELECT entityType, entityId, deletedAt, serverRevision, sourceReplicaId, previousRelativePath, previousTitle
            FROM tombstones
            ORDER BY deletedAt ASC, entityType ASC, entityId ASC
          `,
          )[0]?.values ?? []

        return (rows as unknown[][]).map((row): TombstoneRecord => ({
          entityType: String(row[0]),
          entityId: String(row[1]),
          deletedAt: String(row[2]),
          serverRevision: typeof row[3] === "number" ? row[3] : null,
          sourceReplicaId: typeof row[4] === "string" ? row[4] : null,
          previousRelativePath: typeof row[5] === "string" ? row[5] : null,
          previousTitle: typeof row[6] === "string" ? row[6] : null,
        }))
      } finally {
        handle.db.close()
      }
    },
  }
}
