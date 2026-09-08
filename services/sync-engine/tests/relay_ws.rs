//! FDN-51 Stage 2a — the relay proven end-to-end with real WebSocket clients.
//!
//! No database: `MemoryDeltaStore` + `StaticSessionAuthorizer`. These exercise
//! the connection state machine, version negotiation, authorization, live
//! fan-out, and reconnect replay over a real TCP WebSocket. The Postgres-backed
//! proof is Stage 2b (`tests/relay_pg.rs`, not yet written).

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};
use vulto_sync_engine::relay::{
    serve_ephemeral, Hubs, MemoryDeltaStore, RelayState, StaticSessionAuthorizer,
};
use vulto_sync_engine::wire::{
    decode, encode, Ack, DeltaEntry, ErrorKind, Hello, Message, PayloadKind, PullSinceCursor,
    PushDelta, SyncState, SyncStatus, TierTag,
};

const WORKSPACE: &str = "ws-stage2a";
const TOKEN_A: &[u8] = b"token-device-a";
const TOKEN_B: &[u8] = b"token-device-b";

type Client = WebSocketStream<MaybeTlsStream<TcpStream>>;

async fn spawn_relay(authorizer: StaticSessionAuthorizer) -> SocketAddr {
    let state = RelayState {
        store: Arc::new(MemoryDeltaStore::default()),
        authorizer: Arc::new(authorizer),
        hubs: Hubs::default(),
    };
    let (addr, server) = serve_ephemeral(state).await.expect("bind ephemeral relay");
    tokio::spawn(server);
    addr
}

fn default_authorizer() -> StaticSessionAuthorizer {
    StaticSessionAuthorizer::new()
        .allow(TOKEN_A, WORKSPACE, "device-a", "user-a")
        .allow(TOKEN_B, WORKSPACE, "device-b", "user-b")
}

async fn open(addr: SocketAddr) -> Client {
    let (client, _response) = connect_async(format!("ws://{addr}/sync"))
        .await
        .expect("websocket connect");
    client
}

async fn send(client: &mut Client, message: &Message) {
    client
        .send(WsMessage::Binary(encode(message)))
        .await
        .expect("send frame");
}

async fn recv(client: &mut Client) -> Message {
    loop {
        let frame = tokio::time::timeout(Duration::from_secs(5), client.next())
            .await
            .expect("timed out waiting for a frame")
            .expect("stream ended")
            .expect("websocket error");
        match frame {
            WsMessage::Binary(bytes) => return decode(&bytes).expect("decode frame"),
            WsMessage::Ping(_) | WsMessage::Pong(_) => {}
            WsMessage::Close(_) => panic!("unexpected close"),
            other => panic!("unexpected frame: {other:?}"),
        }
    }
}

/// Expect the connection to close, optionally after one `Error` frame. Returns
/// the error kind if one was sent.
async fn expect_closed(client: &mut Client) -> Option<ErrorKind> {
    let mut error_kind = None;
    loop {
        let next = tokio::time::timeout(Duration::from_secs(5), client.next())
            .await
            .expect("timed out waiting for close");
        match next {
            None | Some(Ok(WsMessage::Close(_))) | Some(Err(_)) => return error_kind,
            Some(Ok(WsMessage::Binary(bytes))) => match decode(&bytes).expect("decode frame") {
                Message::Error(error) => error_kind = Some(error.kind),
                other => panic!("expected Error or Close, got {other:?}"),
            },
            Some(Ok(WsMessage::Ping(_))) | Some(Ok(WsMessage::Pong(_))) => {}
            Some(Ok(other)) => panic!("expected Error or Close, got {other:?}"),
        }
    }
}

fn hello(token: &[u8], device: &str) -> Message {
    Message::Hello(Hello {
        client_min_version: 1,
        client_max_version: 1,
        workspace_id: WORKSPACE.to_owned(),
        device_id: device.to_owned(),
        session_token: token.to_vec(),
    })
}

fn push(document: &str, client_ref: &[u8], payload: &[u8]) -> Message {
    Message::PushDelta(PushDelta {
        document_id: document.to_owned(),
        tier_tag: TierTag::Opaque,
        payload_kind: PayloadKind::Update,
        client_ref: client_ref.to_vec(),
        payload: payload.to_vec(),
    })
}

