import { createAiConfigRepository } from "./config-repository.js";
import { ensureDescribeNotePrompt } from "./prompt-repository.js";
import { enqueueDescribeNoteJob } from "./queue-service.js";
export function formatAiEnqueueFailureWarning(error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Warning: could not enqueue AI description refresh: ${message}`;
}
export function enqueueDescribeNoteIfAiEnabled(rootPath, input, options) {
    try {
        const configRepository = createAiConfigRepository(rootPath);
        if (!configRepository.exists()) {
            return false;
        }
        const config = configRepository.read();
        if (!config.enabled) {
            return false;
        }
        const prompt = ensureDescribeNotePrompt(rootPath);
        enqueueDescribeNoteJob(rootPath, {
            key: input.key,
            relativePath: input.relativePath,
            title: input.title,
            body: input.body,
            currentDescription: input.currentDescription,
            promptHash: prompt.hash,
        }, { clock: options.clock, replaceKey: input.replaceKey });
        return true;
    }
    catch (error) {
        options.warn?.(formatAiEnqueueFailureWarning(error));
        return false;
    }
}
//# sourceMappingURL=enqueue-describe-note.js.map