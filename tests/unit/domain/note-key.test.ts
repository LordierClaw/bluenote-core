import { test } from "bun:test"
import assert from "node:assert/strict"

import {
  createNoteKey,
  createShortNoteSuffix,
  slugifyNoteTitle,
} from "../../../src/domain/note-key"

test("slugifyNoteTitle normalizes titles into lowercase dash-separated slugs", () => {
  assert.equal(slugifyNoteTitle("  Hello, BlueNote CLI!  "), "hello-bluenote-cli")
  assert.equal(slugifyNoteTitle("Roadmap: Storage & UX"), "roadmap-storage-ux")
})

test("createShortNoteSuffix formats injected random bytes as a short lowercase base36 token", () => {
  const suffix = createShortNoteSuffix({
    suffixLength: 4,
    randomSource: () => 0x12345678,
  })

  assert.equal(suffix, "u7i0")
  assert.match(suffix, /^[a-z0-9]{4}$/)
})

test("createNoteKey appends a short suffix to the normalized slug", () => {
  const key = createNoteKey("Ship It", {
    suffixLength: 4,
    randomSource: () => 0x12345678,
  })

  assert.equal(key, "ship-it-u7i0")
})

test("createNoteKey retries collisions until a unique candidate is available", () => {
  const emitted: string[] = []
  const draws = [0x12345678, 0x76543210]

  const key = createNoteKey("Collision Course", {
    suffixLength: 4,
    randomSource: () => draws.shift() ?? 0,
    isUnique: (candidate: string) => {
      emitted.push(candidate)
      return candidate.endsWith("ycr4")
    },
    onCollision: (candidate: string) => {
      emitted.push(`collision:${candidate}`)
    },
  })

  assert.equal(key, "collision-course-ycr4")
  assert.deepEqual(emitted, [
    "collision-course-u7i0",
    "collision:collision-course-u7i0",
    "collision-course-ycr4",
  ])
})
