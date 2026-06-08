import { readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

const distRoot = path.resolve(import.meta.dir, "..", "dist")

async function collectJsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectJsFiles(entryPath))
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(entryPath)
    }
  }

  return files
}

function withJsExtension(specifier: string): string {
  if (!specifier.startsWith(".")) {
    return specifier
  }

  if (path.extname(specifier) !== "") {
    return specifier
  }

  return `${specifier}.js`
}

const jsFiles = await collectJsFiles(distRoot)

for (const file of jsFiles) {
  const source = await readFile(file, "utf8")
  const updated = source
    .replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g, (_match, prefix, specifier, suffix) => `${prefix}${withJsExtension(specifier)}${suffix}`)
    .replace(/(import\(\s*["'])(\.{1,2}\/[^"']+)(["']\s*\))/g, (_match, prefix, specifier, suffix) => `${prefix}${withJsExtension(specifier)}${suffix}`)

  if (updated !== source) {
    await writeFile(file, updated)
  }
}
