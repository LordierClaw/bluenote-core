import { createAiConfigRepository } from "./config-repository"
import { ensureDescribeNotePrompt } from "./prompt-repository"
import { enqueueDescribeNoteJob } from "./queue-service"
import type { Clock } from "../platform/clock"

export interface EnqueueDescribeNoteIfAiEnabledInput {
  key: string
  relativePath: string
  title: string
  body: string
  currentDescription?: string | null
  replaceKey?: string | null
}

export interface EnqueueDescribeNoteIfAiEnabledOptions {
  clock: Clock
  warn?: (message: string) => void
}

export function formatAiEnqueueFailureWarning(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `Warning: could not enqueue AI description refresh: ${message}`
}

export function enqueueDescribeNoteIfAiEnabled(
  rootPath: string,
  input: EnqueueDescribeNoteIfAiEnabledInput,
  options: EnqueueDescribeNoteIfAiEnabledOptions,
): boolean {
  try {
    const configRepository = createAiConfigRepository(rootPath)
    if (!configRepository.exists()) {
      return false
    }

    const config = configRepository.read()
    if (!config.enabled) {
      return false
    }

    const prompt = ensureDescribeNotePrompt(rootPath)
    enqueueDescribeNoteJob(
      rootPath,
      {
        key: input.key,
        relativePath: input.relativePath,
        title: input.title,
        body: input.body,
        currentDescription: input.currentDescription,
        promptHash: prompt.hash,
      },
      { clock: options.clock, replaceKey: input.replaceKey },
    )
    return true
  } catch (error) {
    options.warn?.(formatAiEnqueueFailureWarning(error))
    return false
  }
}
