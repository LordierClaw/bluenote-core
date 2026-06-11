# Phase 8 Core Node 16.14 Compatibility

This phase keeps `@lordierclaw/bluenote-core` usable in restricted Node.js environments while preserving the headless package boundary consumed by BlueNote clients.

## Scope

- Support Node.js `16.14` or newer through package metadata, CI, and runtime-compatible dependencies.
- Keep the public API, storage layout, note file format, search semantics, and AI behavior stable.
- Keep terminal UI, CLI routing, OpenTUI rendering, editor launch, and clipboard behavior out of this repository.
- Keep generated package output refreshed when a branch intentionally supports direct package consumption before an npm publish.

## Verification

The public gate remains:

```bash
npm run check
```

Use `npm pack --dry-run` when validating package contents for a release or consumer handoff.
