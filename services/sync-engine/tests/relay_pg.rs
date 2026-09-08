//! FDN-51 Stage 2b — the relay proven against a real, ephemeral PostgreSQL.
//!
//! These tests are `#[ignore]` by default: a bare `cargo test` skips them. They
//! run through `pnpm test:sync-engine`, which creates a dedicated database, runs
//! the Drizzle migrations (so `session` / `member` / `organization` /
//! `device_unlock_secret` and the `sync_*` tables exist), and invokes
//! `cargo test --test relay_pg -- --ignored --test-threads=1` with `DATABASE_URL`
//! set. No persistence is mocked.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use sqlx::postgres::PgPool;
use sqlx::Row;
use tokio::net::TcpStream;
use tokio::task::JoinHandle;
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};
use uuid::Uuid;
use vulto_sync_engine::relay::{
    connect_pool, serve_ephemeral, DeltaStore, Hubs, NewDelta, PgDeltaStore, PgSessionAuthorizer,
    RelayState, MAX_DELTA_PAGE,
};
use vulto_sync_engine::wire::{
    decode, encode, Ack, Cursor, DeltaEntry, ErrorKind, Hello, Message, PayloadKind,
    PullSinceCursor, PushDelta, SyncState, SyncStatus, TierTag,
};

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

fn database_url() -> String {
    std::env::var("DATABASE_URL").expect(
        "DATABASE_URL must be set for the --ignored relay_pg tests; run `pnpm test:sync-engine`",
    )
}

async fn connect_test_pool() -> PgPool {
    connect_pool(&database_url())
        .await
        .expect("connect to PostgreSQL")
}

struct Seeded {
    workspace_id: Uuid,
    user_id: Uuid,
    device_id: String,
    token: String,
}

/// Insert a fresh workspace + user + active membership + unexpired session +
/// non-revoked `device-a`, all with unique identifiers so tests never collide.
async fn seed(pool: &PgPool) -> Seeded {
    let device_id = "device-a";
    let tag = Uuid::new_v4().simple().to_string();
    let workspace_id = Uuid::new_v4();
    let user_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    let device_secret_id = Uuid::new_v4();
    let token = format!("tok-{tag}");

    sqlx::query(
        "INSERT INTO organization (id, name, slug, created_at, status) \
         VALUES ($1, $2, $3, now(), 'active')",
    )
    .bind(workspace_id)
    .bind(format!("ws-{tag}"))
    .bind(format!("slug-{tag}"))
    .execute(pool)
    .await
    .expect("insert organization");

    sqlx::query(
        "INSERT INTO \"user\" (id, name, email, email_verified, created_at, updated_at, status) \
         VALUES ($1, $2, $3, true, now(), now(), 'active')",
    )
    .bind(user_id)
    .bind(format!("user-{tag}"))
    .bind(format!("user-{tag}@example.test"))
    .execute(pool)
    .await
    .expect("insert user");

    sqlx::query(
        "INSERT INTO member (id, organization_id, user_id, role, created_at, status, projection_state) \
         VALUES ($1, $2, $3, 'owner', now(), 'active', 'confirmed')",
    )
    .bind(member_id)
    .bind(workspace_id)
    .bind(user_id)
    .execute(pool)
    .await
    .expect("insert member");

    seed_session(
        pool,
        session_id,
        user_id,
        &token,
        "now() + interval '1 hour'",
    )
    .await;

    sqlx::query(
        "INSERT INTO device_unlock_secret \
           (id, workspace_id, user_id, device_id, key_epoch, server_half, created_at) \
         VALUES ($1, $2, $3, $4, 1, 'test-server-half', now())",
    )
    .bind(device_secret_id)
    .bind(workspace_id)
    .bind(user_id)
    .bind(device_id)
    .execute(pool)
    .await
    .expect("insert device_unlock_secret");

    Seeded {
        workspace_id,
        user_id,
        device_id: device_id.to_owned(),
        token,
    }
}

async fn seed_session(pool: &PgPool, id: Uuid, user_id: Uuid, token: &str, expires_sql: &str) {
    sqlx::query(&format!(
        "INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id) \
         VALUES ($1, {expires_sql}, $2, now(), now(), $3)"
    ))
    .bind(id)
    .bind(token)
    .bind(user_id)
    .execute(pool)
    .await
    .expect("insert session");
}

