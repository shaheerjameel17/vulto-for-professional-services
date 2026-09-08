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
(`SessionAuthorizer`); subscribe to the workspace hub; replay everything after
the device's last acknowledgement before live traffic (A003-T40); then serve —
`PushDelta` → store → `Ack{RelayReceipt}` → fan out to every other connected
device (A003-T44), `Ack{ClientCumulative}` → record, `PullSinceCursor` →
`DeltaBatch`. The relay never inspects a payload (A003-T43).

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

`tests/relay_pg.rs` (six `#[ignore]` cases) runs against a real, ephemeral
PostgreSQL via `pnpm test:sync-engine`: concurrent-push gapless commit order,
durable reconnect replay across a simulated relay restart, revoked-device denial,
expired-session denial, `sync_delta.payload` byte-for-byte opacity + log scrub,
and the SQL-level ack clamp.

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
