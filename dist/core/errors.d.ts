import type { AppErrorCode, AppErrorOptions } from "./types.js";
export declare class AppError extends Error {
    readonly code: AppErrorCode;
    readonly hint?: string;
    constructor(code: AppErrorCode, message: string, options?: AppErrorOptions);
}
export declare class UsageError extends AppError {
    constructor(message: string, options?: AppErrorOptions);
}
export declare class RootNotInitializedError extends AppError {
    constructor(message: string, options?: AppErrorOptions);
}
export declare class InvalidFrontmatterError extends AppError {
    constructor(message: string, options?: AppErrorOptions);
}
export declare class AmbiguousSelectorError extends AppError {
    constructor(message: string, options?: AppErrorOptions);
}
export declare class SelectorNotFoundError extends AppError {
    constructor(message: string, options?: AppErrorOptions);
}
export declare class EditorLaunchError extends AppError {
    constructor(message: string, options?: AppErrorOptions);
}
export declare class IndexUnavailableError extends AppError {
    constructor(message: string, options?: AppErrorOptions);
}
export declare class IndexValidationFailedError extends AppError {
    constructor(message: string, options?: AppErrorOptions);
}
export declare function isValidationOrDataError(error: unknown): error is InvalidFrontmatterError | AmbiguousSelectorError | IndexUnavailableError | IndexValidationFailedError;
//# sourceMappingURL=errors.d.ts.map