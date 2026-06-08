import { describe, test } from "bun:test"
import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../..")

async function collectTsFiles(relativeDir: string): Promise<string[]> {
  const absoluteDir = path.join(repoRoot, relativeDir)
  const entries = await readdir(absoluteDir, { recursive: true, withFileTypes: true })

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => path.relative(repoRoot, path.join(entry.parentPath, entry.name)))
    .sort()
}

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(repoRoot, relativePath), "utf8")
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const importExportPattern = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g
  const dynamicImportPattern = /import\(\s*["']([^"']+)["']\s*\)/g

  for (const match of source.matchAll(importExportPattern)) {
    specifiers.push(match[1])
  }

  for (const match of source.matchAll(dynamicImportPattern)) {
    specifiers.push(match[1])
  }

  return specifiers
}

describe("package boundary enforcement", () => {
  test("package exports only the public root entrypoint", async () => {
    const packageJson = JSON.parse(await read("package.json"))

    assert.deepEqual(Object.keys(packageJson.exports), ["."])
    assert.equal(packageJson.main, "./dist/index.js")
    assert.equal(packageJson.types, "./dist/index.d.ts")
  })

  test("core remains headless and does not import terminal UI/client code", async () => {
    const files = await collectTsFiles("src")
    const violations: string[] = []

    for (const file of files) {
      const source = await read(file)
      const specifiers = importSpecifiers(source)
      const forbidden = specifiers.filter((specifier) =>
        specifier === "@opentui/core" ||
        specifier.includes("packages/term") ||
        specifier.includes("src/tui") ||
        specifier.includes("/term/") ||
        specifier.startsWith("bluenote-term"),
      )

      if (forbidden.length > 0) {
        violations.push(`${file}: ${forbidden.join(", ")}`)
      }
    }

    assert.deepEqual(violations, [])
  })
})
