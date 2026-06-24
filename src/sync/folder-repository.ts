import { ensureSyncDatabase, openSyncDatabase, saveSyncDatabase, type EnsureSyncDatabaseOptions } from "./sync-db"

export interface FolderInput {
  relativePath: string
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export interface FolderRecord {
  relativePath: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface FolderRepository {
  upsertFolder(folder: FolderInput): void
  listFolders(): FolderRecord[]
}

export function createFolderRepository(rootPath: string, dbIdentity: EnsureSyncDatabaseOptions): FolderRepository {
  return {
    upsertFolder(folder) {
      ensureSyncDatabase(rootPath, dbIdentity)
      const handle = openSyncDatabase(rootPath)

      try {
        handle.db.run(
          `
          INSERT INTO folders (relativePath, createdAt, updatedAt, deletedAt)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(relativePath) DO UPDATE SET
            createdAt = excluded.createdAt,
            updatedAt = excluded.updatedAt,
            deletedAt = excluded.deletedAt
        `,
          [folder.relativePath, folder.createdAt, folder.updatedAt, folder.deletedAt ?? null],
        )
        saveSyncDatabase(handle)
      } finally {
        handle.db.close()
      }
    },

    listFolders() {
      ensureSyncDatabase(rootPath, dbIdentity)
      const handle = openSyncDatabase(rootPath)

      try {
        const rows =
          handle.db.exec(
            `
            SELECT relativePath, createdAt, updatedAt, deletedAt
            FROM folders
            ORDER BY relativePath ASC
          `,
          )[0]?.values ?? []

        return (rows as unknown[][]).map((row): FolderRecord => ({
          relativePath: String(row[0]),
          createdAt: String(row[1]),
          updatedAt: String(row[2]),
          deletedAt: typeof row[3] === "string" ? row[3] : null,
        }))
      } finally {
        handle.db.close()
      }
    },
  }
}
