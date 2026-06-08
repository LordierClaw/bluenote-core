import path from "node:path";
import { resolveBlueNoteRoot } from "../config/root.js";
import { UsageError } from "../core/errors.js";
import { rebuildIndexes } from "../core/rebuild-indexes.js";
import { selectNote } from "../core/select-note.js";
import { systemClock } from "../platform/clock.js";
import { createNoteRepository } from "../storage/note-repository.js";
import { createSidecarRepository } from "../storage/sidecar-repository.js";
import { createAiConfigRepository } from "./config-repository.js";
import { sanitizeAiDescription } from "./description-policy.js";
import { sanitizeAiErrorMessage } from "./error-redaction.js";
import { readDescribeNotePrompt } from "./prompt-repository.js";
import { hashDescribeNoteContent, removeDescribeNoteJob } from "./queue-service.js";
import { appendAiResultLog, appendAiUsageLog } from "./usage-log.js";
function buildUserContent(input) {
    return [
        `Title: ${input.title}`,
        `Current description: ${input.currentDescription || "(none)"}`,
        "Body:",
        input.body,
    ].join("\n");
}
function buildMessages(systemPrompt, userContent) {
    return [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
    ];
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function appendConfiguredLogs(input) {
    if (input.logging.usage) {
        appendAiUsageLog(input.rootPath, {
            timestamp: input.timestamp,
            key: input.key,
            provider: input.provider,
            model: input.model,
            status: input.status,
            ...(input.completion?.usage ? { usage: input.completion.usage } : {}),
            ...(input.completion?.providerRequestId ? { providerRequestId: input.completion.providerRequestId } : {}),
        });
    }
    if (input.logging.results) {
        appendAiResultLog(input.rootPath, {
            timestamp: input.timestamp,
            key: input.key,
            relativePath: input.relativePath,
            status: input.status,
            promptHash: input.promptHash,
            contentHash: input.contentHash,
            ...(input.description ? { description: input.description } : {}),
            ...(input.rawOutput ? { rawOutput: input.rawOutput } : {}),
            ...(input.error ? { error: input.error } : {}),
            ...(input.completion?.providerRequestId ? { providerRequestId: input.completion.providerRequestId } : {}),
        });
    }
}
function appendConfiguredLogsBestEffort(input) {
    try {
        appendConfiguredLogs(input);
    }
    catch {
        // AI logging is diagnostic only. Do not let log write/chmod failures mask
        // provider errors, invalid generations, or successful sidecar updates.
    }
}
function isCapturedInputFresh(input) {
    const currentSelected = selectNote({ repository: input.repository, selector: input.key, visibility: "all" });
    const currentSidecar = input.sidecars.read(input.key);
    const currentContentHash = hashDescribeNoteContent({
        title: currentSidecar.title,
        body: currentSelected.body,
        currentDescription: currentSidecar.description,
    });
    if (currentContentHash !== input.contentHash) {
        return false;
    }
    return true;
}
export async function generateNoteDescription(options) {
    const rootPath = resolveBlueNoteRoot({ override: options.rootPath });
    const clock = options.clock ?? systemClock;
    const timestamp = clock.now().toISOString();
    const config = createAiConfigRepository(rootPath).read();
    const secrets = config.provider === "openai-compatible" ? [config.apiKey] : [];
    if (!config.enabled) {
        throw new UsageError("AI description generation is disabled.", {
            hint: "Enable AI in .data/ai/config.json before generating note descriptions.",
        });
    }
    const prompt = readDescribeNotePrompt(rootPath);
    const repository = createNoteRepository(rootPath);
    const sidecars = createSidecarRepository(rootPath);
    const selected = selectNote({ repository, selector: options.selector, visibility: "all" });
    const key = selected.frontmatter.id;
    const sidecar = sidecars.read(key);
    const contentHash = hashDescribeNoteContent({
        title: sidecar.title,
        body: selected.body,
        currentDescription: sidecar.description,
    });
    const messages = buildMessages(prompt.content, buildUserContent({
        title: sidecar.title,
        currentDescription: sidecar.description,
        body: selected.body,
    }));
    let completion;
    try {
        completion = await options.client.createChatCompletion({
            model: config.model,
            messages,
        });
    }
    catch (error) {
        appendConfiguredLogsBestEffort({
            rootPath,
            timestamp,
            logging: config.logging,
            key,
            relativePath: selected.sourcePath,
            status: "failed",
            provider: config.provider,
            model: config.model,
            promptHash: prompt.hash,
            contentHash,
            error: sanitizeAiErrorMessage(error, secrets),
        });
        throw error;
    }
    let description;
    try {
        description = sanitizeAiDescription(completion.text);
    }
    catch (error) {
        const message = sanitizeAiErrorMessage(error, secrets);
        appendConfiguredLogsBestEffort({
            rootPath,
            timestamp,
            logging: config.logging,
            key,
            relativePath: selected.sourcePath,
            status: "invalid",
            provider: config.provider,
            model: config.model,
            promptHash: prompt.hash,
            contentHash,
            completion,
            rawOutput: completion.text,
            error: message,
        });
        return {
            key,
            relativePath: selected.sourcePath,
            status: "invalid",
            error: message,
        };
    }
    if (!isCapturedInputFresh({ repository, sidecars, key, contentHash })) {
        const message = "note changed while AI description was generating; skipped stale result";
        appendConfiguredLogsBestEffort({
            rootPath,
            timestamp,
            logging: config.logging,
            key,
            relativePath: selected.sourcePath,
            status: "invalid",
            provider: config.provider,
            model: config.model,
            promptHash: prompt.hash,
            contentHash,
            completion,
            rawOutput: completion.text,
            error: message,
        });
        return {
            key,
            relativePath: path.normalize(selected.sourcePath).split(path.sep).join("/"),
            status: "stale",
            error: message,
        };
    }
    const currentSidecar = sidecars.read(key);
    sidecars.write({
        ...currentSidecar,
        description,
        ai: {
            ...currentSidecar.ai,
            description: {
                ...currentSidecar.ai?.description,
                lastProcessedAt: timestamp,
            },
        },
    });
    removeDescribeNoteJob(rootPath, key);
    rebuildIndexes({ override: rootPath });
    appendConfiguredLogsBestEffort({
        rootPath,
        timestamp,
        logging: config.logging,
        key,
        relativePath: selected.sourcePath,
        status: "applied",
        provider: config.provider,
        model: config.model,
        promptHash: prompt.hash,
        contentHash,
        completion,
        description,
        rawOutput: completion.text,
    });
    return {
        key,
        relativePath: path.normalize(selected.sourcePath).split(path.sep).join("/"),
        status: "applied",
        description,
    };
}
//# sourceMappingURL=description-service.js.map