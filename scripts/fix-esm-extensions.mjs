import { readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const distRoot = path.resolve(scriptDir, "..", "dist")

async function collectOutputFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectOutputFiles(entryPath))
    } else if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".d.ts"))) {
      files.push(entryPath)
    }
  }

  return files
}

function withJsExtension(specifier) {
  if (!specifier.startsWith(".")) {
    return specifier
  }

  if (path.extname(specifier) !== "") {
    return specifier
  }

  return `${specifier}.js`
}

const outputFiles = await collectOutputFiles(distRoot)

for (const file of outputFiles) {
  const source = await readFile(file, "utf8")
  const updated = source
    .replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g, (_match, prefix, specifier, suffix) => `${prefix}${withJsExtension(specifier)}${suffix}`)
    .replace(/(import\s+["'])(\.{1,2}\/[^"']+)(["'])/g, (_match, prefix, specifier, suffix) => `${prefix}${withJsExtension(specifier)}${suffix}`)
    .replace(/(import\(\s*["'])(\.{1,2}\/[^"']+)(["']\s*\))/g, (_match, prefix, specifier, suffix) => `${prefix}${withJsExtension(specifier)}${suffix}`)

  if (updated !== source) {
    await writeFile(file, updated)
  }
}
