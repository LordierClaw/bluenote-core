# @lordierclaw/bluenote-core

Headless BlueNote core for local-first Markdown notes. This package owns storage, note business logic, search/indexing, configuration, domain helpers, and AI support code used by BlueNote clients.

## Role in BlueNote

This repo owns:

- note model and storage layout
- plain Markdown note files plus sidecar metadata
- search/index semantics
- AI configuration, queue, provider, prompt, and description-generation services
- schema 3 workspace identity and local sync state primitives
- public core APIs consumed by distribution and client packages

It intentionally does not include terminal UI, browser UI, OpenTUI rendering, CLI presentation, editor integration, clipboard integration, distribution command routing, hosted auth/security, or daemon lifecycle UX.

## Install

Most users should install the BlueNote app entrypoint and optional clients instead of installing core directly:

```sh
npm install -g @lordierclaw/bluenote
npm install -g @lordierclaw/bluenote-webui   # optional browser UI
npm install -g @lordierclaw/bluenote-term    # optional terminal UI
bluenote doctor
```

The distribution README is the canonical guide for full app install, uninstall, PATH setup, and optional client verification.

Install core directly only when building a client, distribution package, or library integration:

```sh
npm install @lordierclaw/bluenote-core
```

## Local development

For sibling source checkout development, build/check core before clients or the distribution CLI:

```sh
cd ../bluenote-core
npm ci --include=dev
npm run check
```

Sibling packages should consume core through public package exports only:

```ts
import { createBlueNoteCore, createNote, searchNotes } from "@lordierclaw/bluenote-core"
```

Do not import `src/*`, `dist/*`, tests, or other private paths. Supported public entrypoints are the package root, `./search/contains-match`, `./api/daemon-contract`, and `./package.json`.

## Sync primitives

Core remains local-first: standalone remains the default runtime mode for new and existing managed roots. New workspaces initialize with schema 3 metadata, including a stable workspace identity and immutable note IDs stored in sidecar metadata under `.data/notes/`.

The package root exposes core sync APIs for clients and the distribution package:

```ts
const core = createBlueNoteCore({ rootPath })

core.sync.status()
core.sync.link({ mode: "seed-empty-server-from-local", serverUrl, workspaceId })
core.sync.now({ transport })
core.sync.repair()
core.sync.unlink()
```

These sync APIs are core primitives, not full hosted auth/security. They provide local runtime mode, dirty/tombstone/status repositories, whole-note client/server protocol helpers, in-process/HTTP transport adapters, structured redacted sync logs, and non-mutating repair dry-run reports. Daemon auth/TLS are out of scope for v1 core sync; a future gateway or distribution daemon plan owns authentication, TLS, users, and server lifecycle hardening.

The distribution CLI owns `bluenote sync ...` UX in a follow-up repo plan. Client packages should call the package-root APIs above rather than importing private sync modules directly.

## Scripts

```sh
npm install
npm run typecheck
npm run build
npm test
npm run check
```

`npm test` rebuilds first, then runs the TypeScript test suite with Vitest so child-process tests do not use stale generated output. `npm run check` runs typecheck, tests, and package import smoke verification.

## Packaging and versions

The package name is `@lordierclaw/bluenote-core`.

Maintainer release flow: publish a GitHub Release for the matching `v*` tag. The release workflow verifies the package first and only then publishes to npm.

When testing unpublished core changes before an npm release is available, app/client repositories can temporarily consume a pinned immutable Git commit that includes built output:

```json
{
  "dependencies": {
    "@lordierclaw/bluenote-core": "git+https://github.com/LordierClaw/bluenote-core.git#<pinned-commit-sha>"
  }
}
```

For active local core development, temporarily consume a sibling checkout after building it:

```json
{
  "dependencies": {
    "@lordierclaw/bluenote-core": "file:../bluenote-core"
  }
}
```

Release-like Git dependencies must be pinned to immutable commits or tags and include built output. Do not use moving branch dependencies such as `#main` for release-like installs.

## Cross-platform notes

- Runtime target: Node.js `>=16.14 <17 || >=18`.
- Package tooling uses npm and TypeScript.
- Core workflows are local-first and standalone by default; sync-client behavior is opt-in through caller-owned APIs and transport configuration.
- Optional AI provider calls are explicit/queued by clients and should not block normal local note workflows.

## Related packages

- `@lordierclaw/bluenote`: official distribution CLI and top-level app command.
- `@lordierclaw/bluenote-webui`: local browser UI client.
- `@lordierclaw/bluenote-term`: terminal/TUI client.

Additional docs:

- [Product overview](docs/product/overview.md)
- [Runtime and dependencies](docs/architecture/runtime-and-dependencies.md)
- [Package workflow](docs/workflow/package.md)
