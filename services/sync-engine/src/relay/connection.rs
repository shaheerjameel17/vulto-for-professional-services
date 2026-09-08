//! The per-connection state machine.
//!
//! One WebSocket connection = one device of one workspace, for the life of the
//! socket. The flow, per `VPS-A003`'s "Sync transport contract":
//!
//! 1. First frame MUST be `Hello`. Negotiate the protocol version (A003-T38),
//!    then authorize the session against the workspace and device.
//! 2. Subscribe to the workspace's live stream, then replay every delta after
//!    this device's last acknowledgement, in cursor order, **before** live
//!    traffic (A003-T40).
//! 3. Serve the loop: inbound `PushDelta` -> store -> `Ack{RelayReceipt}` ->
//!    fan out; inbound `Ack{ClientCumulative}` -> record; inbound
//!    `PullSinceCursor` -> `DeltaBatch`. Outbound: forward live deltas from
//!    other devices as single-entry `DeltaBatch`es.
//!
//! Any protocol violation or decode failure sends a typed `Error` frame and
//! closes the socket (A003-T37). The relay never inspects a payload (A003-T43).

use std::sync::Arc;

use crate::wire::{
    decode, encode, negotiate, Ack, Cursor, DeltaBatch, DeltaEntry, ErrorKind, Message,
    PullSinceCursor, PushDelta, SyncState, SyncStatus, WireErrorMessage, SUPPORTED_VERSIONS,
};
use axum::extract::ws::{Message as WsMessage, WebSocket};
use tokio::sync::broadcast::error::RecvError;

use super::hub::Hubs;
use super::session::SessionAuthorizer;
use super::store::{DeltaStore, NewDelta, StoreError};

/// What every connection needs, cloned in from the shared relay state.
pub struct ConnectionDeps {
    pub store: Arc<dyn DeltaStore>,
    pub authorizer: Arc<dyn SessionAuthorizer>,
    pub hubs: Hubs,
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

    let session = deps
        .authorizer
        .authorize(&hello.session_token, &hello.workspace_id, &hello.device_id)
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

    // 2. Subscribe before replay so nothing committed in the gap is missed.
    let mut live = deps.hubs.subscribe(&workspace_id);

    let acked = deps
        .store
        .acked_cursor(&workspace_id, &device_id)
        .await
        .map_err(Closed::from_store)?;

    // `sent` tracks the highest cursor this connection has either delivered to
    // the client or knows the client already holds (its own pushes).
    let mut sent = acked;

    let backlog = deps
        .store
        .read_since(&workspace_id, None, acked)
        .await
        .map_err(Closed::from_store)?;
    if let Some(last) = backlog.last() {
        sent = last.cursor;
        send(
            socket,
            &Message::DeltaBatch(DeltaBatch { entries: backlog }),
        )
        .await?;
    }

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
            broadcast = live.recv() => {
                match broadcast {
                    Ok(entry) => {
                        forward_live(socket, &device_id, &entry, &mut sent).await?;
                    }
                    Err(RecvError::Lagged(_)) => {
                        catch_up(socket, deps, &workspace_id, &device_id, &mut sent).await?;
                    }
                    Err(RecvError::Closed) => {
                        // The hub channel is gone; keep serving inbound traffic.
                    }
                }
            }
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
            let entry = Arc::new(entry);
            send(
                socket,
                &Message::Ack(Ack::RelayReceipt {
                    client_ref,
                    assigned_cursor: entry.cursor,
                }),
            )
            .await?;
            deps.hubs.publish(workspace_id, entry);
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
            let entries = deps
                .store
                .read_since(workspace_id, document, after_cursor)
                .await
                .map_err(Closed::from_store)?;
            send(socket, &Message::DeltaBatch(DeltaBatch { entries })).await?;
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

async fn forward_live(
    socket: &mut WebSocket,
    device_id: &str,
    entry: &Arc<DeltaEntry>,
    sent: &mut Cursor,
) -> Result<(), Closed> {
    if entry.origin_device_id == device_id || !entry.cursor.succeeds(*sent) {
        // Our own push echoed back, or something already delivered.
        *sent = Cursor(sent.value().max(entry.cursor.value()));
        return Ok(());
    }
    *sent = entry.cursor;
    send(
        socket,
        &Message::DeltaBatch(DeltaBatch {
            entries: vec![(**entry).clone()],
        }),
    )
    .await
}

async fn catch_up(
    socket: &mut WebSocket,
    deps: &ConnectionDeps,
    workspace_id: &str,
    device_id: &str,
    sent: &mut Cursor,
) -> Result<(), Closed> {
    let missed = deps
        .store
        .read_since(workspace_id, None, *sent)
        .await
        .map_err(Closed::from_store)?;
    if let Some(last) = missed.last() {
        *sent = Cursor(sent.value().max(last.cursor.value()));
    }
    let entries: Vec<DeltaEntry> = missed
        .into_iter()
        .filter(|entry| entry.origin_device_id != device_id)
        .collect();
    if !entries.is_empty() {
        send(socket, &Message::DeltaBatch(DeltaBatch { entries })).await?;
    }
    Ok(())
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
