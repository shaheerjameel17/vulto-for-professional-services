//! The delivery cursor (A003-T39) — type and arithmetic only.
//!
//! Stage 1 defines what a cursor *is* and how two of them compare. The
//! authoritative assignment — a per-workspace commit sequence handed out at the
//! moment a delta's row is transaction-committed to PostgreSQL, with each device
//! tracking its own acknowledged position in that sequence — is Stage 2's
//! persistence work. Nothing here talks to a database.

/// A monotonic delivery position. `0` is "nothing delivered yet"; the first
/// committed delta is `1`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Cursor(pub u64);

impl Cursor {
    /// The position before any delta has been committed. A `PullSinceCursor`
    /// carrying `ZERO` asks for the entire history.
    pub const ZERO: Cursor = Cursor(0);

    /// The raw sequence value.
    #[inline]
    pub const fn value(self) -> u64 {
        self.0
    }

    /// `true` when `self` is strictly after `other` — the exact test A003-T40
    /// uses to decide which deltas to replay on reconnect ("every delta whose
    /// cursor is strictly greater than that client's last acknowledged cursor").
    #[inline]
    pub const fn succeeds(self, other: Cursor) -> bool {
        self.0 > other.0
    }

    /// The next position. Saturates at `u64::MAX` rather than wrapping; a
    /// workspace that commits 1.8e19 deltas has other problems.
    #[inline]
    pub const fn next(self) -> Cursor {
        Cursor(self.0.saturating_add(1))
    }
}

impl From<u64> for Cursor {
    #[inline]
    fn from(value: u64) -> Self {
        Cursor(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_is_the_bottom() {
        assert_eq!(Cursor::ZERO.value(), 0);
        assert!(!Cursor::ZERO.succeeds(Cursor::ZERO));
        assert!(Cursor(1).succeeds(Cursor::ZERO));
    }

    #[test]
    fn succeeds_is_strict() {
        assert!(Cursor(5).succeeds(Cursor(4)));
        assert!(!Cursor(5).succeeds(Cursor(5)));
        assert!(!Cursor(4).succeeds(Cursor(5)));
    }

    #[test]
    fn next_increments_and_saturates() {
        assert_eq!(Cursor(41).next(), Cursor(42));
        assert_eq!(Cursor(u64::MAX).next(), Cursor(u64::MAX));
    }

    #[test]
    fn ordering_matches_value() {
        assert!(Cursor(1) < Cursor(2));
        let mut v = [Cursor(3), Cursor(1), Cursor(2)];
        v.sort();
        assert_eq!(v, [Cursor(1), Cursor(2), Cursor(3)]);
    }
}
