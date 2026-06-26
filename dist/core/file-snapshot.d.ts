export interface FileSnapshot {
    filePath: string;
    content: Buffer | null;
}
export declare function snapshotFiles(filePaths: string[]): FileSnapshot[];
export declare function restoreFileSnapshots(snapshots: FileSnapshot[]): void;
//# sourceMappingURL=file-snapshot.d.ts.map