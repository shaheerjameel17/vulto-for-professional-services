//! The per-connection state machine.
//!
//! One WebSocket connection = one device of one workspace, for the life of the
//! socket. The flow, per `VPS-A003`'s "Sync transport contract":
//!
//! 1. First frame MUST be `Hello`. Negotiate the protocol version (A003-T38),
//!    then authorize the session against the workspace and device.
//! 2. Subscribe to the workspace doorbell, then replay every delta after this
//!    device's last acknowledgement, **paged**, in cursor order, before live
//!    traffic (A003-T40).
//! 3. Serve the loop:
//!    - inbound `PushDelta` -> store -> `Ack{RelayReceipt}` -> ring the doorbell;
//!    - inbound `Ack{ClientCumulative}` -> record; `PullSinceCursor` ->
//!      `DeltaBatch` (paged).
//!    - the doorbell wakes -> deliver everything now in the store after this
//!      connection's cursor, **read in `ORDER BY cursor` from the store** — the
//!      doorbell carries no ordering, so an out-of-order notification can never
//!      corrupt delivery.
//!    - a re-authorization timer (Stage 3) re-checks admission every
//!      `revalidation_interval`; a device revoked or expired while connected is
//!      cut off within one interval.
//!
//! Any protocol violation or decode failure sends a typed `Error` frame and
//! closes the socket (A003-T37). The relay never inspects a payload (A003-T43).
//!
//! **Duplicate delivery is safe.** A client can apply a delta and then drop
//! before acknowledging; on reconnect the relay replays it from the older
//! `acked_cursor`. Re-applying it is a mathematical no-op: the payload is Loro
//! CRDT update bytes (Tier 0/2) or an FDN-52 envelope wrapping them (Tier 1/3),
//! and Loro identifies every operation by `(peer id, counter)` — importing ops
//! already in the document's version vector changes nothing (A003-T02;
//! `packages/graph`'s Loro round-trip tests cover the client side). The relay
//! never needs to reason about the payload.

use std::sync::Arc;
use std::time::Duration;

use crate::wire::{
    decode, encode, negotiate, Ack, Cursor, DeltaBatch, DeltaEntry, ErrorKind, Message,
    PullSinceCursor, PushDelta, SyncState, SyncStatus, WireErrorMessage, SUPPORTED_VERSIONS,
};
use axum::extract::ws::{Message as WsMessage, WebSocket};
use tokio::time::{interval_at, Instant, MissedTickBehavior};

use super::hub::Hubs;
use super::session::SessionAuthorizer;
use super::store::{DeltaStore, NewDelta, StoreError, MAX_DELTA_PAGE};

/// What every connection needs, cloned in from the shared relay state.
pub struct ConnectionDeps {
    pub store: Arc<dyn DeltaStore>,
    pub authorizer: Arc<dyn SessionAuthorizer>,
    pub hubs: Hubs,
    /// `Duration::ZERO` disables the mid-session re-authorization check.
    pub revalidation_interval: Duration,
}

/// A reason the connection is ending. `frame` is an `Error` message to send
/// before closing, or `None` for a silent close (client already gone, transport
/// broke).
struct Closed {
    frame: Option<Message>,
}

impl Closed {
    fn silent() -> Self {
        Closed { frame: None }
    }

    fn protocol(kind: ErrorKind, detail: impl Into<String>) -> Self {
        Closed {
            frame: Some(Message::Error(WireErrorMessage {
                kind,
                detail: detail.into(),
            })),
        }
    }

    fn from_store(_error: StoreError) -> Self {
        // The cause is logged relay-side; the client is told only that it was
        // internal, never a backend detail.
        Closed::protocol(ErrorKind::Internal, "relay storage error")
    }
}

/// Drive one accepted WebSocket connection to completion.
pub async fn handle_connection(mut socket: WebSocket, deps: ConnectionDeps) {
    if let Err(closed) = run(&mut socket, &deps).await {
        if let Some(frame) = closed.frame {
            let _ = socket.send(WsMessage::Binary(encode(&frame).into())).await;
        }
        let _ = socket.send(WsMessage::Close(None)).await;
    }
}

