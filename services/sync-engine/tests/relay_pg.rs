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
        // `trace` so the Stage 5 opacity scan sees everything the relay and its
        // dependencies (sqlx included) could emit, not just `info` and above.
        let subscriber = tracing_subscriber::fmt()
            .json()
            .with_writer(writer)
            .with_env_filter(tracing_subscriber::EnvFilter::new("trace"))
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

/// Insert a `sync_ticket` row the way `POST /sync/ticket` would, and return the
/// raw ticket string to present in `Hello`. `expires_sql` is a SQL expression
/// for `expires_at`, e.g. `"now() + interval '10 minutes'"`. Only the SHA-256
/// hash is stored — computed by Postgres here, exactly as the relay's lookup
/// recomputes it, so the two never drift.
async fn mint_ticket(pool: &PgPool, s: &Seeded, device_id: &str, expires_sql: &str) -> String {
    let ticket = format!(
        "vlt_sync_{}{}",
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple()
    );
    sqlx::query(&format!(
        "INSERT INTO sync_ticket (token_hash, workspace_id, user_id, device_id, expires_at) \
         VALUES (encode(sha256($1), 'hex'), $2, $3, $4, {expires_sql})"
    ))
    .bind(ticket.as_bytes())
    .bind(s.workspace_id)
    .bind(s.user_id)
    .bind(device_id)
    .execute(pool)
    .await
    .expect("insert sync_ticket");
    ticket
}

// --- Sync tickets (FDN-51 Stage 4a) ---

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn a_sync_ticket_admits_a_connection_like_a_session_token() {
    let pool = connect_test_pool().await;
    let s = seed(&pool).await;
    let relay = spawn_relay(pool.clone()).await;
    let ticket = mint_ticket(&pool, &s, "device-a", "now() + interval '10 minutes'").await;

    let mut a = open(relay.addr).await;
    let (replay, status) = handshake(&mut a, s.workspace_id, &ticket, "device-a").await;
    assert!(replay.is_empty());
    assert_eq!(status.state, SyncState::Synced);

    send(&mut a, &push("doc", b"r1", b"opaque")).await;
    assert_eq!(recv_receipt(&mut a).await, 1);

    drop(relay);
}

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn an_expired_sync_ticket_is_denied() {
    let pool = connect_test_pool().await;
    let s = seed(&pool).await;
    let relay = spawn_relay(pool.clone()).await;
    let ticket = mint_ticket(&pool, &s, "device-a", "now() - interval '1 minute'").await;

    let mut a = open(relay.addr).await;
    send(&mut a, &hello(s.workspace_id, &ticket, "device-a")).await;
    assert_eq!(
        expect_closed(&mut a).await,
        Some(ErrorKind::Unauthenticated)
    );

    drop(relay);
}

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn a_sync_ticket_is_bound_to_one_device() {
    let pool = connect_test_pool().await;
    let s = seed(&pool).await;
    add_device(&pool, &s, "device-b").await;
    let relay = spawn_relay(pool.clone()).await;

    // Minted for device-a; presented as device-b (which is itself authorized).
    let ticket = mint_ticket(&pool, &s, "device-a", "now() + interval '10 minutes'").await;
    let mut b = open(relay.addr).await;
    send(&mut b, &hello(s.workspace_id, &ticket, "device-b")).await;
    assert_eq!(
        expect_closed(&mut b).await,
        Some(ErrorKind::Unauthenticated)
    );

    drop(relay);
}

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn a_sync_ticket_for_a_revoked_device_is_denied() {
    let pool = connect_test_pool().await;
    let s = seed(&pool).await;
    let relay = spawn_relay(pool.clone()).await;
    let ticket = mint_ticket(&pool, &s, "device-a", "now() + interval '10 minutes'").await;

    sqlx::query(
        "UPDATE device_unlock_secret SET revoked_at = now() \
         WHERE workspace_id = $1 AND device_id = 'device-a'",
    )
    .bind(s.workspace_id)
    .execute(&pool)
    .await
    .unwrap();

    let mut a = open(relay.addr).await;
    send(&mut a, &hello(s.workspace_id, &ticket, "device-a")).await;
    assert_eq!(
        expect_closed(&mut a).await,
        Some(ErrorKind::Unauthenticated)
    );

    drop(relay);
}

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn a_ticket_connection_is_evicted_when_the_ticket_expires_mid_session() {
    let pool = connect_test_pool().await;
    let s = seed(&pool).await;
    let relay = spawn_relay_with_reauth(pool.clone(), REAUTH).await;
    let ticket = mint_ticket(
        &pool,
        &s,
        "device-a",
        "now() + interval '1500 milliseconds'",
    )
    .await;

    let mut a = open(relay.addr).await;
    handshake(&mut a, s.workspace_id, &ticket, "device-a").await;

    // The re-auth loop (A003-T45) re-checks the ticket's own expiry, so an
    // expired ticket evicts the live connection just as a revoked device does.
    assert_eq!(
        expect_closed(&mut a).await,
        Some(ErrorKind::Unauthenticated)
    );

    drop(relay);
}

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

