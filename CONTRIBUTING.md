# Contributing

BlueNote core is a headless Node.js library for local-first Markdown notes.

## Requirements

- Node.js 18 or newer
- npm

## Setup

```sh
npm install
```

## Verification

Run the full local check before opening a pull request:

```sh
npm run check
```

For package-specific smoke checks:

```sh
npm run build
node scripts/smoke-node-runtime.mjs
npm pack --dry-run
```

## Scope guard

Keep this repository focused on the headless core package. Do not add terminal UI, OpenTUI rendering, client-only workflows, or cloud requirements here.

Do not redesign note format, storage layout, search semantics, AI behavior, or public runtime API without an approved plan. Prefer small changes that preserve existing local/offline behavior and package boundaries.

## Privacy

Do not include private note content, API keys, access tokens, or other secrets in tests, fixtures, logs, issues, or pull requests.
