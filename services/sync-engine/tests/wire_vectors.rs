//! Canonical wire-format vectors (A003-T42).
//!
//! Every `tests/vectors/*.json` file is decoded from its `encoded_hex` and
//! checked to equal its structured `message`, then re-encoded and checked to
//! reproduce `encoded_hex` exactly. `packages/graph/src/sync/wire.test.ts` runs
//! the identical assertions against the identical files, so the Rust and
//! TypeScript encoders are validated against each other.
//!
//! If a vector's `encoded_hex` is blank, this test prints the value the current
//! encoder produces and then fails — that is how a new vector is finalised.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use vulto_sync_engine::wire::{
    decode, encode, Ack, DeltaBatch, DeltaEntry, ErrorKind, Hello, Message, PayloadKind,
    PullSinceCursor, PushDelta, SyncState, SyncStatus, TierTag, WireErrorMessage,
};

fn vectors_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("vectors")
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

fn hex_decode(s: &str) -> Vec<u8> {
    assert!(
        s.len().is_multiple_of(2),
        "hex string has odd length: {s:?}"
    );
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("valid hex"))
        .collect()
}

fn str_field<'a>(m: &'a Value, key: &str) -> &'a str {
    m.get(key)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("missing string field {key:?}"))
}

fn bytes_field(m: &Value, key: &str) -> Vec<u8> {
    hex_decode(str_field(m, key))
}

fn u64_field(m: &Value, key: &str) -> u64 {
    m.get(key)
        .and_then(Value::as_u64)
        .unwrap_or_else(|| panic!("missing integer field {key:?}"))
}

fn tier_tag(s: &str) -> TierTag {
    match s {
        "server_readable" => TierTag::ServerReadable,
        "opaque" => TierTag::Opaque,
        other => panic!("unknown tier_tag {other:?}"),
    }
}

fn payload_kind(s: &str) -> PayloadKind {
    match s {
        "update" => PayloadKind::Update,
        "snapshot" => PayloadKind::Snapshot,
        other => panic!("unknown payload_kind {other:?}"),
    }
}

fn message_from_json(m: &Value) -> Message {
    match str_field(m, "type") {
        "hello" => Message::Hello(Hello {
            client_min_version: u64_field(m, "client_min_version") as u8,
            client_max_version: u64_field(m, "client_max_version") as u8,
            workspace_id: str_field(m, "workspace_id").to_string(),
            device_id: str_field(m, "device_id").to_string(),
            session_token: bytes_field(m, "session_token_hex"),
        }),
        "push_delta" => Message::PushDelta(PushDelta {
            document_id: str_field(m, "document_id").to_string(),
            tier_tag: tier_tag(str_field(m, "tier_tag")),
            payload_kind: payload_kind(str_field(m, "payload_kind")),
            client_ref: bytes_field(m, "client_ref_hex"),
            payload: bytes_field(m, "payload_hex"),
        }),
        "pull_since_cursor" => Message::PullSinceCursor(PullSinceCursor {
            document_id: str_field(m, "document_id").to_string(),
            after_cursor: u64_field(m, "after_cursor").into(),
        }),
        "delta_batch" => {
            let entries = m
                .get("entries")
                .and_then(Value::as_array)
                .expect("entries array")
                .iter()
                .map(|e| DeltaEntry {
                    cursor: u64_field(e, "cursor").into(),
                    document_id: str_field(e, "document_id").to_string(),
                    tier_tag: tier_tag(str_field(e, "tier_tag")),
                    payload_kind: payload_kind(str_field(e, "payload_kind")),
                    origin_device_id: str_field(e, "origin_device_id").to_string(),
                    committed_at_unix_ms: u64_field(e, "committed_at_unix_ms"),
                    payload: bytes_field(e, "payload_hex"),
                })
                .collect();
            Message::DeltaBatch(DeltaBatch { entries })
        }
        "ack" => Message::Ack(match str_field(m, "ack_kind") {
            "client_cumulative" => Ack::ClientCumulative {
                acknowledged_cursor: u64_field(m, "acknowledged_cursor").into(),
            },
            "relay_receipt" => Ack::RelayReceipt {
                client_ref: bytes_field(m, "client_ref_hex"),
                assigned_cursor: u64_field(m, "assigned_cursor").into(),
            },
            other => panic!("unknown ack_kind {other:?}"),
        }),
        "sync_status" => Message::SyncStatus(SyncStatus {
            state: match str_field(m, "status") {
                "synced" => SyncState::Synced,
                "syncing" => SyncState::Syncing,
                "pending_changes" => SyncState::PendingChanges,
                "offline" => SyncState::Offline,
                other => panic!("unknown status {other:?}"),
            },
            highest_known_cursor: u64_field(m, "highest_known_cursor").into(),
            highest_acknowledged_cursor: u64_field(m, "highest_acknowledged_cursor").into(),
        }),
        "error" => Message::Error(WireErrorMessage {
            kind: match str_field(m, "error_kind") {
                "unsupported_version" => ErrorKind::UnsupportedVersion,
                "unauthenticated" => ErrorKind::Unauthenticated,
                "malformed_frame" => ErrorKind::MalformedFrame,
                "unknown_message_type" => ErrorKind::UnknownMessageType,
                "internal" => ErrorKind::Internal,
                other => panic!("unknown error_kind {other:?}"),
            },
            detail: str_field(m, "detail").to_string(),
        }),
        other => panic!("unknown message type {other:?}"),
    }
}

#[test]
fn vectors_round_trip_on_both_directions() {
    let mut needs_regen: Vec<String> = Vec::new();
    let mut checked = 0usize;

    let mut files: Vec<PathBuf> = fs::read_dir(vectors_dir())
        .expect("vectors dir")
        .map(|e| e.expect("dir entry").path())
        .filter(|p| p.extension().map(|x| x == "json").unwrap_or(false))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no vector files found");

    for path in files {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let raw = fs::read_to_string(&path).expect("read vector");
        let vector: Value = serde_json::from_str(&raw).expect("parse vector json");

        let message = message_from_json(&vector["message"]);
        let got_hex = hex_encode(&encode(&message));

        // The encoder's own output must always decode back to the same value.
        assert_eq!(
            decode(&hex_decode(&got_hex)).expect("decode own output"),
            message,
            "{name}: encode->decode round trip"
        );

        let declared = vector["encoded_hex"].as_str().unwrap_or("");
        if declared.is_empty() {
            needs_regen.push(format!("  {name}: \"encoded_hex\": \"{got_hex}\""));
            continue;
        }

        assert_eq!(
            got_hex, declared,
            "{name}: encode(message) must equal encoded_hex"
        );
        assert_eq!(
            decode(&hex_decode(declared)).expect("decode declared hex"),
            message,
            "{name}: decode(encoded_hex) must equal message"
        );
        checked += 1;
    }

    if !needs_regen.is_empty() {
        panic!(
            "{} vector(s) have a blank encoded_hex. Paste these in:\n{}",
            needs_regen.len(),
            needs_regen.join("\n")
        );
    }

    assert!(
        checked >= 9,
        "expected at least 9 finalised vectors, checked {checked}"
    );
}