async fn run(socket: &mut WebSocket, deps: &ConnectionDeps) -> Result<(), Closed> {
    // 1. Hello.
    let first = next_binary(socket).await.ok_or_else(Closed::silent)?;
    let hello = match decode(&first) {
        Ok(Message::Hello(hello)) => hello,
        Ok(other) => {
            return Err(Closed::protocol(
                ErrorKind::MalformedFrame,
                format!("first frame must be Hello, got {:?}", other.message_type()),
            ))
        }
        Err(error) => {
            return Err(Closed::protocol(
                ErrorKind::MalformedFrame,
                error.to_string(),
            ))
        }
    };

    negotiate(
        hello.client_min_version,
        hello.client_max_version,
        SUPPORTED_VERSIONS,
    )
    .map_err(|_| {
        Closed::protocol(
            ErrorKind::UnsupportedVersion,
            format!("relay implements protocol version(s) {SUPPORTED_VERSIONS:?}"),
        )
    })?;

    // Kept for the mid-session re-authorization check below.
    let session_token = hello.session_token;

    let session = deps
        .authorizer
        .authorize(&session_token, &hello.workspace_id, &hello.device_id)
        .await
        .map_err(|_| {
            Closed::protocol(
                ErrorKind::Unauthenticated,
                "session is not authorized for this workspace and device",
            )
        })?;

    let workspace_id = session.workspace_id;
    let device_id = session.device_id;
    tracing::info!(%workspace_id, %device_id, user_id = %session.user_id, "device connected");

    // 2. Subscribe before replay so a delta committed during replay still wakes
    //    us afterwards.
    let mut doorbell = deps.hubs.subscribe(&workspace_id);

    let acked = deps
        .store
        .acked_cursor(&workspace_id, &device_id)
        .await
        .map_err(Closed::from_store)?;

    // `sent` tracks the highest cursor this connection has delivered to the
    // client or knows the client already holds (its own pushes). Only ever
    // advanced past a cursor once that cursor has been successfully sent.
    let mut sent = acked;

    // Replay: everything after the durable ack, paged, own deltas included
    // (a reconnecting device may legitimately need its own history re-sent —
    // idempotent per the module doc).
    deliver_pending(socket, deps, &workspace_id, &device_id, &mut sent, false).await?;

    // 3. Initial status.
    let highest = deps
        .store
        .highest_cursor(&workspace_id)
        .await
        .map_err(Closed::from_store)?;
    send(
        socket,
        &Message::SyncStatus(SyncStatus {
            state: sync_state(sent, highest),
            highest_known_cursor: highest,
            highest_acknowledged_cursor: acked,
        }),
    )
    .await?;

    // 4. Serve.
    let reauth_enabled = !deps.revalidation_interval.is_zero();
    let mut reauth = {
        let period = if reauth_enabled {
            deps.revalidation_interval
        } else {
            Duration::from_secs(3600)
        };
        // Jitter the first tick over the interval so connections do not stampede
        // the database together.
        let jitter =
            Duration::from_nanos(u64::from(subsec_nanos()) % period.as_nanos().max(1) as u64);
        let mut timer = interval_at(Instant::now() + jitter + period, period);
        timer.set_missed_tick_behavior(MissedTickBehavior::Delay);
        timer
    };
    let mut doorbell_open = true;

    loop {
        tokio::select! {
            inbound = socket.recv() => {
                let Some(message) = inbound else { return Ok(()) };
                let message = message.map_err(|_| Closed::silent())?;
                match message {
                    WsMessage::Binary(bytes) => {
                        handle_inbound(socket, deps, &workspace_id, &device_id, &bytes, &mut sent).await?;
                    }
                    WsMessage::Close(_) => return Ok(()),
                    WsMessage::Ping(_) | WsMessage::Pong(_) => {}
                    WsMessage::Text(_) => {
                        return Err(Closed::protocol(
                            ErrorKind::MalformedFrame,
                            "this protocol is binary; text frames are not accepted",
                        ));
                    }
                }
            }
            changed = doorbell.changed(), if doorbell_open => {
                match changed {
                    Ok(()) => {
                        deliver_pending(socket, deps, &workspace_id, &device_id, &mut sent, true).await?;
                    }
                    Err(_) => {
                        // The workspace doorbell was dropped (only at shutdown).
                        // Stop selecting on it; keep serving inbound traffic.
                        doorbell_open = false;
                    }
                }
            }
            _ = reauth.tick(), if reauth_enabled => {
                if deps
                    .authorizer
                    .authorize(&session_token, &workspace_id, &device_id)
                    .await
                    .is_err()
                {
                    tracing::info!(%workspace_id, %device_id, "session revoked or expired mid-session; evicting");
                    return Err(Closed::protocol(
                        ErrorKind::Unauthenticated,
                        "session revoked or expired mid-session",
                    ));
                }
            }
        }
    }
}

/// Send every delta in the workspace after `sent`, in cursor order, paging until
/// the store returns a short page. `skip_own` filters this device's own deltas
/// from the live path (it already holds them); replay passes `false`.
///
/// `sent` is advanced only after a page is successfully sent — a send failure
/// leaves it at the last delivered cursor and the connection ends, so reconnect
/// resumes cleanly from the durable ack.
async fn deliver_pending(
    socket: &mut WebSocket,
    deps: &ConnectionDeps,
    workspace_id: &str,
    device_id: &str,
    sent: &mut Cursor,
    skip_own: bool,
) -> Result<(), Closed> {
    loop {
        let page = deps
            .store
            .read_since(workspace_id, None, *sent)
            .await
            .map_err(Closed::from_store)?;
        let Some(last) = page.last() else {
            return Ok(());
        };

        let page_len = page.len();
        let max_cursor = last.cursor;
        let entries: Vec<DeltaEntry> = if skip_own {
            page.into_iter()
                .filter(|entry| entry.origin_device_id != device_id)
                .collect()
        } else {
            page
        };

        if !entries.is_empty() {
            send(socket, &Message::DeltaBatch(DeltaBatch { entries })).await?;
        }
        *sent = max_cursor;

        if page_len < MAX_DELTA_PAGE {
            return Ok(());
        }
    }
}

