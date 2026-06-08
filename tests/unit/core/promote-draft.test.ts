import { test } from "bun:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"

import { UsageError } from "../../../src/core/errors"
import { promoteDraft } from "../../../src/core/promote-draft"

async function writeSidecarNote(rootPath: string, input: { key: string; title: string; relativePath: string; type?: "normal" | "draft" | "archived" }) {
  const notePath = path.join(rootPath, input.relativePath)
  await mkdir(path.dirname(notePath), { recursive: true })
  await mkdir(path.join(rootPath, ".data", "notes"), { recursive: true })
  await writeFile(notePath, `${input.title} body\n`, "utf8")
  await writeFile(path.join(rootPath, ".data", "notes", `${input.key}.json`), JSON.stringify({
    type: input.type ?? "normal",
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

test("promoteDraft moves a draft into an existing note folder and preserves sidecar metadata", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-promote-draft-"))
  try {
    await writeSidecarNote(rootPath, { key: "draft-abc123", title: "Draft ABC", relativePath: "draft/draft-abc123.md", type: "draft" })
    await mkdir(path.join(rootPath, "note", "work"), { recursive: true })

    const promoted = promoteDraft({
      override: rootPath,
      selector: "draft-abc123",
      destinationFolder: "note/work",
      title: "Promoted Draft",
      updatedAt: "2026-06-07T00:00:00.000Z",
      randomSource: () => 0,
    })

    assert.equal(promoted.previousKey, "draft-abc123")
    assert.equal(promoted.key, "promoted-draft-000000")
    assert.equal(promoted.title, "Promoted Draft")
    assert.equal(promoted.previousRelativePath, "draft/draft-abc123.md")
    assert.equal(promoted.relativePath, "note/work/promoted-draft-000000.md")
    await assert.rejects(readFile(path.join(rootPath, "draft", "draft-abc123.md"), "utf8"))
    assert.equal(await readFile(path.join(rootPath, "note", "work", "promoted-draft-000000.md"), "utf8"), "Draft ABC body\n")
    await assert.rejects(readFile(path.join(rootPath, ".data", "notes", "draft-abc123.json"), "utf8"))

    const sidecar = JSON.parse(await readFile(path.join(rootPath, ".data", "notes", "promoted-draft-000000.json"), "utf8"))
    assert.equal(sidecar.type, "normal")
    assert.equal(sidecar.key, "promoted-draft-000000")
    assert.equal(sidecar.title, "Promoted Draft")
    assert.equal(sidecar.description, "existing description")
    assert.equal(sidecar.relativePath, "note/work/promoted-draft-000000.md")
    assert.equal(sidecar.createdAt, "2026-06-01T00:00:00.000Z")
    assert.equal(sidecar.updatedAt, "2026-06-07T00:00:00.000Z")
    assert.equal(sidecar.archivedAt, null)
    assert.deepEqual(sidecar.ai, { description: { lastProcessedAt: "2026-06-04T00:00:00.000Z" } })
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("promoteDraft updates latest-opened when the promoted draft is currently open", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-promote-draft-latest-"))
  try {
    await writeSidecarNote(rootPath, { key: "draft-abc123", title: "Draft ABC", relativePath: "draft/draft-abc123.md", type: "draft" })
    await mkdir(path.join(rootPath, "note", "work"), { recursive: true })
    await mkdir(path.join(rootPath, ".data"), { recursive: true })
    await writeFile(path.join(rootPath, ".data", "latest-opened-note.json"), JSON.stringify({
      relativePath: "draft/draft-abc123.md",
      openedAt: "2026-06-07T00:00:00.000Z",
    }, null, 2) + "\n", "utf8")

    promoteDraft({ override: rootPath, selector: "draft-abc123", destinationFolder: "note/work", title: "Promoted Draft", randomSource: () => 0 })

    const latest = JSON.parse(await readFile(path.join(rootPath, ".data", "latest-opened-note.json"), "utf8"))
    assert.equal(latest.relativePath, "note/work/promoted-draft-000000.md")
    assert.equal(latest.openedAt, "2026-06-07T00:00:00.000Z")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("promoteDraft rejects non-drafts and non-existing or protected destinations", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-promote-draft-reject-"))
  try {
    await writeSidecarNote(rootPath, { key: "draft-abc123", title: "Draft ABC", relativePath: "draft/draft-abc123.md", type: "draft" })
    await writeSidecarNote(rootPath, { key: "normal-one", title: "Normal One", relativePath: "note/work/normal-one.md" })
    await mkdir(path.join(rootPath, "note", "work"), { recursive: true })
    await mkdir(path.join(rootPath, "draft", "nested"), { recursive: true })

    assert.throws(() => promoteDraft({ override: rootPath, selector: "normal-one", destinationFolder: "note/work", title: "Nope" }), UsageError)
    assert.throws(() => promoteDraft({ override: rootPath, selector: "draft-abc123", destinationFolder: "note/missing", title: "Nope" }), UsageError)
    assert.throws(() => promoteDraft({ override: rootPath, selector: "draft-abc123", destinationFolder: "draft/nested", title: "Nope" }), UsageError)
    assert.throws(() => promoteDraft({ override: rootPath, selector: "draft-abc123", destinationFolder: "note/work", title: "   " }), UsageError)
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})

test("promoteDraft rejects destination folders that resolve outside note via symlink", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-promote-draft-symlink-"))
  const outsidePath = await mkdtemp(path.join(os.tmpdir(), "bluenote-promote-draft-outside-"))
  try {
    await writeSidecarNote(rootPath, { key: "draft-abc123", title: "Draft ABC", relativePath: "draft/draft-abc123.md", type: "draft" })
    await mkdir(path.join(rootPath, "note"), { recursive: true })
    await symlink(outsidePath, path.join(rootPath, "note", "outside-link"), "dir")

    assert.throws(() => promoteDraft({
      override: rootPath,
      selector: "draft-abc123",
      destinationFolder: "note/outside-link",
      title: "Promoted Draft",
      randomSource: () => 0,
    }), UsageError)
    await assert.rejects(readFile(path.join(outsidePath, "promoted-draft-000000.md"), "utf8"))
  } finally {
    await rm(rootPath, { recursive: true, force: true })
    await rm(outsidePath, { recursive: true, force: true })
  }
})

test("promoteDraft rejects a note root that resolves outside the managed root", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-promote-draft-note-root-link-"))
  const outsidePath = await mkdtemp(path.join(os.tmpdir(), "bluenote-promote-draft-note-root-outside-"))
  try {
    await writeSidecarNote(rootPath, { key: "draft-abc123", title: "Draft ABC", relativePath: "draft/draft-abc123.md", type: "draft" })
    await rm(path.join(rootPath, "note"), { recursive: true, force: true })
    await symlink(outsidePath, path.join(rootPath, "note"), "dir")

    assert.throws(() => promoteDraft({
      override: rootPath,
      selector: "draft-abc123",
      destinationFolder: "note",
      title: "Promoted Draft",
      randomSource: () => 0,
    }), UsageError)
    await assert.rejects(readFile(path.join(outsidePath, "promoted-draft-000000.md"), "utf8"))
  } finally {
    await rm(rootPath, { recursive: true, force: true })
    await rm(outsidePath, { recursive: true, force: true })
  }
})

test("promoteDraft refuses to reuse the original draft key for the promoted normal note", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "bluenote-promote-draft-same-key-"))
  try {
    await writeSidecarNote(rootPath, { key: "draft-000000", title: "Draft 000000", relativePath: "draft/draft-000000.md", type: "draft" })
    await mkdir(path.join(rootPath, "note", "work"), { recursive: true })

    assert.throws(() => promoteDraft({
      override: rootPath,
      selector: "draft-000000",
      destinationFolder: "note/work",
      title: "Draft",
      randomSource: () => 0,
    }), UsageError)

    const sidecar = JSON.parse(await readFile(path.join(rootPath, ".data", "notes", "draft-000000.json"), "utf8"))
    assert.equal(sidecar.type, "draft")
    assert.equal(sidecar.relativePath, "draft/draft-000000.md")
    assert.equal(await readFile(path.join(rootPath, "draft", "draft-000000.md"), "utf8"), "Draft 000000 body\n")
  } finally {
    await rm(rootPath, { recursive: true, force: true })
  }
})
