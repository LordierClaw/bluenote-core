# @lordierclaw/bluenote-core

Headless BlueNote core for local-first Markdown notes. This package owns storage, note business logic, search/indexing, configuration, domain helpers, and AI support code used by BlueNote clients.

## Role in BlueNote

This repo owns:

- note model and storage layout
- plain Markdown note files plus sidecar metadata
- search/index semantics
- AI configuration, queue, provider, prompt, and description-generation services
- public core APIs consumed by distribution and client packages

It intentionally does not include terminal UI, browser UI, OpenTUI rendering, CLI presentation, editor integration, clipboard integration, or distribution command routing.

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
- Core workflows are local-first and do not require accounts, sync services, hosted backends, or cloud storage.
- Optional AI provider calls are explicit/queued by clients and should not block normal local note workflows.

## Related packages

- `@lordierclaw/bluenote`: official distribution CLI and top-level app command.
- `@lordierclaw/bluenote-webui`: local browser UI client.
- `@lordierclaw/bluenote-term`: terminal/TUI client.

Additional docs:

- [Product overview](docs/product/overview.md)
- [Runtime and dependencies](docs/architecture/runtime-and-dependencies.md)
- [Package workflow](docs/workflow/package.md)
