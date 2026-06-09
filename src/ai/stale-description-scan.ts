import { existsSync } from "node:fs"

import { createAiConfigRepository } from "./config-repository"
import { enqueueDescribeNoteIfAiEnabled } from "./enqueue-describe-note"
import { createNoteDescription } from "../domain/note-description"
import type { Clock } from "../platform/clock"
import { createNoteRepository } from "../storage/note-repository"
import { createSidecarRepository } from "../storage/sidecar-repository"

export interface ScanAndEnqueueStaleDescriptionsOptions {
  clock: Clock
  warn?: (message: string) => void
}

export interface ScanAndEnqueueStaleDescriptionsResult {
  scanned: number
  enqueued: number
}

function isDescriptionStale(updatedAt: string, lastProcessedAt: string | undefined): boolean {
  const updatedAtTime = Date.parse(updatedAt)
  const lastProcessedAtTime = Date.parse(lastProcessedAt ?? "")

  return Number.isNaN(lastProcessedAtTime) || updatedAtTime > lastProcessedAtTime
}

function formatStaleScanWarning(key: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `Warning: could not scan note '${key}' for AI description refresh: ${message}`
}

export function scanAndEnqueueStaleDescriptions(
  rootPath: string,
  options: ScanAndEnqueueStaleDescriptionsOptions,
): ScanAndEnqueueStaleDescriptionsResult {
  const configRepository = createAiConfigRepository(rootPath)
  if (!configRepository.exists()) {
    return { scanned: 0, enqueued: 0 }
  }

  const config = configRepository.read()
  if (!config.enabled) {
    return { scanned: 0, enqueued: 0 }
  }

  const noteRepository = createNoteRepository(rootPath)
  const sidecars = createSidecarRepository(rootPath)
  let scanned = 0
  let enqueued = 0

  for (const record of noteRepository.listNotePaths()) {
    scanned += 1

    try {
      const note = noteRepository.read(record.notePath)
      const key = note.frontmatter.id

      if (note.frontmatter.archivedAt !== undefined) {
        continue
      }

      const sidecarPath = sidecars.getSidecarPath(key)
      const sidecar = existsSync(sidecarPath) ? sidecars.read(key) : null
      const lastProcessedAt = sidecar?.ai?.description?.lastProcessedAt

      if (!isDescriptionStale(note.frontmatter.updatedAt, lastProcessedAt)) {
        continue
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
      })
      if (didEnqueue) {
        enqueued += 1
      }
    } catch (error) {
      options.warn?.(formatStaleScanWarning(record.relativePath, error))
    }
  }

  return { scanned, enqueued }
}
