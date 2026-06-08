import type { AppErrorCode, AppErrorOptions } from "./types"

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly hint?: string

  constructor(code: AppErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, "cause" in options ? { cause: options.cause } : undefined)
    this.name = new.target.name
    this.code = code
    this.hint = options.hint
  }
}

export class UsageError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("USAGE_ERROR", message, options)
  }
}

export class RootNotInitializedError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("ROOT_NOT_INITIALIZED", message, options)
  }
}

export class InvalidFrontmatterError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("INVALID_FRONTMATTER", message, options)
  }
}

export class AmbiguousSelectorError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("AMBIGUOUS_SELECTOR", message, options)
  }
}

export class SelectorNotFoundError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("SELECTOR_NOT_FOUND", message, options)
  }
}

export class EditorLaunchError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("EDITOR_LAUNCH_FAILED", message, options)
  }
}

export class IndexUnavailableError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("INDEX_UNAVAILABLE", message, options)
  }
}

export class IndexValidationFailedError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("INDEX_VALIDATION_FAILED", message, options)
  }
}

export function isValidationOrDataError(
  error: unknown,
): error is InvalidFrontmatterError | AmbiguousSelectorError | IndexUnavailableError | IndexValidationFailedError {
  return (
    error instanceof InvalidFrontmatterError ||
    error instanceof AmbiguousSelectorError ||
    error instanceof IndexUnavailableError ||
    error instanceof IndexValidationFailedError
  )
}
