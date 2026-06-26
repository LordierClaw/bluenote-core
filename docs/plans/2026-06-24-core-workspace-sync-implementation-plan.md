# Core Workspace Sync Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Implement the approved schema 3 workspace identity and minimal end-to-end core sync foundation for `@lordierclaw/bluenote-core`, while preserving standalone defaults and Node `>=16.14 <17 || >=18` compatibility.

**Architecture:** Build from storage invariants upward: schema 3 manifest + immutable note IDs, sync DB repository, dirty/tombstone/folder tracking, then a `createBlueNoteCore().sync` API that can run pull-then-push cycles against a local HTTP JSON adapter. Keep daemon/server and distribution CLI wiring for follow-up repo-specific plans after the core API exists.

**Tech Stack:** TypeScript ESM, npm, Vitest, `sql.js`, Node 16-compatible APIs only.

---

## Scope and guardrails

### In scope for this implementation plan

- `bluenote-core` only.
- Schema 3 default for newly initialized workspaces.
- Root-local `workspaceId` in `.data/manifest.json`.
- Immutable `noteId` in schema 3 sidecars.
- `.data/notes/<noteId>.json` sidecar paths for schema 3.
- Existing schema 2 compatibility for old workspaces.
- `.data/sync/sync.sqlite` repository and schema creation.
- Dirty/tombstone/folder/status primitives.
- Core sync namespace under `createBlueNoteCore().sync`.
- Minimal server/client sync services using whole-note metadata + separate body transfer abstractions.
- Log redaction helpers and structured sync log writer under `.data/sync/logs/`.
- Core-only tests and README/docs updates for public API/storage behavior.

### Out of scope for this plan

- Distribution CLI command routing in `/root/code/bluenote`.
- TUI/WebUI sync UX.
- Production daemon process manager/server lifecycle in `/root/code/bluenote`.
- Auth/TLS/gateway behavior.
- Existing schema 2 in-place migration.
- Binary attachments/assets.
- Conflict copies or visible conflict-note UX.
- Server push/WebSocket/SSE notification.

### Required checks

Run at the end of every committed task unless the task is docs-only:

```sh
npm run typecheck
npm test -- --runInBand
```

If Vitest rejects `--runInBand` in this version, use:

```sh
npm test
```

Final gate:

```sh
npm run check
```

### Commit cadence

Commit after each task. Commit messages should be small and scoped, e.g. `feat: add schema 3 workspace ids`.

---

## Task 1: Add schema 3 workspace identity to the state manifest

**Objective:** Make newly initialized roots write schema version 3 with a root-local immutable `workspaceId`.

**Files:**

- Modify: `src/config/root.ts`
- Modify: `src/storage/state-manifest.ts`
- Modify: `tests/unit/storage/state-manifest.test.ts`
- Modify: `tests/unit/core/public-api.test.ts` if public exports expectations need updating

**Step 1: Write failing tests**

In `tests/unit/storage/state-manifest.test.ts`:

- Update `createDefaultStateManifest returns the current storage schema version` to expect `{ schemaVersion: 3, workspaceId: <string> }`.
- Add a deterministic test for injected ID generation if the helper supports an override, e.g. `createDefaultStateManifest({ createWorkspaceId: () => "workspace_test" })`.
- Add a read test proving schema 2 manifests without `workspaceId` still read successfully as legacy standalone manifests.
- Add a read test proving schema 3 manifests require string `workspaceId`.

**Step 2: Verify RED**

Run:

```sh
npx vitest run tests/unit/storage/state-manifest.test.ts
```

Expected: failures because `STORAGE_SCHEMA_VERSION` is still `2` and `workspaceId` is not present/validated.

**Step 3: Implement minimal code**

- Change `STORAGE_SCHEMA_VERSION` from `2` to `3` in `src/config/root.ts`.
- Extend `StateManifest`:

```ts
export interface StateManifest {
  schemaVersion: number
  workspaceId?: string
}
```

