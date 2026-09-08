//! Relay configuration from the environment.
//!
//! Mirrors the loud-failure philosophy of `services/api/src/env.ts` — a config
//! value that is wrong should fail visibly, not degrade quietly. Stage 2a needs
//! almost nothing: the relay runs against an in-memory store, so `DATABASE_URL`
//! is read but **its absence is not an error**. It becomes a required,
//! loudly-checked variable in Stage 2b when `PgDeltaStore` depends on it.

/// Resolved relay configuration.
#[derive(Debug, Clone)]
pub struct RelayConfig {
    /// Bind host. Default `0.0.0.0` (the compose service publishes `8080:8080`).
    pub host: String,
    /// Bind port. Default `8080`, matching `docker-compose.yml`.
    pub port: u16,
    /// PostgreSQL connection string. `None` in Stage 2a — unused. Stage 2b makes
    /// it required and fails loudly when missing.
    pub database_url: Option<String>,
}

impl RelayConfig {
    /// Read the environment. Never panics; missing optional values take defaults.
    pub fn from_env() -> Self {
        RelayConfig {
            host: non_empty_var("SYNC_ENGINE_HOST").unwrap_or_else(|| "0.0.0.0".to_owned()),
            port: non_empty_var("SYNC_ENGINE_PORT")
                .and_then(|value| value.parse().ok())
                .unwrap_or(8080),
            database_url: non_empty_var("DATABASE_URL"),
        }
    }
}

fn non_empty_var(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}
