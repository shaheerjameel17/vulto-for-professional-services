//! The Axum HTTP surface and the server run loop.
//!
//! Two routes: `GET /health` (a small JSON body, so the compose stack and
//! `docs/Bootstrap.md`'s `curl :8080/health` keep working) and `GET /sync` (the
//! WebSocket upgrade — the only real interface, A003-T36).

use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{ws::WebSocketUpgrade, State};
use axum::http::header::CONTENT_TYPE;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use tokio::net::TcpListener;

use super::config::RelayConfig;
use super::connection::{handle_connection, ConnectionDeps};
use super::hub::Hubs;
use super::session::SessionAuthorizer;
use super::store::DeltaStore;

/// Everything the relay shares across connections. Cheap to clone — every field
/// is an `Arc` or `Arc`-backed.
#[derive(Clone)]
pub struct RelayState {
    pub store: Arc<dyn DeltaStore>,
    pub authorizer: Arc<dyn SessionAuthorizer>,
    pub hubs: Hubs,
}

/// Build the router.
pub fn router(state: RelayState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/sync", get(sync_upgrade))
        .with_state(state)
}

async fn health() -> impl IntoResponse {
    (
        [(CONTENT_TYPE, "application/json")],
        concat!(
            "{\"service\":\"vulto-sync-engine\",",
            "\"status\":\"relay running\",",
            "\"transport\":\"websocket\",",
            "\"stage\":\"FDN-51 Stage 2a\"}"
        ),
    )
}

async fn sync_upgrade(State(state): State<RelayState>, upgrade: WebSocketUpgrade) -> Response {
    upgrade.on_upgrade(move |socket| async move {
        handle_connection(
            socket,
            ConnectionDeps {
                store: state.store.clone(),
                authorizer: state.authorizer.clone(),
                hubs: state.hubs.clone(),
            },
        )
        .await
    })
}

/// Bind and serve until a shutdown signal.
pub async fn serve(config: &RelayConfig, state: RelayState) -> std::io::Result<()> {
    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .map_err(|error| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!(
                    "invalid bind address {}:{}: {error}",
                    config.host, config.port
                ),
            )
        })?;

    let listener = TcpListener::bind(addr).await?;
    tracing::info!(%addr, "vulto-sync-engine relay listening");

    axum::serve(listener, router(state))
        .with_graceful_shutdown(shutdown_signal())
        .await
}

/// Serve on an OS-assigned port (`127.0.0.1:0`) and return the bound address
/// alongside the server future. For integration tests.
pub async fn serve_ephemeral(
    state: RelayState,
) -> std::io::Result<(
    SocketAddr,
    impl std::future::Future<Output = std::io::Result<()>>,
)> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    let server = async move { axum::serve(listener, router(state)).await };
    Ok((addr, server))
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => tracing::warn!(%error, "could not install SIGTERM handler"),
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
    tracing::info!("shutdown signal received");
}