- Add a `createWorkspaceId()` helper using existing ID conventions where available. Prefer `src/platform/ids.ts`; if unsuitable, add a small Node 16-compatible helper there.
- Make `createDefaultStateManifest()` return schema 3 plus `workspaceId`.
- Validate:
  - schema 2: `workspaceId` optional
  - schema 3+: `workspaceId` required non-empty string

**Step 4: Verify GREEN**

Run:

```sh
npx vitest run tests/unit/storage/state-manifest.test.ts
npm run typecheck
```

**Step 5: Commit**

```sh
git add src/config/root.ts src/storage/state-manifest.ts tests/unit/storage/state-manifest.test.ts
git commit -m "feat: add schema 3 workspace identity"
```

---

## Task 2: Add note ID support to sidecar validation

**Objective:** Allow legacy schema 2 sidecars to remain readable while requiring `noteId` for schema 3 sidecars.

**Files:**

- Modify: `src/storage/sidecar-schema.ts`
- Modify: `src/storage/sidecar-repository.ts`
- Modify: `tests/unit/storage/sidecar-schema.test.ts`
- Modify: `tests/unit/storage/sidecar-repository.test.ts`
- Modify: `tests/helpers/note-fixtures.ts`

**Step 1: Write failing tests**

Add tests that prove:

- schema 3 sidecars with `noteId` validate and preserve `noteId`.
- schema 3 sidecars missing `noteId` throw `InvalidFrontmatterError`.
- legacy sidecars without `noteId` can still validate when read in schema 2 compatibility mode.
- sidecar write validation reports paths with `noteId` when `noteId` exists.

**Step 2: Verify RED**

Run:

```sh
npx vitest run tests/unit/storage/sidecar-schema.test.ts tests/unit/storage/sidecar-repository.test.ts
```

Expected: failures because `noteId` is not accepted/required yet.

**Step 3: Implement minimal code**

- Extend `NoteSidecar` with `noteId?: string` initially to preserve compile compatibility.
- Add a validation mode/options object, for example:

```ts
export interface ValidateNoteSidecarOptions {
  requireNoteId?: boolean
}
```

- Require non-empty string `noteId` when `requireNoteId` is true.
- Accept and return `noteId` when present.
- Keep unknown-field rejection strict by adding `noteId` to the known fields list.
- Extend fixture `sidecarJson()` with optional `noteId`.

**Step 4: Verify GREEN**

Run:

```sh
npx vitest run tests/unit/storage/sidecar-schema.test.ts tests/unit/storage/sidecar-repository.test.ts
npm run typecheck
```

**Step 5: Commit**

```sh
git add src/storage/sidecar-schema.ts src/storage/sidecar-repository.ts tests/unit/storage/sidecar-schema.test.ts tests/unit/storage/sidecar-repository.test.ts tests/helpers/note-fixtures.ts
git commit -m "feat: validate schema 3 note ids"
```

---

## Task 3: Key schema 3 sidecar paths by note ID

**Objective:** Store schema 3 sidecar JSON under `.data/notes/<noteId>.json` while preserving schema 2 key-based sidecar access.

**Files:**

- Modify: `src/storage/sidecar-repository.ts`
- Modify: `src/storage/state-manifest.ts` if helper access is needed
- Modify: `tests/unit/storage/sidecar-repository.test.ts`

**Step 1: Write failing tests**

Add tests proving:

- writing a sidecar with `noteId: "note_abc"` writes `.data/notes/note_abc.json` even when `key` is `human-title`.
- reading by ID returns that sidecar.
- existing `read(key)` remains available for schema 2 callers.
- path traversal is rejected for both key and note ID.

**Step 2: Verify RED**

Run:

```sh
npx vitest run tests/unit/storage/sidecar-repository.test.ts
```

Expected: schema 3 path tests fail because repository still writes by key.

**Step 3: Implement minimal code**

- Extend `SidecarRepository` with explicit methods rather than changing call-site meaning silently:

```ts
getSidecarPath(keyOrNoteId: string): string
getSidecarPathByNoteId(noteId: string): string
read(key: string): NoteSidecar
readByNoteId(noteId: string): NoteSidecar
write(sidecar: NoteSidecar): string
```

- Make `write()` choose `noteId` path when `sidecar.noteId` exists; otherwise use `key`.
- Keep `read(key)` as key-based legacy read.
- Add `readByNoteId()` for schema 3.

**Step 4: Verify GREEN**

Run:

```sh
npx vitest run tests/unit/storage/sidecar-repository.test.ts
npm run typecheck
```

**Step 5: Commit**

```sh
git add src/storage/sidecar-repository.ts tests/unit/storage/sidecar-repository.test.ts
git commit -m "feat: store schema 3 sidecars by note id"
```

---

## Task 4: Generate note IDs during note creation

**Objective:** New schema 3 notes get immutable `noteId`s and sidecars are written by note ID.

**Files:**

- Modify: `src/core/create-note.ts`
- Modify: `src/platform/ids.ts`
- Modify: `tests/unit/core/create-note.test.ts`

**Step 1: Write failing tests**

Update/create tests proving:

- `createNote()` in a newly initialized/default schema 3 root returns `noteId` in `CreateNoteSummary`.
- sidecar JSON includes `noteId`.
- sidecar file path is `.data/notes/<noteId>.json`.
- key and Markdown path stay human-readable and unchanged.

**Step 2: Verify RED**

Run:

```sh
npx vitest run tests/unit/core/create-note.test.ts
```

Expected: failures because create summary and sidecar do not include `noteId`.

**Step 3: Implement minimal code**

- Add `noteId` to `CreateNoteSummary`.
- Generate `noteId` before repository create/write.
- Pass `noteId` into sidecar creation path. If `note-repository` owns sidecar creation internally, update it there instead of duplicating sidecar writes in `create-note.ts`.
- Keep the note file itself plain Markdown; do not add `noteId` frontmatter.

**Step 4: Verify GREEN**

Run:

```sh
npx vitest run tests/unit/core/create-note.test.ts tests/unit/storage/note-repository.test.ts
npm run typecheck
```

**Step 5: Commit**

```sh
git add src/core/create-note.ts src/platform/ids.ts src/storage/note-repository.ts tests/unit/core/create-note.test.ts tests/unit/storage/note-repository.test.ts
git commit -m "feat: assign note ids on creation"
```

---

## Task 5: Preserve note IDs across rename, move, archive, and promote

**Objective:** Ensure mutable UX operations update `key`/path/title while preserving immutable `noteId` and sidecar path.

**Files:**

- Modify: `src/core/rename-note.ts`
- Modify: `src/core/move-note.ts`
- Modify: `src/core/archive-note.ts`
- Modify: `src/core/promote-draft.ts`
- Modify: tests in `tests/unit/core/*`

**Step 1: Write failing tests**

For each operation, add a test with a schema 3 sidecar keyed by note ID proving:

- operation succeeds when sidecar file is named by `noteId`, not old `key`.
- `noteId` remains unchanged in JSON.
- sidecar path remains `.data/notes/<noteId>.json` after operation.
- `key`, `title`, `relativePath`, and `archivedAt` update according to existing behavior.

**Step 2: Verify RED**

Run:

```sh
npx vitest run tests/unit/core/rename-note.test.ts tests/unit/core/move-note.test.ts tests/unit/core/archive-note.test.ts tests/unit/core/promote-draft.test.ts
```

Expected: failures around locating/writing sidecars by key.

**Step 3: Implement minimal code**

- Trace each operation to its sidecar read/write path.
- Resolve note metadata by scanning sidecars where necessary until a key-to-noteId index exists.
- Avoid changing Markdown note content format.
- Do not add sync dirty marking yet; that is Task 8.

**Step 4: Verify GREEN**

Run:

```sh
npx vitest run tests/unit/core/rename-note.test.ts tests/unit/core/move-note.test.ts tests/unit/core/archive-note.test.ts tests/unit/core/promote-draft.test.ts
npm run typecheck
```

**Step 5: Commit**

```sh
git add src/core/rename-note.ts src/core/move-note.ts src/core/archive-note.ts src/core/promote-draft.ts tests/unit/core/rename-note.test.ts tests/unit/core/move-note.test.ts tests/unit/core/archive-note.test.ts tests/unit/core/promote-draft.test.ts
git commit -m "feat: preserve note ids across note mutations"
```

---

## Task 6: Add sync DB repository and schema bootstrap

**Objective:** Create `.data/sync/sync.sqlite` with the approved tables using `sql.js`.

**Files:**

- Create: `src/sync/sync-db.ts`
- Create: `tests/unit/sync/sync-db.test.ts`
- Modify: `src/storage/root-layout.ts`
- Modify: `src/config/root.ts`
- Modify: `src/index.ts`

**Step 1: Write failing tests**

Tests should prove:

- `ensureSyncDatabase(rootPath, { role: "client", workspaceId })` creates `.data/sync/sync.sqlite`.
- required tables exist: `sync_meta`, `replicas`, `server_changes`, `dirty_records`, `tombstones`, `folders`, `sync_status`.
- metadata includes `schemaVersion`, `workspaceId`, and `role`.
- `.data/sync/` and `.data/sync/logs/` are created by managed root setup.

**Step 2: Verify RED**

Run:

```sh
npx vitest run tests/unit/sync/sync-db.test.ts tests/unit/storage/root-layout.test.ts
```

Expected: fails because sync DB and directories do not exist.

**Step 3: Implement minimal code**

- Add constants for sync directories in `src/config/root.ts`.
- Add sync directories to `MANAGED_ROOT_LAYOUT`.
- Implement sync DB open/save helpers with `sql.js`.
- Keep the API synchronous if consistent with existing storage repositories; otherwise isolate async behavior and document it in types.

**Step 4: Verify GREEN**

Run:

```sh
npx vitest run tests/unit/sync/sync-db.test.ts tests/unit/storage/root-layout.test.ts
npm run typecheck
```

**Step 5: Commit**

```sh
git add src/config/root.ts src/storage/root-layout.ts src/sync/sync-db.ts src/index.ts tests/unit/sync/sync-db.test.ts tests/unit/storage/root-layout.test.ts
git commit -m "feat: add sync database bootstrap"
```

---

## Task 7: Add dirty, tombstone, folder, and status repositories

**Objective:** Provide low-level sync state operations before wiring them into note mutations.

**Files:**

- Create: `src/sync/dirty-repository.ts`
- Create: `src/sync/tombstone-repository.ts`
- Create: `src/sync/folder-repository.ts`
- Create: `src/sync/status-repository.ts`
- Create: tests under `tests/unit/sync/`
- Modify: `src/index.ts`

**Step 1: Write failing tests**

Cover:

- marking dirty records idempotently by `(entityType, entityId)`.
- clearing dirty records after accepted sync.
- recording tombstones for deleted notes/folders.
- storing empty folder records by relative path.
- status summary read/write with pending/running/failed counts.

**Step 2: Verify RED**

Run:

```sh
npx vitest run tests/unit/sync
```

Expected: new tests fail because repositories do not exist.

**Step 3: Implement minimal code**

Implement small repository functions against `sync-db.ts`. Keep JSON serialization centralized for metadata fields.

**Step 4: Verify GREEN**

Run:

```sh
npx vitest run tests/unit/sync
npm run typecheck
```

**Step 5: Commit**

```sh
git add src/sync tests/unit/sync src/index.ts
git commit -m "feat: add sync state repositories"
```

---

## Task 8: Auto-mark dirty records in sync-client mode

**Objective:** Core mutations mark affected notes/folders dirty only after explicit link/sync-client mode, not in standalone unlinked schema 3 workspaces.

