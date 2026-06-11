import fetchImpl from "node-fetch"

export type FetchLike = typeof fetch

export function getDefaultFetch(): FetchLike {
  return globalThis.fetch ?? (fetchImpl as unknown as FetchLike)
}
