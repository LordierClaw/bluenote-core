#!/usr/bin/env node
import { spawn } from "node:child_process"
import { readdir } from "node:fs/promises"
import path from "node:path"

async function collectTestFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectTestFiles(entryPath))
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      files.push(entryPath)
    }
  }

  return files.sort()
}

const testFiles = await collectTestFiles(path.resolve("tests"))

if (testFiles.length === 0) {
  throw new Error("No test files found under tests")
}

const registerFlag = Number(process.versions.node.split(".")[0]) >= 20 ? "--import" : "--loader"
const child = spawn(process.execPath, [registerFlag, "tsx", "--test", ...testFiles], {
  stdio: "inherit",
})

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 1)
})

child.on("error", (error) => {
  console.error(error)
  process.exit(1)
})