**Files:**

- Create: `src/sync/runtime-mode.ts`
- Modify: mutation files in `src/core/`
- Modify: tests in `tests/unit/core/`
- Add sync tests as needed

**Step 1: Write failing tests**

Prove:

- standalone schema 3 `createNote()` does not create dirty records.
- sync-client mode `createNote()` marks the new note dirty.
- sync-client mode rename/move/archive/promote/delete mark relevant note/folder/tombstone state.
- local save still succeeds if dirty marking can be retried later; do not block note file writes on non-critical status logging.

**Step 2: Verify RED**

Run targeted mutation tests.

**Step 3: Implement minimal code**

- Add explicit runtime mode config/storage helper.
- Do not infer sync-client mode implicitly from schema 3.
- Wire dirty marking after successful local persistence.
- For delete, record tombstone in sync-client mode.

**Step 4: Verify GREEN**

Run:

```sh
npx vitest run tests/unit/core/create-note.test.ts tests/unit/core/delete-note.test.ts tests/unit/core/rename-note.test.ts tests/unit/core/move-note.test.ts tests/unit/core/archive-note.test.ts tests/unit/core/promote-draft.test.ts tests/unit/sync
npm run typecheck
```

**Step 5: Commit**

```sh
git add src/core src/sync tests/unit/core tests/unit/sync
git commit -m "feat: track dirty sync records for mutations"
```

---

## Task 9: Add core sync API namespace

**Objective:** Expose public sync operations under `createBlueNoteCore().sync` without implementing full HTTP transport yet.

**Files:**

- Modify: `src/index.ts`
- Create: `src/sync/types.ts`
- Create: `src/sync/core-sync.ts`
- Modify: `tests/unit/core/public-api.test.ts`
- Add: `tests/unit/sync/core-sync.test.ts`

**Step 1: Write failing tests**

Tests should assert:

- `createBlueNoteCore().sync.status()` returns unlinked/idle status for a new root.
- `sync.link({ mode: "seed-empty-server-from-local", serverUrl })` switches runtime mode and marks all existing notes/folders dirty.
- `sync.unlink()` keeps local notes and schema 3/note IDs.
- `sync.repair({ dryRun: true })` is non-mutating by default.
- public exported types are available from package root.

**Step 2: Verify RED**

Run:

```sh
npx vitest run tests/unit/core/public-api.test.ts tests/unit/sync/core-sync.test.ts
```

Expected: fails because `sync` namespace does not exist.

**Step 3: Implement minimal code**

Add `sync` object to `BlueNoteCore`:

```ts
sync: {
  status(options?: BlueNoteCoreRootOptions): SyncStatusView
  link(options: SyncLinkOptions & BlueNoteCoreRootOptions): SyncLinkSummary
  unlink(options?: BlueNoteCoreRootOptions): SyncUnlinkSummary
  now(options?: SyncNowOptions & BlueNoteCoreRootOptions): SyncNowSummary
  repair(options?: SyncRepairOptions & BlueNoteCoreRootOptions): SyncRepairSummary
}
```

For this task, `sync.now()` can return a clear `not-linked` or `transport-not-configured` status until transport services are added.

**Step 4: Verify GREEN**

Run:

```sh
npx vitest run tests/unit/core/public-api.test.ts tests/unit/sync/core-sync.test.ts
npm run typecheck
```

**Step 5: Commit**

```sh
git add src/index.ts src/sync tests/unit/core/public-api.test.ts tests/unit/sync/core-sync.test.ts
git commit -m "feat: expose core sync api namespace"
```

---

## Task 10: Add body transfer and change protocol types

**Objective:** Define protocol-level request/response types for pull, push, body upload/download, and snapshots.

**Files:**

- Create: `src/sync/protocol.ts`
- Modify: `src/index.ts`
- Add: `tests/unit/sync/protocol.test.ts`

**Step 1: Write failing tests**

