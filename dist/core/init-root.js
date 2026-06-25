import { resolveBlueNoteRoot } from "../config/root.js";
import { UsageError } from "./errors.js";
import { writeStateManifest } from "../storage/state-manifest.js";
import { ensureManagedRoot } from "../storage/root-layout.js";
import { migrateLegacyAppStateToData } from "../storage/app-state-migration.js";
export function initRoot(options = {}) {
    const rootPath = ensureManagedRoot(resolveBlueNoteRoot(options));
    migrateLegacyAppStateToData(rootPath);
    try {
        writeStateManifest(rootPath);
    }
    catch (error) {
        throw new UsageError(`Could not initialize BlueNote root at '${rootPath}'.`, {
            hint: "Ensure BLUENOTE_ROOT points to a writable directory path.",
            cause: error,
        });
    }
    return {
        rootPath,
    };
}
//# sourceMappingURL=init-root.js.map