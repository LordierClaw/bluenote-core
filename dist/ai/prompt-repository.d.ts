export declare const DESCRIBE_NOTE_PROMPT_FILENAME = "describe-note.md";
export declare const DEFAULT_OUTPUT_LANGUAGE = "English";
export declare const DEFAULT_DESCRIBE_NOTE_PROMPT: string;
export interface AiPrompt {
    path: string;
    content: string;
    hash: string;
}
export declare function hashAiPromptContent(content: string): string;
export declare function ensureDescribeNotePrompt(rootPath: string): AiPrompt;
export declare function readDescribeNotePrompt(rootPath: string): AiPrompt;
//# sourceMappingURL=prompt-repository.d.ts.map