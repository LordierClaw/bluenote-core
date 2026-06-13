export declare const ATOMIC_NOTE_WRITER_TEMP_PREFIX = "atomic-note-writer-";
export interface AtomicNoteWriterFs {
    closeSync(fileDescriptor: number): void;
    existsSync(filePath: string): boolean;
    fsyncSync(fileDescriptor: number): void;
    lstatSync(targetPath: string): {
        isSymbolicLink(): boolean;
    };
    mkdirSync(directoryPath: string, options: {
        recursive: true;
    }): void;
    openSync(filePath: string, flags: string, mode?: number): number;
    readdirSync(directoryPath: string): string[];
    renameSync(sourcePath: string, targetPath: string): void;
    rmSync(targetPath: string, options?: {
        force?: boolean;
        recursive?: boolean;
    }): void;
    statSync(targetPath: string): {
        isFile(): boolean;
    };
    unlinkSync(filePath: string): void;
    writeFileSync(fileDescriptor: number, data: string, options: {
        encoding: BufferEncoding;
    }): void;
}
export interface ReplaceNoteBodyAtomicallyOptions {
    fs?: Partial<AtomicNoteWriterFs>;
    tempName?: string;
}
export interface CleanupStaleAtomicNoteWriterTempsOptions {
    fs?: Partial<AtomicNoteWriterFs>;
}
export interface CleanupStaleAtomicNoteWriterTempsResult {
    removedPaths: string[];
}
export declare function replaceNoteBodyAtomically(rootPath: string, notePath: string, body: string, options?: ReplaceNoteBodyAtomicallyOptions): void;
export declare function cleanupStaleAtomicNoteWriterTemps(rootPath: string, options?: CleanupStaleAtomicNoteWriterTempsOptions): CleanupStaleAtomicNoteWriterTempsResult;
//# sourceMappingURL=atomic-note-writer.d.ts.map