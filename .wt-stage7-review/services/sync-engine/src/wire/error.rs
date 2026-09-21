//! Decode failures for the wire codec.
//!
//! This is distinct from the on-wire [`crate::wire::message::WireErrorMessage`]
//! (`Error` message type `7`). A `WireError` is a local "these bytes are not a
//! valid frame" result; the `Error` *message* is a peer telling us something went
//! wrong at the protocol level. A relay that hits a `WireError` while decoding an
//! inbound frame replies with an `Error` message and closes the connection, per
//! A003-T37.

use core::fmt;

/// Why a byte slice failed to decode into a [`crate::wire::Message`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WireError {
    /// The frame was shorter than the fixed 2-byte header.
    ShortHeader,
    /// The protocol-version byte did not match the negotiated version.
    ///
    /// Carries `(found, expected)`.
    VersionMismatch { found: u8, expected: u8 },
    /// The message-type byte is not one this build knows (A003-T37).
    UnknownMessageType(u8),
    /// A field ran past the end of the buffer.
    ///
    /// Carries how many more bytes the field needed.
    UnexpectedEof { needed: usize },
    /// A `u32` length prefix exceeded a sane bound, or the declared count in a
    /// `DeltaBatch` exceeded [`MAX_BATCH_ENTRIES`](crate::wire::codec::MAX_BATCH_ENTRIES).
    LengthTooLarge { field: &'static str, declared: u64 },
    /// A single-byte enum discriminant was outside its defined range.
    InvalidEnum { field: &'static str, value: u8 },
    /// A length-prefixed field that must be UTF-8 was not.
    InvalidUtf8 { field: &'static str },
    /// The buffer held a complete message and then extra bytes. A frame is
    /// exactly one message; anything after it is a framing bug upstream.
    TrailingBytes { extra: usize },
    /// `negotiate` was asked to agree a version and the offered range did not
    /// intersect the supported set (A003-T38). Carries the offered range.
    NoCommonVersion { client_min: u8, client_max: u8 },
    /// A `Hello` whose `client_min_version` was greater than its
    /// `client_max_version`.
    InvalidVersionRange { client_min: u8, client_max: u8 },
}

impl fmt::Display for WireError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            WireError::ShortHeader => write!(f, "frame shorter than the 2-byte header"),
            WireError::VersionMismatch { found, expected } => {
                write!(f, "protocol version byte {found} != negotiated {expected}")
            }
            WireError::UnknownMessageType(code) => write!(f, "unknown message type {code}"),
            WireError::UnexpectedEof { needed } => {
                write!(f, "unexpected end of frame, needed {needed} more byte(s)")
            }
            WireError::LengthTooLarge { field, declared } => {
                write!(
                    f,
                    "field {field} declared length {declared} exceeds the bound"
                )
            }
            WireError::InvalidEnum { field, value } => {
                write!(f, "field {field} has invalid discriminant {value}")
            }
            WireError::InvalidUtf8 { field } => write!(f, "field {field} is not valid UTF-8"),
            WireError::TrailingBytes { extra } => {
                write!(f, "{extra} trailing byte(s) after a complete message")
            }
            WireError::NoCommonVersion {
                client_min,
                client_max,
            } => write!(
                f,
                "no protocol version in common with client range [{client_min}, {client_max}]"
            ),
            WireError::InvalidVersionRange {
                client_min,
                client_max,
            } => write!(
                f,
                "client version range [{client_min}, {client_max}] is inverted"
            ),
        }
    }
}

impl std::error::Error for WireError {}
