import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@lordierclaw/bluenote-core": new URL("./src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    globals: false,
    setupFiles: ["./tests/setup.ts"],
  },
})
