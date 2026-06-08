export interface ShortNoteSuffixOptions {
  suffixLength?: number
  randomSource?: () => number
}

export interface CreateNoteKeyOptions extends ShortNoteSuffixOptions {
  isUnique?: (candidate: string) => boolean
  onCollision?: (candidate: string, attempt: number) => void
  maxAttempts?: number
}

export interface CreateDraftNoteKeyOptions extends ShortNoteSuffixOptions {
  isUnique?: (candidate: string) => boolean
  onCollision?: (candidate: string, attempt: number) => void
  maxAttempts?: number
}

const DEFAULT_SUFFIX_LENGTH = 6
const DEFAULT_MAX_ATTEMPTS = 10
const UNTITLED_SLUG = "untitled"

function defaultRandomSource(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
}

export function slugifyNoteTitle(title: string): string {
  const normalized = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return normalized || UNTITLED_SLUG
}

export function createShortNoteSuffix(options: ShortNoteSuffixOptions = {}): string {
  const suffixLength = options.suffixLength ?? DEFAULT_SUFFIX_LENGTH
  const randomSource = options.randomSource ?? defaultRandomSource
  const token = Math.abs(randomSource() >>> 0)
    .toString(36)
    .padStart(suffixLength, "0")

  return token.slice(-suffixLength)
}

export function createNoteKey(title: string, options: CreateNoteKeyOptions = {}): string {
  const slug = slugifyNoteTitle(title)
  const isUnique = options.isUnique ?? (() => true)
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const suffix = createShortNoteSuffix(options)
    const candidate = `${slug}-${suffix}`

    if (isUnique(candidate)) {
      return candidate
    }

    options.onCollision?.(candidate, attempt)
  }

  throw new Error(`Unable to generate a unique note key for \"${title}\" after ${maxAttempts} attempts.`)
}

export function createDraftNoteKey(options: CreateDraftNoteKeyOptions = {}): string {
  const isUnique = options.isUnique ?? (() => true)
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidate = `draft-${createShortNoteSuffix(options)}`

    if (isUnique(candidate)) {
      return candidate
    }

    options.onCollision?.(candidate, attempt)
  }

  throw new Error(`Unable to generate a unique draft note key after ${maxAttempts} attempts.`)
}