/// Regression for the Stage 3 review finding (the vestigial `*sent = max(sent,
/// pushed_cursor)` in the `PushDelta` handler). A connection that pushes must
/// still receive every delta a peer committed at a lower cursor that it had not
/// yet been delivered — advancing `sent` to the pushed cursor skipped those on
/// the live path until reconnect. Here both devices push concurrently and each
/// must end holding the other's complete set.
#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn a_pushing_device_still_receives_a_concurrent_peers_lower_cursor_deltas_live() {
    let pool = connect_test_pool().await;
    let s = seed(&pool).await;
    let b_token = add_device(&pool, &s, "device-b").await;
    let relay = spawn_relay(pool.clone()).await;

    const ROUNDS: usize = 40;

    let peers: [(&str, String); 2] = [
        (s.device_id.as_str(), s.token.clone()),
        ("device-b", b_token.clone()),
    ];

    let mut tasks = Vec::new();
    for (device, token) in peers {
        let addr = relay.addr;
        let ws = s.workspace_id;
        let device = device.to_owned();
        tasks.push(tokio::spawn(async move {
            let mut c = open(addr).await;
            handshake(&mut c, ws, &token, &device).await;

            let mut mine: Vec<u64> = Vec::new();
            let mut from_peer: Vec<u64> = Vec::new();
            let mut pushed = 0usize;

            // Push all of ROUNDS, interleaving with whatever the peer sends.
            send(&mut c, &push("doc", format!("{device}-0").as_bytes(), b"x")).await;
            pushed += 1;
            while mine.len() < ROUNDS || from_peer.len() < ROUNDS {
                match tokio::time::timeout(Duration::from_secs(20), recv(&mut c)).await {
                    Ok(Message::Ack(Ack::RelayReceipt {
                        assigned_cursor, ..
                    })) => {
                        mine.push(assigned_cursor.value());
                        if pushed < ROUNDS {
                            send(
                                &mut c,
                                &push("doc", format!("{device}-{pushed}").as_bytes(), b"x"),
                            )
                            .await;
                            pushed += 1;
                        }
                    }
                    Ok(Message::DeltaBatch(batch)) => {
                        for entry in batch.entries {
                            assert_ne!(
                                entry.origin_device_id, device,
                                "a device must never be sent its own delta"
                            );
                            from_peer.push(entry.cursor.value());
                        }
                    }
                    Ok(other) => panic!("unexpected {other:?}"),
                    Err(_) => panic!(
                        "{device} stalled: mine={} from_peer={}",
                        mine.len(),
                        from_peer.len()
                    ),
                }
            }
            (mine, from_peer)
        }));
    }

    let mut results = Vec::new();
    for t in tasks {
        results.push(t.await.unwrap());
    }
    let (a_mine, a_from_peer) = &results[0];
    let (b_mine, b_from_peer) = &results[1];

    let sorted = |v: &Vec<u64>| {
        let mut c = v.clone();
        c.sort_unstable();
        c
    };
    assert_eq!(
        sorted(a_from_peer),
        sorted(b_mine),
        "device-a received every delta device-b committed, live"
    );
    assert_eq!(
        sorted(b_from_peer),
        sorted(a_mine),
        "device-b received every delta device-a committed, live"
    );
    assert_eq!(
        sorted(&[sorted(a_mine), sorted(b_mine)].concat()),
        (1..=(2 * ROUNDS) as u64).collect::<Vec<_>>(),
        "the two devices' pushes together are a gapless 1..=2N"
    );

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

