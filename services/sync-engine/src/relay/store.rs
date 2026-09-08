//! The delta log behind a trait.
//!
//! [`DeltaStore`] is the seam between the relay's protocol logic and its
//! persistence. Stage 2a ships [`MemoryDeltaStore`]; Stage 2b adds
//! `PgDeltaStore`, where `append` runs inside a PostgreSQL transaction that
//! draws the delivery cursor from a per-workspace locked counter, so the cursor
//! order equals the commit order exactly (A003-T39).
//!
//! The cursor contract every implementation must honor:
//!
//! * strictly increasing per workspace, dense from 1;
//! * assigned at the point the delta is durably recorded, never before;
//! * never reused, never reordered relative to record order.
//!
//! `MemoryDeltaStore` gets this for free: a single mutex serializes `append`, so
//! the position in the workspace's `Vec` *is* the cursor.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::wire::{Cursor, DeltaEntry, PayloadKind, TierTag};

/// A store operation failed. The relay maps this to `Error { internal }` and
/// closes the socket without leaking the cause to the client.
#[derive(Debug)]
pub enum StoreError {
    Backend(String),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::Backend(detail) => write!(f, "delta store backend error: {detail}"),
        }
    }
}

impl std::error::Error for StoreError {}

/// A delta as the client submitted it, before the store assigns a cursor and a
/// commit timestamp.
#[derive(Debug, Clone)]
pub struct NewDelta {
    pub workspace_id: String,
    pub document_id: String,
    pub tier_tag: TierTag,
    pub payload_kind: PayloadKind,
    pub origin_device_id: String,
    /// Opaque. Loro change bytes for Tier 0/2, an FDN-52 protected envelope for
    /// Tier 1/3. The store persists and returns it unmodified and never inspects
    /// it (A003-T43).
    pub payload: Vec<u8>,
}

#[async_trait::async_trait]
pub trait DeltaStore: Send + Sync {
    /// Durably record a delta and return it with its assigned cursor and commit
    /// timestamp.
    async fn append(&self, delta: NewDelta) -> Result<DeltaEntry, StoreError>;

    /// Every delta for the workspace whose cursor is strictly greater than
    /// `after`, in cursor order. `document_id = Some(_)` restricts to one
    /// document; `None` is the whole workspace.
    async fn read_since(
        &self,
        workspace_id: &str,
        document_id: Option<&str>,
        after: Cursor,
    ) -> Result<Vec<DeltaEntry>, StoreError>;

    /// Record that a device has durably applied everything through `cursor`.
    /// Monotonic — a lower value than the stored one is ignored.
    async fn record_ack(
        &self,
        workspace_id: &str,
        device_id: &str,
        cursor: Cursor,
    ) -> Result<(), StoreError>;

    /// The cursor a device last acknowledged, or `Cursor::ZERO` if it never has.
    async fn acked_cursor(&self, workspace_id: &str, device_id: &str)
        -> Result<Cursor, StoreError>;

    /// The highest cursor recorded for the workspace, or `Cursor::ZERO`.
    async fn highest_cursor(&self, workspace_id: &str) -> Result<Cursor, StoreError>;
}

/// In-memory delta log. Non-durable — every restart is empty. Stage 2a's proof
/// vehicle and a valid backend for a single-process local relay.
#[derive(Debug, Default)]
pub struct MemoryDeltaStore {
    inner: Mutex<Inner>,
}

#[derive(Debug, Default)]
struct Inner {
    /// workspace id -> deltas in cursor order (index + 1 == cursor).
    deltas: HashMap<String, Vec<DeltaEntry>>,
    /// (workspace id, device id) -> acknowledged cursor value.
    acks: HashMap<(String, String), u64>,
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[async_trait::async_trait]
impl DeltaStore for MemoryDeltaStore {
    async fn append(&self, delta: NewDelta) -> Result<DeltaEntry, StoreError> {
        let mut inner = self.inner.lock().expect("delta store mutex poisoned");
        let log = inner.deltas.entry(delta.workspace_id).or_default();
        let cursor = Cursor(log.len() as u64 + 1);
        let entry = DeltaEntry {
            cursor,
            document_id: delta.document_id,
            tier_tag: delta.tier_tag,
            payload_kind: delta.payload_kind,
            origin_device_id: delta.origin_device_id,
            committed_at_unix_ms: now_unix_ms(),
            payload: delta.payload,
        };
        log.push(entry.clone());
        Ok(entry)
    }

    async fn read_since(
        &self,
        workspace_id: &str,
        document_id: Option<&str>,
        after: Cursor,
    ) -> Result<Vec<DeltaEntry>, StoreError> {
        let inner = self.inner.lock().expect("delta store mutex poisoned");
        let Some(log) = inner.deltas.get(workspace_id) else {
            return Ok(Vec::new());
        };
        Ok(log
            .iter()
            .filter(|e| e.cursor.succeeds(after))
            .filter(|e| document_id.is_none_or(|doc| e.document_id == doc))
            .cloned()
            .collect())
    }

