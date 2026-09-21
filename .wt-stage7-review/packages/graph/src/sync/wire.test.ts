/**
 * Canonical wire-format vectors (A003-T42), TypeScript side.
 *
 * Loads the same `services/sync-engine/tests/vectors/*.json` files the Rust
 * integration test (`tests/wire_vectors.rs`) uses and runs the identical
 * assertions: `decodeMessage(encoded_hex)` deep-equals `message`, and
 * `encodeMessage(message)` reproduces `encoded_hex` byte-for-byte.
 *
 * The vectors live with the Rust crate because that crate is the reference
 * implementation of the wire format per VPS-A003. This is a deliberate
 * cross-package read, at test time only.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  decodeMessage,
  encodeMessage,
  WireError,
  type DeltaEntry,
  type ErrorKind,
  type Message,
  type PayloadKind,
  type SyncState,
  type TierTag,
} from "./wire";

const vectorsDir = fileURLToPath(
  new URL("../../../../services/sync-engine/tests/vectors/", import.meta.url),
);

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

interface RawVector {
  description: string;
  message: Record<string, unknown>;
  encoded_hex: string;
}

function loadVector(file: string): RawVector {
  return JSON.parse(readFileSync(`${vectorsDir}${file}`, "utf8")) as RawVector;
}

function entryFromJson(e: Record<string, unknown>): DeltaEntry {
  return {
    cursor: BigInt(e["cursor"] as number),
    documentId: e["document_id"] as string,
    tierTag: e["tier_tag"] as TierTag,
    payloadKind: e["payload_kind"] as PayloadKind,
    originDeviceId: e["origin_device_id"] as string,
    committedAtUnixMs: BigInt(e["committed_at_unix_ms"] as number),
    payload: fromHex((e["payload_hex"] as string) ?? ""),
  };
}

function messageFromJson(m: Record<string, unknown>): Message {
  const s = (k: string) => m[k] as string;
  const num = (k: string) => m[k] as number;
  const bytes = (k: string) => fromHex((m[k] as string) ?? "");
  const cursor = (k: string) => BigInt(m[k] as number);

  switch (s("type")) {
    case "hello":
      return {
        type: "hello",
        clientMinVersion: num("client_min_version"),
        clientMaxVersion: num("client_max_version"),
        workspaceId: s("workspace_id"),
        deviceId: s("device_id"),
        sessionToken: bytes("session_token_hex"),
      };
    case "push_delta":
      return {
        type: "push_delta",
        documentId: s("document_id"),
        tierTag: s("tier_tag") as TierTag,
        payloadKind: s("payload_kind") as PayloadKind,
        clientRef: bytes("client_ref_hex"),
        payload: bytes("payload_hex"),
      };
    case "pull_since_cursor":
      return {
        type: "pull_since_cursor",
        documentId: s("document_id"),
        afterCursor: cursor("after_cursor"),
      };
    case "delta_batch":
      return {
        type: "delta_batch",
        entries: (m["entries"] as Record<string, unknown>[]).map(entryFromJson),
      };
    case "ack":
      return s("ack_kind") === "client_cumulative"
        ? {
            type: "ack",
            ackKind: "client_cumulative",
            acknowledgedCursor: cursor("acknowledged_cursor"),
          }
        : {
            type: "ack",
            ackKind: "relay_receipt",
            clientRef: bytes("client_ref_hex"),
            assignedCursor: cursor("assigned_cursor"),
          };
    case "sync_status":
      return {
        type: "sync_status",
        status: s("status") as SyncState,
        highestKnownCursor: cursor("highest_known_cursor"),
        highestAcknowledgedCursor: cursor("highest_acknowledged_cursor"),
      };
    case "error":
      return {
        type: "error",
        errorKind: s("error_kind") as ErrorKind,
        detail: s("detail"),
      };
    default:
      throw new Error(`unknown message type ${s("type")}`);
  }
}

const vectorFiles = readdirSync(vectorsDir)
  .filter((f) => f.endsWith(".json"))
  .sort();

describe("sync wire format — canonical vectors", () => {
  it("finds the vector files shared with the Rust crate", () => {
    expect(vectorFiles.length).toBeGreaterThanOrEqual(9);
  });

  for (const file of vectorFiles) {
    const vector = loadVector(file);
    const expected = messageFromJson(vector.message);

    it(`${file}: decode(encoded_hex) equals message`, () => {
      expect(vector.encoded_hex).not.toEqual("");
      expect(decodeMessage(fromHex(vector.encoded_hex))).toEqual(expected);
    });

    it(`${file}: encode(message) reproduces encoded_hex`, () => {
      expect(toHex(encodeMessage(expected))).toEqual(vector.encoded_hex);
    });

    it(`${file}: encode -> decode round trips`, () => {
      expect(decodeMessage(encodeMessage(expected))).toEqual(expected);
    });
  }
});

describe("sync wire format — decode rejects malformed frames", () => {
  const hello = fromHex(loadVector("hello.json").encoded_hex);

  it("rejects a frame shorter than the header", () => {
    expect(() => decodeMessage(new Uint8Array([1]))).toThrow(WireError);
  });

  it("rejects a wrong version byte", () => {
    const bad = hello.slice();
    bad[0] = 2;
    expect(() => decodeMessage(bad)).toThrow(/protocol version byte 2/);
  });

  it("rejects an unknown message type", () => {
    expect(() => decodeMessage(new Uint8Array([1, 99]))).toThrow(
      /unknown message type 99/,
    );
  });

  it("rejects a truncated body", () => {
    for (let cut = 2; cut < hello.length; cut += 1) {
      expect(() => decodeMessage(hello.subarray(0, cut))).toThrow(WireError);
    }
  });

  it("rejects trailing bytes", () => {
    const padded = new Uint8Array(hello.length + 1);
    padded.set(hello);
    expect(() => decodeMessage(padded)).toThrow(/trailing byte/);
  });
});
