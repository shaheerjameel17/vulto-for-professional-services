//! The message types A003-T37 names, as Rust values.
//!
//! Every field here maps to a run of bytes described in `VPS-A003`'s "Sync
//! transport contract" section. The codec in [`crate::wire::codec`] is the only
//! place that turns these into bytes and back; keeping the shapes here free of
//! encoding logic is what lets the TypeScript client mirror them exactly.

use crate::wire::cursor::Cursor;
use crate::wire::error::WireError;

/// The message-type byte (frame header offset 1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum MessageType {
    Hello = 1,
    PushDelta = 2,
    PullSinceCursor = 3,
    DeltaBatch = 4,
    Ack = 5,
    SyncStatus = 6,
    Error = 7,
}

impl MessageType {
    /// The wire byte.
    #[inline]
    pub const fn as_u8(self) -> u8 {
        self as u8
    }

    /// Decode the type byte. An unrecognised code is A003-T37's "unknown message
    /// type" — the caller replies with an `Error` message and closes.
    pub const fn try_from_u8(byte: u8) -> Result<Self, WireError> {
        match byte {
            1 => Ok(MessageType::Hello),
            2 => Ok(MessageType::PushDelta),
            3 => Ok(MessageType::PullSinceCursor),
            4 => Ok(MessageType::DeltaBatch),
            5 => Ok(MessageType::Ack),
            6 => Ok(MessageType::SyncStatus),
            7 => Ok(MessageType::Error),
            other => Err(WireError::UnknownMessageType(other)),
        }
    }
}

/// The fixed 2-byte frame header: protocol version, then message type.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameHeader {
    pub version: u8,
    pub message_type: MessageType,
}

/// Whether the relay may read a delta's payload. This is transport metadata the
/// relay is allowed to see (A003-T41); it is **not** FDN-52's authenticated
/// protected-document header and must never stand in for it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum TierTag {
    /// Tier 0 / Tier 2 — standard encryption, server-readable.
    ServerReadable = 0,
    /// Tier 1 / Tier 3 — end-to-end encrypted, opaque to the relay.
    Opaque = 1,
}

/// Whether a payload is an incremental CRDT update or a full snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum PayloadKind {
    Update = 0,
    Snapshot = 1,
}

/// The four states A003-T08's `SyncStatus` observable surfaces.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum SyncState {
    Synced = 0,
    Syncing = 1,
    PendingChanges = 2,
    Offline = 3,
}

/// The kind field of an on-wire `Error` message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ErrorKind {
    UnsupportedVersion = 1,
    Unauthenticated = 2,
    MalformedFrame = 3,
    UnknownMessageType = 4,
    Internal = 5,
}

macro_rules! byte_enum {
    ($ty:ty, $field:literal, { $($value:literal => $variant:expr),+ $(,)? }) => {
        impl $ty {
            #[inline]
            pub const fn as_u8(self) -> u8 {
                self as u8
            }

            pub const fn try_from_u8(byte: u8) -> Result<Self, WireError> {
                match byte {
                    $($value => Ok($variant),)+
                    value => Err(WireError::InvalidEnum { field: $field, value }),
                }
            }
        }
    };
}

byte_enum!(TierTag, "tier_tag", { 0 => TierTag::ServerReadable, 1 => TierTag::Opaque });
byte_enum!(PayloadKind, "payload_kind", { 0 => PayloadKind::Update, 1 => PayloadKind::Snapshot });
byte_enum!(SyncState, "status", {
    0 => SyncState::Synced,
    1 => SyncState::Syncing,
    2 => SyncState::PendingChanges,
    3 => SyncState::Offline,
});
byte_enum!(ErrorKind, "error_kind", {
    1 => ErrorKind::UnsupportedVersion,
    2 => ErrorKind::Unauthenticated,
    3 => ErrorKind::MalformedFrame,
    4 => ErrorKind::UnknownMessageType,
    5 => ErrorKind::Internal,
});

/// `Hello` (client → relay): opens a connection, offers a protocol-version range,
/// and carries opaque session authentication material the shared core does not
/// interpret.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hello {
    pub client_min_version: u8,
    pub client_max_version: u8,
    pub workspace_id: String,
    pub device_id: String,
    pub session_token: Vec<u8>,
}

/// `PushDelta` (client → relay): one change for one document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PushDelta {
    pub document_id: String,
    pub tier_tag: TierTag,
    pub payload_kind: PayloadKind,
    /// A client-chosen correlation token, echoed back in the relay's
    /// `Ack::RelayReceipt`. The relay MUST NOT use it for ordering or dedup
    /// (A003-T40); it exists so the client can match a receipt to its push.
    pub client_ref: Vec<u8>,
    /// Opaque payload: Loro change bytes for Tier 0/2, or FDN-52's protected
    /// envelope for Tier 1/3. The core never opens it.
    pub payload: Vec<u8>,
}

/// `PullSinceCursor` (client → relay): "replay everything after this position".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PullSinceCursor {
    /// Empty means every document in the workspace.
    pub document_id: String,
    pub after_cursor: Cursor,
}

/// One delivered delta inside a [`DeltaBatch`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeltaEntry {
    pub cursor: Cursor,
    pub document_id: String,
    pub tier_tag: TierTag,
    pub payload_kind: PayloadKind,
    pub origin_device_id: String,
    pub committed_at_unix_ms: u64,
    pub payload: Vec<u8>,
}

/// `DeltaBatch` (relay → client): an ordered run of committed deltas.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeltaBatch {
    pub entries: Vec<DeltaEntry>,
}

/// `Ack`: cumulative acknowledgement from a client, or a per-push receipt from
/// the relay.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ack {
    /// `ack_kind = 0` (client → relay): "I have durably applied everything
    /// through this cursor." The relay may drop its outbound obligation for
    /// anything at or below it.
    ClientCumulative { acknowledged_cursor: Cursor },
    /// `ack_kind = 1` (relay → client): "your push `client_ref` committed at this
    /// cursor."
    RelayReceipt {
        client_ref: Vec<u8>,
        assigned_cursor: Cursor,
    },
}

/// `SyncStatus` (relay → client): the raw form the client turns into A003-T08's
/// observable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SyncStatus {
    pub state: SyncState,
    pub highest_known_cursor: Cursor,
    pub highest_acknowledged_cursor: Cursor,
}

/// The on-wire `Error` message (type `7`). `detail` is human-readable and
/// non-authoritative — behaviour keys off `kind`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WireErrorMessage {
    pub kind: ErrorKind,
    pub detail: String,
}

/// One decoded protocol message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Message {
    Hello(Hello),
    PushDelta(PushDelta),
    PullSinceCursor(PullSinceCursor),
    DeltaBatch(DeltaBatch),
    Ack(Ack),
    SyncStatus(SyncStatus),
    Error(WireErrorMessage),
}

impl Message {
    /// The message-type byte this value encodes to.
    pub const fn message_type(&self) -> MessageType {
        match self {
            Message::Hello(_) => MessageType::Hello,
            Message::PushDelta(_) => MessageType::PushDelta,
            Message::PullSinceCursor(_) => MessageType::PullSinceCursor,
            Message::DeltaBatch(_) => MessageType::DeltaBatch,
            Message::Ack(_) => MessageType::Ack,
            Message::SyncStatus(_) => MessageType::SyncStatus,
            Message::Error(_) => MessageType::Error,
        }
    }
}
