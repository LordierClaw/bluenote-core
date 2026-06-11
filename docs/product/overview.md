# BlueNote Core Product Overview

`@lordierclaw/bluenote-core` is the headless BlueNote library for local-first Markdown notes. It owns storage, note business logic, search/indexing, configuration, domain helpers, and reusable AI services shared by BlueNote clients.

## Product principles

- **Headless core only:** this package does not own terminal UI, OpenTUI rendering, CLI entrypoints, editor launch, clipboard integration, servers, sync, or hosted services.
- **File-first:** normal notes are ordinary Markdown files without required frontmatter; BlueNote-managed metadata lives in sidecar JSON under `.data/notes/`.
- **Local-first and offline-first:** core note workflows must work without accounts, sync services, hosted backends, or network access.
- **Rebuildable state:** metadata and search artifacts under `.data/` are derived from note files and sidecars and should remain rebuildable.
- **Opt-in AI:** AI helpers are inert until a caller explicitly configures and invokes a provider-backed workflow.

## Current delivered scope

Current public behavior includes:

- managed-root initialization and layout helpers
- plain Markdown normal notes under `note/` and drafts under `draft/`
- canonical metadata sidecars under `.data/notes/`
- rebuildable metadata/search artifacts at `.data/metadata.sqlite` and `.data/search-index.json`
- note creation, listing, showing, searching, moving, renaming, archiving, deletion, draft promotion, and index rebuild services
- selector, note-key, path-safety, and description validation helpers
- contains-style search over keys, paths, titles, descriptions, and note bodies
- opt-in AI description support, provider configuration, prompt storage, queue persistence, sanitized failure metadata, usage logging, and Codex/OpenAI-compatible provider clients
- a public package-root API consumed by BlueNote client packages

## Storage and search contract

Normal note bodies remain plain Markdown under `note/`, drafts remain plain Markdown under `draft/`, and archived note bodies move to hidden `.data/archive/` storage. BlueNote metadata sidecars are stored under `.data/notes/`. Derived metadata/search artifacts are rebuildable under `.data/` as `.data/metadata.sqlite` and `.data/search-index.json`.

Search uses contains-style matching rather than fuzzy subsequence matching. For example, `123` matches `Receipt 123`, `meeting-123.md`, or body text containing `123`, but it does not match notes without an actual `123` substring in a searchable field or content.

## AI model

Core exposes AI provider, description, queue, prompt, config, auth, and usage-log building blocks for callers. Normal note creation, mutation, save, and indexing paths must not wait on provider network calls; caller-owned UI/CLI layers decide when to enqueue and process AI jobs.

AI requires explicit provider configuration before network-backed description generation. OpenAI-compatible API-key providers remain supported. Codex provider support uses root-local auth state managed by callers through explicit auth flows; core must not start Codex login automatically.

## Still out of scope

- terminal UI, OpenTUI rendering, terminal input, editor launch, and clipboard UX
- hosted backends, cloud sync, cloud login, or subscription flows
- standalone AI daemons/autostart provider processing outside a caller-owned workflow
- embedding BlueNote metadata into note frontmatter as the canonical format
- mobile, desktop, or web clients
