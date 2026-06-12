# Runtime and Dependencies

## Runtime rules

- Support Node.js `16.14` or newer in the published package, while keeping modern Node.js compatibility for active development.
- Use npm as the package manager for this repository; `.npmrc` keeps exact dependency versions for reproducible installs.
- Emit runnable ESM JavaScript and TypeScript declarations into ignored `dist/` output through `npm run build`.
- Keep general core APIs at the package root (`@lordierclaw/bluenote-core`). Public subpath exports are allowed only for documented lightweight helpers/contracts such as `@lordierclaw/bluenote-core/search/contains-match` and `@lordierclaw/bluenote-core/api/daemon-contract`. Do not rely on `src/*` or `dist/*` private paths from consumers.
- Avoid native SQLite dependencies; use `sql.js` for rebuildable cache metadata.
- Keep core headless. Terminal/client packages own command routing, OpenTUI rendering, editor launch, clipboard bridges, and user interaction.

## Current baseline dependencies

- `js-yaml` — legacy frontmatter parsing support for migration/compatibility paths; current note files remain plain Markdown plus sidecars.
- `minisearch` — rebuildable text index support.
- `sql.js` — rebuildable metadata cache engine.
- `node-fetch` — Node 16-compatible fetch implementation for provider clients that need HTTP.
- `typescript` / `@types/node` — strict project typing.
- `vitest` — TypeScript test runner.
- `tsx` — TypeScript execution helper used by Vitest and development-time test transforms.

## Validation expectations

The combined public gate is:

```bash
npm run check
```

It runs typecheck, builds the package as part of `npm test`, runs the Vitest suite against freshly built output where child processes need package JavaScript, and verifies the built package can be imported by the supported Node runtime. Use targeted commands while developing:

```bash
npm run typecheck
npm run build
npm test
node scripts/smoke-node-runtime.mjs
npm pack --dry-run
```

Child-process tests that verify concurrency or locking behavior use freshly built `dist/` output. Keep `npm test` building first so those child processes cannot exercise stale generated JavaScript after source changes.
