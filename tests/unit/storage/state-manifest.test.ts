import { test } from "bun:test"
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
  assert.deepEqual(createDefaultStateManifest(), {
    schemaVersion: STORAGE_SCHEMA_VERSION,
  })
})

test("writeStateManifest stores manifest.json under .data and readStateManifest loads it", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-state-manifest-"))

  try {
    const manifestPath = await writeStateManifest(rootPath)
    assert.equal(manifestPath, path.join(rootPath, ".data", "manifest.json"))

    const manifestJson = await readFile(manifestPath, "utf8")
    assert.deepEqual(JSON.parse(manifestJson), {
      schemaVersion: STORAGE_SCHEMA_VERSION,
    })

    assert.deepEqual(await readStateManifest(rootPath), {
      schemaVersion: STORAGE_SCHEMA_VERSION,
    })
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
