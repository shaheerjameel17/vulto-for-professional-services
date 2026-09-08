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

### Stage 2a (current)

The server, the state machine, the `SessionAuthorizer` seam, and in-memory
fan-out. Persistence is behind the `DeltaStore` trait; `MemoryDeltaStore` is the
only implementation. `tests/relay_ws.rs` proves it end-to-end with real
WebSocket clients and no database.

**The binary is not production-wired yet.** With no `DATABASE_URL` it runs on
`MemoryDeltaStore` + an empty `StaticSessionAuthorizer`, so `/health` works and
`/sync` speaks the full protocol but rejects every real connection as
unauthenticated. Stage 2b supplies `PgDeltaStore` and `PgSessionAuthorizer`.

### Stage 2b (next)

`PgDeltaStore` (`sync_delta` / `sync_device_ack` / `sync_workspace_cursor`
tables; the cursor drawn from a per-workspace locked counter inside the same
transaction that commits the delta row, so cursor order equals commit order —
A003-T39), `PgSessionAuthorizer` (the admission query from
`services/api/src/auth/workspace-session.ts` plus a device-revocation check),
optional in-process TLS, and the real-Postgres integration proof.

## Dependencies

The `[lib]` and the shipped binary's runtime have **no** standard
`[dependencies]`. The relay's Tokio/Axum/tracing dependencies live under
`[target.'cfg(not(target_arch = "wasm32"))'.dependencies]`, so
`cargo build --lib --target wasm32-unknown-unknown` still resolves to zero
dependencies and the three-target build holds. `serde`/`serde_json` (vector
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
