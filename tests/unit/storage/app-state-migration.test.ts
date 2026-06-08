import { spyOn, test } from "bun:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"

import { UsageError } from "../../../src/core/errors"
import { migrateLegacyAppStateToData } from "../../../src/storage/app-state-migration"

async function createTempRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix))
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

test("migrateLegacyAppStateToData copies legacy manifest and note sidecars when data is absent", async () => {
  const rootPath = await createTempRoot("bluenote-app-state-migration-copy-")

  try {
    await mkdir(path.join(rootPath, ".state", "notes"), { recursive: true })
    await writeFile(path.join(rootPath, ".state", "manifest.json"), JSON.stringify({ schemaVersion: 2 }), "utf8")
    await writeFile(path.join(rootPath, ".state", "notes", "alpha.json"), JSON.stringify({ title: "Alpha" }), "utf8")
    await writeFile(path.join(rootPath, ".state", "notes", "beta.json"), JSON.stringify({ title: "Beta" }), "utf8")

    const result = migrateLegacyAppStateToData(rootPath)

    assert.equal(result.status, "migrated")
    assert.equal(result.migratedFileCount, 3)
    assert.equal(result.legacyStatePath, path.join(path.resolve(rootPath), ".state"))
    assert.equal(result.dataStatePath, path.join(path.resolve(rootPath), ".data"))
    assert.equal(await readFile(path.join(rootPath, ".data", "manifest.json"), "utf8"), JSON.stringify({ schemaVersion: 2 }))
    assert.equal(await readFile(path.join(rootPath, ".data", "notes", "alpha.json"), "utf8"), JSON.stringify({ title: "Alpha" }))
    assert.equal(await readFile(path.join(rootPath, ".data", "notes", "beta.json"), "utf8"), JSON.stringify({ title: "Beta" }))
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("migrateLegacyAppStateToData leaves Markdown notes byte-for-byte untouched", async () => {
  const rootPath = await createTempRoot("bluenote-app-state-migration-markdown-")

  try {
    const notePath = path.join(rootPath, "notes", "inbox", "alpha.md")
    const markdown = "# Alpha\n\nPreserve me exactly.\n"
    await mkdir(path.dirname(notePath), { recursive: true })
    await mkdir(path.join(rootPath, ".state", "notes"), { recursive: true })
    await writeFile(notePath, markdown, "utf8")
    await writeFile(path.join(rootPath, ".state", "notes", "alpha.json"), JSON.stringify({ title: "Alpha" }), "utf8")

    const before = await readFile(notePath, "utf8")
    migrateLegacyAppStateToData(rootPath)
    const after = await readFile(notePath, "utf8")

    assert.equal(after, before)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("migrateLegacyAppStateToData skips stale derived legacy artifacts", async () => {
  const rootPath = await createTempRoot("bluenote-app-state-migration-derived-")

  try {
    await mkdir(path.join(rootPath, ".state", "notes"), { recursive: true })
    await writeFile(path.join(rootPath, ".state", "manifest.json"), "{}", "utf8")
    await writeFile(path.join(rootPath, ".state", "metadata.sqlite"), "sqlite", "utf8")
    await writeFile(path.join(rootPath, ".state", "search-index.json"), "{}", "utf8")

    migrateLegacyAppStateToData(rootPath)

    assert.equal(await exists(path.join(rootPath, ".data", "manifest.json")), true)
    assert.equal(await exists(path.join(rootPath, ".data", "metadata.sqlite")), false)
    assert.equal(await exists(path.join(rootPath, ".data", "search-index.json")), false)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("migrateLegacyAppStateToData is idempotent when run twice", async () => {
  const rootPath = await createTempRoot("bluenote-app-state-migration-idempotent-")

  try {
    await mkdir(path.join(rootPath, ".state", "notes"), { recursive: true })
    await writeFile(path.join(rootPath, ".state", "manifest.json"), "{}", "utf8")
    await writeFile(path.join(rootPath, ".state", "notes", "alpha.json"), "{\"ok\":true}", "utf8")

    const first = migrateLegacyAppStateToData(rootPath)
    const second = migrateLegacyAppStateToData(rootPath)

    assert.equal(first.status, "migrated")
    assert.equal(first.migratedFileCount, 2)
    assert.equal(second.status, "noop")
    assert.equal(second.migratedFileCount, 0)
    assert.equal(await readFile(path.join(rootPath, ".data", "notes", "alpha.json"), "utf8"), "{\"ok\":true}")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("migrateLegacyAppStateToData allows data plus empty or stale legacy state with no conflict", async () => {
  const rootPath = await createTempRoot("bluenote-app-state-migration-stale-")

  try {
    await mkdir(path.join(rootPath, ".data", "notes"), { recursive: true })
    await mkdir(path.join(rootPath, ".state"), { recursive: true })
    await writeFile(path.join(rootPath, ".state", "metadata.sqlite"), "sqlite", "utf8")
    await writeFile(path.join(rootPath, ".state", "search-index.json"), "{}", "utf8")

    const result = migrateLegacyAppStateToData(rootPath)

    assert.equal(result.status, "noop")
    assert.equal(result.migratedFileCount, 0)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("migrateLegacyAppStateToData throws UsageError for conflicting app state files", async () => {
  const rootPath = await createTempRoot("bluenote-app-state-migration-conflict-")

  try {
    await mkdir(path.join(rootPath, ".data", "notes"), { recursive: true })
    await mkdir(path.join(rootPath, ".state", "notes"), { recursive: true })
    await writeFile(path.join(rootPath, ".data", "notes", "foo.json"), "{\"title\":\"Data\"}", "utf8")
    await writeFile(path.join(rootPath, ".state", "notes", "foo.json"), "{\"title\":\"State\"}", "utf8")

    assert.throws(
      () => migrateLegacyAppStateToData(rootPath),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.equal(error.message, "Cannot migrate legacy .state because .data already contains conflicting app state.")
        assert.equal(
          error.hint,
          "Review .state and .data, keep the desired BlueNote metadata under .data, then retry.",
        )
        return true
      },
    )
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("migrateLegacyAppStateToData does not overwrite a destination created during copy", async () => {
  const rootPath = await createTempRoot("bluenote-app-state-migration-race-")

  try {
    const sourcePath = path.join(rootPath, ".state", "notes", "foo.json")
    const destinationPath = path.join(rootPath, ".data", "notes", "foo.json")
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, "{\"title\":\"State\"}", "utf8")

    const originalCopyFileSync = fs.copyFileSync
    const copyMock = spyOn(fs, "copyFileSync").mockImplementation((source, destination, mode) => {
      if (String(destination) === destinationPath) {
        fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
        fs.writeFileSync(destinationPath, "{\"title\":\"Data\"}", "utf8")
        const error = new Error("destination already exists") as NodeJS.ErrnoException
        error.code = "EEXIST"
        throw error
      }

      return originalCopyFileSync(source, destination, mode)
    })

    try {
      assert.throws(
        () => migrateLegacyAppStateToData(rootPath),
        (error) => {
          assert.ok(error instanceof UsageError)
          assert.equal(error.message, "Cannot migrate legacy .state because .data already contains conflicting app state.")
          return true
        },
      )
    } finally {
      copyMock.mockRestore()
    }

    assert.equal(await readFile(destinationPath, "utf8"), "{\"title\":\"Data\"}")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("migrateLegacyAppStateToData rejects symlinked destination app-state directories", async () => {
  const rootPath = await createTempRoot("bluenote-app-state-migration-symlink-")
  const outsidePath = await createTempRoot("bluenote-app-state-migration-outside-")

  try {
    await mkdir(path.join(rootPath, ".state", "notes"), { recursive: true })
    await writeFile(path.join(rootPath, ".state", "notes", "foo.json"), "{\"title\":\"State\"}", "utf8")
    await symlink(outsidePath, path.join(rootPath, ".data"), "dir")

    assert.throws(
      () => migrateLegacyAppStateToData(rootPath),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.equal(error.message, "Cannot migrate legacy .state because .data contains unsafe app-state paths.")
        assert.equal(error.hint, "Remove symlinks from .data app-state paths before retrying migration.")
        return true
      },
    )

    assert.equal(await exists(path.join(outsidePath, "notes", "foo.json")), false)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
    await rm(outsidePath, { recursive: true, force: true })
  }
})

test("migrateLegacyAppStateToData rejects symlinked destination app-state files", async () => {
  const rootPath = await createTempRoot("bluenote-app-state-migration-file-symlink-")
  const outsidePath = await createTempRoot("bluenote-app-state-migration-file-outside-")

  try {
    const outsideSidecarPath = path.join(outsidePath, "foo.json")
    await mkdir(path.join(rootPath, ".state", "notes"), { recursive: true })
    await mkdir(path.join(rootPath, ".data", "notes"), { recursive: true })
    await writeFile(path.join(rootPath, ".state", "notes", "foo.json"), "{\"title\":\"State\"}", "utf8")
    await writeFile(outsideSidecarPath, "{\"title\":\"State\"}", "utf8")
    await symlink(outsideSidecarPath, path.join(rootPath, ".data", "notes", "foo.json"))

    assert.throws(
      () => migrateLegacyAppStateToData(rootPath),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.equal(error.message, "Cannot migrate legacy .state because .data contains unsafe app-state paths.")
        assert.equal(error.hint, "Remove symlinks from .data app-state paths before retrying migration.")
        return true
      },
    )
  } finally {
    await rm(rootPath, { recursive: true, force: true })
    await rm(outsidePath, { recursive: true, force: true })
  }
})

test("migrateLegacyAppStateToData rejects dangling destination app-state symlinks", async () => {
  const rootPath = await createTempRoot("bluenote-app-state-migration-dangling-symlink-")

  try {
    await mkdir(path.join(rootPath, ".state", "notes"), { recursive: true })
    await mkdir(path.join(rootPath, ".data", "notes"), { recursive: true })
    await writeFile(path.join(rootPath, ".state", "notes", "foo.json"), "{\"title\":\"State\"}", "utf8")
    await symlink(path.join(rootPath, "missing-target.json"), path.join(rootPath, ".data", "notes", "foo.json"))

    assert.throws(
      () => migrateLegacyAppStateToData(rootPath),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.equal(error.message, "Cannot migrate legacy .state because .data contains unsafe app-state paths.")
        assert.equal(error.hint, "Remove symlinks from .data app-state paths before retrying migration.")
        return true
      },
    )
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("migrateLegacyAppStateToData rejects symlinked legacy source directories", async () => {
  const rootPath = await createTempRoot("bluenote-app-state-migration-source-symlink-")
  const outsidePath = await createTempRoot("bluenote-app-state-migration-source-outside-")

  try {
    await mkdir(path.join(rootPath, ".state"), { recursive: true })
    await writeFile(path.join(outsidePath, "foo.json"), "{\"title\":\"Outside\"}", "utf8")
    await symlink(outsidePath, path.join(rootPath, ".state", "notes"), "dir")

    assert.throws(
      () => migrateLegacyAppStateToData(rootPath),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.equal(error.message, "Cannot migrate legacy .state because .state contains unsafe app-state paths.")
        assert.equal(error.hint, "Remove symlinks from .state app-state paths before retrying migration.")
        return true
      },
    )

    assert.equal(await exists(path.join(rootPath, ".data", "notes", "foo.json")), false)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
    await rm(outsidePath, { recursive: true, force: true })
  }
})

test("migrateLegacyAppStateToData rejects symlinked legacy source files", async () => {
  const rootPath = await createTempRoot("bluenote-app-state-migration-source-file-symlink-")
  const outsidePath = await createTempRoot("bluenote-app-state-migration-source-file-outside-")

  try {
    const outsideSidecarPath = path.join(outsidePath, "foo.json")
    await mkdir(path.join(rootPath, ".state", "notes"), { recursive: true })
    await writeFile(outsideSidecarPath, "{\"title\":\"Outside\"}", "utf8")
    await symlink(outsideSidecarPath, path.join(rootPath, ".state", "notes", "foo.json"))

    assert.throws(
      () => migrateLegacyAppStateToData(rootPath),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.equal(error.message, "Cannot migrate legacy .state because .state contains unsafe app-state paths.")
        assert.equal(error.hint, "Remove symlinks from .state app-state paths before retrying migration.")
        return true
      },
    )

    assert.equal(await exists(path.join(rootPath, ".data", "notes", "foo.json")), false)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
    await rm(outsidePath, { recursive: true, force: true })
  }
})

test("migrateLegacyAppStateToData rejects a symlinked legacy state root", async () => {
  const rootPath = await createTempRoot("bluenote-app-state-migration-state-root-symlink-")
  const outsidePath = await createTempRoot("bluenote-app-state-migration-state-root-outside-")

  try {
    await mkdir(path.join(outsidePath, "notes"), { recursive: true })
    await writeFile(path.join(outsidePath, "notes", "foo.json"), "{\"title\":\"Outside\"}", "utf8")
    await symlink(outsidePath, path.join(rootPath, ".state"), "dir")

    assert.throws(
      () => migrateLegacyAppStateToData(rootPath),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.equal(error.message, "Cannot migrate legacy .state because .state contains unsafe app-state paths.")
        assert.equal(error.hint, "Remove symlinks from .state app-state paths before retrying migration.")
        return true
      },
    )

    assert.equal(await exists(path.join(rootPath, ".data", "notes", "foo.json")), false)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
    await rm(outsidePath, { recursive: true, force: true })
  }
})

test("migrateLegacyAppStateToData rejects a symlinked legacy manifest", async () => {
  const rootPath = await createTempRoot("bluenote-app-state-migration-manifest-symlink-")
  const outsidePath = await createTempRoot("bluenote-app-state-migration-manifest-outside-")

  try {
    const outsideManifestPath = path.join(outsidePath, "manifest.json")
    await mkdir(path.join(rootPath, ".state"), { recursive: true })
    await writeFile(outsideManifestPath, "{\"schemaVersion\":2}", "utf8")
    await symlink(outsideManifestPath, path.join(rootPath, ".state", "manifest.json"))

    assert.throws(
      () => migrateLegacyAppStateToData(rootPath),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.equal(error.message, "Cannot migrate legacy .state because .state contains unsafe app-state paths.")
        assert.equal(error.hint, "Remove symlinks from .state app-state paths before retrying migration.")
        return true
      },
    )
  } finally {
    await rm(rootPath, { recursive: true, force: true })
    await rm(outsidePath, { recursive: true, force: true })
  }
})

test("migrateLegacyAppStateToData rejects symlinked data root even when legacy state is stale", async () => {
  const rootPath = await createTempRoot("bluenote-app-state-migration-data-root-symlink-noop-")
  const outsidePath = await createTempRoot("bluenote-app-state-migration-data-root-outside-")

  try {
    await mkdir(path.join(rootPath, ".state"), { recursive: true })
    await symlink(outsidePath, path.join(rootPath, ".data"), "dir")

    assert.throws(
      () => migrateLegacyAppStateToData(rootPath),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.equal(error.message, "Cannot migrate legacy .state because .data contains unsafe app-state paths.")
        assert.equal(error.hint, "Remove symlinks from .data app-state paths before retrying migration.")
        return true
      },
    )
  } finally {
    await rm(rootPath, { recursive: true, force: true })
    await rm(outsidePath, { recursive: true, force: true })
  }
})

test("migrateLegacyAppStateToData creates only data layout and leaves unrelated note symlinks untouched", async () => {
  const rootPath = await createTempRoot("bluenote-app-state-migration-narrow-layout-")
  const outsidePath = await createTempRoot("bluenote-app-state-migration-narrow-outside-")

  try {
    await mkdir(path.join(rootPath, ".state", "notes"), { recursive: true })
    await writeFile(path.join(rootPath, ".state", "notes", "foo.json"), "{\"title\":\"State\"}", "utf8")
    await symlink(outsidePath, path.join(rootPath, "notes"), "dir")

    const result = migrateLegacyAppStateToData(rootPath)

    assert.equal(result.status, "migrated")
    assert.equal(await exists(path.join(rootPath, ".data", "notes", "foo.json")), true)
    assert.equal(await exists(path.join(outsidePath, "inbox")), false)
    assert.equal(await exists(path.join(outsidePath, "journal")), false)
    assert.equal(await exists(path.join(outsidePath, "archive")), false)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
    await rm(outsidePath, { recursive: true, force: true })
  }
})