/// Add a second authorized device to an existing seeded workspace/user.
async fn add_device(pool: &PgPool, s: &Seeded, device_id: &str) -> String {
    let tag = Uuid::new_v4().simple().to_string();
    let token = format!("tok-{tag}");
    seed_session(
        pool,
        Uuid::new_v4(),
        s.user_id,
        &token,
        "now() + interval '1 hour'",
    )
    .await;
    sqlx::query(
        "INSERT INTO device_unlock_secret \
           (id, workspace_id, user_id, device_id, key_epoch, server_half, created_at) \
         VALUES ($1, $2, $3, $4, 1, 'test-server-half', now())",
    )
    .bind(Uuid::new_v4())
    .bind(s.workspace_id)
    .bind(s.user_id)
    .bind(device_id)
    .execute(pool)
    .await
    .expect("insert second device");
    token
}

// ---------------------------------------------------------------------------
// Relay + WebSocket client
// ---------------------------------------------------------------------------

struct RunningRelay {
    addr: SocketAddr,
    task: JoinHandle<std::io::Result<()>>,
}

impl Drop for RunningRelay {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn spawn_relay(pool: PgPool) -> RunningRelay {
    spawn_relay_with_reauth(pool, Duration::ZERO).await
}

async fn spawn_relay_with_reauth(pool: PgPool, revalidation_interval: Duration) -> RunningRelay {
    let state = RelayState {
        store: Arc::new(PgDeltaStore::new(pool.clone())),
        authorizer: Arc::new(PgSessionAuthorizer::new(pool)),
        hubs: Hubs::default(),
        revalidation_interval,
    };
    let (addr, server) = serve_ephemeral(state).await.expect("bind ephemeral relay");
    RunningRelay {
        addr,
        task: tokio::spawn(server),
    }
}

type Client = WebSocketStream<MaybeTlsStream<TcpStream>>;

async fn open(addr: SocketAddr) -> Client {
    connect_async(format!("ws://{addr}/sync"))
        .await
        .expect("ws connect")
        .0
}

async fn send(client: &mut Client, message: &Message) {
    client
        .send(WsMessage::Binary(encode(message)))
        .await
        .expect("send frame");
}

async fn recv(client: &mut Client) -> Message {
    let frame = tokio::time::timeout(Duration::from_secs(10), client.next())
        .await
        .expect("frame timeout")
        .expect("stream ended")
        .expect("ws error");
    match frame {
        WsMessage::Binary(bytes) => decode(&bytes).expect("decode"),
        other => panic!("unexpected frame: {other:?}"),
    }
}

async fn expect_closed(client: &mut Client) -> Option<ErrorKind> {
    let mut kind = None;
    loop {
        match tokio::time::timeout(Duration::from_secs(10), client.next())
            .await
            .expect("close timeout")
        {
            None | Some(Ok(WsMessage::Close(_))) | Some(Err(_)) => return kind,
            Some(Ok(WsMessage::Binary(bytes))) => match decode(&bytes).expect("decode") {
                Message::Error(error) => kind = Some(error.kind),
                other => panic!("expected Error/Close, got {other:?}"),
            },
            Some(Ok(_)) => {}
        }
    }
}

fn hello(workspace: Uuid, token: &str, device: &str) -> Message {
    Message::Hello(Hello {
        client_min_version: 1,
        client_max_version: 1,
        workspace_id: workspace.to_string(),
        device_id: device.to_owned(),
        session_token: token.as_bytes().to_vec(),
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

async fn handshake(
    client: &mut Client,
    ws: Uuid,
    token: &str,
    device: &str,
) -> (Vec<DeltaEntry>, SyncStatus) {
    send(client, &hello(ws, token, device)).await;
    let mut replay = Vec::new();
    loop {
        match recv(client).await {
            Message::DeltaBatch(batch) => replay.extend(batch.entries),
            Message::SyncStatus(status) => return (replay, status),
            other => panic!("unexpected {other:?} during handshake"),
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

async fn ack(client: &mut Client, cursor: u64) {
    send(
        client,
        &Message::Ack(Ack::ClientCumulative {
            acknowledged_cursor: cursor.into(),
        }),
    )
    .await;
}

fn cursors(entries: &[DeltaEntry]) -> Vec<u64> {
    entries.iter().map(|e| e.cursor.value()).collect()
}

// ---------------------------------------------------------------------------
// Log capture (for the opacity test)
// ---------------------------------------------------------------------------

fn log_buffer() -> &'static Arc<Mutex<Vec<u8>>> {
    static BUFFER: OnceLock<Arc<Mutex<Vec<u8>>>> = OnceLock::new();
    BUFFER.get_or_init(|| {
        let buffer = Arc::new(Mutex::new(Vec::new()));
        let writer = BufferWriter(buffer.clone());
        let subscriber = tracing_subscriber::fmt()
            .json()
            .with_writer(writer)
            .with_env_filter(tracing_subscriber::EnvFilter::new("info"))
            .finish();
        let _ = tracing::subscriber::set_global_default(subscriber);
        buffer
    })
}

#[derive(Clone)]
struct BufferWriter(Arc<Mutex<Vec<u8>>>);

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for BufferWriter {
    type Writer = BufferGuard;
    fn make_writer(&'a self) -> BufferGuard {
        BufferGuard(self.0.clone())
    }
}

struct BufferGuard(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for BufferGuard {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn concurrent_pushes_preserve_commit_order_gaplessly() {
    let pool = connect_test_pool().await;
    let s = seed(&pool).await;
    let relay = spawn_relay(pool.clone()).await;

    const CONNS: usize = 8;
    const PER_CONN: usize = 10;

    // Each connection gets its own device + session (the workspace/user is shared).
    let mut devices = vec![(s.device_id.clone(), s.token.clone())];
    for i in 1..CONNS {
        let device = format!("device-{i}");
        let token = add_device(&pool, &s, &device).await;
        devices.push((device, token));
    }

    let mut handles = Vec::new();
    for (device, token) in devices {
        let addr = relay.addr;
        let ws = s.workspace_id;
        let index = handles.len();
        handles.push(tokio::spawn(async move {
            let mut c = open(addr).await;
            handshake(&mut c, ws, &token, &device).await;
            let i = index;
            let mut got = Vec::new();
            for n in 0..PER_CONN {
                send(&mut c, &push("doc", format!("{i}-{n}").as_bytes(), b"x")).await;
                loop {
                    match recv(&mut c).await {
                        Message::Ack(Ack::RelayReceipt {
                            assigned_cursor, ..
                        }) => {
                            got.push(assigned_cursor.value());
                            break;
                        }
                        Message::DeltaBatch(_) => {} // another device's live delta; ignore
                        other => panic!("unexpected {other:?}"),
                    }
                }
            }
            got
        }));
    }

    let mut all_cursors = Vec::new();
    for h in handles {
        all_cursors.extend(h.await.unwrap());
    }
    all_cursors.sort_unstable();
    let expected: Vec<u64> = (1..=(CONNS * PER_CONN) as u64).collect();
    assert_eq!(all_cursors, expected, "gapless, no duplicate");

    // Commit order == cursor order: no delta committed before an earlier cursor.
    let rows = sqlx::query(
        "SELECT cursor, committed_at FROM sync_delta WHERE workspace_id = $1 ORDER BY committed_at, cursor",
    )
    .bind(s.workspace_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    let by_commit: Vec<i64> = rows.iter().map(|r| r.get::<i64, _>("cursor")).collect();
    let mut sorted = by_commit.clone();
    sorted.sort_unstable();
    assert_eq!(by_commit, sorted, "commit order equals cursor order");

    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM sync_delta WHERE workspace_id = $1")
        .bind(s.workspace_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, (CONNS * PER_CONN) as i64);

    let last: i64 =
        sqlx::query_scalar("SELECT last_cursor FROM sync_workspace_cursor WHERE workspace_id = $1")
            .bind(s.workspace_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(last, (CONNS * PER_CONN) as i64);

    drop(relay);
}

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn durable_reconnect_replay_survives_a_relay_restart() {
    let pool = connect_test_pool().await;
    let s = seed(&pool).await;
    let b_token = add_device(&pool, &s, "device-b").await;

    let relay = spawn_relay(pool.clone()).await;

    // B pushes 5 deltas.
    let mut b = open(relay.addr).await;
    handshake(&mut b, s.workspace_id, &b_token, "device-b").await;
    for n in 1..=5 {
        send(
            &mut b,
            &push(
                "doc",
                format!("r{n}").as_bytes(),
                format!("p{n}").as_bytes(),
            ),
        )
        .await;
        assert_eq!(recv_receipt(&mut b).await, n);
    }

    // A connects, acknowledges through 2, disconnects.
    let mut a = open(relay.addr).await;
    let (replay, _) = handshake(&mut a, s.workspace_id, &s.token, "device-a").await;
    assert_eq!(cursors(&replay), [1, 2, 3, 4, 5]);
    ack(&mut a, 2).await;
    tokio::time::sleep(Duration::from_millis(150)).await;
    a.close(None).await.ok();
    drop(b);

    // Restart: abort the server task, drop its Hubs, build a brand-new relay
    // with a brand-new pool. Only PostgreSQL persisted.
    drop(relay);
    let fresh_pool = connect_test_pool().await;
    let relay = spawn_relay(fresh_pool).await;

    let mut a = open(relay.addr).await;
    let (replay, status) = handshake(&mut a, s.workspace_id, &s.token, "device-a").await;
    assert_eq!(
        cursors(&replay),
        [3, 4, 5],
        "replay from durable state, after the ack"
    );
    assert_eq!(status.highest_acknowledged_cursor.value(), 2);

    // Live traffic through the restarted relay.
    let mut b = open(relay.addr).await;
    handshake(&mut b, s.workspace_id, &b_token, "device-b").await;
    send(&mut b, &push("doc", b"r6", b"p6")).await;
    assert_eq!(recv_receipt(&mut b).await, 6);
    match recv(&mut a).await {
        Message::DeltaBatch(batch) => assert_eq!(cursors(&batch.entries), [6]),
        other => panic!("expected live delta 6, got {other:?}"),
    }

    drop(relay);
}

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn a_revoked_device_is_denied_on_its_next_connection() {
    let pool = connect_test_pool().await;
    let s = seed(&pool).await;
    let relay = spawn_relay(pool.clone()).await;

    // First connection succeeds.
    let mut a = open(relay.addr).await;
    let (_, _status) = handshake(&mut a, s.workspace_id, &s.token, "device-a").await;
    a.close(None).await.ok();

    // Central revocation (what revokeWorkspaceAdmission / suspendUser... do).
    sqlx::query(
        "UPDATE device_unlock_secret SET revoked_at = now() \
         WHERE workspace_id = $1 AND user_id = $2 AND device_id = 'device-a'",
    )
    .bind(s.workspace_id)
    .bind(s.user_id)
    .execute(&pool)
    .await
    .unwrap();

    // The same token is now rejected on reconnect.
    let mut a = open(relay.addr).await;
    send(&mut a, &hello(s.workspace_id, &s.token, "device-a")).await;
    assert_eq!(
        expect_closed(&mut a).await,
        Some(ErrorKind::Unauthenticated)
    );

    drop(relay);
}

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn an_expired_session_is_denied_and_an_unexpired_one_is_admitted() {
    let pool = connect_test_pool().await;

    // Expired.
    let s = seed(&pool).await;
    sqlx::query("UPDATE session SET expires_at = now() - interval '1 hour' WHERE token = $1")
        .bind(&s.token)
        .execute(&pool)
        .await
        .unwrap();
    let relay = spawn_relay(pool.clone()).await;
    let mut c = open(relay.addr).await;
    send(&mut c, &hello(s.workspace_id, &s.token, "device-a")).await;
    assert_eq!(
        expect_closed(&mut c).await,
        Some(ErrorKind::Unauthenticated)
    );

    // Control: a fresh unexpired session is admitted.
    let s2 = seed(&pool).await;
    let mut c = open(relay.addr).await;
    let (replay, _) = handshake(&mut c, s2.workspace_id, &s2.token, &s2.device_id).await;
    assert!(replay.is_empty());

    drop(relay);
}

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn stored_payload_is_opaque_and_never_logged() {
    let _buffer = log_buffer();
    log_buffer().lock().unwrap().clear();

    let pool = connect_test_pool().await;
    let s = seed(&pool).await;
    let relay = spawn_relay(pool.clone()).await;

    // A distinctive "envelope": 200 bytes that will not occur by chance.
    let envelope: Vec<u8> = (0..200u32)
        .map(|i| (i.wrapping_mul(37) ^ 0xA5) as u8)
        .collect();

    let mut a = open(relay.addr).await;
    handshake(&mut a, s.workspace_id, &s.token, "device-a").await;
    send(
        &mut a,
        &Message::PushDelta(PushDelta {
            document_id: "doc-tier1".to_owned(),
            tier_tag: TierTag::Opaque,
            payload_kind: PayloadKind::Snapshot,
            client_ref: b"ref".to_vec(),
            payload: envelope.clone(),
        }),
    )
    .await;
    assert_eq!(recv_receipt(&mut a).await, 1);
    tokio::time::sleep(Duration::from_millis(100)).await;

    // The stored bytes are exactly the envelope.
    let stored: Vec<u8> =
        sqlx::query_scalar("SELECT payload FROM sync_delta WHERE workspace_id = $1 AND cursor = 1")
            .bind(s.workspace_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored, envelope, "payload stored verbatim");

    // No text column holds the plaintext.
    let row = sqlx::query(
        "SELECT document_id, origin_device_id FROM sync_delta WHERE workspace_id = $1 AND cursor = 1",
    )
    .bind(s.workspace_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let doc: String = row.get("document_id");
    let origin: String = row.get("origin_device_id");
    assert!(!doc
        .as_bytes()
        .windows(16)
        .any(|w| envelope.windows(16).any(|e| e == w)));
    assert!(!origin
        .as_bytes()
        .windows(16)
        .any(|w| envelope.windows(16).any(|e| e == w)));

    // The relay logged the accept event with metadata but not the payload.
    let logs = String::from_utf8(log_buffer().lock().unwrap().clone()).unwrap();
    assert!(
        logs.contains("sync delta accepted"),
        "the A003-T09 hook fired"
    );
    assert!(logs.contains("\"payload_len\":200"));
    assert!(logs.contains("doc-tier1"));
    let hex: String = envelope
        .iter()
        .take(16)
        .map(|b| format!("{b:02x}"))
        .collect();
    assert!(!logs.contains(&hex), "no payload bytes in the log");
    for window in envelope.windows(16) {
        let as_lossy = String::from_utf8_lossy(window);
        assert!(!logs.contains(as_lossy.as_ref()) || as_lossy.trim().is_empty());
    }

    drop(relay);
}

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn ack_clamp_is_enforced_in_sql_not_application_code() {
    let pool = connect_test_pool().await;
    let s = seed(&pool).await;
    let store = PgDeltaStore::new(pool.clone());

    let ws = s.workspace_id.to_string();
    store.record_ack(&ws, "device-a", Cursor(5)).await.unwrap();
    store.record_ack(&ws, "device-a", Cursor(3)).await.unwrap();
    assert_eq!(
        store.acked_cursor(&ws, "device-a").await.unwrap(),
        Cursor(5)
    );

    store.record_ack(&ws, "device-a", Cursor(9)).await.unwrap();
    assert_eq!(
        store.acked_cursor(&ws, "device-a").await.unwrap(),
        Cursor(9)
    );

    // The stored value never regressed — GREATEST() in the ON CONFLICT clause.
    let stored: i64 = sqlx::query_scalar(
        "SELECT acked_cursor FROM sync_device_ack WHERE workspace_id = $1 AND device_id = 'device-a'",
    )
    .bind(s.workspace_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored, 9);
}

// ===========================================================================
// FDN-51 Stage 3 — acknowledgement / retry / replay / resume hardening
// ===========================================================================

/// Seed a backlog straight into PostgreSQL through the store (fast — no WS).
async fn seed_deltas(pool: &PgPool, workspace_id: Uuid, origin: &str, count: usize) {
    let store = PgDeltaStore::new(pool.clone());
    for n in 0..count {
        store
            .append(NewDelta {
                workspace_id: workspace_id.to_string(),
                document_id: "doc".to_owned(),
                tier_tag: TierTag::Opaque,
                payload_kind: PayloadKind::Update,
                origin_device_id: origin.to_owned(),
                payload: format!("p{n}").into_bytes(),
            })
            .await
            .unwrap();
    }
}

const REAUTH: Duration = Duration::from_millis(700);

// --- Mid-session eviction ---

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn a_revoked_device_open_connection_is_evicted() {
    let pool = connect_test_pool().await;
    let s = seed(&pool).await;
    let relay = spawn_relay_with_reauth(pool.clone(), REAUTH).await;

    let mut a = open(relay.addr).await;
    handshake(&mut a, s.workspace_id, &s.token, "device-a").await;

    let revoked_at = Instant::now();
    sqlx::query(
        "UPDATE device_unlock_secret SET revoked_at = now() \
         WHERE workspace_id = $1 AND user_id = $2 AND device_id = 'device-a'",
    )
    .bind(s.workspace_id)
    .bind(s.user_id)
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(
        expect_closed(&mut a).await,
        Some(ErrorKind::Unauthenticated)
    );
    let elapsed = revoked_at.elapsed();
    assert!(
        elapsed >= REAUTH / 2,
        "eviction waited for the re-auth tick, not instant: {elapsed:?}"
    );
    assert!(
        elapsed < REAUTH * 5,
        "eviction happened within a few intervals: {elapsed:?}"
    );

    drop(relay);
}

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn an_expired_session_evicts_the_open_connection() {
    let pool = connect_test_pool().await;
    let s = seed(&pool).await;
    let relay = spawn_relay_with_reauth(pool.clone(), REAUTH).await;

    let mut a = open(relay.addr).await;
    handshake(&mut a, s.workspace_id, &s.token, "device-a").await;

    sqlx::query("UPDATE session SET expires_at = now() - interval '1 second' WHERE token = $1")
        .bind(&s.token)
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(
        expect_closed(&mut a).await,
        Some(ErrorKind::Unauthenticated)
    );
    drop(relay);
}

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn a_membership_revocation_evicts_the_open_connection() {
    let pool = connect_test_pool().await;
    let s = seed(&pool).await;
    let relay = spawn_relay_with_reauth(pool.clone(), REAUTH).await;

    let mut a = open(relay.addr).await;
    handshake(&mut a, s.workspace_id, &s.token, "device-a").await;

    sqlx::query("UPDATE member SET status = 'revoked' WHERE organization_id = $1 AND user_id = $2")
        .bind(s.workspace_id)
        .bind(s.user_id)
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(
        expect_closed(&mut a).await,
        Some(ErrorKind::Unauthenticated)
    );
    drop(relay);
}

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn eviction_does_not_disturb_other_devices() {
    let pool = connect_test_pool().await;
    let s = seed(&pool).await;
    let b_token = add_device(&pool, &s, "device-b").await;
    let c_token = add_device(&pool, &s, "device-c").await;
    let relay = spawn_relay_with_reauth(pool.clone(), REAUTH).await;

    let mut a = open(relay.addr).await;
    handshake(&mut a, s.workspace_id, &s.token, "device-a").await;
    let mut b = open(relay.addr).await;
    handshake(&mut b, s.workspace_id, &b_token, "device-b").await;
    let mut c = open(relay.addr).await;
    handshake(&mut c, s.workspace_id, &c_token, "device-c").await;

    sqlx::query(
        "UPDATE device_unlock_secret SET revoked_at = now() \
         WHERE workspace_id = $1 AND user_id = $2 AND device_id = 'device-a'",
    )
    .bind(s.workspace_id)
    .bind(s.user_id)
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(
        expect_closed(&mut a).await,
        Some(ErrorKind::Unauthenticated)
    );

    // B (a different device) keeps pushing; C (a third device) keeps receiving.
    send(&mut b, &push("doc", b"r1", b"p1")).await;
    assert_eq!(recv_receipt(&mut b).await, 1);
    match recv(&mut c).await {
        Message::DeltaBatch(batch) => assert_eq!(cursors(&batch.entries), [1]),
        other => panic!("device C should still receive live deltas, got {other:?}"),
    }
    send(&mut b, &push("doc", b"r2", b"p2")).await;
    assert_eq!(recv_receipt(&mut b).await, 2);
    match recv(&mut c).await {
        Message::DeltaBatch(batch) => assert_eq!(cursors(&batch.entries), [2]),
        other => panic!("device C should still receive live deltas, got {other:?}"),
    }

    drop(relay);
}

// --- Delivery ---

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn concurrent_writers_deliver_a_gapless_ordered_stream_to_every_reader() {
    let pool = connect_test_pool().await;
    let s = seed(&pool).await;

    const WRITERS: usize = 4;
    const PER_WRITER: usize = 15;
    const READERS: usize = 2;
    let total = (WRITERS * PER_WRITER) as u64;

    let mut writer_devs = Vec::new();
    for i in 0..WRITERS {
        let d = format!("writer-{i}");
        let t = add_device(&pool, &s, &d).await;
        writer_devs.push((d, t));
    }
    let mut reader_devs = Vec::new();
    for i in 0..READERS {
        let d = format!("reader-{i}");
        let t = add_device(&pool, &s, &d).await;
        reader_devs.push((d, t));
    }

    let relay = spawn_relay(pool.clone()).await;

    // Readers connect and go idle.
    let mut reader_tasks = Vec::new();
    for (device, token) in reader_devs {
        let addr = relay.addr;
        let ws = s.workspace_id;
        reader_tasks.push(tokio::spawn(async move {
            let mut c = open(addr).await;
            handshake(&mut c, ws, &token, &device).await;
            let mut seen = Vec::new();
            while (seen.len() as u64) < total {
                match recv(&mut c).await {
                    Message::DeltaBatch(batch) => seen.extend(cursors(&batch.entries)),
                    other => panic!("reader got {other:?}"),
                }
            }
            seen
        }));
    }

    // Writers push concurrently.
    let mut writer_tasks = Vec::new();
    for (device, token) in writer_devs {
        let addr = relay.addr;
        let ws = s.workspace_id;
        writer_tasks.push(tokio::spawn(async move {
            let mut c = open(addr).await;
            handshake(&mut c, ws, &token, &device).await;
            for n in 0..PER_WRITER {
                send(
                    &mut c,
                    &push("doc", format!("{device}-{n}").as_bytes(), b"x"),
                )
                .await;
                loop {
                    match recv(&mut c).await {
                        Message::Ack(Ack::RelayReceipt { .. }) => break,
                        Message::DeltaBatch(_) => {}
                        other => panic!("writer got {other:?}"),
                    }
                }
            }
        }));
    }
    for t in writer_tasks {
        t.await.unwrap();
    }
    for t in reader_tasks {
        let seen = t.await.unwrap();
        assert_eq!(
            seen,
            (1..=total).collect::<Vec<_>>(),
            "every reader received a gapless, in-order stream"
        );
    }

    drop(relay);
}

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn a_slow_consumer_is_caught_up_not_dropped() {
    let pool = connect_test_pool().await;
    let s = seed(&pool).await;
    let b_token = add_device(&pool, &s, "device-b").await;
    let relay = spawn_relay(pool.clone()).await;

    let mut a = open(relay.addr).await;
    handshake(&mut a, s.workspace_id, &s.token, "device-a").await;

    // B pushes a batch larger than one page while A does not read.
    let count = MAX_DELTA_PAGE + 77;
    let mut b = open(relay.addr).await;
    handshake(&mut b, s.workspace_id, &b_token, "device-b").await;
    for n in 0..count {
        send(&mut b, &push("doc", format!("r{n}").as_bytes(), b"x")).await;
        recv_receipt(&mut b).await;
    }

    // A resumes: gets everything, paged, gapless.
    let mut seen = Vec::new();
    while seen.len() < count {
        match recv(&mut a).await {
            Message::DeltaBatch(batch) => seen.extend(cursors(&batch.entries)),
            other => panic!("got {other:?}"),
        }
    }
    assert_eq!(seen, (1..=count as u64).collect::<Vec<_>>());

    drop(relay);
}

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn a_failed_send_advances_no_durable_state() {
    let pool = connect_test_pool().await;
    let s = seed(&pool).await;
    let b_token = add_device(&pool, &s, "device-b").await;
    let relay = spawn_relay(pool.clone()).await;

    let mut a = open(relay.addr).await;
    handshake(&mut a, s.workspace_id, &s.token, "device-a").await;

    let mut b = open(relay.addr).await;
    handshake(&mut b, s.workspace_id, &b_token, "device-b").await;
    for n in 0..20 {
        send(&mut b, &push("doc", format!("r{n}").as_bytes(), b"x")).await;
        recv_receipt(&mut b).await;
    }

    // A receives a few, then vanishes without acknowledging.
    let mut got = 0;
    while got < 3 {
        if let Message::DeltaBatch(batch) = recv(&mut a).await {
            got += batch.entries.len();
        }
    }
    drop(a);
    tokio::time::sleep(Duration::from_millis(150)).await;

    let acked: Option<i64> = sqlx::query_scalar(
        "SELECT acked_cursor FROM sync_device_ack WHERE workspace_id = $1 AND device_id = 'device-a'",
    )
    .bind(s.workspace_id)
    .fetch_optional(&pool)
    .await
    .unwrap();
    assert!(
        acked.is_none() || acked == Some(0),
        "a failed send never moves the durable ack; only an explicit Ack does: {acked:?}"
    );

    drop(relay);
}

// --- Interrupted-sync resume ---

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn replay_pages_through_a_backlog_larger_than_one_batch() {
    let pool = connect_test_pool().await;
    let s = seed(&pool).await;
    let total = MAX_DELTA_PAGE + 213;
    seed_deltas(&pool, s.workspace_id, "device-b", total).await;

    let relay = spawn_relay(pool.clone()).await;
    let mut a = open(relay.addr).await;
    let (replay, status) = handshake(&mut a, s.workspace_id, &s.token, "device-a").await;

    assert_eq!(cursors(&replay), (1..=total as u64).collect::<Vec<_>>());
    assert_eq!(status.state, SyncState::Synced);

    drop(relay);
}

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn a_device_that_disconnects_mid_replay_resumes_without_gap_or_duplicate() {
    let pool = connect_test_pool().await;
    let s = seed(&pool).await;
    let b_token = add_device(&pool, &s, "device-b").await;
    seed_deltas(&pool, s.workspace_id, "device-b", 800).await;

    let relay = spawn_relay(pool.clone()).await;

    // A connects and reads only the first replay page (one DeltaBatch), applies
    // and acknowledges it, then drops mid-replay — before the remaining pages.
    let mut a = open(relay.addr).await;
    send(&mut a, &hello(s.workspace_id, &s.token, "device-a")).await;
    let first_page = match recv(&mut a).await {
        Message::DeltaBatch(batch) => cursors(&batch.entries),
        other => panic!("expected the first replay page, got {other:?}"),
    };
    assert_eq!(
        first_page.len(),
        MAX_DELTA_PAGE,
        "the first page is a full batch"
    );
    let ack_to = *first_page.last().unwrap();
    ack(&mut a, ack_to).await;
    tokio::time::sleep(Duration::from_millis(150)).await;
    drop(a);

    // A reconnects: replay resumes right after the ack, contiguous to 800.
    let mut a = open(relay.addr).await;
    let (replay, _) = handshake(&mut a, s.workspace_id, &s.token, "device-a").await;
    let got = cursors(&replay);
    assert_eq!(got.first().copied(), Some(ack_to + 1), "resumes at ack + 1");
    assert_eq!(got.last().copied(), Some(800));
    assert_eq!(
        got,
        (ack_to + 1..=800).collect::<Vec<_>>(),
        "contiguous, no gap or dup"
    );

    // Live continues.
    let mut b = open(relay.addr).await;
    handshake(&mut b, s.workspace_id, &b_token, "device-b").await;
    send(&mut b, &push("doc", b"r801", b"p")).await;
    assert_eq!(recv_receipt(&mut b).await, 801);
    match recv(&mut a).await {
        Message::DeltaBatch(batch) => assert_eq!(cursors(&batch.entries), [801]),
        other => panic!("expected live 801, got {other:?}"),
    }

    drop(relay);
}

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn a_device_that_never_acks_during_replay_re_replays_cleanly() {
    let pool = connect_test_pool().await;
    let s = seed(&pool).await;
    seed_deltas(&pool, s.workspace_id, "device-b", 800).await;

    let relay = spawn_relay(pool.clone()).await;

    let mut a = open(relay.addr).await;
    send(&mut a, &hello(s.workspace_id, &s.token, "device-a")).await;
    let mut received = Vec::new();
    while received.len() < 300 {
        if let Message::DeltaBatch(batch) = recv(&mut a).await {
            received.extend(cursors(&batch.entries));
        }
    }
    drop(a); // no ack

    let mut a = open(relay.addr).await;
    let (replay, _) = handshake(&mut a, s.workspace_id, &s.token, "device-a").await;
    assert_eq!(
        cursors(&replay),
        (1..=800u64).collect::<Vec<_>>(),
        "full re-replay from cursor 0 (safe to re-apply)"
    );

    drop(relay);
}

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn pull_since_cursor_is_an_equivalent_client_driven_resume() {
    let pool = connect_test_pool().await;
    let s = seed(&pool).await;
    seed_deltas(&pool, s.workspace_id, "device-b", 800).await;

    // A has already acknowledged through 600, so auto-replay on Hello starts at 601.
    let store = PgDeltaStore::new(pool.clone());
    store
        .record_ack(&s.workspace_id.to_string(), "device-a", Cursor(600))
        .await
        .unwrap();

    let relay = spawn_relay(pool.clone()).await;
    let mut a = open(relay.addr).await;
    let (replay, _) = handshake(&mut a, s.workspace_id, &s.token, "device-a").await;
    assert_eq!(cursors(&replay), (601..=800u64).collect::<Vec<_>>());

    // An explicit pull for an already-held range comes back paged and in order.
    send(
        &mut a,
        &Message::PullSinceCursor(PullSinceCursor {
            document_id: String::new(),
            after_cursor: 200u64.into(),
        }),
    )
    .await;
    let mut pulled = Vec::new();
    while pulled.len() < 600 {
        match recv(&mut a).await {
            Message::DeltaBatch(batch) => pulled.extend(cursors(&batch.entries)),
            other => panic!("got {other:?}"),
        }
    }
    assert_eq!(pulled, (201..=800u64).collect::<Vec<_>>());

    drop(relay);
}
