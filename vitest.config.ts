import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@lordierclaw/bluenote-core/search/contains-match": new URL("./src/search/contains-match.ts", import.meta.url).pathname,
      "@lordierclaw/bluenote-core/api/daemon-contract": new URL("./src/api/daemon-contract.ts", import.meta.url).pathname,
      "@lordierclaw/bluenote-core": new URL("./src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    globals: false,
    setupFiles: ["./tests/setup.ts"],
  },
})
