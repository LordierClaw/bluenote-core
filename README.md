# @lordierclaw/bluenote-core

Headless BlueNote core package extracted from BlueNote Term. This package contains the storage, note business logic, search/indexing, configuration, domain helpers, and AI support code used by BlueNote.

It intentionally does **not** include the terminal UI, OpenTUI rendering, CLI entrypoints, editor integration, clipboard integration, or other terminal-client behavior.

## Install / consume

During Phase 8.2 extraction, recommended dependency strategies are:

```json
{
  "dependencies": {
    "@lordierclaw/bluenote-core": "file:../bluenote-core"
  }
}
```

or from a tagged GitHub release:

```json
{
  "dependencies": {
    "@lordierclaw/bluenote-core": "github:lordierclaw/bluenote-core#v0.1.0"
  }
}
```

Future npm consumers should use the published semver range:

```json
{
  "dependencies": {
    "@lordierclaw/bluenote-core": "^0.1.0"
  }
}
```

Import only the package root:

```ts
import { createBlueNoteCore, createNote, searchNotes } from "@lordierclaw/bluenote-core"
```

Never import `src/*`, `dist/*`, or other private paths. The package exports only `.`.

## Commands

```sh
bun install
bun run typecheck
bun run build
bun test
```

`bun run build` emits runnable ESM JavaScript and TypeScript declarations to `dist/`.

## Scope

This repository is an extraction scaffold for BlueNote core. It preserves the existing public API, storage layout, note format, search semantics, and AI behavior from the source core package; it is not a redesign.
