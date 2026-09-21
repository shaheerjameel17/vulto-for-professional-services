//! Protocol-version negotiation (A003-T38).
//!
//! `Hello` offers a `[min, max]` range. The relay agrees the single highest
//! version it also supports, or rejects the connection with a typed error. There
//! is deliberately no downgrade path *within* a session and no "best effort"
//! compatibility: once a version is agreed, every later frame's version byte
//! MUST equal it (the codec enforces that side).

use crate::wire::error::WireError;

/// The one protocol version this build implements. Any wire-format change
/// increments it (A003-T38).
pub const PROTOCOL_VERSION: u8 = 1;

/// The versions this build can speak, highest first. Single-element today; the
/// negotiation logic is here so adding an entry is the only change needed later.
pub const SUPPORTED_VERSIONS: &[u8] = &[PROTOCOL_VERSION];

/// Agree a protocol version, or fail.
///
/// Returns the highest value that is both in the client's inclusive
/// `[client_min, client_max]` range and in `supported`. `supported` is treated
/// as a set; order does not matter.
///
/// * `WireError::InvalidVersionRange` if `client_min > client_max`.
/// * `WireError::NoCommonVersion` if the ranges do not intersect — the caller
///   sends `Error { kind: UnsupportedVersion }` and closes.
pub fn negotiate(client_min: u8, client_max: u8, supported: &[u8]) -> Result<u8, WireError> {
    if client_min > client_max {
        return Err(WireError::InvalidVersionRange {
            client_min,
            client_max,
        });
    }
    supported
        .iter()
        .copied()
        .filter(|v| *v >= client_min && *v <= client_max)
        .max()
        .ok_or(WireError::NoCommonVersion {
            client_min,
            client_max,
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agrees_the_only_version() {
        assert_eq!(negotiate(1, 1, SUPPORTED_VERSIONS), Ok(1));
        assert_eq!(negotiate(1, 5, SUPPORTED_VERSIONS), Ok(1));
        assert_eq!(negotiate(0, 1, SUPPORTED_VERSIONS), Ok(1));
    }

    #[test]
    fn picks_the_highest_common_version() {
        assert_eq!(negotiate(1, 3, &[1, 2, 3]), Ok(3));
        assert_eq!(negotiate(1, 2, &[1, 2, 3]), Ok(2));
        assert_eq!(negotiate(2, 2, &[3, 2, 1]), Ok(2));
    }

    #[test]
    fn rejects_a_disjoint_range() {
        assert_eq!(
            negotiate(2, 4, SUPPORTED_VERSIONS),
            Err(WireError::NoCommonVersion {
                client_min: 2,
                client_max: 4
            })
        );
    }

    #[test]
    fn rejects_an_inverted_range() {
        assert_eq!(
            negotiate(5, 1, SUPPORTED_VERSIONS),
            Err(WireError::InvalidVersionRange {
                client_min: 5,
                client_max: 1
            })
        );
    }
}
