# services/sync-engine

The shared sync core (A003-T10) and the relay server that deploys it.

## `[lib]` — the wire format (`src/wire/`, FDN-51 Stage 1)

Encodes and decodes the framed protocol messages defined in `VPS-A003`'s "Sync
transport contract" section (A003-T36–T42): `Hello`, `PushDelta`,
`PullSinceCursor`, `DeltaBatch`, `Ack`, `SyncStatus`, `Error` — a fixed 2-byte
header (protocol version, message type) then length-prefixed big-endian fields,
hand-rolled, no codegen toolchain. Plus `wire::negotiate` (version negotiation
that rejects rather than downgrades) and the delivery `Cursor` type.

Standard-library only and transport-agnostic (A003-T36). The `wasm32` and mobile
targets compile only this module and carry zero dependencies.

### Cross-implementation vectors (A003-T42)

`tests/vectors/*.json` is the single source of truth for the byte layout.
`tests/wire_vectors.rs` here and `packages/graph/src/sync/wire.test.ts` on the
TypeScript side both decode each vector and re-encode it, so the two encoders are
checked against one another.

## `relay` — the relay server (`src/relay/`, FDN-51 Stage 2)

`pub mod relay` in the lib, but `#[cfg(not(target_arch = "wasm32"))]` — server
code, native only. `src/main.rs` is a thin entry point over `relay::serve`.
Tokio + Axum, WebSocket at `GET /sync` (A003-T36); `GET /health` keeps the
compose readiness contract.

The connection state machine (`src/relay/connection.rs`): first frame must be
`Hello`; negotiate the version (A003-T38); authorize the session
(`SessionAuthorizer`); subscribe to the workspace doorbell; replay everything
after the device's last acknowledgement before live traffic (A003-T40), paged;
then serve — `PushDelta` → store → `Ack{RelayReceipt}` → ring the doorbell,
`Ack{ClientCumulative}` → record, `PullSinceCursor` → `DeltaBatch` (paged). A
doorbell wake re-reads the durable log in cursor order and delivers whatever is
now past this connection's cursor. A re-authorization timer re-runs the full
admission check every `SYNC_REVALIDATION_SECS` (default 10) and evicts a
connection that no longer passes (A003-T45). The relay never inspects a payload
(A003-T43).

### Stage 2a — server + protocol + seams

The server, the state machine, the `SessionAuthorizer` / `DeltaStore` seams, and
in-memory fan-out. `tests/relay_ws.rs` proves it end-to-end with real WebSocket
clients and no database (`MemoryDeltaStore` + `StaticSessionAuthorizer`).

### Stage 2b — PostgreSQL backend (`src/relay/pg.rs`)

`PgDeltaStore` and `PgSessionAuthorizer`, `sqlx` as a runtime query executor only
(no `query!` macro, no `sqlx::migrate!`). `append` assigns the delivery cursor
from a per-workspace locked counter (`SELECT … FOR UPDATE`) inside the same
transaction that commits the delta row, so cursor order equals commit order
(A003-T39). `PgSessionAuthorizer` re-derives Better Auth's admission logic
(`services/api/src/auth/workspace-session.ts`) plus a
`device_unlock_secret.revoked_at IS NULL` check. **The shipped binary requires
`DATABASE_URL`** and refuses to start without it.

The schema is **Drizzle-managed** — `services/api/src/auth/schema.ts`, migration
`0002_wealthy_magneto` (`sync_workspace_cursor` / `sync_delta` /
`sync_device_ack`). Run `pnpm --filter @vulto/api db:migrate` before first start;
the compose `sync-engine` service gets `DATABASE_URL` from the compose environment.

`tests/relay_pg.rs` (`#[ignore]` cases — Stage 2b's six, Stage 3's eleven more)
runs against a real, ephemeral PostgreSQL via `pnpm test:sync-engine`:
concurrent-push gapless commit order,
durable reconnect replay across a simulated relay restart, revoked-device denial,
expired-session denial, `sync_delta.payload` byte-for-byte opacity + log scrub,
and the SQL-level ack clamp.

### Stage 3 — acknowledgement, retry, replay, resume hardening

Three corrections, proven on the real stack (`tests/relay_pg.rs` grows to
eighteen cases):

- **Mid-session eviction (A003-T45).** A re-authorization timer re-runs the
  admission check every `SYNC_REVALIDATION_SECS` (default 10, jittered first
  tick). A revoked device, expired session or removed membership is closed with
  `Error{unauthenticated}` within one interval — the pre-Stage-3 relay only
  gated new connections. `Duration::ZERO` disables the timer (tests set this).
