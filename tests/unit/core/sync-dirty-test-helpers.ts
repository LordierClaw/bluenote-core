import path from "node:path"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"

import { createDirtyRecordRepository, createTombstoneRepository, type DirtyRecord, type TombstoneRecord } from "../../../src"
import { setSyncRuntimeMode } from "../../../src/sync/runtime-mode"

export const syncClientIdentity = { role: "client" as const, workspaceId: "workspace-core-mutations" }

export async function withTempRoot<T>(prefix: string, callback: (rootPath: string) => T | Promise<T>): Promise<T> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), prefix))

  try {
    return await callback(rootPath)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
}

export async function enableSyncClientMode(rootPath: string): Promise<void> {
  setSyncRuntimeMode(rootPath, { mode: "sync-client", workspaceId: syncClientIdentity.workspaceId })
}

export function listDirtyRecords(rootPath: string): DirtyRecord[] {
  return createDirtyRecordRepository(rootPath, syncClientIdentity).listDirtyRecords()
}

export function listTombstones(rootPath: string): TombstoneRecord[] {
  return createTombstoneRepository(rootPath, syncClientIdentity).listTombstones()
}

export async function writeSidecarNote(rootPath: string, input: { key: string; noteId?: string; title: string; relativePath: string; type?: "normal" | "draft" | "archived" }): Promise<void> {
  const notePath = path.join(rootPath, input.relativePath)
  await mkdir(path.dirname(notePath), { recursive: true })
  await mkdir(path.join(rootPath, ".data", "notes"), { recursive: true })
  await writeFile(notePath, `${input.title} body\n`, "utf8")
  await writeFile(path.join(rootPath, ".data", "notes", `${input.noteId ?? input.key}.json`), JSON.stringify({
    type: input.type ?? "normal",
    ...(input.noteId === undefined ? {} : { noteId: input.noteId }),
    key: input.key,
    title: input.title,
    description: "existing description",
    relativePath: input.relativePath,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
    archivedAt: input.type === "archived" ? "2026-06-03T00:00:00.000Z" : null,
    namingVersion: 1,
    ai: { description: { lastProcessedAt: "2026-06-04T00:00:00.000Z" } },
  }, null, 2) + "\n", "utf8")
}
