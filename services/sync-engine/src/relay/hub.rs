//! Per-workspace live fan-out.
//!
//! When a delta is accepted, it is published to every currently connected
//! device of its workspace (A003-T44 — no per-recipient filtering; that gap is
//! F186, owned by FDN-89). Each connection holds a [`tokio::sync::broadcast`]
//! receiver; a slow consumer that lags the channel falls back to a store re-read
//! (see `connection.rs`), so a live delta is never silently lost.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::wire::DeltaEntry;
use tokio::sync::broadcast;

/// Broadcast buffer per workspace. A connection that falls this far behind is
/// caught up from the store instead.
const HUB_CAPACITY: usize = 1024;

/// The set of live per-workspace broadcast channels.
///
/// A channel is created on first subscribe and kept for the process lifetime
/// even after its last receiver drops — an idle `broadcast::Sender` is a few
/// words, and a workspace that has synced once will very likely sync again.
#[derive(Debug, Default, Clone)]
pub struct Hubs {
    channels: Arc<Mutex<HashMap<String, broadcast::Sender<Arc<DeltaEntry>>>>>,
}

impl Hubs {
    /// Subscribe to a workspace's live delta stream, creating the channel if
    /// this is its first subscriber.
    pub fn subscribe(&self, workspace_id: &str) -> broadcast::Receiver<Arc<DeltaEntry>> {
        let mut channels = self.channels.lock().expect("hub registry mutex poisoned");
        channels
            .entry(workspace_id.to_owned())
            .or_insert_with(|| broadcast::channel(HUB_CAPACITY).0)
            .subscribe()
    }

    /// Publish an accepted delta to the workspace's live subscribers. A send
    /// error means there are no live receivers, which is fine — reconnecting
    /// devices catch up from the store.
    pub fn publish(&self, workspace_id: &str, entry: Arc<DeltaEntry>) {
        let channels = self.channels.lock().expect("hub registry mutex poisoned");
        if let Some(sender) = channels.get(workspace_id) {
            let _ = sender.send(entry);
        }
    }
}