async fn handle_inbound(
    socket: &mut WebSocket,
    deps: &ConnectionDeps,
    workspace_id: &str,
    device_id: &str,
    bytes: &[u8],
    sent: &mut Cursor,
) -> Result<(), Closed> {
    let message = decode(bytes)
        .map_err(|error| Closed::protocol(ErrorKind::MalformedFrame, error.to_string()))?;

    match message {
        Message::PushDelta(PushDelta {
            document_id,
            tier_tag,
            payload_kind,
            client_ref,
            payload,
        }) => {
            let payload_len = payload.len();
            let entry = deps
                .store
                .append(NewDelta {
                    workspace_id: workspace_id.to_owned(),
                    document_id,
                    tier_tag,
                    payload_kind,
                    origin_device_id: device_id.to_owned(),
                    payload,
                })
                .await
                .map_err(Closed::from_store)?;

            // A003-T09 / VPS-F004 hook. The real audit sink is a later
            // integration; the payload bytes are never logged (A003-T43).
            tracing::info!(
                %workspace_id,
                document_id = %entry.document_id,
                tier = ?entry.tier_tag,
                payload_kind = ?entry.payload_kind,
                cursor = entry.cursor.value(),
                origin_device_id = %device_id,
                committed_at_unix_ms = entry.committed_at_unix_ms,
                payload_len,
                "sync delta accepted"
            );

            *sent = Cursor(sent.value().max(entry.cursor.value()));
            send(
                socket,
                &Message::Ack(Ack::RelayReceipt {
                    client_ref,
                    assigned_cursor: entry.cursor,
                }),
            )
            .await?;
            deps.hubs.notify(workspace_id);
            Ok(())
        }

        Message::Ack(Ack::ClientCumulative {
            acknowledged_cursor,
        }) => {
            deps.store
                .record_ack(workspace_id, device_id, acknowledged_cursor)
                .await
                .map_err(Closed::from_store)?;
            Ok(())
        }

        Message::PullSinceCursor(PullSinceCursor {
            document_id,
            after_cursor,
        }) => {
            let document = if document_id.is_empty() {
                None
            } else {
                Some(document_id.as_str())
            };
            // Paged, like replay — an explicit pull of a huge range comes back
            // as several batches.
            let mut cursor = after_cursor;
            loop {
                let page = deps
                    .store
                    .read_since(workspace_id, document, cursor)
                    .await
                    .map_err(Closed::from_store)?;
                let Some(last) = page.last() else {
                    break;
                };
                let page_len = page.len();
                cursor = last.cursor;
                send(socket, &Message::DeltaBatch(DeltaBatch { entries: page })).await?;
                if page_len < MAX_DELTA_PAGE {
                    break;
                }
            }
            Ok(())
        }

        // Relay-to-client messages, or a second Hello — none are valid inbound.
        Message::Hello(_)
        | Message::DeltaBatch(_)
        | Message::SyncStatus(_)
        | Message::Ack(Ack::RelayReceipt { .. })
        | Message::Error(_) => Err(Closed::protocol(
            ErrorKind::MalformedFrame,
            format!(
                "{:?} is not valid client-to-relay input",
                message.message_type()
            ),
        )),
    }
}

async fn send(socket: &mut WebSocket, message: &Message) -> Result<(), Closed> {
    socket
        .send(WsMessage::Binary(encode(message).into()))
        .await
        .map_err(|_| Closed::silent())
}

/// Read the next binary frame, transparently skipping ping/pong. `None` on a
/// clean close or a transport error.
async fn next_binary(socket: &mut WebSocket) -> Option<Vec<u8>> {
    loop {
        match socket.recv().await? {
            Ok(WsMessage::Binary(bytes)) => return Some(bytes.to_vec()),
            Ok(WsMessage::Ping(_)) | Ok(WsMessage::Pong(_)) => {}
            Ok(WsMessage::Close(_)) | Ok(WsMessage::Text(_)) => return None,
            Err(_) => return None,
        }
    }
}

fn sync_state(sent: Cursor, highest: Cursor) -> SyncState {
    if sent.value() >= highest.value() {
        SyncState::Synced
    } else {
        SyncState::Syncing
    }
}

/// A cheap, non-cryptographic jitter source. Only needs to spread connections'
/// first re-auth tick across the interval.
fn subsec_nanos() -> u32 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0)
}
