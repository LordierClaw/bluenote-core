export interface AppConfig {
    latestOpenedNoteTtlDays: number;
}
export interface AppConfigRepository {
    exists(): boolean;
    read(): AppConfig;
    write(config: Partial<AppConfig>): string;
}
export declare function normalizeAppConfig(input: unknown): AppConfig;
export declare function createAppConfigRepository(rootPath: string): AppConfigRepository;
//# sourceMappingURL=app-config-repository.d.ts.map