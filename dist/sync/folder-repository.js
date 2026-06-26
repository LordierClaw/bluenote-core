import { withSyncDatabase } from "./sync-db.js";
export function createFolderRepository(rootPath, dbIdentity) {
    return {
        upsertFolder(folder) {
            withSyncDatabase(rootPath, dbIdentity, (handle) => {
                handle.db.run(`
          INSERT INTO folders (relativePath, createdAt, updatedAt, deletedAt)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(relativePath) DO UPDATE SET
            createdAt = excluded.createdAt,
            updatedAt = excluded.updatedAt,
            deletedAt = excluded.deletedAt
        `, [folder.relativePath, folder.createdAt, folder.updatedAt, folder.deletedAt ?? null]);
            }, { save: true });
        },
        listFolders() {
            return withSyncDatabase(rootPath, dbIdentity, (handle) => {
                const rows = handle.db.exec(`
            SELECT relativePath, createdAt, updatedAt, deletedAt
            FROM folders
            ORDER BY relativePath ASC
          `)[0]?.values ?? [];
                return rows.map((row) => ({
                    relativePath: String(row[0]),
                    createdAt: String(row[1]),
                    updatedAt: String(row[2]),
                    deletedAt: typeof row[3] === "string" ? row[3] : null,
                }));
            });
        },
    };
}
//# sourceMappingURL=folder-repository.js.map