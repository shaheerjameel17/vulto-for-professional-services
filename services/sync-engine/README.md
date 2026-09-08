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

**Stage 4 client-contract note.** During a large replay a client should send
`Ack{ClientCumulative}` incrementally as it applies each batch, not once at the
end — an interrupted replay then resumes from the last applied batch instead of
re-sending the whole backlog. The relay already supports this (every `Ack`
advances the durable cursor); it is a client discipline to specify in Stage 4.

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
