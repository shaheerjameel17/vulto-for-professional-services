//! The Vulto sync engine relay server — FDN-51 Stage 2.
//!
//! A thin entry point. Everything is in `vulto_sync_engine::relay`; this file
//! reads the environment, chooses the backends, and runs the server.
//!
//! # Stage 2a
//!
//! The relay runs against an **in-memory** delta log ([`MemoryDeltaStore`]) and
//! a **static, empty** session authorizer ([`StaticSessionAuthorizer`]). It is a
//! functional relay for local protocol exercise and the `tests/relay_ws.rs`
//! proof — `/health` responds, `/sync` upgrades and speaks the full protocol —
//! but it rejects every real connection with `Error { unauthenticated }` until
//! Stage 2b wires `PgSessionAuthorizer` and `PgDeltaStore` against PostgreSQL.
//!
//! `A007-T17` still holds: the Dockerfile builds this in a discarded builder
//! stage and ships only the binary.

use std::sync::Arc;

use vulto_sync_engine::relay::Hubs;
use vulto_sync_engine::relay::{
    serve, MemoryDeltaStore, RelayConfig, RelayState, StaticSessionAuthorizer,
};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let config = RelayConfig::from_env();

    if config.database_url.is_none() {
        tracing::warn!(
            "DATABASE_URL is not set — running with the in-memory Stage 2a backend; \
             connections will be rejected as unauthenticated until Stage 2b"
        );
    }

    let state = RelayState {
        store: Arc::new(MemoryDeltaStore::default()),
        authorizer: Arc::new(StaticSessionAuthorizer::new()),
        hubs: Hubs::default(),
    };

    if let Err(error) = serve(&config, state).await {
        tracing::error!(%error, "relay server exited with error");
        std::process::exit(1);
    }
}
