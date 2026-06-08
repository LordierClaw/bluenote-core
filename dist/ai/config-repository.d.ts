import type { AiConfig } from "./config-schema";
export interface AiConfigRepository {
    exists(): boolean;
    read(): AiConfig;
    write(config: AiConfig): string;
}
export declare function createAiConfigRepository(rootPath: string): AiConfigRepository;
//# sourceMappingURL=config-repository.d.ts.map