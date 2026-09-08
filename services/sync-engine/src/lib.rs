//! `vulto-sync-engine` — the shared sync core (A003-T10).
//!
//! # One source, three targets
//!
//! This library links natively into the relay server binary (`src/main.rs` +
//! `src/relay/`), compiles to `wasm32-unknown-unknown` for the browser client,
//! and builds as `cdylib`/`staticlib` for mobile FFI — the three targets A007's
//! sixth gate names, from this one source. `cargo build --lib` builds only this
//! crate and never touches the relay.
//!
//! # The wire format
//!
//! [`wire`] is the whole of this library: it encodes and decodes the framed
//! protocol messages defined in `VPS-A003`'s "Sync transport contract" section
//! (A003-T36–T42) and does nothing else — no socket, no async runtime, no
//! database. It is standard-library only, so the wasm and mobile targets carry
//! zero dependencies. Each host wraps its own transport around this code: the
//! relay server (`src/relay/`, FDN-51 Stage 2) speaks it over WebSocket; a WASM
//! client speaks it from a Worker.
//!
//! The canonical cross-implementation test vectors live in `tests/vectors/*.json`
//! and are run by `tests/wire_vectors.rs` here and by
//! `packages/graph/src/sync/wire.test.ts` on the TypeScript side, so the two
//! encoders are validated against each other rather than each against itself.

pub mod wire;

/// The relay server (FDN-51 Stage 2). Native targets only — it is server code,
/// not part of what the WASM client or a mobile host links. The `[[bin]]`
/// (`src/main.rs`) is a thin entry point over [`relay::serve`].
#[cfg(not(target_arch = "wasm32"))]
pub mod relay;
