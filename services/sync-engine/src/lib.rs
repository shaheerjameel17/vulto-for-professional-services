//! `vulto-sync-engine` — the shared sync core (A003-T10).
//!
//! # One source, three targets
//!
//! This library links natively into the server binary (`main.rs`), compiles to
//! `wasm32-unknown-unknown` for the browser client, and builds as
//! `cdylib`/`staticlib` for mobile FFI — the three targets A007's sixth gate
//! names, from this one source. `cargo build --lib` builds only this crate and
//! never touches `main.rs`.
//!
//! # FDN-51 Stage 1: the wire format
//!
//! [`wire`] is the whole of Stage 1. It encodes and decodes the framed protocol
//! messages defined in `VPS-A003`'s "Sync transport contract" section
//! (A003-T36–T42) and does nothing else — no socket, no async runtime, no
//! database. Each host (the Tokio/Axum relay in Stage 2, a WASM client, a mobile
//! host) wraps its own transport around this same code.
//!
//! The canonical cross-implementation test vectors live in
//! `tests/vectors/*.json` and are run by `tests/wire_vectors.rs` here and by
//! `packages/graph/src/sync/wire.test.ts` on the TypeScript side, so the two
//! encoders are validated against each other rather than each against itself.
//!
//! # Still a placeholder: the server binary
//!
//! `main.rs` remains the Stage 0 placeholder. It gets its real content — the
//! WebSocket relay, PostgreSQL persistence, the per-device delivery cursor
//! assigned at transaction commit — in **FDN-51 Stage 2**. [`placeholder_info`]
//! is what it still reports until then.

pub mod wire;

/// What the still-placeholder server binary reports about itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlaceholderInfo {
    pub service: &'static str,
    pub status: &'static str,
    pub content_owner: &'static str,
}

/// The server binary's self-description, pending its Stage 2 implementation. The
/// `wire` module above is real; the relay that speaks it is not built yet.
pub fn placeholder_info() -> PlaceholderInfo {
    PlaceholderInfo {
        service: "vulto-sync-engine",
        status: "wire format implemented (FDN-51 Stage 1); relay server pending (Stage 2)",
        content_owner: "FDN-51",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_itself() {
        let info = placeholder_info();
        assert_eq!(info.service, "vulto-sync-engine");
        assert_eq!(info.content_owner, "FDN-51");
    }
}
