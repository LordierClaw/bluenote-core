import path from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { STATE_DIRECTORY, STATE_MANIFEST_FILENAME, STORAGE_SCHEMA_VERSION, } from "../config/root.js";
import { RootNotInitializedError } from "../core/errors.js";
export function createDefaultStateManifest() {
    return {
        schemaVersion: STORAGE_SCHEMA_VERSION,
    };
}
export function getStateManifestPath(rootPath) {
    return path.join(path.resolve(rootPath), STATE_DIRECTORY, STATE_MANIFEST_FILENAME);
}
export function writeStateManifest(rootPath, manifest = createDefaultStateManifest()) {
    const manifestPath = getStateManifestPath(rootPath);
    mkdirSync(path.dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    return manifestPath;
}
function isStateManifest(value) {
    return (typeof value === "object" &&
        value !== null &&
        typeof value.schemaVersion === "number");
}
export function readStateManifest(rootPath) {
    try {
        const manifest = JSON.parse(readFileSync(getStateManifestPath(rootPath), "utf8"));
        if (!isStateManifest(manifest)) {
            throw new Error("Invalid state manifest structure.");
        }
        return manifest;
    }
    catch (error) {
        throw new RootNotInitializedError("BlueNote root is not initialized.", {
            hint: `Run 'bn init' to create a valid ${STATE_DIRECTORY}/${STATE_MANIFEST_FILENAME}.`,
            cause: error,
        });
    }
}
//# sourceMappingURL=state-manifest.js.map