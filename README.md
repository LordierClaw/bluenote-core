# @lordierclaw/bluenote-core

Headless BlueNote core for local-first Markdown notes. This package contains the storage, note business logic, search/indexing, configuration, domain helpers, and AI support code used by BlueNote.

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

- Runtime: Node.js 18 or newer
- Development/test runner: Bun

## Commands

```sh
bun install
npm run typecheck
npm run build
npm run test
npm run check
```

`npm run build` uses Node.js and TypeScript to emit runnable ESM JavaScript and TypeScript declarations to `dist/`. Tests currently use Bun as the development test runner. The generated `dist/` directory is included in npm packages but is not tracked in git.

## Scope and compatibility

This repository preserves the existing public API, storage layout, note file format, search semantics, and AI behavior from the extracted BlueNote core package. It is a standalone library repository, not a redesign of BlueNote and not a UI/client package.
