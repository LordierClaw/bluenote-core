export type AppErrorCode =
  | "USAGE_ERROR"
  | "ROOT_NOT_INITIALIZED"
  | "INVALID_FRONTMATTER"
  | "AMBIGUOUS_SELECTOR"
  | "SELECTOR_NOT_FOUND"
  | "EDITOR_LAUNCH_FAILED"
  | "INDEX_UNAVAILABLE"
  | "INDEX_VALIDATION_FAILED"

export type CliExitCode = 0 | 1 | 2

export interface CliResult {
  exitCode: CliExitCode
  stdout: string
  stderr: string
}

export interface AppErrorOptions {
  hint?: string
  cause?: unknown
}
