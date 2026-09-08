//! Per-workspace live doorbell.
//!
//! When a delta is accepted the relay rings the workspace's doorbell; every
//! connected device wakes and delivers whatever is now in the store after its
//! own cursor (`connection.rs::deliver_pending`). The doorbell carries **no
//! payload and no ordering** — the durable `sync_delta` log is the single
//! authority on delta order (A003-T39), so a delivery cannot be corrupted by the
//! order notifications happen to arrive in.
//!
//! A [`tokio::sync::watch`] channel is the right primitive: a notification that
//! lands while a connection is mid-delivery is retained (the receiver still sees
//! "changed" on its next check), and there is no capacity to overflow, so a slow
//! consumer is never dropped — it just does a larger store read when it catches
//! up. Fan-out is to every connected device (A003-T44 — no per-recipient
//! filtering; that gap is F186, owned by FDN-89).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::watch;

/// The set of live per-workspace doorbells.
///
/// A channel is created on first subscribe and kept for the process lifetime
/// even after its last receiver drops — an idle `watch::Sender` is a few words,
/// and a workspace that has synced once will very likely sync again.
#[derive(Debug, Default, Clone)]
pub struct Hubs {
    channels: Arc<Mutex<HashMap<String, watch::Sender<()>>>>,
}

impl Hubs {
    /// Subscribe to a workspace's doorbell, creating it on first subscribe. The
    /// returned receiver's first `changed()` resolves on the next `notify`, not
    /// immediately.
    pub fn subscribe(&self, workspace_id: &str) -> watch::Receiver<()> {
        let mut channels = self.channels.lock().expect("hub registry mutex poisoned");
        channels
            .entry(workspace_id.to_owned())
            .or_insert_with(|| watch::channel(()).0)
            .subscribe()
    }

    /// Ring the workspace's doorbell. Every send marks the channel changed, so a
    /// wake is never coalesced away against a connection that is currently
    /// delivering. An error means there are no live receivers — fine, a
    /// reconnecting device catches up from the store.
    pub fn notify(&self, workspace_id: &str) {
        let channels = self.channels.lock().expect("hub registry mutex poisoned");
        if let Some(sender) = channels.get(workspace_id) {
            let _ = sender.send(());
        }
    }
}
