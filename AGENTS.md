# bluenote-core Agent Guide

## Role

`bluenote-core` is the headless BlueNote engine/library.

## Owns

- note model and domain semantics
- managed root/storage layout and sidecar metadata
- search and indexing semantics
- AI config, prompts, queue, provider, and description semantics
- public core APIs exported by `@lordierclaw/bluenote-core`

## Does not own

- terminal layout, keybindings, or OpenTUI behavior
- browser UI, local web server, or setup flow
- distribution CLI command routing/help/version/doctor
- sync/server/cloud features unless approved by a cross-repo design

## Runtime compatibility

Must remain compatible with Node `>=16.14 <17 || >=18` and npm.

## Public API/export rules

- Export public APIs through package exports only.
- Do not require consumers to import `src/*`, `dist/*`, tests, or private paths.
- Preserve note file format, storage layout, search semantics, and AI behavior unless an approved task explicitly changes them.

## Dependency rules

- Must not import `bluenote-term`, `bluenote-webui`, or `bluenote`.
- Must not import OpenTUI.
- Must not contain UI behavior.

## Read first

1. Parent `.agent/CURRENT_TASK.md` when working from the parent workspace.
2. Parent `AGENTS.md`.
3. `../bluenote/AGENTS.md` and `../bluenote/docs/*` for cross-repo rules.
4. This file.
5. `README.md`, `CONTRIBUTING.md`, and relevant `docs/*`.

Older phase docs are historical unless the active task references them.

## Common tasks

- Core API/storage/search/AI change: edit this repo.
- Terminal UX/keybinding change: edit `bluenote-term`, not this repo.
- Browser UI/server setup change: edit `bluenote-webui`, not this repo.
- Distribution command routing: edit `bluenote`, not this repo.

## Checks

- Docs-only: `git status` plus file inspection.
- Runtime/API changes: `npm run check`.
- Package boundary changes: also inspect `exports` and run package smoke checks where practical.

## Documentation update rule

Update README/docs when public APIs, runtime compatibility, storage/search/AI contracts, or package consumption instructions change. Do not overwrite historical phase/migration docs.
