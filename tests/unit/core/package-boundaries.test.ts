import { describe, test } from "vitest"
import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

async function collectTsFiles(relativeDir: string): Promise<string[]> {
  const absoluteDir = path.join(repoRoot, relativeDir)
  const entries = await readdir(absoluteDir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const entryPath = path.join(absoluteDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectTsFiles(path.relative(repoRoot, entryPath)))
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(path.relative(repoRoot, entryPath))
    }
  }

  return files.sort()
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
  test("package exports only public runtime and metadata entrypoints", async () => {
    const packageJson = JSON.parse(await read("package.json"))

    assert.equal(packageJson.name, "@lordierclaw/bluenote-core")
    assert.match(packageJson.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/)
    assert.equal(packageJson.engines.node, ">=16.14 <17 || >=18")
    assert.equal(packageJson.engines.bun, undefined)
    assert.equal(packageJson.devDependencies?.["@types/bun"], undefined)
    assert.equal(packageJson.scripts.test.includes("bun"), false)
    assert.equal(packageJson.packageManager.startsWith("npm@"), true)
    assert.equal(packageJson.packageManager.startsWith("bun@"), false)
    assert.deepEqual(packageJson.repository, {
      type: "git",
      url: "https://github.com/LordierClaw/bluenote-core",
    })
    assert.equal(packageJson.files.includes("CHANGELOG.md"), false)
    assert.deepEqual(Object.keys(packageJson.exports), [".", "./search/contains-match", "./api/daemon-contract", "./package.json"])
    assert.deepEqual(packageJson.exports["./search/contains-match"], {
      types: "./dist/search/contains-match.d.ts",
      import: "./dist/search/contains-match.js",
      default: "./dist/search/contains-match.js",
    })
    assert.deepEqual(packageJson.exports["./api/daemon-contract"], {
      types: "./dist/api/daemon-contract.d.ts",
      import: "./dist/api/daemon-contract.js",
      default: "./dist/api/daemon-contract.js",
    })
    assert.equal(packageJson.exports["./package.json"], "./package.json")
    assert.equal(Object.keys(packageJson.exports).length, 4)
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
