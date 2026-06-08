import path from "node:path";
import { UsageError } from "../core/errors.js";
export function assertPathInsideRoot(rootPath, targetPath) {
    if (rootPath === "") {
        throw new UsageError("Managed root path must not be empty.");
    }
    if (targetPath === "") {
        throw new UsageError("Target path must not be empty.");
    }
    const normalizedRootPath = path.resolve(rootPath);
    const normalizedTargetPath = path.resolve(targetPath);
    const relativePath = path.relative(normalizedRootPath, normalizedTargetPath);
    if (relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))) {
        return normalizedTargetPath;
    }
    throw new UsageError(`Target path '${normalizedTargetPath}' is outside the managed root '${normalizedRootPath}'.`);
}
export function toPortableRelativePath(relativePath) {
    return relativePath.replace(/\\/g, "/");
}
export function joinPortableRelativePath(...segments) {
    return path.posix.join(...segments.map(toPortableRelativePath));
}
export function toRootRelativePath(rootPath, targetPath) {
    const normalizedTargetPath = assertPathInsideRoot(rootPath, targetPath);
    const relativePath = path.relative(path.resolve(rootPath), normalizedTargetPath);
    return toPortableRelativePath(relativePath);
}
//# sourceMappingURL=path-safety.js.map