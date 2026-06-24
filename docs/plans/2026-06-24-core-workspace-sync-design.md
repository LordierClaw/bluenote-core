# BlueNote Core Workspace Sync Design

## Status

Drafted from the approved brainstorm decisions on 2026-06-24. This is a design document only; no product code is implemented by this document.

## Goal

Evolve `@lordierclaw/bluenote-core` from a local-only headless note engine into a local-first workspace engine with a stable core-to-core sync API. The same core/daemon engine should run locally and on a server, with the server-side core acting as the source of truth for synced workspaces.

The future backend gateway is intentionally separate. It will own users, auth, security, external access policy, and hosted product concerns. This phase focuses on `bluenote-core` management/sync logic and the BlueNote daemon runtime that exposes it.

## Current project baseline

`bluenote-core` currently owns:

- plain Markdown notes under `note/` and drafts under `draft/`
- hidden app state under `.data/`
- sidecar metadata under `.data/notes/`
- archived notes under `.data/archive/`
- rebuildable search/metadata artifacts under `.data/metadata.sqlite` and `.data/search-index.json`
- note create/list/show/search/move/rename/archive/delete/promote/rebuild logic
- AI config, queue, prompt, provider, and generated description semantics
- runtime-light daemon API contract types at `@lordierclaw/bluenote-core/api/daemon-contract`

Current sidecars are keyed by mutable note key/basename. Sync requires a stronger identity model.

## Research summary

This design borrows production patterns from local-first/sync systems:

- Ink & Switch local-first principles: local writes stay fast/offline-capable, sync runs in the background, and user files remain under user control.
- Replicache-style background sync: local mutations are not on the network critical path; background sync reconciles with a server-side canonical state.
- CouchDB-style replication concepts: changed records, tombstones, revisions, and incremental feeds matter for multi-client sync.
- Automerge/CRDT lessons: true collaborative conflict preservation is powerful but would be too large a first phase for BlueNote’s plain Markdown model.
- Electric/RxDB-style sync scope: explicitly define what subset of workspace data is synced and keep transport/contracts stable.

## Architecture overview

```text
standalone mode
  client/package -> bluenote-core -> local workspace

sync-client mode
  client CLI/TUI/WebUI -> local core/daemon engine -> HTTP JSON sync -> server core/daemon engine

sync-server mode
  server BlueNote daemon + bluenote-core -> source-of-truth workspace root

future hosted mode
  clients -> backend gateway -> server BlueNote core/daemon engine
           gateway owns auth/users/security/external policy
```

For this design, `bluenote-core` and the BlueNote daemon runtime are treated as one engine boundary. Core owns sync storage, sync semantics, public types, and core APIs. The distribution `bluenote` repo owns top-level CLI UX such as `bluenote sync ...`.

## Runtime modes

Core should expose explicit runtime modes:

- `standalone` — default; local-only behavior; sync disabled.
- `sync-client` — local workspace linked to a server-authoritative core.
- `sync-server` — headless/server daemon source-of-truth workspace.

Standalone remains the default for existing users. Sync is opt-in only when explicitly configured/linked.

## Storage schema 3

### Workspace compatibility

- Existing schema 2 workspaces remain standalone in v1.
- V1 does not automatically migrate existing workspaces to sync.
- Existing workspaces require manual copy/reset guidance or a later explicit migration phase.
- No export/import seed flow is included in v1.
- After this phase, all newly initialized workspaces use storage schema version 3, even when sync is disabled.

### Workspace identity

Schema 3 adds root-local workspace identity:

```json
{
  "schemaVersion": 3,
  "workspaceId": "workspace_..."
}
```

`workspaceId` lives in root-local workspace state. It must travel with the workspace.

### Note identity

Every schema 3 note sidecar requires immutable hidden `noteId`.

- `noteId` is sync identity.
- `key` remains mutable user-facing filename/basename.
- title, key, path, and folder placement may change without changing `noteId`.
- No lazy `noteId` assignment for schema 3 notes.

Schema 3 sidecars under `.data/notes/` are keyed by `noteId`, not `key`:

```text
.data/notes/<noteId>.json
```

Sketch:

```json
{
  "noteId": "note_...",
  "type": "normal",
  "key": "project-kickoff",
  "title": "Project kickoff",
  "description": "...",
  "relativePath": "note/project-kickoff.md",
  "createdAt": "2026-06-24T00:00:00.000Z",
  "updatedAt": "2026-06-24T00:00:00.000Z",
  "archivedAt": null,
  "namingVersion": 1,
  "syncRevision": 12,
  "ai": {
    "description": {
      "lastProcessedAt": "2026-06-24T00:00:00.000Z"
    }
  }
}
```

### Notes, drafts, archive

