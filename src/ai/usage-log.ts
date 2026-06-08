import path from "node:path"
import { appendFileSync, chmodSync, mkdirSync } from "node:fs"

import { getAiLogsPath } from "../storage/root-layout"
import type { AiTokenUsage } from "./types"

export type AiGenerationStatus = "applied" | "invalid" | "failed"

export interface AppendAiUsageLogInput {
  timestamp: string
  key: string
  provider: "openai-compatible" | "codex"
  model: string
  status: AiGenerationStatus
  usage?: AiTokenUsage
  providerRequestId?: string
}

export interface AppendAiResultLogInput {
  timestamp: string
  key: string
  relativePath: string
  status: AiGenerationStatus
  promptHash: string
  contentHash: string
  description?: string
  rawOutput?: string
  error?: string
  providerRequestId?: string
}

function appendJsonLine(filePath: string, record: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  appendFileSync(filePath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 })
  chmodSync(filePath, 0o600)
}

export function appendAiUsageLog(rootPath: string, input: AppendAiUsageLogInput): string {
  const logPath = path.join(getAiLogsPath(rootPath), "usage.jsonl")
  appendJsonLine(logPath, input)
  return logPath
}

export function appendAiResultLog(rootPath: string, input: AppendAiResultLogInput): string {
  const logPath = path.join(getAiLogsPath(rootPath), "results.jsonl")
  appendJsonLine(logPath, input)
  return logPath
}
