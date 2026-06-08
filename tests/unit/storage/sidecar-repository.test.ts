import { test, spyOn } from "bun:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"

import { InvalidFrontmatterError, UsageError } from "../../../src/core/errors"
import { createSidecarRepository } from "../../../src/storage/sidecar-repository"

const FIXED_SIDECAR = {
  type: "normal",
  key: "note-work-24-abc123",
  title: "Note Work #24",
  description: "Meeting notes about rollout risks.",
  relativePath: "note/note-work-24-abc123.md",
  createdAt: "2026-05-24T12:00:00.000Z",
  updatedAt: "2026-05-24T12:10:00.000Z",
  archivedAt: null,
  namingVersion: 1,
} as const

test("sidecar repository writes and reads sidecars under .data/notes", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-sidecar-repository-"))

  try {
    const repository = createSidecarRepository(rootPath)
    const sidecarPath = repository.write(FIXED_SIDECAR)

    assert.equal(sidecarPath, path.join(rootPath, ".data", "notes", "note-work-24-abc123.json"))

    const sidecarJson = await readFile(sidecarPath, "utf8")
    assert.deepEqual(JSON.parse(sidecarJson), FIXED_SIDECAR)

    assert.deepEqual(repository.read(FIXED_SIDECAR.key), FIXED_SIDECAR)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("sidecar repository writes canonical metadata under .data/notes", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-sidecar-repository-data-canonical-"))

  try {
    const repository = createSidecarRepository(rootPath)

    repository.write(FIXED_SIDECAR)

    await access(path.join(rootPath, ".data", "notes", "note-work-24-abc123.json"))
    await assert.rejects(() => access(path.join(rootPath, ".state", "notes", "note-work-24-abc123.json")), {
      code: "ENOENT",
    })
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("sidecar repository create-path write failures do not leave a partial sidecar behind", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-sidecar-repository-create-rollback-"))

  try {
    const repository = createSidecarRepository(rootPath)
    const sidecarPath = repository.getSidecarPath(FIXED_SIDECAR.key)
    const originalWriteFileSync = fs.writeFileSync
    const simulatedFailure = new Error("simulated partial sidecar write failure")
    const writeMock = spyOn(fs, "writeFileSync").mockImplementation((...args: Parameters<typeof fs.writeFileSync>) => {
      const [targetPath, _data, options] = args
      const targetPathString = String(targetPath)

      if (targetPathString.startsWith(`${sidecarPath}.`) && targetPathString.endsWith(".tmp")) {
        originalWriteFileSync(targetPath, "{\n  \"key\": \"note-work-24-abc123\"", options)
        throw simulatedFailure
      }

      return originalWriteFileSync(...args)
    })

    try {
      assert.throws(
        () => repository.write(FIXED_SIDECAR),
        (error: unknown) => {
          assert.ok(error instanceof UsageError)
          assert.match(error.message, /Could not write sidecar '.*note-work-24-abc123\.json'\./)
          assert.equal(error.cause, simulatedFailure)
          return true
        },
      )
    } finally {
      writeMock.mockRestore()
    }

    await assert.rejects(() => access(sidecarPath))
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("sidecar repository overwrite-path write failures preserve the existing sidecar contents", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-sidecar-repository-overwrite-rollback-"))

  try {
    const repository = createSidecarRepository(rootPath)
    const sidecarPath = repository.write(FIXED_SIDECAR)
    const originalJson = await readFile(sidecarPath, "utf8")
    const updatedSidecar = {
      ...FIXED_SIDECAR,
      type: "archived" as const,
      title: "Archived Note Work #24",
      relativePath: ".data/archive/note-work-24-abc123.md",
      archivedAt: "2026-05-24T12:30:00.000Z",
    }
    const originalWriteFileSync = fs.writeFileSync
    const simulatedFailure = new Error("simulated partial sidecar overwrite failure")
    const writeMock = spyOn(fs, "writeFileSync").mockImplementation((...args: Parameters<typeof fs.writeFileSync>) => {
      const [targetPath, _data, options] = args
      const targetPathString = String(targetPath)

      if (targetPathString.startsWith(`${sidecarPath}.`) && targetPathString.endsWith(".tmp")) {
        originalWriteFileSync(targetPath, "{\n  \"key\": \"note-work-24-abc123\",\n  \"title\": \"corrupted", options)
        throw simulatedFailure
      }

      return originalWriteFileSync(...args)
    })

    try {
      assert.throws(
        () => repository.write(updatedSidecar),
        (error: unknown) => {
          assert.ok(error instanceof UsageError)
          assert.match(error.message, /Could not write sidecar '.*note-work-24-abc123\.json'\./)
          assert.equal(error.cause, simulatedFailure)
          return true
        },
      )
    } finally {
      writeMock.mockRestore()
    }

    assert.equal(await readFile(sidecarPath, "utf8"), originalJson)
    assert.deepEqual(repository.read(FIXED_SIDECAR.key), FIXED_SIDECAR)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("sidecar repository rejects missing required sidecar fields when writing", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-sidecar-repository-invalid-write-"))

  try {
    const repository = createSidecarRepository(rootPath)

    assert.throws(
      () =>
        repository.write({
          type: "normal",
          key: "note-work-24-abc123",
          title: "Note Work #24",
          description: "Meeting notes about rollout risks.",
          createdAt: "2026-05-24T12:00:00.000Z",
          updatedAt: "2026-05-24T12:10:00.000Z",
          archivedAt: null,
          namingVersion: 1,
        } as never),
      (error: unknown) => {
        assert.ok(error instanceof InvalidFrontmatterError)
        assert.match(error.message, /note-work-24-abc123\.json/i)
        assert.match(error.message, /relativePath/i)
        return true
      },
    )
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("sidecar repository rejects invalid stored sidecars", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-sidecar-repository-invalid-read-"))

  try {
    const repository = createSidecarRepository(rootPath)
    const sidecarPath = path.join(rootPath, ".data", "notes", "note-work-24-abc123.json")

    await mkdir(path.dirname(sidecarPath), { recursive: true })
    await writeFile(
      sidecarPath,
      JSON.stringify({
        type: "normal",
        key: "note-work-24-abc123",
        title: "Note Work #24",
        description: "Meeting notes about rollout risks.",
        relativePath: "note/note-work-24-abc123.md",
        createdAt: "2026-05-24T12:00:00.000Z",
        updatedAt: "not-a-timestamp",
        archivedAt: null,
        namingVersion: 1,
      }),
      "utf8",
    )

    assert.throws(
      () => repository.read("note-work-24-abc123"),
      (error: unknown) => {
        assert.ok(error instanceof InvalidFrontmatterError)
        assert.match(error.message, /updatedAt/i)
        return true
      },
    )
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("sidecar repository rejects keys that escape .data/notes", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-sidecar-repository-invalid-key-"))

  try {
    const repository = createSidecarRepository(rootPath)

    assert.throws(() => repository.getSidecarPath("../escaped"), /outside the managed root/i)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("sidecar repository write rejects non-object runtime input without raw type errors", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-sidecar-repository-non-object-write-"))

  try {
    const repository = createSidecarRepository(rootPath)

    assert.throws(
      () => repository.write(null as never),
      (error: unknown) => {
        assert.ok(error instanceof InvalidFrontmatterError)
        assert.match(error.message, /expected a json object/i)
        assert.doesNotMatch(String(error), /TypeError/)
        return true
      },
    )
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})
