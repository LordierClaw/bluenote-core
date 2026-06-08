import type { NoteSidecar } from "./sidecar-schema";
export interface SidecarRepository {
    getSidecarPath(key: string): string;
    read(key: string): NoteSidecar;
    write(sidecar: NoteSidecar): string;
}
export declare function createSidecarRepository(rootPath: string): SidecarRepository;
//# sourceMappingURL=sidecar-repository.d.ts.map