import path from "node:path";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, } from "node:fs";
import { UsageError } from "../core/errors.js";
import { assertPathInsideRoot } from "../platform/path-safety.js";
import { getStatePath, getStateTmpPath } from "./root-layout.js";
export const ATOMIC_NOTE_WRITER_TEMP_PREFIX = "atomic-note-writer-";
const nodeFs = {
    closeSync,
    existsSync,
    fsyncSync,
    lstatSync,
    mkdirSync,
    openSync,
    readdirSync,
    renameSync,
    rmSync,
    statSync,
    unlinkSync,
    writeFileSync,
};
function withFs(overrides) {
    return { ...nodeFs, ...overrides };
}
function createTempName() {
    const time = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2);
    return `${ATOMIC_NOTE_WRITER_TEMP_PREFIX}${process.pid}-${time}-${random}.tmp`;
}
function isAtomicNoteWriterTempName(fileName) {
    return fileName.startsWith(ATOMIC_NOTE_WRITER_TEMP_PREFIX) && fileName.endsWith(".tmp");
}
function assertExistingPathIsNotSymlink(fs, filePath, relativeLabel) {
    try {
        if (fs.lstatSync(filePath).isSymbolicLink()) {
            throw new UsageError(`BlueNote atomic note writer path '${relativeLabel}' must not be a symlink.`, {
                hint: "Remove symlinks from BlueNote-managed internal state paths before retrying.",
            });
        }
    }
    catch (error) {
        if (error instanceof UsageError) {
            throw error;
        }
        if (typeof error === "object" && error !== null && error.code === "ENOENT") {
            return;
        }
        throw error;
    }
}
function assertTempDirectoryPathSafe(rootPath, fs) {
    const statePath = getStatePath(rootPath);
    const tempDirectoryPath = getStateTmpPath(rootPath);
    assertExistingPathIsNotSymlink(fs, statePath, path.relative(rootPath, statePath));
    assertExistingPathIsNotSymlink(fs, tempDirectoryPath, path.relative(rootPath, tempDirectoryPath));
    return tempDirectoryPath;
}
function assertExistingPathAndParentsAreNotSymlinks(rootPath, targetPath, fs) {
    const relativePath = path.relative(rootPath, targetPath);
    const parts = relativePath === "" ? [] : relativePath.split(path.sep).filter(Boolean);
    let currentPath = rootPath;
    assertExistingPathIsNotSymlink(fs, currentPath, path.relative(rootPath, currentPath) || ".");
    for (const part of parts) {
        currentPath = path.join(currentPath, part);
        assertExistingPathIsNotSymlink(fs, currentPath, path.relative(rootPath, currentPath));
    }
}
function removeBestEffort(fs, filePath) {
    try {
        fs.rmSync(filePath, { force: true });
    }
    catch {
        // Best-effort cleanup must not mask the original persistence error.
    }
}
function fsyncDirectoryBestEffort(fs, directoryPath) {
    let fileDescriptor;
    try {
        fileDescriptor = fs.openSync(directoryPath, "r");
        fs.fsyncSync(fileDescriptor);
    }
    catch {
        // Directory fsync is not available on every runtime/filesystem; the temp
        // file itself is still fsynced before rename.
    }
    finally {
        if (fileDescriptor !== undefined) {
            try {
                fs.closeSync(fileDescriptor);
            }
            catch {
                // Best-effort only.
            }
        }
    }
}
export function replaceNoteBodyAtomically(rootPath, notePath, body, options = {}) {
    const normalizedRootPath = path.resolve(rootPath);
    const normalizedNotePath = assertPathInsideRoot(normalizedRootPath, notePath);
    const fs = withFs(options.fs);
    assertExistingPathAndParentsAreNotSymlinks(normalizedRootPath, normalizedNotePath, fs);
    const tempDirectoryPath = assertTempDirectoryPathSafe(normalizedRootPath, fs);
    const tempName = options.tempName ?? createTempName();
    if (!isAtomicNoteWriterTempName(tempName) || path.basename(tempName) !== tempName) {
        throw new Error("Atomic note writer temp name must use the BlueNote writer prefix, .tmp suffix, and no path separators.");
    }
    fs.mkdirSync(path.dirname(normalizedNotePath), { recursive: true });
    fs.mkdirSync(tempDirectoryPath, { recursive: true });
    const tempPath = assertPathInsideRoot(tempDirectoryPath, path.join(tempDirectoryPath, tempName));
    let fileDescriptor;
    let tempCreated = false;
    let renamed = false;
    try {
        fileDescriptor = fs.openSync(tempPath, "wx", 0o600);
        tempCreated = true;
        fs.writeFileSync(fileDescriptor, body, { encoding: "utf8" });
        fs.fsyncSync(fileDescriptor);
        fs.closeSync(fileDescriptor);
        fileDescriptor = undefined;
        fs.renameSync(tempPath, normalizedNotePath);
        renamed = true;
        fsyncDirectoryBestEffort(fs, path.dirname(normalizedNotePath));
    }
    catch (error) {
        if (fileDescriptor !== undefined) {
            try {
                fs.closeSync(fileDescriptor);
            }
            catch {
                // Preserve the original error from write/fsync/rename.
            }
        }
        if (!renamed && tempCreated) {
            removeBestEffort(fs, tempPath);
        }
        throw error;
    }
}
export function cleanupStaleAtomicNoteWriterTemps(rootPath, options = {}) {
    const normalizedRootPath = path.resolve(rootPath);
    const fs = withFs(options.fs);
    const tempDirectoryPath = assertTempDirectoryPathSafe(normalizedRootPath, fs);
    const removedPaths = [];
    if (!fs.existsSync(tempDirectoryPath)) {
        return { removedPaths };
    }
    for (const fileName of fs.readdirSync(tempDirectoryPath)) {
        if (!isAtomicNoteWriterTempName(fileName)) {
            continue;
        }
        const stalePath = assertPathInsideRoot(tempDirectoryPath, path.join(tempDirectoryPath, fileName));
        if (!fs.statSync(stalePath).isFile()) {
            continue;
        }
        fs.unlinkSync(stalePath);
        removedPaths.push(stalePath);
    }
    return { removedPaths };
}
//# sourceMappingURL=atomic-note-writer.js.map