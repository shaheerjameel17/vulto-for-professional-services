//! The one place bytes are produced and consumed.
//!
//! Layout, fixed by `VPS-A003`'s "Sync transport contract" section:
//!
//! * Frame = `u8` protocol version, `u8` message type, then the body.
//! * All multi-byte integers are big-endian.
//! * Every variable-length field is a `u32` big-endian length prefix followed by
//!   exactly that many bytes (`lp` below).
//! * String fields are UTF-8 inside an `lp`.
//! * No padding, no alignment, no optional/absent fields — every message has a
//!   fixed shape for its type.
//!
//! A frame carries exactly one message. Trailing bytes after a complete message
//! are a framing bug and decode as [`WireError::TrailingBytes`].

use crate::wire::cursor::Cursor;
use crate::wire::error::WireError;
use crate::wire::message::{
    Ack, DeltaBatch, DeltaEntry, ErrorKind, FrameHeader, Hello, Message, MessageType, PayloadKind,
    PullSinceCursor, PushDelta, SyncState, SyncStatus, TierTag, WireErrorMessage,
};
use crate::wire::version::PROTOCOL_VERSION;

/// Upper bound on any single length-prefixed field. A snapshot payload can be
/// large, but a declared length past this is a hostile or corrupt prefix, not a
/// real field — reject before allocating.
pub const MAX_LP_LEN: u64 = 64 * 1024 * 1024;

/// Upper bound on `DeltaBatch` entry count, for the same reason.
pub const MAX_BATCH_ENTRIES: u64 = 100_000;

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

struct Writer {
    out: Vec<u8>,
}

impl Writer {
    fn new(message_type: MessageType) -> Self {
        Writer {
            out: vec![PROTOCOL_VERSION, message_type.as_u8()],
        }
    }

    fn u8(&mut self, v: u8) {
        self.out.push(v);
    }

    fn u16(&mut self, v: u16) {
        self.out.extend_from_slice(&v.to_be_bytes());
    }

    fn u32(&mut self, v: u32) {
        self.out.extend_from_slice(&v.to_be_bytes());
    }

    fn u64(&mut self, v: u64) {
        self.out.extend_from_slice(&v.to_be_bytes());
    }

    fn cursor(&mut self, c: Cursor) {
        self.u64(c.value());
    }

    /// `u32` length prefix + bytes. Panics only if a field somehow exceeds
    /// `u32::MAX`, which no real payload does and which the decode side rejects
    /// well below anyway.
    fn lp(&mut self, bytes: &[u8]) {
        let len = u32::try_from(bytes.len()).expect("length-prefixed field exceeds u32");
        self.u32(len);
        self.out.extend_from_slice(bytes);
    }

    fn lp_str(&mut self, s: &str) {
        self.lp(s.as_bytes());
    }

    fn finish(self) -> Vec<u8> {
        self.out
    }
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(buf: &'a [u8]) -> Self {
        Reader { buf, pos: 0 }
    }

    fn remaining(&self) -> usize {
        self.buf.len() - self.pos
    }