/// Send `Hello`, then collect the replay `DeltaBatch`es that arrive before the
/// initial `SyncStatus`. Returns `(replayed entries, initial status)`.
async fn handshake(
    client: &mut Client,
    token: &[u8],
    device: &str,
) -> (Vec<DeltaEntry>, SyncStatus) {
    send(client, &hello(token, device)).await;
    let mut replay = Vec::new();
    loop {
        match recv(client).await {
            Message::DeltaBatch(batch) => replay.extend(batch.entries),
            Message::SyncStatus(status) => return (replay, status),
            other => panic!("unexpected {other:?} during the Hello handshake"),
        }
    }
}

async fn recv_receipt(client: &mut Client) -> u64 {
    match recv(client).await {
        Message::Ack(Ack::RelayReceipt {
            assigned_cursor, ..
        }) => assigned_cursor.value(),
        other => panic!("expected RelayReceipt, got {other:?}"),
    }
}

fn cursors(entries: &[DeltaEntry]) -> Vec<u64> {
    entries.iter().map(|e| e.cursor.value()).collect()
}

fn only_entry(message: Message) -> DeltaEntry {
    match message {
        Message::DeltaBatch(batch) => {
            assert_eq!(batch.entries.len(), 1, "expected a single-entry batch");
            batch.entries.into_iter().next().unwrap()
        }
        other => panic!("expected DeltaBatch, got {other:?}"),
    }
}

async fn ack(client: &mut Client, cursor: u64) {
    send(
        client,
        &Message::Ack(Ack::ClientCumulative {
            acknowledged_cursor: cursor.into(),
        }),
    )
    .await;
}

#[tokio::test]
async fn push_from_one_device_reaches_the_other_but_not_the_sender() {
    let addr = spawn_relay(default_authorizer()).await;

    let mut a = open(addr).await;
    let mut b = open(addr).await;
    let (replay_a, status_a) = handshake(&mut a, TOKEN_A, "device-a").await;
    let (replay_b, _) = handshake(&mut b, TOKEN_B, "device-b").await;
    assert!(
        replay_a.is_empty() && replay_b.is_empty(),
        "fresh workspace has no backlog"
    );
    assert_eq!(status_a.state, SyncState::Synced);

    send(&mut a, &push("doc-1", b"ref-1", b"opaque-payload-1")).await;

    match recv(&mut a).await {
        Message::Ack(Ack::RelayReceipt {
            client_ref,
            assigned_cursor,
        }) => {
            assert_eq!(client_ref, b"ref-1");
            assert_eq!(assigned_cursor.value(), 1);
        }
        other => panic!("expected RelayReceipt, got {other:?}"),
    }

    let delivered = only_entry(recv(&mut b).await);
    assert_eq!(delivered.cursor.value(), 1);
    assert_eq!(delivered.document_id, "doc-1");
    assert_eq!(delivered.origin_device_id, "device-a");
    assert_eq!(delivered.payload, b"opaque-payload-1");

    // The sender must not receive its own delta back. A's next frame after a
    // second push is that push's receipt, never an echo of delta 1.
    tokio::time::sleep(Duration::from_millis(100)).await;
    send(&mut a, &push("doc-1", b"ref-2", b"payload-2")).await;
    assert_eq!(recv_receipt(&mut a).await, 2);
}

