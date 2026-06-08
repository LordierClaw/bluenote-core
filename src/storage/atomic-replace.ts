import { existsSync, renameSync, rmSync } from "node:fs"

export interface ReplaceFileAtomicallyOptions {
  platform?: NodeJS.Platform
}

/**
 * Replace a file with an already-written temporary file.
 *
 * POSIX rename overwrites an existing file atomically. Windows can reject
 * renaming over an existing target, so remove the old target first there.
 * The Windows path is the best available cross-platform fallback for these
 * small root-local state files; callers still write to a temp path first so
 * failed writes do not corrupt the prior file contents.
 */
export function replaceFileAtomically(temporaryPath: string, targetPath: string, options: ReplaceFileAtomicallyOptions = {}): void {
  const platform = options.platform ?? process.platform

  if (platform === "win32" && existsSync(targetPath)) {
    rmSync(targetPath, { force: true })
  }

  renameSync(temporaryPath, targetPath)
}