Tests should validate type guards or runtime validators for:

- `PullChangesResponse`
- `SyncChangeView`
- `PushRequest`
- `PushResponse`
- snapshot-required error shape
- no body field in change-list records

**Step 2: Verify RED**

Run:

```sh
npx vitest run tests/unit/sync/protocol.test.ts
```

Expected: fails because protocol module does not exist.

**Step 3: Implement minimal code**

- Add exported interfaces from the design doc.
- Add small runtime guard helpers where tests need runtime validation.
- Ensure change-list types have body metadata only, not raw body strings.

**Step 4: Verify GREEN**

Run:

```sh
npx vitest run tests/unit/sync/protocol.test.ts
npm run typecheck
```

**Step 5: Commit**

```sh
git add src/sync/protocol.ts src/index.ts tests/unit/sync/protocol.test.ts
git commit -m "feat: define sync protocol types"
```

---

## Task 11: Add in-process sync server service

**Objective:** Implement server-side core service functions for accepting pushes, serving changes, and transferring note bodies without HTTP yet.

**Files:**

- Create: `src/sync/server-service.ts`
- Add: `tests/unit/sync/server-service.test.ts`
- Modify: sync repositories as needed

**Step 1: Write failing tests**

Use temp roots to prove:

- server accepts pushed note metadata/body and writes Markdown + sidecar.
- server appends `server_changes` rows.
- `getChanges({ since })` returns metadata without bodies.
- `downloadNoteBody(noteId)` returns body separately.
- tombstone push deletes/marks deleted and appears in changes.
- server queues AI work after accept through a stub callback, without blocking response.

**Step 2: Verify RED**

Run:

```sh
npx vitest run tests/unit/sync/server-service.test.ts
```

Expected: fails because server service does not exist.

**Step 3: Implement minimal code**

- Keep server service pure/in-process.
- Reuse existing note repository and sidecar repository.
- Record server revisions/sequences transactionally.
- Do not add HTTP in this task.

**Step 4: Verify GREEN**

Run:

```sh
npx vitest run tests/unit/sync/server-service.test.ts tests/unit/sync
npm run typecheck
```

**Step 5: Commit**

```sh
git add src/sync/server-service.ts src/sync tests/unit/sync/server-service.test.ts
git commit -m "feat: add in-process sync server service"
```

---

## Task 12: Add sync client service with pull-then-push cycle

**Objective:** Implement client-side sync cycle order and conflict behavior against an abstract transport.

**Files:**

- Create: `src/sync/client-service.ts`
- Add: `tests/unit/sync/client-service.test.ts`
- Modify: `src/sync/core-sync.ts`

**Step 1: Write failing tests**

Tests should prove:

- sync cycle calls transport pull before push.
- dirty records are pushed after pull.
- if pull sees a newer server version for a locally dirty note, local dirty state is cleared/replaced and not pushed.
- overwritten local dirty content is not preserved in recovery/conflict files.
- accepted pushes clear dirty records.

**Step 2: Verify RED**

Run:

```sh
npx vitest run tests/unit/sync/client-service.test.ts
```

Expected: fails because client service does not exist.

**Step 3: Implement minimal code**

- Define `SyncTransport` interface in core.
- Implement pull-then-push order.
- Keep transport HTTP-agnostic in this task.
- Wire `createBlueNoteCore().sync.now()` to use the service when a transport is supplied or configured.

**Step 4: Verify GREEN**

Run:

```sh
npx vitest run tests/unit/sync/client-service.test.ts tests/unit/sync/core-sync.test.ts
npm run typecheck
```

**Step 5: Commit**

```sh
git add src/sync/client-service.ts src/sync/core-sync.ts tests/unit/sync/client-service.test.ts tests/unit/sync/core-sync.test.ts
git commit -m "feat: add pull then push sync client service"
```

---

## Task 13: Add HTTP JSON transport adapter

**Objective:** Add Node 16-compatible HTTP JSON client/server adapter functions inside core for daemon use.