#[tokio::test]
async fn reconnect_replays_exactly_the_unacknowledged_deltas_before_live_traffic() {
    let addr = spawn_relay(default_authorizer()).await;

    // B pushes three deltas while A is offline.
    let mut b = open(addr).await;
    handshake(&mut b, TOKEN_B, "device-b").await;
    for n in 1..=3 {
        send(
            &mut b,
            &push(
                "doc",
                format!("ref-{n}").as_bytes(),
                format!("p{n}").as_bytes(),
            ),
        )
        .await;
        assert_eq!(recv_receipt(&mut b).await, n);
    }

    // A connects: the handshake replay is the whole backlog, in order.
    let mut a = open(addr).await;
    let (replay, status) = handshake(&mut a, TOKEN_A, "device-a").await;
    assert_eq!(
        cursors(&replay),
        [1, 2, 3],
        "replay is the whole backlog in cursor order"
    );
    assert_eq!(status.highest_acknowledged_cursor.value(), 0);
    assert_eq!(status.state, SyncState::Synced, "everything delivered");

    // A acknowledges through cursor 1 and disconnects.
    ack(&mut a, 1).await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    a.close(None).await.ok();

    // A reconnects: replay must be exactly cursors 2 and 3.
    let mut a = open(addr).await;
    let (replay, status) = handshake(&mut a, TOKEN_A, "device-a").await;
    assert_eq!(cursors(&replay), [2, 3]);
    assert_eq!(status.highest_acknowledged_cursor.value(), 1);

    // Then live traffic flows.
    send(&mut b, &push("doc", b"ref-4", b"p4")).await;
    assert_eq!(recv_receipt(&mut b).await, 4);
    assert_eq!(only_entry(recv(&mut a).await).cursor.value(), 4);
}

#[tokio::test]
async fn pull_since_cursor_returns_the_requested_range() {
    let addr = spawn_relay(default_authorizer()).await;
    let mut b = open(addr).await;
    handshake(&mut b, TOKEN_B, "device-b").await;
    for n in 1..=4 {
        send(&mut b, &push("doc", format!("r{n}").as_bytes(), b"p")).await;
        recv_receipt(&mut b).await;
    }

    send(
        &mut b,
        &Message::PullSinceCursor(PullSinceCursor {
            document_id: String::new(),
            after_cursor: 2u64.into(),
        }),
    )
    .await;
    match recv(&mut b).await {
        Message::DeltaBatch(batch) => assert_eq!(cursors(&batch.entries), [3, 4]),
        other => panic!("expected DeltaBatch, got {other:?}"),
    }
}

#[tokio::test]
async fn rejects_a_version_range_without_a_common_version() {
    let addr = spawn_relay(default_authorizer()).await;
    let mut client = open(addr).await;
    send(
        &mut client,
        &Message::Hello(Hello {
            client_min_version: 2,
            client_max_version: 5,
            workspace_id: WORKSPACE.to_owned(),
            device_id: "device-a".to_owned(),
            session_token: TOKEN_A.to_vec(),
        }),
    )
    .await;
    assert_eq!(
        expect_closed(&mut client).await,
        Some(ErrorKind::UnsupportedVersion)
    );
}

#[tokio::test]
async fn rejects_an_unauthorized_session_token() {
    let addr = spawn_relay(default_authorizer()).await;
    let mut client = open(addr).await;
    send(&mut client, &hello(b"not-a-real-token", "device-a")).await;
    assert_eq!(
        expect_closed(&mut client).await,
        Some(ErrorKind::Unauthenticated)
    );
}

#[tokio::test]
async fn rejects_a_first_frame_that_is_not_hello() {
    let addr = spawn_relay(default_authorizer()).await;
    let mut client = open(addr).await;
    send(&mut client, &push("doc", b"ref", b"payload")).await;
    assert_eq!(
        expect_closed(&mut client).await,
        Some(ErrorKind::MalformedFrame)
    );
}

#[tokio::test]
async fn rejects_a_garbage_frame() {
    let addr = spawn_relay(default_authorizer()).await;
    let mut client = open(addr).await;
    client
        .send(WsMessage::Binary(vec![0xff, 0xff, 0x00, 0x01]))
        .await
        .expect("send garbage");
    assert_eq!(
        expect_closed(&mut client).await,
        Some(ErrorKind::MalformedFrame)
    );
}

#[tokio::test]
async fn rejects_a_relay_to_client_message_sent_inbound() {
    let addr = spawn_relay(default_authorizer()).await;
    let mut client = open(addr).await;
    handshake(&mut client, TOKEN_A, "device-a").await;
    send(
        &mut client,
        &Message::SyncStatus(SyncStatus {
            state: SyncState::Synced,
            highest_known_cursor: 0u64.into(),
            highest_acknowledged_cursor: 0u64.into(),
        }),
    )
    .await;
    assert_eq!(
        expect_closed(&mut client).await,
        Some(ErrorKind::MalformedFrame)
    );
}
