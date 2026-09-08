//! PostgreSQL-backed [`DeltaStore`] and [`SessionAuthorizer`] — FDN-51 Stage 2b.
//!
//! `sqlx` is used only as a query executor: the runtime `query()` / `query_scalar()`
//! API over a `PgPool`, no `query!` macro and no `sqlx::migrate!`. The schema is
//! owned by Drizzle (`services/api/src/auth/schema.ts`, migration
//! `0002_wealthy_magneto`), so `cargo build` and the Docker image need no
//! database and no `.sqlx` cache.

use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::postgres::{PgPool, PgPoolOptions, PgRow};
use sqlx::Row;
use uuid::Uuid;

use crate::wire::{Cursor, DeltaEntry, PayloadKind, TierTag};

use super::session::{AuthorizedSession, SessionAuthorizer, SessionDenied};
use super::store::{DeltaStore, NewDelta, StoreError, MAX_DELTA_PAGE};

/// Open a pooled connection to PostgreSQL.
pub async fn connect_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(16)
        .acquire_timeout(Duration::from_secs(10))
        .connect(database_url)
        .await
}

fn backend(error: sqlx::Error) -> StoreError {
    StoreError::Backend(error.to_string())
}

fn workspace_uuid(workspace_id: &str) -> Result<Uuid, StoreError> {
    Uuid::parse_str(workspace_id)
        .map_err(|_| StoreError::Backend(format!("workspace id is not a uuid: {workspace_id:?}")))
}

fn cursor_to_i64(cursor: Cursor) -> i64 {
    i64::try_from(cursor.value()).unwrap_or(i64::MAX)
}

fn row_to_entry(row: &PgRow) -> Result<DeltaEntry, StoreError> {
    let cursor: i64 = row.try_get("cursor").map_err(backend)?;
    let tier: i16 = row.try_get("tier_tag").map_err(backend)?;
    let kind: i16 = row.try_get("payload_kind").map_err(backend)?;
    let committed_ms: i64 = row.try_get("committed_at_ms").map_err(backend)?;

    let tier_tag = u8::try_from(tier)
        .ok()
        .and_then(|byte| TierTag::try_from_u8(byte).ok())
        .ok_or_else(|| StoreError::Backend(format!("invalid tier_tag {tier}")))?;
    let payload_kind = u8::try_from(kind)
        .ok()
        .and_then(|byte| PayloadKind::try_from_u8(byte).ok())
        .ok_or_else(|| StoreError::Backend(format!("invalid payload_kind {kind}")))?;

    Ok(DeltaEntry {
        cursor: Cursor(
            u64::try_from(cursor)
                .map_err(|_| StoreError::Backend(format!("negative cursor {cursor}")))?,
        ),
        document_id: row.try_get("document_id").map_err(backend)?,
        tier_tag,
        payload_kind,
        origin_device_id: row.try_get("origin_device_id").map_err(backend)?,
        committed_at_unix_ms: u64::try_from(committed_ms).unwrap_or(0),
        payload: row.try_get("payload").map_err(backend)?,
    })
}

/// Durable delta log in PostgreSQL. `append` assigns the delivery cursor from a
/// per-workspace locked counter inside the same transaction that commits the
/// delta row, so cursor order equals commit order exactly (A003-T39).
#[derive(Debug, Clone)]
pub struct PgDeltaStore {
    pool: PgPool,
}