    fn take(&mut self, n: usize) -> Result<&'a [u8], WireError> {
        if self.remaining() < n {
            return Err(WireError::UnexpectedEof {
                needed: n - self.remaining(),
            });
        }
        let slice = &self.buf[self.pos..self.pos + n];
        self.pos += n;
        Ok(slice)
    }

    fn u8(&mut self) -> Result<u8, WireError> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, WireError> {
        let b = self.take(2)?;
        Ok(u16::from_be_bytes([b[0], b[1]]))
    }

    fn u32(&mut self) -> Result<u32, WireError> {
        let b = self.take(4)?;
        Ok(u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn u64(&mut self) -> Result<u64, WireError> {
        let b = self.take(8)?;
        Ok(u64::from_be_bytes([
            b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
        ]))
    }

    fn cursor(&mut self) -> Result<Cursor, WireError> {
        Ok(Cursor(self.u64()?))
    }

    fn lp(&mut self, field: &'static str) -> Result<Vec<u8>, WireError> {
        let declared = self.u32()? as u64;
        if declared > MAX_LP_LEN {
            return Err(WireError::LengthTooLarge { field, declared });
        }
        Ok(self.take(declared as usize)?.to_vec())
    }

    fn lp_str(&mut self, field: &'static str) -> Result<String, WireError> {
        let bytes = self.lp(field)?;
        String::from_utf8(bytes).map_err(|_| WireError::InvalidUtf8 { field })
    }

    /// Assert the frame ended exactly here.
    fn finish(&self) -> Result<(), WireError> {
        if self.remaining() != 0 {
            return Err(WireError::TrailingBytes {
                extra: self.remaining(),
            });
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Frame header
// ---------------------------------------------------------------------------

/// Read only the 2-byte header, checking the version against the one this build
/// speaks. Useful for a relay that wants to route on type before decoding a
/// whole body.
pub fn decode_header(frame: &[u8]) -> Result<FrameHeader, WireError> {
    if frame.len() < 2 {
        return Err(WireError::ShortHeader);
    }
    let version = frame[0];
    if version != PROTOCOL_VERSION {
        return Err(WireError::VersionMismatch {
            found: version,
            expected: PROTOCOL_VERSION,
        });
    }
    let message_type = MessageType::try_from_u8(frame[1])?;
    Ok(FrameHeader {
        version,
        message_type,
    })
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/// Serialize one message to a complete frame (header included).
pub fn encode(message: &Message) -> Vec<u8> {
    let mut w = Writer::new(message.message_type());
    match message {
        Message::Hello(m) => {
            w.u8(m.client_min_version);
            w.u8(m.client_max_version);
            w.lp_str(&m.workspace_id);
            w.lp_str(&m.device_id);
            w.lp(&m.session_token);
        }
        Message::PushDelta(m) => {
            w.lp_str(&m.document_id);
            w.u8(m.tier_tag.as_u8());
            w.u8(m.payload_kind.as_u8());
            w.lp(&m.client_ref);
            w.lp(&m.payload);
        }
        Message::PullSinceCursor(m) => {
            w.lp_str(&m.document_id);
            w.cursor(m.after_cursor);
        }
        Message::DeltaBatch(m) => {
            let count = u32::try_from(m.entries.len()).expect("batch entry count exceeds u32");
            w.u32(count);
            for e in &m.entries {
                w.cursor(e.cursor);
                w.lp_str(&e.document_id);
                w.u8(e.tier_tag.as_u8());
                w.u8(e.payload_kind.as_u8());
                w.lp_str(&e.origin_device_id);
                w.u64(e.committed_at_unix_ms);
                w.lp(&e.payload);
            }
        }
        Message::Ack(Ack::ClientCumulative {
            acknowledged_cursor,
        }) => {
            w.u8(0);
            w.cursor(*acknowledged_cursor);
        }
        Message::Ack(Ack::RelayReceipt {
            client_ref,
            assigned_cursor,
        }) => {
            w.u8(1);
            w.lp(client_ref);
            w.cursor(*assigned_cursor);
        }
        Message::SyncStatus(m) => {
            w.u8(m.state.as_u8());
            w.cursor(m.highest_known_cursor);
            w.cursor(m.highest_acknowledged_cursor);
        }
        Message::Error(m) => {
            w.u16(m.kind.as_u8() as u16);
            w.lp_str(&m.detail);
        }
    }
    w.finish()
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/// Parse a complete frame into a message. Bounds-checked throughout; a truncated
/// or over-long frame is an error, never a partial value.
pub fn decode(frame: &[u8]) -> Result<Message, WireError> {
    let header = decode_header(frame)?;
    let mut r = Reader::new(frame);
    r.pos = 2; // past the header, already validated

    let message = match header.message_type {
        MessageType::Hello => Message::Hello(Hello {
            client_min_version: r.u8()?,
            client_max_version: r.u8()?,
            workspace_id: r.lp_str("workspace_id")?,
            device_id: r.lp_str("device_id")?,
            session_token: r.lp("session_token")?,
        }),
        MessageType::PushDelta => Message::PushDelta(PushDelta {
            document_id: r.lp_str("document_id")?,
            tier_tag: TierTag::try_from_u8(r.u8()?)?,
            payload_kind: PayloadKind::try_from_u8(r.u8()?)?,
            client_ref: r.lp("client_ref")?,
            payload: r.lp("payload")?,
        }),
        MessageType::PullSinceCursor => Message::PullSinceCursor(PullSinceCursor {
            document_id: r.lp_str("document_id")?,
            after_cursor: r.cursor()?,
        }),
        MessageType::DeltaBatch => {
            let count = r.u32()? as u64;
            if count > MAX_BATCH_ENTRIES {
                return Err(WireError::LengthTooLarge {
                    field: "delta_batch.count",
                    declared: count,
                });
            }
            let mut entries = Vec::with_capacity(count as usize);
            for _ in 0..count {
                entries.push(DeltaEntry {
                    cursor: r.cursor()?,
                    document_id: r.lp_str("entry.document_id")?,
                    tier_tag: TierTag::try_from_u8(r.u8()?)?,
                    payload_kind: PayloadKind::try_from_u8(r.u8()?)?,
                    origin_device_id: r.lp_str("entry.origin_device_id")?,
                    committed_at_unix_ms: r.u64()?,
                    payload: r.lp("entry.payload")?,
                });
            }
            Message::DeltaBatch(DeltaBatch { entries })
        }
        MessageType::Ack => match r.u8()? {
            0 => Message::Ack(Ack::ClientCumulative {
                acknowledged_cursor: r.cursor()?,
            }),
            1 => Message::Ack(Ack::RelayReceipt {
                client_ref: r.lp("client_ref")?,
                assigned_cursor: r.cursor()?,
            }),
            value => {
                return Err(WireError::InvalidEnum {
                    field: "ack_kind",
                    value,
                })
            }
        },
        MessageType::SyncStatus => Message::SyncStatus(SyncStatus {
            state: SyncState::try_from_u8(r.u8()?)?,
            highest_known_cursor: r.cursor()?,
            highest_acknowledged_cursor: r.cursor()?,
        }),
        MessageType::Error => {
            let kind_raw = r.u16()?;
            let kind_byte = u8::try_from(kind_raw).map_err(|_| WireError::InvalidEnum {
                field: "error_kind",
                value: 0xff,
            })?;
            Message::Error(WireErrorMessage {
                kind: ErrorKind::try_from_u8(kind_byte)?,
                detail: r.lp_str("detail")?,
            })
        }
    };

    r.finish()?;
    Ok(message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip(m: Message) {
        let bytes = encode(&m);
        assert_eq!(bytes[0], PROTOCOL_VERSION, "version byte");
        assert_eq!(bytes[1], m.message_type().as_u8(), "type byte");
        let back = decode(&bytes).expect("decode");
        assert_eq!(back, m, "roundtrip");
    }

    fn sample_hello() -> Message {
        Message::Hello(Hello {
            client_min_version: 1,
            client_max_version: 1,
            workspace_id: "ws-abc".into(),
            device_id: "dev-1".into(),
            session_token: vec![0xde, 0xad, 0xbe, 0xef],
        })
    }

    #[test]
    fn roundtrips_every_message() {
        roundtrip(sample_hello());
        roundtrip(Message::PushDelta(PushDelta {
            document_id: "doc-1".into(),
            tier_tag: TierTag::Opaque,
            payload_kind: PayloadKind::Update,
            client_ref: vec![1, 2, 3],
            payload: vec![9, 8, 7, 6, 5],
        }));
        roundtrip(Message::PullSinceCursor(PullSinceCursor {
            document_id: String::new(),
            after_cursor: Cursor(42),
        }));
        roundtrip(Message::DeltaBatch(DeltaBatch {
            entries: vec![
                DeltaEntry {
                    cursor: Cursor(1),
                    document_id: "doc-1".into(),
                    tier_tag: TierTag::ServerReadable,
                    payload_kind: PayloadKind::Snapshot,
                    origin_device_id: "dev-2".into(),
                    committed_at_unix_ms: 1_726_000_000_000,
                    payload: vec![0; 16],
                },
                DeltaEntry {
                    cursor: Cursor(2),
                    document_id: "doc-1".into(),
                    tier_tag: TierTag::Opaque,
                    payload_kind: PayloadKind::Update,
                    origin_device_id: "dev-2".into(),
                    committed_at_unix_ms: 1_726_000_000_001,
                    payload: vec![255, 254],
                },
            ],
        }));
        roundtrip(Message::DeltaBatch(DeltaBatch { entries: vec![] }));
        roundtrip(Message::Ack(Ack::ClientCumulative {
            acknowledged_cursor: Cursor(7),
        }));
        roundtrip(Message::Ack(Ack::RelayReceipt {
            client_ref: vec![0xaa, 0xbb],
            assigned_cursor: Cursor(8),
        }));
        roundtrip(Message::SyncStatus(SyncStatus {
            state: SyncState::PendingChanges,
            highest_known_cursor: Cursor(10),
            highest_acknowledged_cursor: Cursor(4),
        }));
        roundtrip(Message::Error(WireErrorMessage {
            kind: ErrorKind::UnsupportedVersion,
            detail: "server speaks only v1".into(),
        }));
    }

    #[test]
    fn rejects_short_header() {
        assert_eq!(decode(&[]), Err(WireError::ShortHeader));
        assert_eq!(decode(&[1]), Err(WireError::ShortHeader));
    }

    #[test]
    fn rejects_wrong_version() {
        let mut bytes = encode(&sample_hello());
        bytes[0] = 2;
        assert_eq!(
            decode(&bytes),
            Err(WireError::VersionMismatch {
                found: 2,
                expected: 1
            })
        );
    }

    #[test]
    fn rejects_unknown_message_type() {
        assert_eq!(decode(&[1, 99]), Err(WireError::UnknownMessageType(99)));
    }

    #[test]
    fn rejects_truncated_body() {
        let bytes = encode(&sample_hello());
        for cut in 2..bytes.len() {
            assert!(
                matches!(decode(&bytes[..cut]), Err(WireError::UnexpectedEof { .. })),
                "truncation at {cut} should be UnexpectedEof"
            );
        }
    }

    #[test]
    fn rejects_trailing_bytes() {
        let mut bytes = encode(&Message::Ack(Ack::ClientCumulative {
            acknowledged_cursor: Cursor(1),
        }));
        bytes.push(0);
        assert_eq!(decode(&bytes), Err(WireError::TrailingBytes { extra: 1 }));
    }

    #[test]
    fn rejects_bad_enum_discriminant() {
        // PushDelta with tier_tag = 5
        let mut bytes = encode(&Message::PushDelta(PushDelta {
            document_id: "d".into(),
            tier_tag: TierTag::Opaque,
            payload_kind: PayloadKind::Update,
            client_ref: vec![],
            payload: vec![],
        }));
        // header(2) + lp_str "d" (4 len + 1) => tier_tag at index 7
        bytes[7] = 5;
        assert_eq!(
            decode(&bytes),
            Err(WireError::InvalidEnum {
                field: "tier_tag",
                value: 5
            })
        );
    }

    #[test]
    fn rejects_oversized_length_prefix() {
        // Hello with a workspace_id length prefix of 0x7fffffff
        let mut bytes = encode(&sample_hello());
        // header(2) + client_min(1) + client_max(1) => u32 length at index 4
        bytes[4..8].copy_from_slice(&0x7fff_ffffu32.to_be_bytes());
        assert!(matches!(
            decode(&bytes),
            Err(WireError::LengthTooLarge {
                field: "workspace_id",
                ..
            })
        ));
    }

    #[test]
    fn decode_header_is_consistent_with_decode() {
        let bytes = encode(&sample_hello());
        let h = decode_header(&bytes).unwrap();
        assert_eq!(h.version, PROTOCOL_VERSION);
        assert_eq!(h.message_type, MessageType::Hello);
    }
}
