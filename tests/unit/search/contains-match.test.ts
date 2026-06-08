import { test } from "bun:test"
import assert from "node:assert/strict"

import {
  collectContainsFieldMatches,
  containsSearchQuery,
  normalizeSearchQuery,
  scoreContainsMatch,
} from "../../../src/search/contains-match"

test("normalizeSearchQuery trims, lowercases, and collapses whitespace", () => {
  assert.equal(normalizeSearchQuery("  ABC  "), "abc")
  assert.equal(normalizeSearchQuery("Client\n\tLaunch"), "client launch")
})

test("containsSearchQuery matches literal normalized substrings without subsequence matching", () => {
  assert.equal(containsSearchQuery("Receipt 123", "123"), true)
  assert.equal(containsSearchQuery("a-big-cat", "abc"), false)
})

test("containsSearchQuery handles multi-word queries with conservative same-field token fallback", () => {
  assert.equal(containsSearchQuery("Client Launch Brief", "client launch"), true)
  assert.equal(containsSearchQuery("Client-Launch Brief", "client launch"), true)
  assert.equal(containsSearchQuery("Client legal Launch", "client launch"), false)
})

test("scoreContainsMatch ranks exact above prefix above substring and rejects non-contains", () => {
  const exact = scoreContainsMatch("receipt 123", "receipt 123")
  const prefix = scoreContainsMatch("receipt 123 draft", "receipt")
  const substring = scoreContainsMatch("draft receipt 123", "receipt")

  assert.ok(exact > prefix)
  assert.ok(prefix > substring)
  assert.equal(scoreContainsMatch("a-big-cat", "abc"), 0)
  assert.equal(scoreContainsMatch("Receipt 123", ""), 0)
})

test("scoreContainsMatch applies optional weights deterministically", () => {
  assert.ok(scoreContainsMatch("Receipt 123", "receipt", 2) > scoreContainsMatch("Receipt 123", "receipt"))
})

test("collectContainsFieldMatches returns matched fields and scores for candidates", () => {
  const matches = collectContainsFieldMatches("123", [
    { field: "key", value: "receipt-123", weight: 1.1 },
    { field: "title", value: "Receipt 123" },
    { field: "description", value: "Client receipt" },
    { field: "path", value: "notes/receipts/receipt-123.md" },
    { field: "body", value: "Paid invoice 123 today" },
  ])

  assert.deepEqual(
    matches.map((match) => match.field),
    ["key", "title", "path", "body"],
  )
  assert.ok(matches.every((match) => match.score > 0))
})
