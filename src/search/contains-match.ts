export type ContainsMatchField =
  | "key"
  | "filename"
  | "title"
  | "description"
  | "path"
  | "body"
  | "command"

export interface ContainsMatchCandidate {
  field: ContainsMatchField
  value: string
  weight?: number
}

export interface ContainsFieldMatch {
  field: ContainsMatchField
  score: number
}

type MatchKind = "exact" | "prefix" | "substring" | "token"

const EXACT_MATCH_BASE_SCORE = 120
const PREFIX_MATCH_BASE_SCORE = 100
const SUBSTRING_MATCH_BASE_SCORE = 80

export function normalizeSearchQuery(query: string): string {
  return query.trim().toLocaleLowerCase().replace(/\s+/g, " ")
}

export function containsSearchQuery(value: string, query: string): boolean {
  const normalizedValue = normalizeSearchQuery(value)
  const normalizedQuery = normalizeSearchQuery(query)

  if (normalizedValue.length === 0 || normalizedQuery.length === 0) {
    return false
  }

  return getContainsMatchKind(normalizedValue, normalizedQuery) !== null
}

export function scoreContainsMatch(value: string, query: string, weight = 1): number {
  const normalizedValue = normalizeSearchQuery(value)
  const normalizedQuery = normalizeSearchQuery(query)

  if (normalizedValue.length === 0 || normalizedQuery.length === 0) {
    return 0
  }

  const matchKind = getContainsMatchKind(normalizedValue, normalizedQuery)
  if (matchKind === null) {
    return 0
  }

  const baseScore = getBaseScore(matchKind)
  const ratioBonus = getRatioBonus(normalizedValue, normalizedQuery)
  const safeWeight = Number.isFinite(weight) && weight > 0 ? weight : 1

  return Math.round((baseScore + ratioBonus) * safeWeight)
}

export function collectContainsFieldMatches(
  query: string,
  candidates: readonly ContainsMatchCandidate[],
): ContainsFieldMatch[] {
  const matches: ContainsFieldMatch[] = []

  for (const candidate of candidates) {
    const score = scoreContainsMatch(candidate.value, query, candidate.weight)
    if (score > 0) {
      matches.push({ field: candidate.field, score })
    }
  }

  return matches
}

function getContainsMatchKind(normalizedValue: string, normalizedQuery: string): MatchKind | null {
  if (normalizedValue === normalizedQuery) {
    return "exact"
  }

  if (normalizedValue.startsWith(normalizedQuery)) {
    return "prefix"
  }

  if (normalizedValue.includes(normalizedQuery)) {
    return "substring"
  }

  if (hasContiguousTokenMatch(normalizedValue, normalizedQuery)) {
    return "token"
  }

  return null
}

function getBaseScore(matchKind: MatchKind): number {
  if (matchKind === "exact") {
    return EXACT_MATCH_BASE_SCORE
  }

  if (matchKind === "prefix") {
    return PREFIX_MATCH_BASE_SCORE
  }

  return SUBSTRING_MATCH_BASE_SCORE
}

function getRatioBonus(normalizedValue: string, normalizedQuery: string): number {
  return Math.min(10, Math.round((normalizedQuery.length / normalizedValue.length) * 10))
}

function hasContiguousTokenMatch(normalizedValue: string, normalizedQuery: string): boolean {
  const queryTokens = tokenize(normalizedQuery)
  if (queryTokens.length < 2) {
    return false
  }

  const valueTokens = tokenize(normalizedValue)
  if (queryTokens.length > valueTokens.length) {
    return false
  }

  for (let index = 0; index <= valueTokens.length - queryTokens.length; index += 1) {
    const windowMatches = queryTokens.every(
      (queryToken, tokenIndex) => valueTokens[index + tokenIndex] === queryToken,
    )

    if (windowMatches) {
      return true
    }
  }

  return false
}

function tokenize(value: string): string[] {
  return value.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 0)
}