- **The live path is a doorbell over the durable log, not an in-memory queue.**
  `hub.rs` is a per-workspace `tokio::sync::watch` channel carrying `()`. A push
  rings it; every connection wakes and `deliver_pending` re-reads `sync_delta`
  in `ORDER BY cursor` from its own cursor forward. The log is the single
  ordering authority, so a wake that races ahead of a lower cursor cannot drop a
  delta for a live consumer (the bug the Stage 2a `broadcast` fan-out had), and
  a slow consumer is caught up on its next wake rather than lagged out of the
  channel.
- **Replay and pull page.** `read_since` returns at most `MAX_DELTA_PAGE` (500);
  `deliver_pending` and the `PullSinceCursor` handler loop until a short page, so
  a backlog larger than one batch replays completely and gaplessly.

Duplicate delivery is safe without relay bookkeeping: the payload is Loro update
bytes (or an FDN-52 envelope over them) and Loro dedupes by `(peer id, counter)`
(A003-T02); `packages/graph`'s Loro round-trip tests cover the client side.

**Stage 3 addendum — the `PushDelta` handler must not advance `sent`.** The
review that followed the loss and reconstruction of `connection.rs` (recorded on
FDN-51) found a vestigial line carried over from Stage 2a: on a client's own
push, `sent` jumped to that delta's cursor, which could skip a delta another
device had committed at a lower cursor but that this connection had not yet
delivered — a live-path gap that healed only on reconnect, the same class of bug
the doorbell redesign eliminated for the broadcast path. The line is deleted;
`deliver_pending(skip_own = true)` already advances `sent` correctly and filters
this device's own deltas by origin. Covered by
`a_pushing_device_still_receives_a_concurrent_peers_lower_cursor_delta(s)_live`
in both suites.

### Stage 4a — the sync handshake ticket

The browser's graph Worker cannot read the httpOnly Better Auth session cookie,
so it cannot present a raw `session.token` in `Hello`. `POST /sync/ticket`
(`services/api`, session-cookie authenticated) mints a short-lived
(`SYNC_TICKET_TTL_SECONDS`, 600) ticket bound to one `(workspace, device)`;
`sync_ticket` (Drizzle migration `0003_nappy_kid_colt`) stores only its
SHA-256 hash. `PgSessionAuthorizer` recognizes a `vlt_sync_`-prefixed credential,
looks it up by `encode(sha256($1),'hex')`, and runs the identical
membership / status / device-revocation checks as the session-token path.
Native clients still present a session token directly. The periodic re-auth
(A003-T45) re-checks the ticket's own expiry, so an expired ticket evicts a live
connection just as a revoked device does.

The client (`packages/graph/src/sync/client.ts`, running in the Worker) re-mints
and reconnects before expiry; an `unauthenticated` close is retried with a fresh
ticket and stays offline only if that mint also fails (the device is revoked).

**Incremental replay acknowledgement (Stage 3 ruling 5):** the client sends one
`Ack{ClientCumulative}` per applied `DeltaBatch` — and only for a gapless prefix
— so an interrupted replay resumes from the last applied batch. If a reconnect's
`SyncStatus` reports the relay's ack ahead of the client's own cursor (the local
store was erased or restored from an old backup), the client sends an explicit
`PullSinceCursor` from its real cursor rather than trusting auto-replay.

**Single-active-sync across tabs (Stage 4a, founder ruling):** `deviceId` is
shared across a browser's tabs but the Worker is one per tab, so a
`navigator.locks` exclusive lock per `(workspace, device)` gates the connection —
only the lock holder syncs; the others stay `offline` and take over on release.
Full multi-tab live convergence is FDN-90.

### Stage 4b — two-device convergence

The Stage 4b proof (`services/api/browser-tests-device-store/graph-sync.spec.ts`)
runs two — for one case three — independent devices as separate Playwright
`BrowserContext`s. Separate contexts have separate IndexedDB, so each gets its
own `deviceId`, its own `device_unlock_secret` row, its own `sync_ticket`, its
own `sync_device_ack` row, and its own in-memory `LoroDoc` replica with a
distinct Loro peer id — a genuine second replica, not a second view of one
document. All against the same `cargo run` relay and the same Postgres.

Six cases: concurrent offline non-conflicting edits converge to the union;
concurrent offline edits to the **same** field converge to one value on both
replicas (Loro's own map-register resolution — the test asserts replica
equality and stability, never a chosen winner); a device applies a peer's live
pushes while replaying its own backlog larger than one `MAX_DELTA_PAGE`, every
delta once and gapless; a device offline across an extended multi-page gap
catches up fully on return; replayed delivery into an erased replica rebuilds
the converged state with no new `sync_delta` rows and no extra ack row; a cold
third device bootstraps by plain `update` replay from cursor zero (no snapshot
bootstrap — `PayloadKind::Snapshot` stays defined-but-unused).

