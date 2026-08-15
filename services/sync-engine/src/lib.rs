//! `vulto-sync-engine` — the shared core.
//!
//! # This is the library FDN-46 proves compiles three ways
//!
//! Native (linked into the server binary in `main.rs`), WASM
//! (`wasm32-unknown-unknown`, for the client), and as a `cdylib`/`staticlib`
//! for mobile linking — the three targets A007's sixth gate names, from this
//! one source, per A003-T10's requirement that the sync engine be "a single
//! shared core library used identically across all platforms."
//!
//! `main.rs` is a separate build target — `cargo build --lib` builds only
//! this crate, which is what the WASM and mobile proofs invoke.
//!
//! **Checked rather than assumed:** `main.rs`'s `TcpListener` does compile for
//! `wasm32-unknown-unknown` today — Rust's `std` ships stub network types
//! there rather than refusing to build. An earlier version of this comment
//! claimed the opposite and was wrong; building the whole package confirmed
//! it compiles, at 22.7KB, for an artifact nothing will ever load. `--lib`
//! is used anyway, for reasons that hold regardless: it produces exactly the
//! 43-byte artifact the shared core actually is rather than a bin nobody
//! consumes, and it is insurance against the day `main.rs` gains a real
//! native dependency — a Postgres driver, `tokio`'s epoll bindings — that has
//! no `wasm32` story at all and would fail for real. See `Cargo.toml`.
//!
//! # Deliberately near-empty, and that emptiness was checked rather than assumed
//!
//! A first draft of this crate's contract proposed wire-envelope fields —
//! tier markers, sequence numbers, error codes — for a round-trip test to
//! exercise. Checked against VPS-A003 field by field before writing any of
//! them: a tier marker is A003-T06/T07's key-wrapping model, which resolves a
//! reader set from Privacy Class and subject exclusion and is not a byte on
//! an envelope. A sequence number for idempotency is A003-T02's guarantee,
//! and Loro's own CRDT operations are idempotent by construction — inventing
//! a Vulto-level counter here risks duplicating or contradicting whatever
//! Loro already provides. An error code has no A003 precedent at all, which
//! is itself the tell: nothing here has a real error path to report yet.
//!
//! Every one of those belongs to VPS-A003 and arrives with FDN-51. Defining
//! them now would mean designing A003's wire protocol from inside a
//! placeholder — the same expensive-direction argument that deferred the
//! sync engine's content in the first place, applied to its wire format
//! instead of its business logic. An empty-but-honest boundary beats a full
//! one A003 has to overturn.
//!
//! What this crate can honestly claim: it exists, it compiles to every
//! target the pipeline requires, and it identifies itself. That is
//! [`placeholder_info`], and it is the only public function.

/// Everything this crate can honestly say about itself right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlaceholderInfo {
    pub service: &'static str,
    pub status: &'static str,
    pub content_owner: &'static str,
}

/// The shared core's one exported behavior. `main.rs` calls this to build the
/// server binary's health response, so the "one source" claim is literal —
/// the JSON a running container returns is produced by the library this
/// module doc describes, not by a parallel copy that happens to agree with it.
pub fn placeholder_info() -> PlaceholderInfo {
    PlaceholderInfo {
        service: "vulto-sync-engine",
        status: "not implemented",
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
