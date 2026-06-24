import type { NoteSidecar } from "./sidecar-schema.js";
export interface SidecarRepository {
    getSidecarPath(keyOrNoteId: string): string;
    getSidecarPathByNoteId(noteId: string): string;
    read(key: string): NoteSidecar;
    readByNoteId(noteId: string): NoteSidecar;
    write(sidecar: NoteSidecar): string;
}
export declare function createSidecarRepository(rootPath: string): SidecarRepository;
//# sourceMappingURL=sidecar-repository.d.ts.map