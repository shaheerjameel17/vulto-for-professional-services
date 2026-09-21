/**
 * FDN-51 Stage 1 — the sync transport wire format, TypeScript side.
 *
 * This is a byte-for-byte mirror of `services/sync-engine/src/wire/` (the Rust
 * shared core). Layout is fixed by `VPS-A003`'s "Sync transport contract"
 * section (A003-T36–T42): a 2-byte header (protocol version, message type)
 * followed by length-prefixed fields, all integers big-endian, no codegen
 * toolchain.
 *
 * The two implementations are checked against each other by the canonical
 * vectors in `services/sync-engine/tests/vectors/*.json`, run here by
 * `wire.test.ts` and in Rust by `tests/wire_vectors.rs`.
 *
 * Stage 1 is the codec only. Wiring these messages through the Worker protocol
 * and turning `SyncStatus` into A003-T08's observable is Stage 4 client work.
 */

/** The one protocol version this build implements (A003-T38). */
export const PROTOCOL_VERSION = 1 as const;

/** Message-type byte (frame header offset 1). */
export const MESSAGE_TYPE = {
  hello: 1,
  push_delta: 2,
  pull_since_cursor: 3,
  delta_batch: 4,
  ack: 5,
  sync_status: 6,
  error: 7,
} as const;

export type MessageKind = keyof typeof MESSAGE_TYPE;

/** Tier 0/2 (relay may read) vs Tier 1/3 (opaque). Transport metadata only — not FDN-52's header (A003-T41). */
export type TierTag = "server_readable" | "opaque";
const TIER_TAG_BYTE: Record<TierTag, number> = { server_readable: 0, opaque: 1 };
const TIER_TAG_BY_BYTE = ["server_readable", "opaque"] as const;

export type PayloadKind = "update" | "snapshot";
const PAYLOAD_KIND_BYTE: Record<PayloadKind, number> = { update: 0, snapshot: 1 };
const PAYLOAD_KIND_BY_BYTE = ["update", "snapshot"] as const;

/**
 * The on-wire `SyncStatus.state`. The relay only ever sends `synced` /
 * `syncing`. `pending_changes` is retained but unused: founder ruling 4 on
 * the Stage 4 plan moved pending-local-changes to a client-side boolean
 * (`SyncStatusSnapshot.pendingLocalChanges`), and `offline` is client-derived
 * on socket loss (FDN-51 Stage 6, F188).
 */
export type SyncState = "synced" | "syncing" | "pending_changes" | "offline";
const SYNC_STATE_BYTE: Record<SyncState, number> = {
  synced: 0,
  syncing: 1,
  pending_changes: 2,
  offline: 3,
};
const SYNC_STATE_BY_BYTE = ["synced", "syncing", "pending_changes", "offline"] as const;

export type ErrorKind =
  | "unsupported_version"
  | "unauthenticated"
  | "malformed_frame"
  | "unknown_message_type"
  | "internal";
const ERROR_KIND_BYTE: Record<ErrorKind, number> = {
  unsupported_version: 1,
  unauthenticated: 2,
  malformed_frame: 3,
  unknown_message_type: 4,
  internal: 5,
};
const ERROR_KIND_BY_BYTE: Record<number, ErrorKind> = {
  1: "unsupported_version",
  2: "unauthenticated",
  3: "malformed_frame",
  4: "unknown_message_type",
  5: "internal",
};

export interface DeltaEntry {
  cursor: bigint;
  documentId: string;
  tierTag: TierTag;
  payloadKind: PayloadKind;
  originDeviceId: string;
  committedAtUnixMs: bigint;
  payload: Uint8Array;
}

export type Message =
  | {
      type: "hello";
      clientMinVersion: number;
      clientMaxVersion: number;
      workspaceId: string;
      deviceId: string;
      sessionToken: Uint8Array;
    }
  | {
      type: "push_delta";
      documentId: string;
      tierTag: TierTag;
      payloadKind: PayloadKind;
      clientRef: Uint8Array;
      payload: Uint8Array;
    }
  | { type: "pull_since_cursor"; documentId: string; afterCursor: bigint }
  | { type: "delta_batch"; entries: DeltaEntry[] }
  | { type: "ack"; ackKind: "client_cumulative"; acknowledgedCursor: bigint }
  | {
      type: "ack";
      ackKind: "relay_receipt";
      clientRef: Uint8Array;
      assignedCursor: bigint;
    }
  | {
      type: "sync_status";
      status: SyncState;
      highestKnownCursor: bigint;
      highestAcknowledgedCursor: bigint;
    }
  | { type: "error"; errorKind: ErrorKind; detail: string };

