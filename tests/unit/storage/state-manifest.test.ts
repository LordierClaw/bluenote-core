import { test } from "vitest"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"

import { STORAGE_SCHEMA_VERSION } from "../../../src/config/root"
import { RootNotInitializedError } from "../../../src/core/errors"
import {
  createDefaultStateManifest,
  getStateManifestPath,
  readStateManifest,
  writeStateManifest,
} from "../../../src/storage/state-manifest"

test("createDefaultStateManifest returns the current storage schema version", () => {
  const manifest = createDefaultStateManifest()

  assert.equal(manifest.schemaVersion, 3)
  assert.equal(manifest.schemaVersion, STORAGE_SCHEMA_VERSION)
  assert.equal(typeof manifest.workspaceId, "string")
  assert.notEqual(manifest.workspaceId, "")
})

test("createDefaultStateManifest supports deterministic workspace ID generation", () => {
  assert.deepEqual(createDefaultStateManifest({ createWorkspaceId: () => "workspace_test" }), {
    schemaVersion: 3,
    workspaceId: "workspace_test",
  })
})

test("writeStateManifest stores manifest.json under .data and readStateManifest loads it", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-state-manifest-"))

  try {
    const manifestPath = await writeStateManifest(rootPath)
    assert.equal(manifestPath, path.join(rootPath, ".data", "manifest.json"))

    const manifestJson = await readFile(manifestPath, "utf8")
    const storedManifest = JSON.parse(manifestJson) as { schemaVersion?: unknown; workspaceId?: unknown }
    assert.equal(storedManifest.schemaVersion, 3)
    assert.equal(storedManifest.schemaVersion, STORAGE_SCHEMA_VERSION)
    assert.equal(typeof storedManifest.workspaceId, "string")
    assert.notEqual(storedManifest.workspaceId, "")

    assert.deepEqual(await readStateManifest(rootPath), storedManifest)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("readStateManifest accepts schema 2 manifests without workspaceId as legacy standalone manifests", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-state-manifest-schema-2-"))

  try {
    await writeStateManifest(rootPath)
    await writeFile(getStateManifestPath(rootPath), JSON.stringify({ schemaVersion: 2 }), "utf8")

    assert.deepEqual(readStateManifest(rootPath), { schemaVersion: 2 })
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("readStateManifest requires schema 3 manifests to include a non-empty string workspaceId", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-state-manifest-schema-3-"))

  try {
    await writeStateManifest(rootPath)

    for (const manifest of [
      { schemaVersion: 3 },
      { schemaVersion: 3, workspaceId: "" },
      { schemaVersion: 3, workspaceId: 123 },
    ]) {
      await writeFile(getStateManifestPath(rootPath), JSON.stringify(manifest), "utf8")

      assert.throws(() => readStateManifest(rootPath), (error: unknown) => {
        assert.ok(error instanceof RootNotInitializedError)
        assert.equal(error.message, "BlueNote root is not initialized.")
        assert.equal(error.hint, "Run 'bn init' to create a valid .data/manifest.json.")
        return true
      })
    }

    await writeFile(getStateManifestPath(rootPath), JSON.stringify({ schemaVersion: 3, workspaceId: "workspace_test" }), "utf8")

    assert.deepEqual(readStateManifest(rootPath), { schemaVersion: 3, workspaceId: "workspace_test" })
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("readStateManifest raises a root-initialization error when manifest data is missing or malformed", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-state-manifest-read-error-"))

  try {
    assert.throws(() => readStateManifest(rootPath), (error: unknown) => {
      assert.ok(error instanceof RootNotInitializedError)
      assert.equal(error.message, "BlueNote root is not initialized.")
      assert.equal(error.hint, "Run 'bn init' to create a valid .data/manifest.json.")
      assert.doesNotMatch(error.message, /ENOENT|Unexpected token|SyntaxError/i)
      return true
    })

    await writeStateManifest(rootPath)
    await writeFile(getStateManifestPath(rootPath), "{invalid json\n", "utf8")

    assert.throws(() => readStateManifest(rootPath), (error: unknown) => {
      assert.ok(error instanceof RootNotInitializedError)
      assert.equal(error.message, "BlueNote root is not initialized.")
      assert.equal(error.hint, "Run 'bn init' to create a valid .data/manifest.json.")
      assert.doesNotMatch(error.message, /ENOENT|Unexpected token|SyntaxError/i)
      return true
    })
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("readStateManifest raises a root-initialization error when manifest JSON has an invalid structure", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-state-manifest-invalid-structure-"))

  try {
    await writeStateManifest(rootPath)
    await writeFile(getStateManifestPath(rootPath), JSON.stringify({ schemaVersion: "oops" }), "utf8")

    assert.throws(() => readStateManifest(rootPath), (error: unknown) => {
      assert.ok(error instanceof RootNotInitializedError)
      assert.equal(error.message, "BlueNote root is not initialized.")
      assert.equal(error.hint, "Run 'bn init' to create a valid .data/manifest.json.")
      assert.doesNotMatch(error.message, /oops|TypeError|SyntaxError/i)
      return true
    })
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})
