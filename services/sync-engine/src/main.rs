//! The Vulto sync engine relay server — FDN-51 Stage 2.
//!
//! A thin entry point. Everything is in `vulto_sync_engine::relay`; this file
//! reads the environment, connects PostgreSQL, and runs the server.
//!
//! # Backends (Stage 2b)
//!
//! `PgDeltaStore` (durable delta log, per-workspace locked-counter cursor at
//! commit — A003-T39) and `PgSessionAuthorizer` (the admission query against the
//! live Better Auth / membership tables plus a device-revocation check).
//! `DATABASE_URL` is **required** — the relay refuses to start without it. The
//! schema is owned by Drizzle (`services/api/src/auth/schema.ts`); run
//! `pnpm --filter @vulto/api db:migrate` before first start.
//!
//! `A007-T17` still holds: the Dockerfile builds this in a discarded builder
//! stage and ships only the binary.

use std::process::ExitCode;
use std::sync::Arc;

use vulto_sync_engine::relay::{
    connect_pool, serve, Hubs, PgDeltaStore, PgSessionAuthorizer, RelayConfig, RelayState,
};

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let config = RelayConfig::from_env();

    let Some(database_url) = config.database_url.clone() else {
        tracing::error!(
            "DATABASE_URL is not set. The relay needs PostgreSQL for its durable delta \
             log and session authorization. In the compose stack it comes from the \
             service environment; locally, set it in .env at the repository root."
        );
        return ExitCode::FAILURE;
    };

    let pool = match connect_pool(&database_url).await {
        Ok(pool) => pool,
        Err(error) => {
            tracing::error!(%error, "could not connect to PostgreSQL");
            return ExitCode::FAILURE;
        }
    };

    let state = RelayState {
        store: Arc::new(PgDeltaStore::new(pool.clone())),
        authorizer: Arc::new(PgSessionAuthorizer::new(pool)),
        hubs: Hubs::default(),
        revalidation_interval: config.revalidation_interval,
    };

    if let Err(error) = serve(&config, state).await {
        tracing::error!(%error, "relay server exited with error");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
