import { test } from "bun:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"

import { UsageError } from "../../../src/core/errors"
import {
  ATOMIC_NOTE_WRITER_TEMP_PREFIX,
  cleanupStaleAtomicNoteWriterTemps,
  replaceNoteBodyAtomically,
} from "../../../src/storage/atomic-note-writer"
import { ensureManagedRoot, getStateTmpPath } from "../../../src/storage/root-layout"

async function withManagedRoot(run: (rootPath: string) => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bluenote-atomic-note-writer-"))

  try {
    const rootPath = ensureManagedRoot(tempRoot)
    await run(rootPath)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

async function expectMissing(filePath: string): Promise<void> {
  await assert.rejects(() => access(filePath))
}

test("replaceNoteBodyAtomically replaces a target note body and leaves note files as plain Markdown", async () => {
  await withManagedRoot(async (rootPath) => {
    const notePath = path.join(rootPath, "note", "target.md")
    await writeFile(notePath, "old body\n", "utf8")

    replaceNoteBodyAtomically(rootPath, notePath, "# Title\n\nnew body\n")

    assert.equal(await readFile(notePath, "utf8"), "# Title\n\nnew body\n")
    assert.deepEqual(await readdir(getStateTmpPath(rootPath)), [])
  })
})

test("replaceNoteBodyAtomically creates its temp file only under the managed .data/tmp writer namespace", async () => {
  await withManagedRoot(async (rootPath) => {
    const notePath = path.join(rootPath, "note", "target.md")
    const observedRenameSources: string[] = []
    await writeFile(notePath, "old body\n", "utf8")

    replaceNoteBodyAtomically(rootPath, notePath, "new body\n", {
      fs: {
        renameSync(sourcePath, targetPath) {
          observedRenameSources.push(sourcePath)
          writeFileSync(targetPath, readFileSync(sourcePath))
          unlinkSync(sourcePath)
        },
      },
    })

    assert.equal(observedRenameSources.length, 1)
    const tempPath = observedRenameSources[0]
    assert.ok(tempPath.startsWith(`${getStateTmpPath(rootPath)}${path.sep}`), tempPath)
    assert.ok(path.basename(tempPath).startsWith(ATOMIC_NOTE_WRITER_TEMP_PREFIX), tempPath)
    assert.equal(path.extname(tempPath), ".tmp")
    assert.equal(await readFile(notePath, "utf8"), "new body\n")
  })
})

test("replaceNoteBodyAtomically rejects target paths outside the managed root", async () => {
  await withManagedRoot(async (rootPath) => {
    const outsidePath = path.join(os.tmpdir(), `bluenote-outside-${Date.now()}.md`)

    assert.throws(
      () => replaceNoteBodyAtomically(rootPath, outsidePath, "new body\n"),
      (error) => {
        assert.ok(error instanceof UsageError)
        assert.match(error.message, /outside the managed root/)
        return true
      },
    )

    await expectMissing(outsidePath)
  })
})

test("replaceNoteBodyAtomically leaves original note body unchanged and removes temp file when temp write fails", async () => {
  await withManagedRoot(async (rootPath) => {
    const notePath = path.join(rootPath, "note", "target.md")
    await writeFile(notePath, "original body\n", "utf8")

    assert.throws(
      () =>
        replaceNoteBodyAtomically(rootPath, notePath, "new body\n", {
          fs: {
            writeFileSync() {
              throw new Error("injected temp write failure")
            },
          },
        }),
      /injected temp write failure/,
    )

    assert.equal(await readFile(notePath, "utf8"), "original body\n")
    assert.deepEqual(await readdir(getStateTmpPath(rootPath)), [])
  })
})

test("replaceNoteBodyAtomically leaves original note body unchanged and removes temp file when rename fails", async () => {
  await withManagedRoot(async (rootPath) => {
    const notePath = path.join(rootPath, "note", "target.md")
    await writeFile(notePath, "original body\n", "utf8")

    assert.throws(
      () =>
        replaceNoteBodyAtomically(rootPath, notePath, "new body\n", {
          fs: {
            renameSync() {
              throw new Error("injected rename failure")
            },
          },
        }),
      /injected rename failure/,
    )

    assert.equal(await readFile(notePath, "utf8"), "original body\n")
    assert.deepEqual(await readdir(getStateTmpPath(rootPath)), [])
  })
})

test("replaceNoteBodyAtomically rejects symlinked note parent directories before writing outside the root", async () => {
  await withManagedRoot(async (rootPath) => {
    const inboxPath = path.join(rootPath, "note")
    const outsideNoteRoot = await mkdtemp(path.join(os.tmpdir(), "bluenote-atomic-note-writer-target-outside-"))
    const outsideNotePath = path.join(outsideNoteRoot, "target.md")
    await rm(inboxPath, { recursive: true, force: true })
    symlinkSync(outsideNoteRoot, inboxPath, "dir")

    try {
      assert.throws(
        () => replaceNoteBodyAtomically(rootPath, path.join(inboxPath, "target.md"), "new body\n"),
        (error) => {
          assert.ok(error instanceof UsageError)
          assert.match(error.message, /must not be a symlink/)
          return true
        },
      )

      await expectMissing(outsideNotePath)
    } finally {
      await rm(outsideNoteRoot, { recursive: true, force: true })
    }
  })
})

test("replaceNoteBodyAtomically rejects symlinked BlueNote temp directories before writing outside the root", async () => {
  await withManagedRoot(async (rootPath) => {
    const notePath = path.join(rootPath, "note", "target.md")
    const outsideTempRoot = await mkdtemp(path.join(os.tmpdir(), "bluenote-atomic-note-writer-outside-"))
    await rm(getStateTmpPath(rootPath), { recursive: true, force: true })
    symlinkSync(outsideTempRoot, getStateTmpPath(rootPath), "dir")
    await writeFile(notePath, "original body\n", "utf8")

    try {
      assert.throws(
        () => replaceNoteBodyAtomically(rootPath, notePath, "new body\n"),
        (error) => {
          assert.ok(error instanceof UsageError)
          assert.match(error.message, /must not be a symlink/)
          return true
        },
      )

      assert.equal(await readFile(notePath, "utf8"), "original body\n")
      assert.deepEqual(await readdir(outsideTempRoot), [])
    } finally {
      await rm(outsideTempRoot, { recursive: true, force: true })
    }
  })
})

test("cleanupStaleAtomicNoteWriterTemps rejects symlinked BlueNote temp directories before deleting outside the root", async () => {
  await withManagedRoot(async (rootPath) => {
    const outsideTempRoot = await mkdtemp(path.join(os.tmpdir(), "bluenote-atomic-note-writer-cleanup-outside-"))
    const outsideWriterTemp = path.join(outsideTempRoot, `${ATOMIC_NOTE_WRITER_TEMP_PREFIX}outside.tmp`)
    await writeFile(outsideWriterTemp, "outside temp", "utf8")
    await rm(getStateTmpPath(rootPath), { recursive: true, force: true })
    symlinkSync(outsideTempRoot, getStateTmpPath(rootPath), "dir")

    try {
      assert.throws(
        () => cleanupStaleAtomicNoteWriterTemps(rootPath),
        (error) => {
          assert.ok(error instanceof UsageError)
          assert.match(error.message, /must not be a symlink/)
          return true
        },
      )

      assert.equal(await readFile(outsideWriterTemp, "utf8"), "outside temp")
    } finally {
      await rm(outsideTempRoot, { recursive: true, force: true })
    }
  })
})

test("cleanupStaleAtomicNoteWriterTemps removes only stale BlueNote writer temp files", async () => {
  await withManagedRoot(async (rootPath) => {
    const tempPath = getStateTmpPath(rootPath)
    const staleWriterTemp = path.join(tempPath, `${ATOMIC_NOTE_WRITER_TEMP_PREFIX}stale.tmp`)
    const nestedDirectory = path.join(tempPath, `${ATOMIC_NOTE_WRITER_TEMP_PREFIX}directory.tmp`)
    const unrelatedTemp = path.join(tempPath, "editor-swap.tmp")
    const normalMarkdownNote = path.join(tempPath, `${ATOMIC_NOTE_WRITER_TEMP_PREFIX}not-a-temp.md`)
    const realNote = path.join(rootPath, "note", `${ATOMIC_NOTE_WRITER_TEMP_PREFIX}stale.tmp.md`)

    await writeFile(staleWriterTemp, "stale temp", "utf8")
    await mkdir(nestedDirectory)
    await writeFile(unrelatedTemp, "unrelated", "utf8")
    await writeFile(normalMarkdownNote, "markdown", "utf8")
    await writeFile(realNote, "real note", "utf8")

    const result = cleanupStaleAtomicNoteWriterTemps(rootPath)

    assert.deepEqual(result.removedPaths, [staleWriterTemp])
    await expectMissing(staleWriterTemp)
    assert.equal(await readFile(unrelatedTemp, "utf8"), "unrelated")
    assert.equal(await readFile(normalMarkdownNote, "utf8"), "markdown")
    assert.equal(await readFile(realNote, "utf8"), "real note")
    assert.equal((await readdir(nestedDirectory)).length, 0)
  })
})
