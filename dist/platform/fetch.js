import fetchImpl from "node-fetch";
export function getDefaultFetch() {
    return globalThis.fetch ?? fetchImpl;
}
//# sourceMappingURL=fetch.js.map