// ---------------------------------------------------------------------------
// FDN-51 Stage 5 — server-opacity closure proof (A003-T43, the F152 criterion)
// ---------------------------------------------------------------------------
//
// Adversarial evidence that the relay, every `sync_*` PostgreSQL column, and
// every relay log line carry nothing but FDN-52's opaque protected envelope:
// never Tier 1/3 plaintext, never a usable key, never a reusable credential.
// The Tier 1/3 envelope bytes come from `tests/vectors/opacity/{tier1,tier3}.json`,
// generated by the real FDN-52 constructions (`pnpm stage5:opacity-fixtures`).

#[derive(serde::Deserialize)]
struct OpacityFixture {
    payloads: Vec<OpacityPayload>,
    must_be_absent: Vec<OpacitySecret>,
}

#[derive(serde::Deserialize)]
struct OpacityPayload {
    label: String,
    hex: String,
}

#[derive(serde::Deserialize)]
struct OpacitySecret {
    name: String,
    hex: String,
    #[serde(default)]
    ascii: Option<String>,
}

fn opacity_fixture(file: &str) -> OpacityFixture {
    let path = format!(
        "{}/tests/vectors/opacity/{file}",
        env!("CARGO_MANIFEST_DIR")
    );
    serde_json::from_str(&std::fs::read_to_string(&path).expect("read opacity fixture"))
        .expect("parse opacity fixture")
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex"))
        .collect()
}

fn hex_lower(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn hex_upper(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02X}")).collect()
}

fn base64(bytes: &[u8], alphabet: &[u8; 64], pad: bool) -> String {
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = ((chunk[0] as u32) << 16)
            | ((*chunk.get(1).unwrap_or(&0) as u32) << 8)
            | (*chunk.get(2).unwrap_or(&0) as u32);
        out.push(alphabet[((n >> 18) & 63) as usize] as char);
        out.push(alphabet[((n >> 12) & 63) as usize] as char);
        match chunk.len() {
            1 if pad => out.push('='),
            1 => {}
            _ => out.push(alphabet[((n >> 6) & 63) as usize] as char),
        }
        match chunk.len() {
            3 => out.push(alphabet[(n & 63) as usize] as char),
            _ if pad => out.push('='),
            _ => {}
        }
    }
    out
}

const B64_STD: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_URL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Every representation a secret could plausibly take on a server surface:
/// raw bytes, hex (both cases), base64 (standard padded/unpadded and URL),
/// `tracing`'s `?bytes` decimal-array Debug form, and any known ASCII form.
fn representations(secret: &[u8], ascii: Option<&str>) -> Vec<Vec<u8>> {
    let mut reps = vec![
        secret.to_vec(),
        hex_lower(secret).into_bytes(),
        hex_upper(secret).into_bytes(),
        base64(secret, B64_STD, true).into_bytes(),
        base64(secret, B64_STD, false).into_bytes(),
        base64(secret, B64_URL, false).into_bytes(),
        format!("{secret:?}").into_bytes(),
    ];
    if let Some(text) = ascii {
        reps.push(text.as_bytes().to_vec());
    }
    reps
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty()
        && needle.len() <= haystack.len()
        && haystack.windows(needle.len()).any(|w| w == needle)
}

fn count(haystack: &[u8], needle: &[u8]) -> usize {
    if needle.is_empty() || needle.len() > haystack.len() {
        return 0;
    }
    haystack
        .windows(needle.len())
        .filter(|w| *w == needle)
        .count()
}

fn assert_absent(haystack: &[u8], secret: &[u8], ascii: Option<&str>, label: &str, surface: &str) {
    for rep in representations(secret, ascii) {
        if rep.len() < 8 {
            continue;
        }
        assert!(
            !contains(haystack, &rep),
            "{surface}: {label} leaked ({}-byte representation)",
            rep.len()
        );
    }
}

