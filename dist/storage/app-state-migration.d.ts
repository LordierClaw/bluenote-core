export interface AppStateMigrationResult {
    status: "noop" | "migrated";
    migratedFileCount: number;
    legacyStatePath: string;
    dataStatePath: string;
}
export declare function migrateLegacyAppStateToData(rootPath: string): AppStateMigrationResult;
//# sourceMappingURL=app-state-migration.d.ts.map