Schema 3 keeps current file layout semantics:

- normal notes under `note/`
- drafts under `draft/`
- archived note files move to `.data/archive/`
- note files remain plain Markdown with no required frontmatter

### Folder model

Custom folders under `note/` sync by relative path.

- Folder identity is relative path; there are no immutable `folderId`s in v1.
- Notes carry folder placement through `relativePath`.
- Empty custom folders must be preserved in v1.
- Empty/custom folder records live in `.data/sync/sync.sqlite`.

This keeps note sync simple but makes folder rename/move path-based and less robust than note identity.

## Sync state layout

All workspace sync state lives under `.data/sync/`.

```text
.data/sync/
  sync.sqlite
  logs/
```

Server endpoint/runtime config is not stored root-local. It lives in user-global config so machine-specific server connection settings do not travel with workspace files.

`replicaId` is user-global/per-machine per `(machine, workspaceId)`, avoiding accidental shared replica IDs when a workspace is copied.

## SQLite sync DB sketch

Both server and client use `.data/sync/sync.sqlite`.

### `sync_meta`

Key-value store for local sync DB metadata.

```sql
CREATE TABLE sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Example keys:

- `schemaVersion`
- `workspaceId`
- `role` (`client` or `server`)
- `createdAt`
- `lastCompactedAt`

### `replicas`

Server-side per-client replica records; client-side may store active local/server linkage.

```sql
CREATE TABLE replicas (
  replicaId TEXT PRIMARY KEY,
  workspaceId TEXT NOT NULL,
  label TEXT,
  lastSeenAt TEXT,
  lastPulledSequence INTEGER DEFAULT 0,
  lastPushedAt TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);
```

### `server_changes`

Server-side historical incremental change log.

```sql
CREATE TABLE server_changes (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  workspaceId TEXT NOT NULL,
  entityType TEXT NOT NULL, -- note | folder | config | tombstone | ai
  entityId TEXT NOT NULL,
  changeType TEXT NOT NULL, -- upsert | delete | archive | folder-upsert | folder-delete | config-update | ai-update
  serverRevision INTEGER NOT NULL,
  changedAt TEXT NOT NULL,
  sourceReplicaId TEXT,
  title TEXT,
  relativePath TEXT,
  bodyAvailable INTEGER NOT NULL DEFAULT 0,
  metadataJson TEXT NOT NULL
);
```

Note bodies are not stored inline in general change-list responses. The DB may record body availability/revision metadata; body transfer happens via separate endpoints.

### `dirty_records`

Client-side dirty tracking after link/sync-client mode.

```sql
CREATE TABLE dirty_records (
  entityType TEXT NOT NULL,
  entityId TEXT NOT NULL,
  dirtyType TEXT NOT NULL, -- upsert | delete | folder-upsert | folder-delete
  markedAt TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lastError TEXT,
  PRIMARY KEY (entityType, entityId)
);
```

Standalone unlinked schema 3 workspaces do not record dirty sync state. Dirty tracking starts after explicit link/sync-client configuration.

### `tombstones`

Deletion records for hard-delete sync.

```sql
CREATE TABLE tombstones (
  entityType TEXT NOT NULL,
  entityId TEXT NOT NULL,
  deletedAt TEXT NOT NULL,
  serverRevision INTEGER,
  sourceReplicaId TEXT,
  previousRelativePath TEXT,
  previousTitle TEXT,
  PRIMARY KEY (entityType, entityId)
);
```

### `folders`

Explicit folder records for empty custom folders.

```sql
CREATE TABLE folders (
  relativePath TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);
