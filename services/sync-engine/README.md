# services/sync-engine

The shared sync core (A003-T10) plus the relay server that deploys it.

## What is built: the wire format (`[lib]`, FDN-51 Stage 1)

`src/wire/` encodes and decodes the framed protocol messages defined in
`VPS-A003`'s "Sync transport contract" section (A003-T36–T42):

- `Hello`, `PushDelta`, `PullSinceCursor`, `DeltaBatch`, `Ack`, `SyncStatus`,
  `Error` — a fixed 2-byte header (protocol version, message type) followed by
  length-prefixed fields, all integers big-endian, hand-rolled, no codegen
  toolchain.
- Version negotiation that rejects rather than downgrades (`wire::negotiate`).
- The delivery `Cursor` type and its ordering — the authoritative assignment
  (a per-workspace commit sequence handed out at PostgreSQL transaction commit)
  belongs to Stage 2.

The core is transport-agnostic (A003-T36): no socket, no async runtime, no
database. It compiles natively, to `wasm32-unknown-unknown`, and as a
`cdylib`/`staticlib` for mobile from this one source.

### Cross-implementation vectors (A003-T42)

`tests/vectors/*.json` is the single source of truth for the byte layout. Both
`tests/wire_vectors.rs` here and `packages/graph/src/sync/wire.test.ts` on the
TypeScript side decode each vector's `encoded_hex` to its structured `message`
and re-encode it back, so the two implementations are checked against each other
rather than each against itself.

`serde`/`serde_json` are `[dev-dependencies]` only — used to read those JSON
fixtures. The shipped `[lib]` and the runtime `[dependencies]` are standard
library only.

## What is still a placeholder: the relay server (`[[bin]]`)

`src/main.rs` remains the Stage 0 placeholder — a std-only readiness endpoint,
not an API. It gets its real content in **FDN-51 Stage 2**: the WebSocket relay
on Tokio + Axum (A003-T36), PostgreSQL delta persistence and catch-up, per-device
cursors assigned at transaction commit (A003-T39), acknowledgement / replay
(A003-T40), and the VPS-F004 delta-log hook (A003-T09). `GET /health` exists only
so `docker compose up --wait` can tell the container is up; nothing should be
built against it.

## Build

`rust-toolchain.toml` pins the toolchain; nobody outside this crate needs it
installed (A001-T04) — the compose stack builds the crate in a container. The
`Dockerfile` uses cargo-chef dependency-layer caching so a cold
`docker compose up` does not recompile the dependency graph on a source-only
edit.

```
cargo test                                   # unit tests + tests/wire_vectors.rs
cargo fmt --check && cargo clippy -- -D warnings
cargo build --lib --release --target wasm32-unknown-unknown
```
