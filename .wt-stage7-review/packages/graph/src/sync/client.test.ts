import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceSyncClient,
  type SyncHostBindings,
  type SyncSocket,
  type SyncStatusSnapshot,
} from "./client";
import {
  decodeMessage,
  encodeMessage,
  PROTOCOL_VERSION,
  type DeltaEntry,
  type Message,
} from "./wire";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const DEVICE = "device-under-test";
const DOCUMENT = "workspace-graph";

/**
 * A fake relay reachable through a `SyncSocket`. It runs the real wire codec
 * and a minimal version of the Stage 2b/3 server behaviour: cursor-at-receipt,
 * replay of a seeded backlog after `Hello`, live fan-out is not modelled (one
 * client only).
 */
class FakeRelay implements SyncSocket {
  binaryType = "arraybuffer";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  readonly received: Message[] = [];
  readonly log: DeltaEntry[] = [];
  #cursor = 0n;
  #open = true;
  #helloSeen = false;
  /** Frames the relay will emit on the next `Hello`, before `SyncStatus`. */
  replayBacklog: DeltaEntry[][] = [];
  /** If set, `Hello` is answered with this error instead of a replay. */
  rejectWith: Message | null = null;
  /** What the relay's `SyncStatus` reports as this device's durable ack (server-side). */
  deviceAckedCursor = 0n;

  constructor(seed: Array<{ payload: Uint8Array; origin?: string }> = []) {
    for (const entry of seed) this.#append(entry.payload, entry.origin ?? "peer");
  }

  #append(payload: Uint8Array, origin: string): DeltaEntry {
    this.#cursor += 1n;
    const entry: DeltaEntry = {
      cursor: this.#cursor,
      documentId: DOCUMENT,
      tierTag: "server_readable",
      payloadKind: "update",
      originDeviceId: origin,
      committedAtUnixMs: 0n,
      payload,
    };
    this.log.push(entry);
    return entry;
  }

  send(data: ArrayBufferView | ArrayBufferLike): void {
    if (!this.#open) return;
    const bytes =
      data instanceof Uint8Array
        ? data
        : ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data);
    const message = decodeMessage(bytes.slice());
    this.received.push(message);

    if (message.type === "hello") {
      this.#helloSeen = true;
      if (this.rejectWith) {
        this.#emit(this.rejectWith);
        return;
      }
      for (const batch of this.replayBacklog) {
        this.#emit({ type: "delta_batch", entries: batch });
      }
      this.#emit({
        type: "sync_status",
        status: "synced",
        highestKnownCursor: this.#cursor,
        highestAcknowledgedCursor: this.deviceAckedCursor,
      });
      return;
    }
    if (message.type === "push_delta") {
      const entry = this.#append(message.payload, DEVICE);
      this.#emit({
        type: "ack",
        ackKind: "relay_receipt",
        clientRef: message.clientRef,
        assignedCursor: entry.cursor,
      });
    }
    if (message.type === "pull_since_cursor") {
      const entries = this.log.filter((e) => e.cursor > message.afterCursor);
      if (entries.length > 0) this.#emit({ type: "delta_batch", entries });
    }
  }

  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.onclose?.();
  }

  /** Push a live delta from another device to the connected client. */
  pushFromPeer(payload: Uint8Array): DeltaEntry {
    const entry = this.#append(payload, "peer");
    if (this.#helloSeen && this.#open) {
      this.#emit({ type: "delta_batch", entries: [entry] });
    }
    return entry;
  }

  #emit(message: Message): void {
    if (!this.#open) return;
    queueMicrotask(() => {
      if (this.#open) this.onmessage?.({ data: encodeMessage(message) });
    });
  }
}

interface Harness {
  client: WorkspaceSyncClient;
  relays: FakeRelay[];
  statuses: SyncStatusSnapshot[];
  markers: Map<string, Uint8Array>;
  applied: Uint8Array[][];
  localUpdate: (bytes: Uint8Array) => void;
  failApplyOnce: () => void;
  mintCalls: number;
  timers: Array<{ fn: () => void; ms: number }>;
  runTimers: () => void;
}

