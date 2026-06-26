# Runtime and Dependencies

## Runtime rules

- Support Node.js `16.14` or newer in the published package, while keeping modern Node.js compatibility for active development.
- Use npm as the package manager for this repository; `.npmrc` keeps exact dependency versions for reproducible installs.
- Emit runnable ESM JavaScript and TypeScript declarations into ignored `dist/` output through `npm run build`.
- Keep general core APIs at the package root (`@lordierclaw/bluenote-core`). Public subpath exports are allowed only for documented lightweight helpers/contracts such as `@lordierclaw/bluenote-core/search/contains-match` and `@lordierclaw/bluenote-core/api/daemon-contract`. Do not rely on `src/*` or `dist/*` private paths from consumers.
- Avoid native SQLite dependencies; use `sql.js` for rebuildable cache metadata.
- Keep core headless. Terminal/client packages own command routing, OpenTUI rendering, editor launch, clipboard bridges, and user interaction.
- Keep sync primitives headless. Core may expose runtime mode, protocol, repository, client/server service, transport, logging, and repair building blocks, but hosted auth/security, TLS, daemon lifecycle, and `bluenote sync ...` command UX belong outside this package.

## Sync runtime boundaries

- Standalone remains the default runtime mode. Callers must explicitly link a root before sync-client behavior runs.
- New managed roots use schema 3 state with workspace identity plus note-ID sidecars; note bodies remain plain Markdown.
- Core sync uses local `.data/sync/` state for runtime mode, `sync.sqlite`, redacted JSONL logs, dirty records, tombstones, folders, replicas, and status.
- The package root exports sync primitives for clients and the distribution package. Consumers must not import `src/sync/*` or `dist/sync/*` private paths.
- The v1 core layer does not provide daemon auth/TLS, hosted user accounts, gateway authorization, or command routing. Those are follow-up responsibilities for distribution/gateway/client plans.

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
