import { existsSync } from "node:fs";
import { createAiConfigRepository } from "./config-repository.js";
import { enqueueDescribeNoteIfAiEnabled } from "./enqueue-describe-note.js";
import { createNoteDescription } from "../domain/note-description.js";
import { createNoteRepository } from "../storage/note-repository.js";
import { createSidecarRepository } from "../storage/sidecar-repository.js";
function isDescriptionStale(updatedAt, lastProcessedAt) {
    const updatedAtTime = Date.parse(updatedAt);
    const lastProcessedAtTime = Date.parse(lastProcessedAt ?? "");
    return Number.isNaN(lastProcessedAtTime) || updatedAtTime > lastProcessedAtTime;
}
function formatStaleScanWarning(key, error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Warning: could not scan note '${key}' for AI description refresh: ${message}`;
}
function readOptionalSidecarByKey(sidecars, key) {
    if (existsSync(sidecars.getSidecarPath(key))) {
        return sidecars.read(key);
    }
    try {
        return sidecars.read(key);
    }
    catch {
        return null;
    }
}
export function scanAndEnqueueStaleDescriptions(rootPath, options) {
    const configRepository = createAiConfigRepository(rootPath);
    if (!configRepository.exists()) {
        return { scanned: 0, enqueued: 0 };
    }
    const config = configRepository.read();
    if (!config.enabled) {
        return { scanned: 0, enqueued: 0 };
    }
    const noteRepository = createNoteRepository(rootPath);
    const sidecars = createSidecarRepository(rootPath);
    let scanned = 0;
    let enqueued = 0;
    for (const record of noteRepository.listNotePaths()) {
        scanned += 1;
        try {
            const note = noteRepository.read(record.notePath);
            const key = note.frontmatter.id;
            if (note.frontmatter.archivedAt !== undefined) {
                continue;
            }
            const sidecar = readOptionalSidecarByKey(sidecars, key);
            const lastProcessedAt = sidecar?.ai?.description?.lastProcessedAt;
            if (!isDescriptionStale(note.frontmatter.updatedAt, lastProcessedAt)) {
                continue;
            }
            const didEnqueue = enqueueDescribeNoteIfAiEnabled(rootPath, {
                key,
                relativePath: record.relativePath,
                title: note.frontmatter.title,
                body: note.body,
                currentDescription: sidecar?.description ?? createNoteDescription(note.body),
            }, {
                clock: options.clock,
                warn: options.warn,
            });
            if (didEnqueue) {
                enqueued += 1;
            }
        }
        catch (error) {
            options.warn?.(formatStaleScanWarning(record.relativePath, error));
        }
    }
    return { scanned, enqueued };
}
//# sourceMappingURL=stale-description-scan.js.map