function makeHarness(
  options: {
    seed?: Array<{ payload: Uint8Array; origin?: string }>;
    mintRejects?: boolean;
    configureRelay?: (relay: FakeRelay) => void;
  } = {},
): Harness {
  const relays: FakeRelay[] = [];
  const statuses: SyncStatusSnapshot[] = [];
  const markers = new Map<string, Uint8Array>();
  const applied: Uint8Array[][] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const state = { mintCalls: 0, failApplyOnce: false };

  const bindings: SyncHostBindings = {
    workspaceId: WORKSPACE,
    deviceId: DEVICE,
    documentId: DOCUMENT,
    async applyRemoteDeltas(payloads) {
      if (state.failApplyOnce) {
        state.failApplyOnce = false;
        throw new Error("materialization refused this batch");
      }
      applied.push(payloads.map((p) => p.slice()));
    },
    async loadMarker(key) {
      return markers.get(key) ?? null;
    },
    async storeMarker(key, value) {
      markers.set(key, value.slice());
    },
    async mintTicket() {
      state.mintCalls += 1;
      if (options.mintRejects) throw new Error("not authorized");
      return { ticket: `vlt_sync_test-${state.mintCalls}`, expiresAtMs: 10_000_000 };
    },
  };

  const client = new WorkspaceSyncClient({
    relayUrl: "ws://relay.test/sync",
    bindings,
    onStatusChange: (snapshot) => statuses.push(snapshot),
    socketFactory: () => {
      const relay = new FakeRelay(options.seed);
      options.configureRelay?.(relay);
      relays.push(relay);
      queueMicrotask(() => relay.onopen?.());
      return relay;
    },
    now: () => 0,
    setTimer: (fn, ms) => {
      const handle = { fn, ms };
      timers.push(handle);
      return handle;
    },
    clearTimer: (handle) => {
      const idx = timers.indexOf(handle as { fn: () => void; ms: number });
      if (idx >= 0) timers.splice(idx, 1);
    },
  });

  return {
    client,
    relays,
    statuses,
    markers,
    applied,
    localUpdate: (bytes) => client.enqueueLocalDelta(bytes),
    failApplyOnce: () => {
      state.failApplyOnce = true;
    },
    get mintCalls() {
      return state.mintCalls;
    },
    timers,
    runTimers: () => {
      const due = timers.splice(0, timers.length);
      for (const t of due) t.fn();
    },
  } as Harness;
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WorkspaceSyncClient", () => {
  it("handshakes, replays a backlog with one ack per frame, and reports synced", async () => {
    const h = makeHarness({
      configureRelay: (r) => {
        r.replayBacklog = [
          [entry(1n, new Uint8Array([10]))],
          [entry(2n, new Uint8Array([20]))],
          [entry(3n, new Uint8Array([30]))],
        ];
      },
    });
    await h.client.start();
    await flush();
    await flush();

    // Applied once per frame, in order.
    expect(h.applied.map((frame) => [...frame[0]!])).toEqual([[10], [20], [30]]);

    // One cumulative ack per frame: 1, then 2, then 3.
    const acks = h.relays[0]!.received.filter(
      (m): m is Extract<Message, { type: "ack"; ackKind: "client_cumulative" }> =>
        m.type === "ack" && m.ackKind === "client_cumulative",
    );
    expect(acks.map((a) => Number(a.acknowledgedCursor))).toEqual([1, 2, 3]);

    const final = h.statuses.at(-1)!;
    expect(final.state).toBe("synced");
    expect(final.highestAckedCursor).toBe(3);
    expect(final.pendingLocalChanges).toBe(false);

    // The durable cursor marker survived.
    expect(h.markers.get("sync/acked-cursor")).toEqual(u64(3n));
  });

  it("pushes a local commit and clears it from the outbox on RelayReceipt", async () => {
    const h = makeHarness();
    await h.client.start();
    await flush();

    h.localUpdate(new Uint8Array([7, 7, 7]));
    await flush();
    await flush();

    const relay = h.relays[0]!;
    const push = relay.received.find((m) => m.type === "push_delta");
    expect(push, "a push_delta was sent").toBeTruthy();
    expect(push!.type === "push_delta" && [...push!.payload]).toEqual([7, 7, 7]);
    expect(push!.type === "push_delta" && push!.tierTag, "Tier 0/2 only").toBe(
      "server_readable",
    );

    // Acknowledged: outbox drained, status synced, marker emptied.
    await flush();
    expect(h.statuses.at(-1)!.pendingLocalChanges).toBe(false);
    expect(h.statuses.at(-1)!.state).toBe("synced");
    expect(decodeOutboxLen(h.markers.get("sync/outbox"))).toBe(0);
  });

  it("buffers local commits made while offline and flushes them on reconnect", async () => {
    const h = makeHarness();
    await h.client.start();
    await flush();
    h.relays[0]!.close();
    await flush();

    expect(h.statuses.at(-1)!.state).toBe("offline");

    h.localUpdate(new Uint8Array([1]));
    h.localUpdate(new Uint8Array([2]));
    await flush();
    expect(h.statuses.at(-1)!.pendingLocalChanges).toBe(true);
    // Persisted for a Worker restart.
    expect(decodeOutboxLen(h.markers.get("sync/outbox"))).toBe(2);

    h.runTimers(); // fire the reconnect backoff
    await flush();
    await flush();
    await flush();

    const relay = h.relays.at(-1)!;
    const pushes = relay.received.filter((m) => m.type === "push_delta");
    expect(pushes.map((m) => (m.type === "push_delta" ? [...m.payload] : []))).toEqual([
      [1],
      [2],
    ]);
    expect(h.statuses.at(-1)!.state).toBe("synced");
  });

  it("applies a live delta from a peer and acknowledges it", async () => {
    const h = makeHarness();
    await h.client.start();
    await flush();

    h.relays[0]!.pushFromPeer(new Uint8Array([42]));
    await flush();
    await flush();

    expect(h.applied.at(-1)!.map((p) => [...p])).toEqual([[42]]);
    const lastAck = h.relays[0]!.received.filter(
      (m): m is Extract<Message, { type: "ack"; ackKind: "client_cumulative" }> =>
        m.type === "ack" && m.ackKind === "client_cumulative",
    ).at(-1)!;
    expect(Number(lastAck.acknowledgedCursor)).toBe(1);
    expect(h.statuses.at(-1)!.state).toBe("synced");
  });

  it("re-pulls when the relay's ack is ahead of local state (erased store)", async () => {
    // The relay already has a delta and thinks this device acked it, but the
    // device's local cursor marker is gone.
    const h = makeHarness({
      seed: [{ payload: new Uint8Array([9, 9]), origin: "peer" }],
      configureRelay: (r) => {
        r.deviceAckedCursor = 1n;
      },
    });
    await h.client.start();
    await flush();
    await flush();
    await flush();

    // Auto-replay-from-ack delivered nothing; the client pulled instead.
    const relay = h.relays[0]!;
    expect(relay.received.some((m) => m.type === "pull_since_cursor")).toBe(true);
    expect(h.applied.at(-1)!.map((p) => [...p])).toEqual([[9, 9]]);
    expect(h.statuses.at(-1)!.state).toBe("synced");
    expect(h.statuses.at(-1)!.highestAckedCursor).toBe(1);
  });

  it("drops and retries the connection when applyRemoteDeltas fails", async () => {
    const h = makeHarness({
      configureRelay: (r) => {
        r.replayBacklog = [[entry(1n, new Uint8Array([5]))]];
      },
    });
    h.failApplyOnce();

    await h.client.start();
    await flush();
    await flush();
    await flush();

    // The first replay failed; the connection dropped.
    expect(h.statuses.at(-1)!.state).toBe("offline");
    expect(h.statuses.at(-1)!.lastError).toBe("internal");

    // Reconnect (backoff timer) -> the replay succeeds this time.
    h.runTimers();
    await flush();
    await flush();
    await flush();

    expect(h.relays.length).toBeGreaterThanOrEqual(2);
    expect(h.applied.flat().map((p) => [...p])).toContainEqual([5]);
    expect(h.statuses.at(-1)!.state).toBe("synced");
  });

  it("re-mints a ticket and reconnects on an unauthenticated close", async () => {
    let first = true;
    const h = makeHarness({
      configureRelay: (r) => {
        if (first) {
          r.rejectWith = {
            type: "error",
            errorKind: "unauthenticated",
            detail: "expired",
          };
          first = false;
        }
      },
    });

    await h.client.start();
    await flush();
    await flush();
    expect(h.statuses.at(-1)!.state).toBe("offline");
    expect(h.statuses.at(-1)!.lastError).toBe("unauthenticated");

    h.runTimers();
    await flush();
    await flush();
    await flush();

    expect(h.mintCalls).toBeGreaterThanOrEqual(2);
    expect(h.statuses.at(-1)!.state).toBe("synced");
    expect(h.statuses.at(-1)!.lastError).toBeNull();
  });

  it("stays offline when re-minting also fails (device deauthorized)", async () => {
    const h = makeHarness({ mintRejects: true });
    await h.client.start();
    await flush();
    await flush();

    expect(h.statuses.at(-1)!.state).toBe("offline");
    h.runTimers();
    await flush();
    expect(h.relays).toHaveLength(0); // never opened a socket
  });

  it("acknowledges the gapless prefix when a replay frame is reordered and duplicated", async () => {
    const h = makeHarness({
      configureRelay: (r) => {
        r.replayBacklog = [
          [
            entry(2n, new Uint8Array([20])),
            entry(1n, new Uint8Array([10])),
            entry(3n, new Uint8Array([30])),
            entry(2n, new Uint8Array([20])), // duplicate of cursor 2
          ],
        ];
      },
    });
    await h.client.start();
    await flush();
    await flush();

    // Every entry is handed to the merge layer; Loro import is idempotent
    // (A003-T02), so re-applying cursor 2 changes nothing downstream.
    expect(h.applied.flat().map((p) => [...p])).toEqual([[20], [10], [30], [20]]);

    // The cumulative ack is the contiguous prefix — 3 — regardless of the
    // order the cursors arrived in or that one repeated.
    const acks = h.relays[0]!.received.filter(
      (m): m is Extract<Message, { type: "ack"; ackKind: "client_cumulative" }> =>
        m.type === "ack" && m.ackKind === "client_cumulative",
    );
    expect(Number(acks.at(-1)!.acknowledgedCursor)).toBe(3);
    expect(h.statuses.at(-1)!.state).toBe("synced");
    expect(h.markers.get("sync/acked-cursor")).toEqual(u64(3n));
  });
});

// --- helpers ---

function entry(cursor: bigint, payload: Uint8Array): DeltaEntry {
  return {
    cursor,
    documentId: DOCUMENT,
    tierTag: "server_readable",
    payloadKind: "update",
    originDeviceId: "peer",
    committedAtUnixMs: 0n,
    payload,
  };
}

function u64(value: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, value, false);
  return b;
}

function decodeOutboxLen(bytes: Uint8Array | undefined): number {
  if (!bytes || bytes.byteLength < 4) return 0;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    0,
    false,
  );
}

void PROTOCOL_VERSION;
