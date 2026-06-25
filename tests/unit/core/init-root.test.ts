import { test } from "vitest"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"

import { initRoot } from "../../../src/core/init-root"
import { getStateManifestPath, readStateManifest, writeStateManifest } from "../../../src/storage/state-manifest"

test("initRoot preserves an existing valid workspaceId", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-init-root-preserve-workspace-"))

  try {
    await writeStateManifest(rootPath, { schemaVersion: 3, workspaceId: "workspace_existing" })

    const summary = initRoot({ override: rootPath })

    assert.equal(summary.rootPath, rootPath)
    assert.deepEqual(readStateManifest(rootPath), { schemaVersion: 3, workspaceId: "workspace_existing" })
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("initRoot repairs malformed manifests", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-init-root-repair-malformed-"))

  try {
    await mkdir(path.dirname(getStateManifestPath(rootPath)), { recursive: true })
    await writeFile(getStateManifestPath(rootPath), "{ not valid json", "utf8")

    initRoot({ override: rootPath })

    const manifest = readStateManifest(rootPath)
    assert.equal(manifest.schemaVersion, 3)
    assert.equal(typeof manifest.workspaceId, "string")
    assert.notEqual(manifest.workspaceId, "")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("initRoot repairs invalid schema 3 manifests missing workspaceId", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-init-root-repair-invalid-schema3-"))

  try {
    await mkdir(path.dirname(getStateManifestPath(rootPath)), { recursive: true })
    await writeFile(getStateManifestPath(rootPath), JSON.stringify({ schemaVersion: 3 }) + "\n", "utf8")

    initRoot({ override: rootPath })

    const manifest = readStateManifest(rootPath)
    assert.equal(manifest.schemaVersion, 3)
    assert.equal(typeof manifest.workspaceId, "string")
    assert.notEqual(manifest.workspaceId, "")
    assert.notEqual(await readFile(getStateManifestPath(rootPath), "utf8"), JSON.stringify({ schemaVersion: 3 }) + "\n")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})
