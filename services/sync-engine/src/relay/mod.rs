//! The relay server — FDN-51 Stage 2.
//!
//! A coordination layer, per `VPS-A003`'s sync topology: it accepts WebSocket
//! connections (A003-T36), authenticates them, relays `PushDelta` messages
//! between the connected devices of a workspace, persists every delta, assigns
//! each a durable per-workspace delivery cursor at commit (A003-T39), and
//! replays everything after a device's last acknowledgement on reconnect
//! (A003-T40). It never holds a canonical copy and never possesses a Tier 1/3
//! key — the payload bytes it stores and forwards are opaque to it (A003-T43).
//!
//! # Stage 2a (this checkpoint)
//!
//! The server, the connection state machine, session authentication behind the
//! [`SessionAuthorizer`] trait, and in-memory fan-out. Persistence sits behind
//! the [`DeltaStore`] trait with [`store::MemoryDeltaStore`]. Proven end-to-end
//! with real WebSocket clients (`tests/relay_ws.rs`) and no database.
//!
//! # Stage 2b (next)
//!
//! `PgDeltaStore` + `PgSessionAuthorizer` + SQL migrations + the real-Postgres
//! integration proof. The cursor becomes a per-workspace locked counter written
//! inside the same transaction that commits the delta row.

pub mod config;
pub mod connection;
pub mod hub;
pub mod pg;
pub mod server;
pub mod session;
pub mod store;

pub use config::{RelayConfig, DEFAULT_REVALIDATION_SECS};
pub use hub::Hubs;
pub use pg::{connect_pool, PgDeltaStore, PgSessionAuthorizer};
pub use server::{serve, serve_ephemeral, RelayState};
pub use session::{AuthorizedSession, SessionAuthorizer, SessionDenied, StaticSessionAuthorizer};
pub use store::MAX_DELTA_PAGE;
pub use store::{DeltaStore, MemoryDeltaStore, NewDelta, StoreError};
