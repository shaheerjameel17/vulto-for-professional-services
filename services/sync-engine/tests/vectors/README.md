# Canonical wire-format vectors (FDN-51 Stage 1, A003-T42)

One file per protocol message. Each is:

```json
{
  "description": "...",
  "message": { "type": "<message type>", ... },
  "encoded_hex": "<lowercase hex of the complete frame>"
}
```

These are the single source of truth for the wire format. Both implementations
validate against **these exact files**:

- Rust — `services/sync-engine/tests/wire_vectors.rs`
- TypeScript — `packages/graph/src/sync/wire.test.ts`

Each side independently asserts `decode(encoded_hex)` equals `message` and
`encode(message)` reproduces `encoded_hex`. A vector only holds if the two
encoders agree byte-for-byte.

## `message` conventions

- Enum fields are lowercase strings: `tier_tag` is `"server_readable"` / `"opaque"`;
  `payload_kind` is `"update"` / `"snapshot"`; `status` is
  `"synced"` / `"syncing"` / `"pending_changes"` / `"offline"`; `error_kind` is
  `"unsupported_version"` / `"unauthenticated"` / `"malformed_frame"` /
  `"unknown_message_type"` / `"internal"`.
- Any field whose Rust type is `Vec<u8>` carries a `_hex` suffix in JSON and is a
  lowercase hex string (empty string = no bytes): `session_token_hex`,
  `client_ref_hex`, `payload_hex`.
- Cursors are plain JSON integers.

## Regenerating

`encoded_hex` is produced once from the fixed `message` inputs and checked in.
Running `cargo test --test wire_vectors` with any `encoded_hex` blank prints the
computed value and fails, so a new vector is added by writing everything except
`encoded_hex`, running once, and pasting the printed hex back in.
