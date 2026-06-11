import path from "node:path";
import fs from "node:fs";
import { STATE_NOTES_DIRECTORY } from "../config/root.js";
import { UsageError } from "../core/errors.js";
import { assertPathInsideRoot } from "../platform/path-safety.js";
import { validateNoteSidecar } from "./sidecar-schema.js";
function getWriteValidationSourcePath(sidecar) {
    if (typeof sidecar === "object" && sidecar !== null) {
        const candidateKey = sidecar.key;
        if (typeof candidateKey === "string") {
            return path.join(STATE_NOTES_DIRECTORY, `${candidateKey}.json`);
        }
    }
    return path.join(STATE_NOTES_DIRECTORY, "<unknown>.json");
}
function wrapSidecarRepositoryError(action, relativePath, error) {
    const message = action === "read" ? `Could not read sidecar '${relativePath}'.` : `Could not write sidecar '${relativePath}'.`;
    const hint = action === "read"
        ? `Ensure the sidecar exists inside BLUENOTE_ROOT/${STATE_NOTES_DIRECTORY} and is readable.`
        : "Ensure BLUENOTE_ROOT points to a writable directory path.";
    throw new UsageError(message, {
        hint,
        cause: error,
    });
}
function getTemporarySidecarPath(sidecarPath) {
    return `${sidecarPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
}
function removeTemporarySidecar(sidecarPath) {
    if (!fs.existsSync(sidecarPath)) {
        return;
    }
    try {
        fs.rmSync(sidecarPath, { force: true });
    }
    catch {
        // Best-effort cleanup: preserve the original filesystem failure and error shape.
    }
}
export function createSidecarRepository(rootPath) {
    const normalizedRootPath = path.resolve(rootPath);
    const normalizedStateNotesPath = path.join(normalizedRootPath, STATE_NOTES_DIRECTORY);
    function getSidecarPath(key) {
        return assertPathInsideRoot(normalizedStateNotesPath, path.join(normalizedStateNotesPath, `${key}.json`));
    }
    return {
        getSidecarPath,
        read(key) {
            const sidecarPath = getSidecarPath(key);
            let rawJson;
            try {
                rawJson = fs.readFileSync(sidecarPath, "utf8");
            }
            catch (error) {
                wrapSidecarRepositoryError("read", path.join(STATE_NOTES_DIRECTORY, `${key}.json`), error);
            }
            let parsed;
            try {
                parsed = JSON.parse(rawJson);
            }
            catch (error) {
                throw new UsageError(`Could not parse sidecar '${path.join(STATE_NOTES_DIRECTORY, `${key}.json`)}'.`, {
                    hint: "Ensure sidecar files contain valid JSON metadata.",
                    cause: error,
                });
            }
            return validateNoteSidecar(parsed, path.join(STATE_NOTES_DIRECTORY, `${key}.json`));
        },
        write(sidecar) {
            const canonicalSidecar = validateNoteSidecar(sidecar, getWriteValidationSourcePath(sidecar));
            const sidecarPath = getSidecarPath(canonicalSidecar.key);
            const temporarySidecarPath = getTemporarySidecarPath(sidecarPath);
            try {
                fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
                fs.writeFileSync(temporarySidecarPath, JSON.stringify(canonicalSidecar, null, 2) + "\n", "utf8");
                fs.renameSync(temporarySidecarPath, sidecarPath);
            }
            catch (error) {
                removeTemporarySidecar(temporarySidecarPath);
                wrapSidecarRepositoryError("write", path.join(STATE_NOTES_DIRECTORY, `${canonicalSidecar.key}.json`), error);
            }
            return sidecarPath;
        },
    };
}
//# sourceMappingURL=sidecar-repository.js.map