/// The `to_jsonb` text of every row of every `sync_*` table for one workspace
/// — i.e. every column of every row a server-side adversary can `SELECT`. Scoped
/// to the test's own workspace because these tables accumulate across the serial
/// suite (the pretest `TRUNCATE` runs once, not per test).
async fn sync_tables_dump(pool: &PgPool, workspace_id: Uuid) -> Vec<u8> {
    let mut out = Vec::new();
    for table in [
        "sync_delta",
        "sync_workspace_cursor",
        "sync_device_ack",
        "sync_ticket",
    ] {
        let rows: Vec<String> = sqlx::query_scalar(&format!(
            "SELECT to_jsonb(t)::text FROM {table} t WHERE workspace_id = $1"
        ))
        .bind(workspace_id)
        .fetch_all(pool)
        .await
        .unwrap();
        for row in rows {
            out.extend_from_slice(row.as_bytes());
            out.push(b'\n');
        }
    }
    out
}

async fn columns(pool: &PgPool, table: &str) -> Vec<String> {
    let mut cols: Vec<String> = sqlx::query_scalar(
        "SELECT column_name FROM information_schema.columns \
         WHERE table_schema = 'public' AND table_name = $1",
    )
    .bind(table)
    .fetch_all(pool)
    .await
    .unwrap();
    cols.sort();
    cols
}