/** Thrown when a byte slice is not a valid frame. Mirrors Rust's `WireError`. */
export class WireError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WireError";
  }
}

/** Decode-side bounds, identical to the Rust constants. */
export const MAX_LP_LEN = 64 * 1024 * 1024;
export const MAX_BATCH_ENTRIES = 100_000;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

class Writer {
  #parts: number[] = [];

  constructor(type: MessageKind) {
    this.#parts.push(PROTOCOL_VERSION, MESSAGE_TYPE[type]);
  }

  u8(v: number): void {
    this.#parts.push(v & 0xff);
  }

  u16(v: number): void {
    this.#parts.push((v >>> 8) & 0xff, v & 0xff);
  }

  u32(v: number): void {
    this.#parts.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  }

  u64(v: bigint): void {
    const buf = new DataView(new ArrayBuffer(8));
    buf.setBigUint64(0, BigInt.asUintN(64, v), false);
    for (let i = 0; i < 8; i += 1) this.#parts.push(buf.getUint8(i));
  }

  lp(bytes: Uint8Array): void {
    this.u32(bytes.length);
    for (const b of bytes) this.#parts.push(b);
  }

  lpStr(s: string): void {
    this.lp(textEncoder.encode(s));
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.#parts);
  }
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

class Reader {
  #view: DataView;
  #pos = 0;

  constructor(private readonly buf: Uint8Array) {
    this.#view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get remaining(): number {
    return this.buf.length - this.#pos;
  }

  #need(n: number): void {
    if (this.remaining < n) {
      throw new WireError(
        `unexpected end of frame, needed ${n - this.remaining} more byte(s)`,
      );
    }
  }

  u8(): number {
    this.#need(1);
    return this.#view.getUint8(this.#pos++);
  }

  u16(): number {
    this.#need(2);
    const v = this.#view.getUint16(this.#pos, false);
    this.#pos += 2;
    return v;
  }

  u32(): number {
    this.#need(4);
    const v = this.#view.getUint32(this.#pos, false);
    this.#pos += 4;
    return v;
  }

  u64(): bigint {
    this.#need(8);
    const v = this.#view.getBigUint64(this.#pos, false);
    this.#pos += 8;
    return v;
  }

  lp(field: string): Uint8Array {
    const declared = this.u32();
    if (declared > MAX_LP_LEN) {
      throw new WireError(
        `field ${field} declared length ${declared} exceeds the bound`,
      );
    }
    this.#need(declared);
    const out = this.buf.subarray(this.#pos, this.#pos + declared);
    this.#pos += declared;
    return new Uint8Array(out);
  }

  lpStr(field: string): string {
    try {
      return textDecoder.decode(this.lp(field));
    } catch {
      throw new WireError(`field ${field} is not valid UTF-8`);
    }
  }

  finish(): void {
    if (this.remaining !== 0) {
      throw new WireError(
        `${this.remaining} trailing byte(s) after a complete message`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

export function encodeMessage(message: Message): Uint8Array {
  const w = new Writer(message.type);
  switch (message.type) {
    case "hello":
      w.u8(message.clientMinVersion);
      w.u8(message.clientMaxVersion);
      w.lpStr(message.workspaceId);
      w.lpStr(message.deviceId);
      w.lp(message.sessionToken);
      break;
    case "push_delta":
      w.lpStr(message.documentId);
      w.u8(TIER_TAG_BYTE[message.tierTag]);
      w.u8(PAYLOAD_KIND_BYTE[message.payloadKind]);
      w.lp(message.clientRef);
      w.lp(message.payload);
      break;
    case "pull_since_cursor":
      w.lpStr(message.documentId);
      w.u64(message.afterCursor);
      break;
    case "delta_batch":
      w.u32(message.entries.length);
      for (const e of message.entries) {
        w.u64(e.cursor);
        w.lpStr(e.documentId);
        w.u8(TIER_TAG_BYTE[e.tierTag]);
        w.u8(PAYLOAD_KIND_BYTE[e.payloadKind]);
        w.lpStr(e.originDeviceId);
        w.u64(e.committedAtUnixMs);
        w.lp(e.payload);
      }
      break;
    case "ack":
      if (message.ackKind === "client_cumulative") {
        w.u8(0);
        w.u64(message.acknowledgedCursor);
      } else {
        w.u8(1);
        w.lp(message.clientRef);
        w.u64(message.assignedCursor);
      }
      break;
    case "sync_status":
      w.u8(SYNC_STATE_BYTE[message.status]);
      w.u64(message.highestKnownCursor);
      w.u64(message.highestAcknowledgedCursor);
      break;
    case "error":
      w.u16(ERROR_KIND_BYTE[message.errorKind]);
      w.lpStr(message.detail);
      break;
  }
  return w.finish();
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

function tierTag(byte: number): TierTag {
  const v = TIER_TAG_BY_BYTE[byte];
  if (v === undefined)
    throw new WireError(`field tier_tag has invalid discriminant ${byte}`);
  return v;
}

function payloadKind(byte: number): PayloadKind {
  const v = PAYLOAD_KIND_BY_BYTE[byte];
  if (v === undefined)
    throw new WireError(`field payload_kind has invalid discriminant ${byte}`);
  return v;
}

/** Parse a complete frame into a message. Bounds-checked throughout. */
export function decodeMessage(frame: Uint8Array): Message {
  if (frame.length < 2) throw new WireError("frame shorter than the 2-byte header");
  const version = frame[0]!;
  if (version !== PROTOCOL_VERSION) {
    throw new WireError(
      `protocol version byte ${version} != negotiated ${PROTOCOL_VERSION}`,
    );
  }
  const typeByte = frame[1]!;
  const kind = (Object.keys(MESSAGE_TYPE) as MessageKind[]).find(
    (k) => MESSAGE_TYPE[k] === typeByte,
  );
  if (kind === undefined) throw new WireError(`unknown message type ${typeByte}`);

  const r = new Reader(frame.subarray(2));
  let message: Message;

  switch (kind) {
    case "hello":
      message = {
        type: "hello",
        clientMinVersion: r.u8(),
        clientMaxVersion: r.u8(),
        workspaceId: r.lpStr("workspace_id"),
        deviceId: r.lpStr("device_id"),
        sessionToken: r.lp("session_token"),
      };
      break;
    case "push_delta":
      message = {
        type: "push_delta",
        documentId: r.lpStr("document_id"),
        tierTag: tierTag(r.u8()),
        payloadKind: payloadKind(r.u8()),
        clientRef: r.lp("client_ref"),
        payload: r.lp("payload"),
      };
      break;
    case "pull_since_cursor":
      message = {
        type: "pull_since_cursor",
        documentId: r.lpStr("document_id"),
        afterCursor: r.u64(),
      };
      break;
    case "delta_batch": {
      const count = r.u32();
      if (count > MAX_BATCH_ENTRIES) {
        throw new WireError(
          `field delta_batch.count declared length ${count} exceeds the bound`,
        );
      }
      const entries: DeltaEntry[] = [];
      for (let i = 0; i < count; i += 1) {
        entries.push({
          cursor: r.u64(),
          documentId: r.lpStr("entry.document_id"),
          tierTag: tierTag(r.u8()),
          payloadKind: payloadKind(r.u8()),
          originDeviceId: r.lpStr("entry.origin_device_id"),
          committedAtUnixMs: r.u64(),
          payload: r.lp("entry.payload"),
        });
      }
      message = { type: "delta_batch", entries };
      break;
    }
    case "ack": {
      const ackKind = r.u8();
      if (ackKind === 0) {
        message = {
          type: "ack",
          ackKind: "client_cumulative",
          acknowledgedCursor: r.u64(),
        };
      } else if (ackKind === 1) {
        message = {
          type: "ack",
          ackKind: "relay_receipt",
          clientRef: r.lp("client_ref"),
          assignedCursor: r.u64(),
        };
      } else {
        throw new WireError(`field ack_kind has invalid discriminant ${ackKind}`);
      }
      break;
    }
    case "sync_status": {
      const stateByte = r.u8();
      const status = SYNC_STATE_BY_BYTE[stateByte];
      if (status === undefined) {
        throw new WireError(`field status has invalid discriminant ${stateByte}`);
      }
      message = {
        type: "sync_status",
        status,
        highestKnownCursor: r.u64(),
        highestAcknowledgedCursor: r.u64(),
      };
      break;
    }
    case "error": {
      const kindRaw = r.u16();
      const errorKind = ERROR_KIND_BY_BYTE[kindRaw];
      if (errorKind === undefined) {
        throw new WireError(`field error_kind has invalid discriminant ${kindRaw}`);
      }
      message = { type: "error", errorKind, detail: r.lpStr("detail") };
      break;
    }
  }

  r.finish();
  return message;
}
