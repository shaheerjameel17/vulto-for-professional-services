//! Connection authentication.
//!
//! `Hello` carries an opaque `session_token`. The relay must confirm it names a
//! current authenticated session that is authorized for the claimed workspace
//! and device before the connection may push or receive anything — the relay is
//! a revocation checkpoint, consistent with `VPS-A003`'s offline-unlock ruling.
//!
//! Stage 2a defines the [`SessionAuthorizer`] seam and a static test
//! implementation. Stage 2b adds `PgSessionAuthorizer`, which runs the exact
//! admission query in `services/api/src/auth/workspace-session.ts` (session +
//! member + user + organization, all active, session unexpired) plus a
//! `device_unlock_secret.revoked_at IS NULL` check.

/// A session the relay has accepted for a workspace and device.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorizedSession {
    pub user_id: String,
    pub workspace_id: String,
    pub device_id: String,
}

/// Why a connection was refused. One variant today; kept as an enum because
/// Stage 2b distinguishes "expired" from "revoked" from "never valid" for
/// logging, all of which still close the socket with `Error { unauthenticated }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionDenied {
    Unauthenticated,
}

/// Resolve an opaque session token to an [`AuthorizedSession`], or refuse.
#[async_trait::async_trait]
pub trait SessionAuthorizer: Send + Sync {
    async fn authorize(
        &self,
        session_token: &[u8],
        workspace_id: &str,
        device_id: &str,
    ) -> Result<AuthorizedSession, SessionDenied>;
}

/// A fixed allow-list. For tests and local protocol exercise only — it performs
/// no expiry, membership or revocation check because it has no database. The
/// binary wires this in Stage 2a and therefore rejects every real connection
/// until Stage 2b supplies `PgSessionAuthorizer`.
#[derive(Debug, Default, Clone)]
pub struct StaticSessionAuthorizer {
    entries: Vec<Entry>,
}

#[derive(Debug, Clone)]
struct Entry {
    token: Vec<u8>,
    workspace_id: String,
    device_id: String,
    user_id: String,
}

impl StaticSessionAuthorizer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register one `(token, workspace, device) -> user` triple as authorized.
    #[must_use]
    pub fn allow(
        mut self,
        token: impl Into<Vec<u8>>,
        workspace_id: impl Into<String>,
        device_id: impl Into<String>,
        user_id: impl Into<String>,
    ) -> Self {
        self.entries.push(Entry {
            token: token.into(),
            workspace_id: workspace_id.into(),
            device_id: device_id.into(),
            user_id: user_id.into(),
        });
        self
    }
}

#[async_trait::async_trait]
impl SessionAuthorizer for StaticSessionAuthorizer {
    async fn authorize(
        &self,
        session_token: &[u8],
        workspace_id: &str,
        device_id: &str,
    ) -> Result<AuthorizedSession, SessionDenied> {
        self.entries
            .iter()
            .find(|e| {
                e.token == session_token
                    && e.workspace_id == workspace_id
                    && e.device_id == device_id
            })
            .map(|e| AuthorizedSession {
                user_id: e.user_id.clone(),
                workspace_id: e.workspace_id.clone(),
                device_id: e.device_id.clone(),
            })
            .ok_or(SessionDenied::Unauthenticated)
    }
}