impl PgDeltaStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl DeltaStore for PgDeltaStore {
    async fn append(&self, delta: NewDelta) -> Result<DeltaEntry, StoreError> {
        let workspace = workspace_uuid(&delta.workspace_id)?;
        let mut tx = self.pool.begin().await.map_err(backend)?;

        // (a) ensure the per-workspace counter row exists.
        sqlx::query(
            "INSERT INTO sync_workspace_cursor (workspace_id, last_cursor) \
             VALUES ($1, 0) ON CONFLICT (workspace_id) DO NOTHING",
        )
        .bind(workspace)
        .execute(&mut *tx)
        .await
        .map_err(backend)?;

        // (b) claim: lock the counter row. Concurrent appends for this
        //     workspace serialize here until this transaction commits.
        let last_cursor: i64 = sqlx::query_scalar(
            "SELECT last_cursor FROM sync_workspace_cursor WHERE workspace_id = $1 FOR UPDATE",
        )
        .bind(workspace)
        .fetch_one(&mut *tx)
        .await
        .map_err(backend)?;
        let next = last_cursor
            .checked_add(1)
            .ok_or_else(|| StoreError::Backend("workspace cursor overflow".to_owned()))?;

        // (c) insert the delta at `next`, returning the DB commit timestamp.
        let committed_at: DateTime<Utc> = sqlx::query_scalar(
            "INSERT INTO sync_delta \
               (workspace_id, cursor, document_id, tier_tag, payload_kind, origin_device_id, payload) \
             VALUES ($1, $2, $3, $4, $5, $6, $7) \
             RETURNING committed_at",
        )
        .bind(workspace)
        .bind(next)
        .bind(&delta.document_id)
        .bind(i16::from(delta.tier_tag.as_u8()))
        .bind(i16::from(delta.payload_kind.as_u8()))
        .bind(&delta.origin_device_id)
        .bind(delta.payload.as_slice())
        .fetch_one(&mut *tx)
        .await
        .map_err(backend)?;

        // (d) advance the counter.
        sqlx::query("UPDATE sync_workspace_cursor SET last_cursor = $2 WHERE workspace_id = $1")
            .bind(workspace)
            .bind(next)
            .execute(&mut *tx)
            .await
            .map_err(backend)?;

        tx.commit().await.map_err(backend)?;

        Ok(DeltaEntry {
            cursor: Cursor(next as u64),
            document_id: delta.document_id,
            tier_tag: delta.tier_tag,
            payload_kind: delta.payload_kind,
            origin_device_id: delta.origin_device_id,
            committed_at_unix_ms: u64::try_from(committed_at.timestamp_millis()).unwrap_or(0),
            payload: delta.payload,
        })
    }

    async fn read_since(
        &self,
        workspace_id: &str,
        document_id: Option<&str>,
        after: Cursor,
    ) -> Result<Vec<DeltaEntry>, StoreError> {
        let workspace = workspace_uuid(workspace_id)?;
        let rows = sqlx::query(
            "SELECT cursor, document_id, tier_tag, payload_kind, origin_device_id, \
                    (extract(epoch from committed_at) * 1000)::bigint AS committed_at_ms, payload \
             FROM sync_delta \
             WHERE workspace_id = $1 \
               AND cursor > $2 \
               AND ($3::text IS NULL OR document_id = $3) \
             ORDER BY cursor \
             LIMIT $4",
        )
        .bind(workspace)
        .bind(cursor_to_i64(after))
        .bind(document_id)
        .bind(MAX_DELTA_PAGE as i64)
        .fetch_all(&self.pool)
        .await
        .map_err(backend)?;

        rows.iter().map(row_to_entry).collect()
    }

    async fn record_ack(
        &self,
        workspace_id: &str,
        device_id: &str,
        cursor: Cursor,
    ) -> Result<(), StoreError> {
        let workspace = workspace_uuid(workspace_id)?;
        // The monotonic clamp is GREATEST(...) in SQL, not application code.
        sqlx::query(
            "INSERT INTO sync_device_ack (workspace_id, device_id, acked_cursor, updated_at) \
             VALUES ($1, $2, $3, now()) \
             ON CONFLICT (workspace_id, device_id) DO UPDATE SET \
               acked_cursor = GREATEST(sync_device_ack.acked_cursor, EXCLUDED.acked_cursor), \
               updated_at = now()",
        )
        .bind(workspace)
        .bind(device_id)
        .bind(cursor_to_i64(cursor))
        .execute(&self.pool)
        .await
        .map_err(backend)?;
        Ok(())
    }