What was already proven by Stage 2b/3/4a is not re-proven: durable
cursor-at-commit and gapless ordering, paged replay and mid-replay resume,
mid-session eviction, the monotonic ack clamp, the ticket handshake, and
single-device push/replay/materialize. What is new to 4b is two real replicas
reaching identical materialized state — CRDT convergence, not just correct byte
delivery — and the A003 30 s acceptance window.

### Stage 5 — server-opacity closure proof (A003-T43, the F152 criterion)

Adversarial real-stack evidence that the relay, every `sync_*` PostgreSQL
column, and every relay log line carry nothing but FDN-52's opaque protected
envelope — never Tier 1/3 plaintext, never a usable key, never a reusable
credential (founder ruling: **tier-level opacity only**; per-recipient
filtering is F186 / FDN-89, out of FDN-51's closure).

`tests/vectors/opacity/{tier1,tier3}.json` are generated by the **real FDN-52
constructions** (`pnpm stage5:opacity-fixtures`, from
`packages/graph/src/worker/testing/stage5-opacity-fixtures.ts`; deterministic,
byte-stable, drift-guarded by `stage5-opacity-fixtures.test.ts`). Each carries
real protected-envelope byte strings — a Tier 1/3 document update, the wrapped
document key, the recovery envelope, and the A003-T32 `Tier1IdentityTransfer`
that also crosses this relay — plus every secret in the Tier 1/3 key hierarchy.
**Every value in those files is fixed test-only material, never used in any real
workspace** (each file says so in its header).

`tests/relay_pg.rs` (`tier1_/tier3_protected_payloads_leak_no_secret_on_any_server_surface`,
`a_mistagged_tier1_payload_is_stored_and_forwarded_opaquely`,
`the_sync_tables_have_exactly_the_columns_the_migration_defines`,
`the_raw_sync_ticket_and_session_token_never_reach_a_sync_row_or_log`) pushes
each payload, then:

- asserts `sync_delta.payload` is byte-for-byte the pushed bytes and the
  payload appears in **no other column of any `sync_*` row** and **no log line**
  — in raw, `\x`-hex, and `?bytes` decimal-array form;
- scans every `sync_*` column (`to_jsonb` of every row) and the relay's entire
  `TRACE`-level log for every hierarchy secret — in raw, hex (both cases),
  base64 (standard and URL), decimal-array, and ASCII form — and finds none;
- confirms `sync_ticket` holds only the SHA-256 hash, never the raw
  `vlt_sync_…` string, and the session token never reaches a row or log;
- confirms the `sync_*` tables have exactly the columns the migration defines
  (`information_schema` — no shadow copy);
- confirms a Tier 1 envelope mis-tagged `server_readable` is still stored and
  forwarded verbatim: opacity is **structural** (the relay never parses any
  payload regardless of tag), not conditional on an honest tier tag.

Mutation spot-checks (each observed failing the intended assertion, then
reverted by hand — never `git checkout`): logging the payload (`?payload`);
copying the payload into `document_id`; `PgSessionAuthorizer` selecting
`d.server_half` and logging the admission row (founder-required); logging the
raw session token; and a positive control (scanning for the workspace id,
which is present). The A003-T09 observability note in `VPS-A003` records that
any future metrics or tracing exporter must re-run this scan.

### TLS

Deferred (A003-T36): the local relay runs plain `ws://`. Production terminates
TLS 1.3 at least at the ingress; optional in-process `wss://` would be gated on
`SYNC_TLS_CERT_PATH` / `SYNC_TLS_KEY_PATH`.

## Dependencies

The `[lib]` and the shipped binary's **runtime `[dependencies]` are empty**. The
relay's Tokio / Axum / tracing / sqlx dependencies live under
`[target.'cfg(not(target_arch = "wasm32"))'.dependencies]`, so
`cargo build --lib --target wasm32-unknown-unknown` still resolves to zero
dependencies and the three-target build holds. `serde` / `serde_json` (vector
fixtures) and `tokio-tungstenite` (test clients) are `[dev-dependencies]`.

## Build

`rust-toolchain.toml` pins the toolchain; nobody outside this crate needs it
installed (A001-T04) — the compose stack builds the crate in a container. The
`Dockerfile` uses cargo-chef dependency-layer caching.

```
cargo test                                   # unit + tests/wire_vectors.rs + tests/relay_ws.rs
cargo fmt --check && cargo clippy --all-targets -- -D warnings
cargo build --lib --release --target wasm32-unknown-unknown
docker build services/sync-engine
```
