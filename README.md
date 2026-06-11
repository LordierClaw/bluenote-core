# @lordierclaw/bluenote-core

Headless BlueNote core for local-first Markdown notes. This package contains storage, note business logic, search/indexing, configuration, domain helpers, and AI support code used by BlueNote.

It intentionally does **not** include terminal UI, OpenTUI rendering, CLI entrypoints, editor integration, clipboard integration, server, sync, or other terminal-client behavior.

## Install

```sh
npm install @lordierclaw/bluenote-core
```

Until the package is published to npm, consume a local checkout after building it:

```json
{
  "dependencies": {
    "@lordierclaw/bluenote-core": "file:../bluenote-core"
  }
}
```

```sh
cd ../bluenote-core
npm install
npm run build
```

The repository does not track generated `dist/` artifacts, so direct GitHub branch/tag dependencies are not the recommended consumption path unless that tag intentionally includes built output.

## Usage

Import only the package root:

```ts
import { createBlueNoteCore, createNote, searchNotes } from "@lordierclaw/bluenote-core"
```

Do not import `src/*`, `dist/*`, or other private paths. The package exports only `.`.

## Requirements

- Node.js 16.14 or newer
- npm

## Commands

```sh
npm install
npm run typecheck
npm run build
npm test
npm run check
```

`npm run build` uses Node.js and TypeScript to emit runnable ESM JavaScript and TypeScript declarations to `dist/`. `npm test` rebuilds first, then runs the TypeScript test suite with Vitest so child-process tests never use stale generated output. `npm run check` runs typecheck, tests, and package import smoke verification. The generated `dist/` directory is included in npm packages and should be refreshed whenever source changes are intentionally shipped with built output.

## Documentation

The docs folder follows the same top-level organization as BlueNote terminal docs:

- [Product overview](docs/product/overview.md)
- [Runtime and dependencies](docs/architecture/runtime-and-dependencies.md)
- [Phase 8 core Node 16.14 compatibility](docs/phases/phase-8-core-node-16-14-compat.md)
- [Node 16.14 compatibility plan](docs/plans/2026-06-11-node-16-14-compat.md)
- [Package workflow](docs/workflow/package.md)

## Scope and compatibility

This repository preserves the existing public API, storage layout, note file format, search semantics, and AI behavior from the extracted BlueNote core package. It is a standalone library repository, not a redesign of BlueNote and not a UI/client package.

For contribution guidance, see [CONTRIBUTING.md](./CONTRIBUTING.md).