    async fn acked_cursor(
        &self,
        workspace_id: &str,
        device_id: &str,
    ) -> Result<Cursor, StoreError> {
        let workspace = workspace_uuid(workspace_id)?;
        let value: Option<i64> = sqlx::query_scalar(
            "SELECT acked_cursor FROM sync_device_ack WHERE workspace_id = $1 AND device_id = $2",
        )
        .bind(workspace)
        .bind(device_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(backend)?;
        Ok(Cursor(
            value.and_then(|v| u64::try_from(v).ok()).unwrap_or(0),
        ))
    }

    async fn highest_cursor(&self, workspace_id: &str) -> Result<Cursor, StoreError> {
        let workspace = workspace_uuid(workspace_id)?;
        let value: Option<i64> = sqlx::query_scalar(
            "SELECT last_cursor FROM sync_workspace_cursor WHERE workspace_id = $1",
        )
        .bind(workspace)
        .fetch_optional(&self.pool)
        .await
        .map_err(backend)?;
        Ok(Cursor(
            value.and_then(|v| u64::try_from(v).ok()).unwrap_or(0),
        ))
    }
}

/// Authorizes a connection against the live Better Auth / membership tables.
#[derive(Debug, Clone)]
pub struct PgSessionAuthorizer {
    pool: PgPool,
}

impl PgSessionAuthorizer {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl SessionAuthorizer for PgSessionAuthorizer {
    async fn authorize(
        &self,
        session_token: &[u8],
        workspace_id: &str,
        device_id: &str,
    ) -> Result<AuthorizedSession, SessionDenied> {
        // `session_token` is the raw Better Auth token — `session.token` is
        // stored unhashed (verified against better-auth@1.6.29; see the FDN-51
        // Stage 2b confirmation comment). Possession of the unguessable 32-char
        // token is the proof, exactly as Better Auth's own `findSession` treats
        // it. A client sending the signed `<token>.<sig>` cookie form is a
        // Stage 4 concern.
        let token = match std::str::from_utf8(session_token) {
            Ok(token) => token,
            Err(_) => return Err(SessionDenied::Unauthenticated),
        };
        let workspace = match Uuid::parse_str(workspace_id) {
            Ok(id) => id,
            Err(_) => return Err(SessionDenied::Unauthenticated),
        };

        // ----------------------------------------------------------------------
        // DELIBERATE, NECESSARY RE-DERIVATION of Better Auth's session-validity
        // logic. The relay is a Rust process and cannot call the Node
        // `better-auth` library or `requireCurrentWorkspaceSession`, so the
        // session / membership / status / expiry checks are reproduced here by
        // hand. This SQL MUST be manually re-checked against
        // `services/api/src/auth/workspace-session.ts` any time that file's
        // admission query changes — there is no compiler or type system linking
        // the two, and a divergence would either lock out valid sessions or
        // admit ones the HTTP layer rejects.
        //
        // The `device_unlock_secret.revoked_at IS NULL` join is an intentional
        // ADDITION the HTTP guard does not have (an HTTP request carries no
        // device). It must be preserved: it is the one condition between a
        // centrally revoked device and "still gets in". The INNER join plus the
        // predicate mean a device with no row, or a row with a non-null
        // `revoked_at`, yields zero rows -> SessionDenied.
        // ----------------------------------------------------------------------
        let row = sqlx::query(
            r#"
            SELECT u.id::text AS user_id,
                   o.id::text AS workspace_id
            FROM session s
            JOIN "user" u                ON u.id = s.user_id
            JOIN member m                ON m.user_id = u.id
                                       AND m.organization_id = $2
            JOIN organization o          ON o.id = m.organization_id
            JOIN device_unlock_secret d  ON d.workspace_id = o.id
                                       AND d.user_id = u.id
                                       AND d.device_id = $3
            WHERE s.token            = $1
              AND s.expires_at       > now()
              AND u.status           = 'active'
              AND o.status           = 'active'
              AND m.status           = 'active'
              AND m.projection_state = 'confirmed'
              AND d.revoked_at IS NULL
            LIMIT 1
            "#,
        )
        .bind(token)
        .bind(workspace)
        .bind(device_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            tracing::error!(%error, "session authorization query failed");
            SessionDenied::Unauthenticated
        })?;

        match row {
            Some(row) => {
                let user_id: String = row
                    .try_get("user_id")
                    .map_err(|_| SessionDenied::Unauthenticated)?;
                let workspace_id: String = row
                    .try_get("workspace_id")
                    .map_err(|_| SessionDenied::Unauthenticated)?;
                Ok(AuthorizedSession {
                    user_id,
                    workspace_id,
                    device_id: device_id.to_owned(),
                })
            }
            None => Err(SessionDenied::Unauthenticated),
        }
    }
}