/// Push every payload in `file`, then prove no secret it records appears in any
/// `sync_*` column or relay log line, and that each payload is stored verbatim
/// in `sync_delta.payload` and nowhere else.
async fn stage5_opacity_case(file: &str) {
    let _buffer = log_buffer();
    log_buffer().lock().unwrap().clear();

    let pool = connect_test_pool().await;
    let s = seed(&pool).await;

    // A distinctive device-unlock secret so scanning for "device unlock secret
    // material" is meaningful — `PgSessionAuthorizer` joins this row on every
    // connection and every A003-T45 revalidation.
    let server_half = format!("stage5-server-half-{}", Uuid::new_v4());
    sqlx::query("UPDATE device_unlock_secret SET server_half = $1 WHERE workspace_id = $2")
        .bind(&server_half)
        .bind(s.workspace_id)
        .execute(&pool)
        .await
        .unwrap();

    let relay = spawn_relay(pool.clone()).await;
    let fixture = opacity_fixture(file);

    let mut a = open(relay.addr).await;
    handshake(&mut a, s.workspace_id, &s.token, "device-a").await;

    for (index, payload) in fixture.payloads.iter().enumerate() {
        let bytes = unhex(&payload.hex);
        send(
            &mut a,
            &Message::PushDelta(PushDelta {
                document_id: format!("protected-doc-{index}"),
                tier_tag: TierTag::Opaque,
                payload_kind: PayloadKind::Update,
                client_ref: format!("ref-{index}").into_bytes(),
                payload: bytes.clone(),
            }),
        )
        .await;
        let cursor = recv_receipt(&mut a).await;
        assert_eq!(cursor, (index + 1) as u64);

        let stored: Vec<u8> = sqlx::query_scalar(
            "SELECT payload FROM sync_delta WHERE workspace_id = $1 AND cursor = $2",
        )
        .bind(s.workspace_id)
        .bind(cursor as i64)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            stored, bytes,
            "{}: stored verbatim, no transform",
            payload.label
        );
    }
    tokio::time::sleep(Duration::from_millis(150)).await;

    let db = sync_tables_dump(&pool, s.workspace_id).await;
    let logs = log_buffer().lock().unwrap().clone();

    for secret in &fixture.must_be_absent {
        let bytes = unhex(&secret.hex);
        assert_absent(
            &db,
            &bytes,
            secret.ascii.as_deref(),
            &secret.name,
            "sync_* tables",
        );
        assert_absent(
            &logs,
            &bytes,
            secret.ascii.as_deref(),
            &secret.name,
            "relay logs",
        );
    }

    // Reusable credentials that touched the sync path.
    assert_absent(
        &db,
        s.token.as_bytes(),
        Some(&s.token),
        "raw session token",
        "sync_* tables",
    );
    assert_absent(
        &logs,
        s.token.as_bytes(),
        Some(&s.token),
        "raw session token",
        "relay logs",
    );
    assert_absent(
        &db,
        server_half.as_bytes(),
        Some(&server_half),
        "device unlock secret material",
        "sync_* tables",
    );
    assert_absent(
        &logs,
        server_half.as_bytes(),
        Some(&server_half),
        "device unlock secret material",
        "relay logs",
    );

    // Each payload is verbatim in `sync_delta` only, never in another table,
    // never in a log line.
    let others: Vec<String> = sqlx::query_scalar(
        "SELECT to_jsonb(t)::text FROM sync_device_ack t WHERE workspace_id = $1 \
         UNION ALL SELECT to_jsonb(t)::text FROM sync_workspace_cursor t WHERE workspace_id = $1 \
         UNION ALL SELECT to_jsonb(t)::text FROM sync_ticket t WHERE workspace_id = $1",
    )
    .bind(s.workspace_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    let others = others.join("\n").into_bytes();
    for payload in &fixture.payloads {
        let bytes = unhex(&payload.hex);
        // raw bytes, `\x..` hex (how `to_jsonb` and `encode(..,'hex')` render a
        // bytea), and `[123, 34, ..]` — `tracing`'s `?bytes` Debug form, the
        // likeliest way a payload gets logged by accident.
        let forms: [Vec<u8>; 3] = [
            bytes.clone(),
            hex_lower(&bytes).into_bytes(),
            format!("{bytes:?}").into_bytes(),
        ];
        for form in &forms {
            // Exactly once across every `sync_*` column of every row (its own
            // `sync_delta.payload`); a second occurrence is a copy elsewhere.
            if form == &hex_lower(&bytes).into_bytes() {
                assert_eq!(
                    count(&db, form),
                    1,
                    "{}: payload appears outside its own sync_delta.payload",
                    payload.label
                );
            } else {
                assert!(
                    !contains(&db, form),
                    "{}: payload leaked into a sync_* column",
                    payload.label
                );
            }
            assert!(
                !contains(&others, form),
                "{}: payload in a non-delta table",
                payload.label
            );
            assert!(
                !contains(&logs, form),
                "{}: payload in a log line",
                payload.label
            );
        }
    }

    // The A003-T09 hook still fired, with permitted metadata only.
    let text = String::from_utf8_lossy(&logs);
    assert!(
        text.contains("sync delta accepted"),
        "the observability hook fired"
    );
    assert!(text.contains("payload_len"), "the hook records the length");
    assert!(text.contains("Opaque"), "the hook records the tier tag");

    drop(relay);
}

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn tier1_protected_payloads_leak_no_secret_on_any_server_surface() {
    stage5_opacity_case("tier1.json").await;
}

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn tier3_protected_payloads_leak_no_secret_on_any_server_surface() {
    stage5_opacity_case("tier3.json").await;
}

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn a_mistagged_tier1_payload_is_stored_and_forwarded_opaquely() {
    let _buffer = log_buffer();
    log_buffer().lock().unwrap().clear();

    let pool = connect_test_pool().await;
    let s = seed(&pool).await;
    let relay = spawn_relay(pool.clone()).await;
    let fixture = opacity_fixture("tier1.json");
    let envelope = unhex(&fixture.payloads[0].hex);

    let mut a = open(relay.addr).await;
    handshake(&mut a, s.workspace_id, &s.token, "device-a").await;

    // A real Tier 1 envelope, deliberately tagged server-readable. The relay
    // copies the tag for routing and logging and never parses the payload, so
    // it still holds only opaque bytes. Authenticity of a Tier 1/3 payload is
    // FDN-52's client-verified header, never this transport tag (A003-T41).
    send(
        &mut a,
        &Message::PushDelta(PushDelta {
            document_id: "mistagged".to_owned(),
            tier_tag: TierTag::ServerReadable,
            payload_kind: PayloadKind::Update,
            client_ref: b"ref".to_vec(),
            payload: envelope.clone(),
        }),
    )
    .await;
    assert_eq!(recv_receipt(&mut a).await, 1);
    tokio::time::sleep(Duration::from_millis(150)).await;

    let row = sqlx::query(
        "SELECT payload, tier_tag FROM sync_delta WHERE workspace_id = $1 AND cursor = 1",
    )
    .bind(s.workspace_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let stored: Vec<u8> = row.get("payload");
    let tier_tag: i16 = row.get("tier_tag");
    assert_eq!(stored, envelope, "stored verbatim regardless of tag");
    assert_eq!(tier_tag, 0, "the frame's tag is copied, not validated");

    let db = sync_tables_dump(&pool, s.workspace_id).await;
    let logs = log_buffer().lock().unwrap().clone();
    for secret in fixture.must_be_absent.iter().take(2) {
        let bytes = unhex(&secret.hex);
        assert_absent(
            &db,
            &bytes,
            secret.ascii.as_deref(),
            &secret.name,
            "sync_* tables",
        );
        assert_absent(
            &logs,
            &bytes,
            secret.ascii.as_deref(),
            &secret.name,
            "relay logs",
        );
    }

    drop(relay);
}

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn the_sync_tables_have_exactly_the_columns_the_migration_defines() {
    let pool = connect_test_pool().await;
    assert_eq!(
        columns(&pool, "sync_delta").await,
        [
            "committed_at",
            "cursor",
            "document_id",
            "origin_device_id",
            "payload",
            "payload_kind",
            "tier_tag",
            "workspace_id",
        ]
    );
    assert_eq!(
        columns(&pool, "sync_workspace_cursor").await,
        ["last_cursor", "workspace_id"]
    );
    assert_eq!(
        columns(&pool, "sync_device_ack").await,
        ["acked_cursor", "device_id", "updated_at", "workspace_id"]
    );
    assert_eq!(
        columns(&pool, "sync_ticket").await,
        [
            "created_at",
            "device_id",
            "expires_at",
            "token_hash",
            "user_id",
            "workspace_id",
        ]
    );
}

#[tokio::test]
#[ignore = "needs a real PostgreSQL — run via `pnpm test:sync-engine`"]
async fn the_raw_sync_ticket_and_session_token_never_reach_a_sync_row_or_log() {
    let _buffer = log_buffer();
    log_buffer().lock().unwrap().clear();

    let pool = connect_test_pool().await;
    let s = seed(&pool).await;
    let ticket = mint_ticket(&pool, &s, "device-a", "now() + interval '10 minutes'").await;
    let relay = spawn_relay(pool.clone()).await;

    let mut a = open(relay.addr).await;
    handshake(&mut a, s.workspace_id, &ticket, "device-a").await;
    send(&mut a, &push("doc", b"r", b"opaque-bytes-0123456789")).await;
    assert_eq!(recv_receipt(&mut a).await, 1);
    tokio::time::sleep(Duration::from_millis(150)).await;

    let db = sync_tables_dump(&pool, s.workspace_id).await;
    let logs = log_buffer().lock().unwrap().clone();

    // Only the SHA-256 hash of the ticket is stored — never the raw string.
    let hash: String = sqlx::query_scalar("SELECT encode(sha256($1), 'hex')")
        .bind(ticket.as_bytes())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(
        contains(&db, hash.as_bytes()),
        "the ticket hash is what is stored"
    );
    assert_absent(
        &db,
        ticket.as_bytes(),
        Some(&ticket),
        "raw sync ticket",
        "sync_* tables",
    );
    assert_absent(
        &logs,
        ticket.as_bytes(),
        Some(&ticket),
        "raw sync ticket",
        "relay logs",
    );
    assert_absent(
        &db,
        s.token.as_bytes(),
        Some(&s.token),
        "raw session token",
        "sync_* tables",
    );
    assert_absent(
        &logs,
        s.token.as_bytes(),
        Some(&s.token),
        "raw session token",
        "relay logs",
    );

    drop(relay);
}
