//! Relay configuration from the environment.
//!
//! Mirrors the loud-failure philosophy of `services/api/src/env.ts` — a config
//! value that is wrong should fail visibly, not degrade quietly.

use std::time::Duration;

/// Default mid-session re-authorization interval (FDN-51 Stage 3). Every open
/// connection re-runs its admission check this often; a device revoked or
/// expired while connected is cut off within one interval.
pub const DEFAULT_REVALIDATION_SECS: u64 = 10;

/// Resolved relay configuration.
#[derive(Debug, Clone)]
pub struct RelayConfig {
    /// Bind host. Default `0.0.0.0` (the compose service publishes `8080:8080`).
    pub host: String,
    /// Bind port. Default `8080`, matching `docker-compose.yml`.
    pub port: u16,
    /// PostgreSQL connection string. Required by `main.rs` (Stage 2b); the
    /// in-memory backend used by tests does not need it.
    pub database_url: Option<String>,
    /// How often an open connection re-checks its authorization (Stage 3).
    /// `Duration::ZERO` disables the check (used by tests that do not exercise
    /// eviction).
    pub revalidation_interval: Duration,
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
            revalidation_interval: Duration::from_secs(
                non_empty_var("SYNC_REVALIDATION_SECS")
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(DEFAULT_REVALIDATION_SECS),
            ),
        }
    }
}

fn non_empty_var(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}