    async fn record_ack(
        &self,
        workspace_id: &str,
        device_id: &str,
        cursor: Cursor,
    ) -> Result<(), StoreError> {
        let mut inner = self.inner.lock().expect("delta store mutex poisoned");
        let slot = inner
            .acks
            .entry((workspace_id.to_owned(), device_id.to_owned()))
            .or_insert(0);
        *slot = (*slot).max(cursor.value());
        Ok(())
    }

    async fn acked_cursor(
        &self,
        workspace_id: &str,
        device_id: &str,
    ) -> Result<Cursor, StoreError> {
        let inner = self.inner.lock().expect("delta store mutex poisoned");
        Ok(Cursor(
            inner
                .acks
                .get(&(workspace_id.to_owned(), device_id.to_owned()))
                .copied()
                .unwrap_or(0),
        ))
    }

    async fn highest_cursor(&self, workspace_id: &str) -> Result<Cursor, StoreError> {
        let inner = self.inner.lock().expect("delta store mutex poisoned");
        Ok(inner
            .deltas
            .get(workspace_id)
            .and_then(|log| log.last())
            .map(|e| e.cursor)
            .unwrap_or(Cursor::ZERO))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wire::{PayloadKind, TierTag};

    fn sample(workspace: &str, device: &str, doc: &str) -> NewDelta {
        NewDelta {
            workspace_id: workspace.to_owned(),
            document_id: doc.to_owned(),
            tier_tag: TierTag::Opaque,
            payload_kind: PayloadKind::Update,
            origin_device_id: device.to_owned(),
            payload: vec![1, 2, 3],
        }
    }

    #[tokio::test]
    async fn append_assigns_dense_increasing_cursors_per_workspace() {
        let store = MemoryDeltaStore::default();
        let a1 = store.append(sample("ws-a", "d1", "doc")).await.unwrap();
        let a2 = store.append(sample("ws-a", "d1", "doc")).await.unwrap();
        let b1 = store.append(sample("ws-b", "d1", "doc")).await.unwrap();
        assert_eq!(a1.cursor, Cursor(1));
        assert_eq!(a2.cursor, Cursor(2));
        assert_eq!(b1.cursor, Cursor(1), "cursors are per workspace");
        assert_eq!(store.highest_cursor("ws-a").await.unwrap(), Cursor(2));
        assert_eq!(store.highest_cursor("ws-b").await.unwrap(), Cursor(1));
    }

    #[tokio::test]
    async fn read_since_is_exclusive_and_ordered_and_document_scoped() {
        let store = MemoryDeltaStore::default();
        store.append(sample("ws", "d1", "doc-1")).await.unwrap();
        store.append(sample("ws", "d1", "doc-2")).await.unwrap();
        store.append(sample("ws", "d1", "doc-1")).await.unwrap();

        let all = store.read_since("ws", None, Cursor(1)).await.unwrap();
        assert_eq!(
            all.iter().map(|e| e.cursor.value()).collect::<Vec<_>>(),
            [2, 3]
        );

        let doc1 = store
            .read_since("ws", Some("doc-1"), Cursor::ZERO)
            .await
            .unwrap();
        assert_eq!(
            doc1.iter().map(|e| e.cursor.value()).collect::<Vec<_>>(),
            [1, 3]
        );

        assert!(store
            .read_since("unknown", None, Cursor::ZERO)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn ack_is_monotonic() {
        let store = MemoryDeltaStore::default();
        store.record_ack("ws", "dev", Cursor(5)).await.unwrap();
        store.record_ack("ws", "dev", Cursor(3)).await.unwrap();
        assert_eq!(store.acked_cursor("ws", "dev").await.unwrap(), Cursor(5));
        store.record_ack("ws", "dev", Cursor(9)).await.unwrap();
        assert_eq!(store.acked_cursor("ws", "dev").await.unwrap(), Cursor(9));
        assert_eq!(
            store.acked_cursor("ws", "other").await.unwrap(),
            Cursor::ZERO,
            "an unknown device has acknowledged nothing"
        );
    }

    #[tokio::test]
    async fn concurrent_appends_to_one_workspace_produce_a_gapless_sequence() {
        use std::sync::Arc;
        let store = Arc::new(MemoryDeltaStore::default());
        let mut tasks = Vec::new();
        for _ in 0..50 {
            let store = store.clone();
            tasks.push(tokio::spawn(async move {
                store
                    .append(sample("ws", "d1", "doc"))
                    .await
                    .unwrap()
                    .cursor
                    .value()
            }));
        }
        let mut cursors = Vec::new();
        for t in tasks {
            cursors.push(t.await.unwrap());
        }
        cursors.sort_unstable();
        assert_eq!(cursors, (1..=50).collect::<Vec<_>>());
    }
}
