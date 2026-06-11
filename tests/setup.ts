import fetchImpl, { Headers, Request, Response } from "node-fetch"

if (!globalThis.Headers) {
  globalThis.Headers = Headers as unknown as typeof globalThis.Headers
}

if (!globalThis.Request) {
  globalThis.Request = Request as unknown as typeof globalThis.Request
}

if (!globalThis.Response) {
  globalThis.Response = Response as unknown as typeof globalThis.Response
}

if (!globalThis.fetch) {
  globalThis.fetch = fetchImpl as unknown as typeof globalThis.fetch
}
