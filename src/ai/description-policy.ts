import { UsageError } from "../core/errors"

const DESCRIPTION_WORD_LIMIT = 10

const WRAPPING_QUOTE_PAIRS = [
  ["\"", "\""],
  ["'", "'"],
  ["“", "”"],
  ["‘", "’"],
] as const

function invalidDescription(reason: string): UsageError {
  return new UsageError(`Provider returned an invalid description: ${reason}.`, {
    hint: "The existing note description was left unchanged.",
  })
}

function trimWrappingQuotes(value: string): string {
  let trimmed = value.trim()

  for (const [openQuote, closeQuote] of WRAPPING_QUOTE_PAIRS) {
    if (trimmed.startsWith(openQuote) && trimmed.endsWith(closeQuote) && trimmed.length >= openQuote.length + closeQuote.length) {
      trimmed = trimmed.slice(openQuote.length, trimmed.length - closeQuote.length).trim()
      break
    }
  }

  return trimmed
}

function wordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length
}

function containsMarkdownOutput(value: string): boolean {
  return /^```/.test(value)
    || /^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/.test(value)
    || /(?:`[^`]+`|\*{1,2}[^*]+\*{1,2}|_{1,2}[^_]+_{1,2}|\[[^\]]+\]\([^)]*\))/.test(value)
}

function containsPromptInjectionLeakage(value: string): boolean {
  return /\b(?:ignore|disregard)\s+(?:(?:all|the)\s+)?(?:previous|prior)\s+instructions\b|\breveal\s+(?:the\s+)?system\s+prompt\b/i.test(value)
}

function containsInstructionLikePromptLeakage(value: string): boolean {
  return /^\s*(?:summarize|describe)\b/i.test(value)
}

function containsProviderRefusalOrError(value: string): boolean {
  return /\b(?:as an ai|i cannot|i can't|sorry,? but|provider error|rate limit)\b|\berror\s*:/i.test(value)
}

const SENTENCE_TERMINATORS = ".!?。！？"

function isExactlyOneSentence(value: string): boolean {
  const trimmed = value.trim()
  const finalCharacter = trimmed.at(-1)
  if (!finalCharacter || !SENTENCE_TERMINATORS.includes(finalCharacter)) {
    return false
  }

  return !Array.from(trimmed.slice(0, -1)).some((character) => SENTENCE_TERMINATORS.includes(character))
}

export function sanitizeAiDescription(raw: string): string {
  const withoutWrappingQuotes = trimWrappingQuotes(raw)

  if (withoutWrappingQuotes.length === 0) {
    throw invalidDescription("empty output")
  }

  if (containsMarkdownOutput(withoutWrappingQuotes)) {
    throw invalidDescription("markdown output is not allowed")
  }

  if (/\r|\n/.test(withoutWrappingQuotes)) {
    throw invalidDescription("description must be a single line")
  }

  if (wordCount(withoutWrappingQuotes) >= DESCRIPTION_WORD_LIMIT) {
    throw invalidDescription("description must be under 10 words")
  }

  if (containsPromptInjectionLeakage(withoutWrappingQuotes)) {
    throw invalidDescription("prompt-injection leakage detected")
  }

  if (containsInstructionLikePromptLeakage(withoutWrappingQuotes)) {
    throw invalidDescription("instruction-like prompt leakage detected")
  }

  if (containsProviderRefusalOrError(withoutWrappingQuotes)) {
    throw invalidDescription("provider error or refusal output detected")
  }

  if (!isExactlyOneSentence(withoutWrappingQuotes)) {
    throw invalidDescription("description must be exactly one short sentence")
  }

  return withoutWrappingQuotes
}
