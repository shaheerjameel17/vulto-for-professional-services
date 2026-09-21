//! The transport-agnostic wire format (A003-T36, A003-T37, A003-T42).
//!
//! This module is the whole of FDN-51 Stage 1: it turns the protocol messages
//! `VPS-A003`'s "Sync transport contract" section defines into bytes and back,
//! and nothing else. There is no socket here, no async runtime, no database — a
//! WASM client, the native relay binary and a future mobile host all link this
//! same code (A003-T10) and each supplies its own transport around it.
//!
//! Layout and per-message field order live in [`codec`]. The canonical
//! cross-implementation vectors are in `tests/vectors/*.json`, exercised by both
//! `tests/wire_vectors.rs` here and `packages/graph/src/sync/wire.test.ts` on
//! the TypeScript side, so the two encoders are checked against one another
//! rather than each only against itself.

pub mod codec;
pub mod cursor;
pub mod error;
pub mod message;
pub mod version;

pub use codec::{decode, decode_header, encode, MAX_BATCH_ENTRIES, MAX_LP_LEN};
pub use cursor::Cursor;
pub use error::WireError;
pub use message::{
    Ack, DeltaBatch, DeltaEntry, ErrorKind, FrameHeader, Hello, Message, MessageType, PayloadKind,
    PullSinceCursor, PushDelta, SyncState, SyncStatus, TierTag, WireErrorMessage,
};
pub use version::{negotiate, PROTOCOL_VERSION, SUPPORTED_VERSIONS};
