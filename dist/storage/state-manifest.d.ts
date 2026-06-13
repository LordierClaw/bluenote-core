export interface StateManifest {
    schemaVersion: number;
}
export declare function createDefaultStateManifest(): StateManifest;
export declare function getStateManifestPath(rootPath: string): string;
export declare function writeStateManifest(rootPath: string, manifest?: StateManifest): string;
export declare function readStateManifest(rootPath: string): StateManifest;
//# sourceMappingURL=state-manifest.d.ts.map