**Files:**

- Create: `src/sync/http-transport.ts`
- Add: `tests/unit/sync/http-transport.test.ts`
- Modify: `src/platform/fetch.ts` if needed
- Modify: `src/index.ts`

**Step 1: Write failing tests**

Tests should prove:

- HTTP client hits expected paths for pull, push, body upload/download, status.
- change list responses do not include bodies.
- credentials/tokens in URLs are redacted before logging/errors.
- no auth header is required in v1.

**Step 2: Verify RED**

Run:

```sh
npx vitest run tests/unit/sync/http-transport.test.ts
```

Expected: fails because adapter does not exist.

**Step 3: Implement minimal code**

- Use existing `src/platform/fetch.ts` abstraction.
- Keep adapter small and daemon-friendly.
- Do not start an HTTP server in core unless existing daemon contract patterns already do so; expose handlers/services for daemon runtime.

**Step 4: Verify GREEN**

Run:

```sh
npx vitest run tests/unit/sync/http-transport.test.ts
npm run typecheck
```

**Step 5: Commit**

```sh
git add src/sync/http-transport.ts src/platform/fetch.ts src/index.ts tests/unit/sync/http-transport.test.ts
git commit -m "feat: add sync http transport adapter"
```

---

## Task 14: Add structured sync logging and redaction

**Objective:** Write structured sync logs under `.data/sync/logs/` without leaking bodies or secrets.

**Files:**

- Create: `src/sync/sync-log.ts`
- Add: `tests/unit/sync/sync-log.test.ts`
- Reuse/modify: `src/ai/error-redaction.ts` only if appropriate and non-breaking

**Step 1: Write failing tests**

Tests should prove:

- logs are written under `.data/sync/logs/`.
- note title/path can appear.
- note body strings are omitted/redacted.
- URL host may appear.
- credentials/tokens/query secrets are redacted.

**Step 2: Verify RED**

Run:

```sh
npx vitest run tests/unit/sync/sync-log.test.ts
```

Expected: fails because logger does not exist.

**Step 3: Implement minimal code**

- Add a structured JSONL log writer.
- Centralize redaction helper.
- Do not log raw request/response objects.

**Step 4: Verify GREEN**

Run:

```sh
npx vitest run tests/unit/sync/sync-log.test.ts
npm run typecheck
```

**Step 5: Commit**

```sh
git add src/sync/sync-log.ts tests/unit/sync/sync-log.test.ts
git commit -m "feat: add private sync logs"
```

---

## Task 15: Add repair dry-run foundation

**Objective:** Implement non-mutating default repair reports for sync DB and sidecar consistency.

**Files:**

- Create: `src/sync/repair.ts`
- Add: `tests/unit/sync/repair.test.ts`
- Modify: `src/sync/core-sync.ts`

**Step 1: Write failing tests**

Tests should prove:

- `sync.repair()` defaults to dry-run.
- dry-run reports missing sync DB, stale dirty records, missing sidecars, and rebuild suggestions without mutation.
- mutating repair requires explicit `dryRun: false` plus a confirmation option.

**Step 2: Verify RED**

Run:

```sh
npx vitest run tests/unit/sync/repair.test.ts tests/unit/sync/core-sync.test.ts
```

Expected: fails because repair service does not exist.

**Step 3: Implement minimal code**

- Return clear report objects.
- Implement only safe/no-op dry-run checks first.
- Add explicit guard for mutating repair; full mutation can be expanded in follow-up tasks.

**Step 4: Verify GREEN**

Run:

```sh
npx vitest run tests/unit/sync/repair.test.ts tests/unit/sync/core-sync.test.ts
npm run typecheck
```

**Step 5: Commit**

```sh
git add src/sync/repair.ts src/sync/core-sync.ts tests/unit/sync/repair.test.ts tests/unit/sync/core-sync.test.ts
git commit -m "feat: add sync repair dry run"
```