```

### `sync_status`

Client/server status summaries.

```sql
CREATE TABLE sync_status (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
```

Status should support pending/running/failed counts, last synced time, server identity/URL, and user-safe messages.

### Rebuildability

The sync DB is partially rebuildable:

- notes/folder presence can be reconstructed from files/sidecars where possible
- cursors, historical change log, tombstones, and per-replica status may require backup state, server snapshot, or full resync

## Sync protocol model

### Authority and payload

- Server is authoritative.
- V1 sync uses whole-note records, not a full operation/event journal from clients.
- Server maintains an incremental historical change log for pulls.
- Deletions use tombstones.
- Same-note concurrent edit policy is last writer wins, with the refinements below.

### Sync cycle order

All sync cycles are bidirectional and use:

```text
pull -> push -> reconcile
```

This applies to:

- `sync now`
- background auto-sync
- reconnect after offline edits

If the pull observes a newer server version for a locally dirty note, the client replaces/clears the local dirty state and does not push the stale local edit. The overwritten local dirty version is discarded in v1; no recovery copy or visible conflict note is created.

### Local saves

Local saves never wait for sync.

- note save/autosave writes local files/state immediately
- core mutation APIs auto-mark affected notes/folders dirty in schema 3 sync-client mode
- background auto-sync considers only persisted local state after save/autosave
- sync must not read unsaved editor buffers

### Initial link modes

`sync link` supports explicit modes:

- `clone-from-server`
- `seed-empty-server-from-local`
- `refuse-if-both-have-data`

`seed-empty-server-from-local` marks all existing local notes and folder records dirty so initial upload includes existing content.

`clone-from-server` requires an empty local workspace by default. Non-empty local workspaces are allowed only through an explicit force path that creates a backup before overwriting/reconciling local state.

### Unlink

`sync unlink` keeps local notes and disables/removes server connection/active replica linkage.

After unlink:

- workspace remains schema 3
- `noteId`s remain
- storage is not downgraded

## HTTP JSON endpoint sketch

The daemon remains HTTP JSON in v1. It listens on localhost by default with explicit configurable host/port for deployment.

No daemon auth and no TLS are included in v1. External exposure must be through trusted network/proxy setups until the future gateway owns auth/security.

### Health and capabilities

```text
GET /health
GET /capabilities
```

`/capabilities` should report sync support and runtime mode.

### Workspace/server info

```text
GET /api/sync/workspace
GET /api/sync/status
```

Response sketch:

```ts
interface SyncWorkspaceInfo {
  workspaceId: string
  storageSchemaVersion: 3
  runtimeMode: 'sync-server'
  serverRevision: number
  noteCount: number
  folderCount: number
}

interface SyncStatusView {
  state: 'unlinked' | 'idle' | 'syncing' | 'error'
  pending: number
  running: number
  failed: number
  lastSyncedAt?: string
  serverUrl?: string
  serverWorkspaceId?: string
  message?: string
}
```

### Link/bootstrap

```text
POST /api/sync/link/prepare
POST /api/sync/link/seed
POST /api/sync/link/clone
```

Request sketch:

```ts
type LinkMode = 'clone-from-server' | 'seed-empty-server-from-local' | 'refuse-if-both-have-data'

interface LinkPrepareRequest {
  workspaceId?: string
  replicaId: string
  mode: LinkMode
}
```

### Incremental pull

```text
GET /api/sync/changes?since=<sequence>&limit=<n>
GET /api/sync/notes/:noteId/body
```

Change-list responses include metadata and body availability, not full bodies inline.

```ts
interface PullChangesResponse {
  workspaceId: string
  fromSequence: number
  toSequence: number
  hasMore: boolean
  changes: SyncChangeView[]
}

interface SyncChangeView {
  sequence: number
  entityType: 'note' | 'folder' | 'config' | 'tombstone' | 'ai'
  entityId: string
  changeType: string
  serverRevision: number
  changedAt: string
  title?: string
  relativePath?: string
  bodyAvailable?: boolean
  metadata: Record<string, unknown>
}
```

If a cursor is too old because of compaction, server returns a full-snapshot-required response.

### Push dirty records

```text
POST /api/sync/push
PUT  /api/sync/notes/:noteId/body
```

Push request sketch:

```ts
interface PushRequest {
  workspaceId: string
  replicaId: string
  baseSequence: number
  records: SyncPushRecord[]
}

interface SyncPushRecord {
  entityType: 'note' | 'folder'
  entityId: string
  dirtyType: 'upsert' | 'delete' | 'folder-upsert' | 'folder-delete'
  clientUpdatedAt: string
  metadata: Record<string, unknown>
  bodyUpload?: {
    uploadId?: string
    contentHash: string
    byteLength: number
  }
}

interface PushResponse {
  accepted: Array<{ entityType: string; entityId: string; serverRevision: number }>
  replacedByServer: Array<{ entityType: string; entityId: string; serverRevision: number }>
  rejected: Array<{ entityType: string; entityId: string; code: string; message: string }>
  serverSequence: number
}
```

### Snapshot/fallback

```text
GET /api/sync/snapshot
```

Used for clone, full resync, and too-old cursor recovery. Snapshot should page metadata and fetch bodies separately.

### Server AI/status

Server AI generation is queued asynchronously after accepted note changes. Clients receive server-generated AI metadata on the next normal sync cycle.

```text
GET /api/sync/ai/status
```

This is status-only for sync clients. Client-local AI generation is disabled in core-to-server mode.

## CLI command surface

Distribution `bluenote` owns top-level CLI commands:

```text
bluenote sync status
bluenote sync link
bluenote sync unlink
bluenote sync now
bluenote sync config
bluenote sync logs
bluenote sync repair
bluenote sync server start
bluenote sync server stop
bluenote sync server status
bluenote sync server config
```

Scope split:

- `sync config` manages client-local sync settings only.
- `sync server config` manages server-side workspace config on the server machine.
- CLI sync UX lives in `bluenote`.
- Core owns underlying sync APIs, storage, daemon contracts, and runtime support.

## Background sync

V1 includes background auto-sync on interval/idle.

- Interval/cadence is client-local.
- Save/autosave never blocks on sync.
- Sync retries and failures update sync status/logs.
- Safe shutdown/restart recovery must preserve enough state to retry later.
- Background sync only syncs persisted note state.

## AI behavior in core-to-server mode

In sync-client/core-to-server mode:

- clients can have no local AI setup
- local AI generation is disabled
- server AI is the only AI authority
- server-side AI provider/config can generate stable note metadata
- provider auth/secrets/runtime state do not sync to clients
- stable server-derived AI metadata, such as descriptions/freshness, syncs to clients
- server queues AI generation asynchronously after accepted note changes
- AI metadata arrives on the next normal sync cycle

Outside core-to-server mode, existing local AI behavior remains local and setup-dependent.

## Logging and repair

### Logs

Structured sync logs live under `.data/sync/logs/`.

Logs may include:

- timestamps
- sync operation names
- server URL/host
- note titles
- note relative paths
- note/folder IDs
- status/error codes

Logs must never include:

- note bodies
- credentials/tokens
- query secrets
- secret-like values

### Repair

`sync repair` is full repair in v1, but dry-run by default.

It may, with explicit confirmation/flag:

- rewrite sync DB state
- recreate tombstones where possible
- reconcile local/server state automatically
- mark full resync needed
- clear stale sync locks/status

It must include safety gates, backups or dry-run/confirmation behavior, and clear reporting so repair does not silently destroy notes.

## Server daemon deployment mode

V1 includes a headless long-lived server daemon suitable as source-of-truth workspace engine.

- listens on localhost by default
- host/port are explicitly configurable for deployment
- no built-in auth in v1
- no built-in TLS/HTTPS in v1
- external access is trusted-network/proxy/gateway responsibility
- future backend gateway owns auth, users, security, and external access policy

## Verification strategy

The first implementation phase intentionally combines schema/storage foundations and a minimal end-to-end HTTP JSON sync path.

Required verification should include:

1. `bluenote-core` unit coverage for schema 3 sidecars, `noteId`, root manifest, sync DB schema, tombstones, folder records, dirty tracking, and sync status.
2. Core/daemon integration tests for HTTP JSON pull/push and body upload/download.
3. Multi-client test with at least two temp client workspaces and one server workspace.
4. CLI end-to-end sync test in `bluenote`:
   - start sync server
   - link client
   - create/edit/delete notes
   - run `sync now`
   - second client pulls accepted state
   - verify Markdown files/sidecars/tombstones/folders
5. Compatibility verification for TUI/WebUI to ensure existing behavior still works and package boundaries remain intact. Full TUI/WebUI sync UX is not required in the first phase.
6. Log privacy tests proving note bodies and secret-like strings are not logged.
7. Repair dry-run tests proving default repair is non-mutating.

## Out of scope for v1

- real auth/users/security
- direct TLS/HTTPS in daemon
- binary attachments/assets
- CRDT or text auto-merge
- existing schema 2 workspace auto-migration
- export/import seed UX
- server push/WebSocket/SSE notification
- full TUI/WebUI sync UX
- multi-workspace server hosting, though APIs include `workspaceId` to preserve a future path
- preserving overwritten local dirty edits after pull-before-push conflict handling

## Risks and trade-offs

### No auth/TLS in v1

This is acceptable only with localhost default or trusted network/proxy deployments. Documentation must be explicit that external security belongs to the future gateway.

### Last-writer-wins and discarded local dirty edits

The approved v1 policy can lose local edits when pull sees a newer server version. This is simpler but must be documented clearly. Future phases can add conflict records, recovery copies, or text merge.

### Folder identity by path

Path-based folder identity is simpler but weaker for concurrent folder rename/move. This is acceptable in v1 because note identity is robust and empty folders are tracked separately.

### Existing workspace non-migration

Users with existing schema 2 workspaces need manual reset/copy guidance or a later migration phase. This avoids risky automatic migration in the first sync slice.

### Larger first phase

Combining storage foundations and end-to-end HTTP sync is a larger review surface. The benefit is a working integrated slice that proves the architecture.

## Recommended next step

After this design is approved, write an implementation plan with small TDD tasks spanning:

1. schema 3 manifest and sidecar identity
2. sync DB repository
3. dirty/tombstone/folder tracking
4. sync core API under `createBlueNoteCore().sync`
5. daemon HTTP endpoints
6. CLI command surface in `bluenote`
7. server AI queue integration for core-to-server mode
8. compatibility and end-to-end verification
