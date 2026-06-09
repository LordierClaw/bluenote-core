export declare const DEFAULT_BLUENOTE_ROOT_DIRECTORY = ".bluenote";
export declare const APP_STATE_DIRECTORY = ".data";
export declare const APP_STATE_NOTES_DIRECTORY: string;
export declare const APP_STATE_RECOVERY_DIRECTORY: string;
export declare const APP_STATE_TMP_DIRECTORY: string;
export declare const APP_STATE_LOGS_DIRECTORY: string;
export declare const APP_STATE_AI_DIRECTORY: string;
export declare const APP_STATE_AI_PROMPTS_DIRECTORY: string;
export declare const APP_STATE_AI_LOGS_DIRECTORY: string;
export declare const APP_STATE_AI_CONFIG_FILENAME = "config.json";
export declare const APP_STATE_AI_QUEUE_FILENAME = "queue.json";
export declare const LEGACY_STATE_DIRECTORY = ".state";
export declare const LEGACY_STATE_NOTES_DIRECTORY: string;
export declare const STATE_DIRECTORY = ".data";
export declare const STATE_NOTES_DIRECTORY: string;
export declare const STATE_RECOVERY_DIRECTORY: string;
export declare const STATE_TMP_DIRECTORY: string;
export declare const STATE_LOGS_DIRECTORY: string;
export declare const STATE_MANIFEST_FILENAME = "manifest.json";
export declare const STORAGE_SCHEMA_VERSION = 2;
export interface ResolveBlueNoteRootOptions {
    override?: string;
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    homeDir?: string;
}
export declare function resolveBlueNoteRoot(options?: ResolveBlueNoteRootOptions): string;
//# sourceMappingURL=root.d.ts.map