---

## Task 16: Add core end-to-end sync integration test

**Objective:** Prove a minimal client/server sync path works inside `bluenote-core` without distribution CLI.

**Files:**

- Add: `tests/unit/sync/sync-integration.test.ts` or `tests/integration/sync/sync-integration.test.ts`
- Modify services as needed

**Step 1: Write failing test**

Create temp roots:

- one server root
- client A
- client B

Flow:

1. Initialize server and clients as schema 3.
2. Link client A with seed mode.
3. Create/edit note in client A.
4. Run client A sync now.
5. Link/clone client B.
6. Run client B sync now.
7. Assert note Markdown body, sidecar `noteId`, relative path, and AI metadata shape are present.
8. Delete note on client A and sync.
9. Client B pulls tombstone and does not resurrect the note.

**Step 2: Verify RED**

Run:

```sh
npx vitest run tests/unit/sync/sync-integration.test.ts
```

Expected: fails wherever service integration is incomplete.

**Step 3: Implement minimal fixes**

Only fix the integration gaps needed by the test. Do not add CLI/TUI/WebUI UX.

**Step 4: Verify GREEN**

Run:

```sh
npx vitest run tests/unit/sync/sync-integration.test.ts tests/unit/sync
npm run typecheck
```

**Step 5: Commit**

```sh
git add src/sync tests/unit/sync
git commit -m "test: cover end to end core sync"
```

---

## Task 17: Update public docs and package boundary checks

**Objective:** Document schema 3/sync core behavior and ensure exports are public and smoke-tested.

**Files:**

- Modify: `README.md`
- Modify: `docs/architecture/runtime-and-dependencies.md` if public runtime/API behavior changes
- Modify: `docs/product/overview.md` if sync is user-visible there
- Modify: `tests/unit/core/package-boundaries.test.ts`
- Modify: `tests/unit/core/public-api.test.ts`

**Step 1: Write failing tests/checks**

- Add package boundary tests proving sync APIs are exported from package root.
- Add smoke import for `createBlueNoteCore().sync` if package-boundary tests support it.

**Step 2: Verify RED**

Run:

```sh
npx vitest run tests/unit/core/package-boundaries.test.ts tests/unit/core/public-api.test.ts
```

**Step 3: Update docs and exports**

README should state:

- standalone remains default
- schema 3 is new-workspace default
- sync APIs are core primitives, not full hosted auth/security
- daemon auth/TLS are out of scope for v1
- distribution CLI owns `bluenote sync ...` UX in a follow-up repo plan

**Step 4: Verify GREEN**

Run:

```sh
npx vitest run tests/unit/core/package-boundaries.test.ts tests/unit/core/public-api.test.ts
npm run typecheck
```

**Step 5: Commit**

```sh
git add README.md docs tests/unit/core src/index.ts package.json
git commit -m "docs: document core sync primitives"
```

---

## Task 18: Final full verification

**Objective:** Prove the implemented core slice is clean and ready for downstream CLI planning.

**Files:**

- No planned edits unless checks reveal issues.

**Step 1: Run full gate**

```sh
npm run check
```

Expected: typecheck, tests, build, and smoke runtime checks pass.

**Step 2: Inspect git state**

```sh
git status --short
git log --oneline -5
```

Expected: clean working tree after commits.

**Step 3: Record status**

Update parent `.agent/STATUS.md` with:

- final commit range
- checks run
- any follow-up distribution/daemon CLI plan needed

Do not commit parent `.agent/*` unless the parent workspace is a repo and the user asks.

---

## Follow-up cross-repo plans after core passes

After this core implementation is complete and approved, create separate approved plans for:

1. `/root/code/bluenote` distribution CLI sync commands and daemon server lifecycle.
2. `/root/code/bluenote-term` compatibility verification and minimal sync status display if needed.
3. `/root/code/bluenote-webui` compatibility verification and sync status display if needed.

Do not mix those repos into this core implementation diff.
