/**
 * FDN-51 Stage 4a — the workspace sync client.
 *
 * Runs entirely inside the graph Worker (founder ruling). It speaks the wire
 * protocol from `./wire` to the `services/sync-engine` relay over one
 * WebSocket:
 *
 * - **outbound** — every local commit to the workspace graph `LoroDoc` produces
 *   update bytes (`onLocalUpdate`); they queue in a durable outbox and are
 *   pushed one at a time, each cleared when the relay acknowledges it with a
 *   `RelayReceipt`.
 * - **inbound** — `DeltaBatch` frames (replay after `Hello`, then live) are
 *   applied to the document via `applyRemoteDeltas` and acknowledged
 *   **incrementally, one `Ack` per frame** (Stage 3 ruling 5), so an
 *   interrupted replay resumes from the last applied frame rather than the
 *   start.
 * - **status** — a `SyncStatusSnapshot` is emitted on every transition; the
 *   Worker forwards it to the main thread as A003-T08's observable.
 *
 * The handshake credential is a short-lived `sync_ticket` (`mintTicket`), not a
 * session token. When it nears expiry the client reconnects with a fresh one;
 * the relay's auto-replay-from-ack makes that seamless. An `unauthenticated`
 * close is retried once with a fresh ticket — if minting also fails the device
 * is genuinely deauthorized and the client stays `offline`.
 *
 * Remote deltas are merged without re-running VPS-A004 Gate 1 (founder ruling
 * 3): access is decided only by the read interceptor, for every query,
 * regardless of how data entered the store.
 */

import {
  decodeMessage,
  encodeMessage,
  PROTOCOL_VERSION,
  WireError,
  type ErrorKind,
  type Message,
} from "./wire";

/**
 * The wire `documentId` for the single Tier 0/2 workspace graph document.
 * Stage 4a syncs only this document; protected partitions are FDN-88/89.
 */
export const WORKSPACE_GRAPH_DOCUMENT_ID = "workspace-graph";

export type SyncStatusState = "offline" | "connecting" | "syncing" | "synced";

export type SyncStatusError = ErrorKind | "network";

export interface SyncStatusSnapshot {
  readonly state: SyncStatusState;
  /** True while a local change has not yet been acknowledged by the relay. */
  readonly pendingLocalChanges: boolean;
  /** The relay's highest assigned cursor, from its last `SyncStatus`. */
  readonly highestKnownCursor: number;
  /** The highest cursor this device has applied and durably acknowledged. */
  readonly highestAckedCursor: number;
  /** The reason the last connection attempt failed, cleared on the next success. */
  readonly lastError: SyncStatusError | null;
}

export interface SyncTicket {
  readonly ticket: string;
  /** Epoch milliseconds at which the ticket stops being accepted. */
  readonly expiresAtMs: number;
}

/** Everything the client needs from the Worker runtime, injected for testability. */
export interface SyncHostBindings {
  readonly workspaceId: string;
  readonly deviceId: string;
  /** The Tier 0/2 workspace graph document's stable id on the wire. */
  readonly documentId: string;
  /**
   * Merge remote Loro update payloads into the workspace document and
   * re-materialize. Rejects only on an unrecoverable local error; a rejection
   * ends the connection and is retried on reconnect.
   */
  applyRemoteDeltas(payloads: readonly Uint8Array[]): Promise<void>;
  /** Fires once per local commit with that commit's update bytes. Returns an unsubscribe. */
  onLocalUpdate(listener: (bytes: Uint8Array) => void): () => void;
  /** Read a durable sealed sync marker, or null if unset. */
  loadMarker(key: string): Promise<Uint8Array | null>;
  /** Write a durable sealed sync marker. */
  storeMarker(key: string, value: Uint8Array): Promise<void>;
  /** Mint a fresh sync ticket. Rejects when the caller is no longer authorized. */
  mintTicket(): Promise<SyncTicket>;
}

/** The subset of the `WebSocket` API the client uses. */
export interface SyncSocket {
  binaryType: string;
  send(data: ArrayBufferView | ArrayBufferLike): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export type SyncSocketFactory = (url: string) => SyncSocket;

export interface WorkspaceSyncClientOptions {
  readonly relayUrl: string;
  readonly bindings: SyncHostBindings;
  onStatusChange(snapshot: SyncStatusSnapshot): void;
  /** Defaults to the global `WebSocket`. */
  socketFactory?: SyncSocketFactory;
  /** Test seam for backoff / expiry timing. Defaults to real timers. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const ACKED_CURSOR_MARKER = "sync/acked-cursor";
const OUTBOX_MARKER = "sync/outbox";

/** Reconnect backoff. */
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
/** Re-mint and reconnect this long before the ticket actually expires. */
const TICKET_REFRESH_LEAD_MS = 60_000;

function defaultSocketFactory(url: string): SyncSocket {
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  return socket as unknown as SyncSocket;
}

function toU64Bytes(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, false);
  return bytes;
}

function fromU64Bytes(bytes: Uint8Array): bigint {
  if (bytes.byteLength !== 8) return 0n;
  return new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, false);
}

/** `[u32 count]([u32 len][bytes])*` — the durable outbox layout. */
function encodeOutbox(chunks: readonly Uint8Array[]): Uint8Array {
  const total = 4 + chunks.reduce((sum, chunk) => sum + 4 + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, chunks.length, false);
  let offset = 4;
  for (const chunk of chunks) {
    view.setUint32(offset, chunk.byteLength, false);
    offset += 4;
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function decodeOutbox(bytes: Uint8Array | null): Uint8Array[] {
  if (bytes === null || bytes.byteLength < 4) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(0, false);
  const chunks: Uint8Array[] = [];
  let offset = 4;
  for (let i = 0; i < count; i += 1) {
    if (offset + 4 > bytes.byteLength) break;
    const len = view.getUint32(offset, false);
    offset += 4;
    if (offset + len > bytes.byteLength) break;
    chunks.push(bytes.slice(offset, offset + len));
    offset += len;
  }
  return chunks;
}

function randomClientRef(): Uint8Array {
  const ref = new Uint8Array(16);
  crypto.getRandomValues(ref);
  return ref;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

export class WorkspaceSyncClient {
  readonly #relayUrl: string;
  readonly #bindings: SyncHostBindings;
  readonly #onStatusChange: (snapshot: SyncStatusSnapshot) => void;
  readonly #socketFactory: SyncSocketFactory;
  readonly #now: () => number;
  readonly #setTimer: (fn: () => void, ms: number) => unknown;
  readonly #clearTimer: (handle: unknown) => void;

  #running = false;
  #socket: SyncSocket | null = null;
  #unsubscribeLocal: (() => void) | null = null;

  #state: SyncStatusState = "offline";
  #lastError: SyncStatusError | null = null;
  #lastEmitted = "";
  /** Highest cursor whose content this device holds with no gap below it (durably acked). */
  #ackedCursor = 0n;
  /** Cursors held but not yet part of the contiguous prefix (a peer delta above a not-yet-seen one, or an own push). */
  #heldAbove = new Set<bigint>();
  #highestKnownCursor = 0n;
  #handshakeComplete = false;

  #outbox: Uint8Array[] = [];
  /** The `clientRef` of the outbox chunk currently awaiting a `RelayReceipt`, if any. */
  #inFlightRef: Uint8Array | null = null;

  #reconnectAttempts = 0;
  #reconnectTimer: unknown = null;
  #ticketTimer: unknown = null;
  /** Serializes inbound frame handling — each frame's async work completes before the next starts. */
  #inbound: Promise<void> = Promise.resolve();

  constructor(options: WorkspaceSyncClientOptions) {
    this.#relayUrl = options.relayUrl;
    this.#bindings = options.bindings;
    this.#onStatusChange = options.onStatusChange;
    this.#socketFactory = options.socketFactory ?? defaultSocketFactory;
    this.#now = options.now ?? (() => Date.now());
    this.#setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown);
    this.#clearTimer =
      options.clearTimer ??
      ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  /** Load durable markers, subscribe to local commits, and start connecting. */
  async start(): Promise<void> {
    if (this.#running) return;
    this.#running = true;

    this.#ackedCursor = fromU64Bytes(
      (await this.#bindings.loadMarker(ACKED_CURSOR_MARKER)) ?? new Uint8Array(0),
    );
    this.#outbox = decodeOutbox(await this.#bindings.loadMarker(OUTBOX_MARKER));

    this.#unsubscribeLocal = this.#bindings.onLocalUpdate((bytes) => {
      void this.#enqueueLocal(bytes);
    });

    this.#connect();
  }

  /** Stop syncing. Durable markers are left intact for the next `start`. */
  async stop(): Promise<void> {
    this.#running = false;
    this.#clearReconnect();
    this.#clearTicketTimer();
    this.#unsubscribeLocal?.();
    this.#unsubscribeLocal = null;
    this.#teardownSocket();
    this.#setState("offline");
  }

  snapshot(): SyncStatusSnapshot {
    return {
      state: this.#state,
      pendingLocalChanges: this.#outbox.length > 0 || this.#inFlightRef !== null,
      highestKnownCursor: Number(this.#highestKnownCursor),
      highestAckedCursor: Number(this.#ackedCursor),
      lastError: this.#lastError,
    };
  }

  // --- connection lifecycle -------------------------------------------------

  #connect(): void {
    if (!this.#running || this.#socket !== null) return;
    this.#handshakeComplete = false;
    this.#setState("connecting");

    void this.#bindings
      .mintTicket()
      .then((ticket) => {
        if (!this.#running) return;
        this.#openSocket(ticket);
      })
      .catch(() => {
        if (!this.#running) return;
        // Minting failed: either transient, or the device is deauthorized.
        // Either way, back off and try again; the status already carries
        // whatever error the last close set.
        if (this.#lastError === null) this.#lastError = "network";
        this.#setState("offline");
        this.#scheduleReconnect();
      });
  }

  #openSocket(ticket: SyncTicket): void {
    let socket: SyncSocket;
    try {
      socket = this.#socketFactory(this.#relayUrl);
    } catch {
      this.#lastError = "network";
      this.#setState("offline");
      this.#scheduleReconnect();
      return;
    }
    this.#socket = socket;
    socket.binaryType = "arraybuffer";

    socket.onopen = () => {
      this.#send({
        type: "hello",
        clientMinVersion: PROTOCOL_VERSION,
        clientMaxVersion: PROTOCOL_VERSION,
        workspaceId: this.#bindings.workspaceId,
        deviceId: this.#bindings.deviceId,
        sessionToken: new TextEncoder().encode(ticket.ticket),
      });
      this.#setState("syncing");
      this.#armTicketRefresh(ticket.expiresAtMs);
    };
    socket.onmessage = (event) => {
      const { data } = event;
      this.#inbound = this.#inbound.then(() => this.#handleFrame(data));
    };
    socket.onerror = () => {
      if (this.#lastError === null) this.#lastError = "network";
    };
    socket.onclose = () => {
      this.#handleDisconnect();
    };
  }

  #handleDisconnect(): void {
    this.#teardownSocket();
    this.#clearTicketTimer();
    this.#inFlightRef = null;
    if (this.#lastError === null) this.#lastError = "network";
    this.#setState("offline");
    if (this.#running) this.#scheduleReconnect();
  }

  #teardownSocket(): void {
    const socket = this.#socket;
    this.#socket = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      // already closing
    }
  }

  #scheduleReconnect(): void {
    if (!this.#running || this.#reconnectTimer !== null) return;
    const capped = Math.min(
      MAX_BACKOFF_MS,
      BASE_BACKOFF_MS * 2 ** this.#reconnectAttempts,
    );
    const delay = capped / 2 + Math.random() * (capped / 2);
    this.#reconnectAttempts += 1;
    this.#reconnectTimer = this.#setTimer(() => {
      this.#reconnectTimer = null;
      this.#connect();
    }, delay);
  }

  #clearReconnect(): void {
    if (this.#reconnectTimer !== null) {
      this.#clearTimer(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  #armTicketRefresh(expiresAtMs: number): void {
    this.#clearTicketTimer();
    const lead = expiresAtMs - TICKET_REFRESH_LEAD_MS - this.#now();
    this.#ticketTimer = this.#setTimer(
      () => {
        this.#ticketTimer = null;
        // Reconnect with a fresh ticket before the current one expires.
        this.#reconnectAttempts = 0;
        this.#teardownSocket();
        this.#setState("connecting");
        this.#connect();
      },
      Math.max(0, lead),
    );
  }

  #clearTicketTimer(): void {
    if (this.#ticketTimer !== null) {
      this.#clearTimer(this.#ticketTimer);
      this.#ticketTimer = null;
    }
  }

  // --- inbound ------------------------------------------------------------

  async #handleFrame(data: unknown): Promise<void> {
    if (this.#socket === null) return;
    let message: Message;
    try {
      message = decodeMessage(toBytes(data));
    } catch (error) {
      if (error instanceof WireError) {
        // A frame we cannot parse means the relay and this client disagree
        // on the wire format — a bug, not a transient fault. Drop the
        // connection; do not spin.
        this.#lastError = "malformed_frame";
        this.#teardownSocketAndStop();
      }
      return;
    }

    switch (message.type) {
      case "delta_batch": {
        const relevant = message.entries.filter(
          (entry) => entry.documentId === this.#bindings.documentId,
        );
        if (relevant.length > 0) {
          await this.#bindings.applyRemoteDeltas(
            relevant.map((entry) => entry.payload),
          );
          for (const entry of relevant) this.#heldAbove.add(entry.cursor);
          if (entry_highest(relevant) > this.#highestKnownCursor) {
            this.#highestKnownCursor = entry_highest(relevant);
          }
          // Incremental ack — one per frame, not one at the end of replay.
          await this.#advanceAckedPrefix();
        }
        this.#recomputeSyncedState();
        return;
      }
      case "sync_status": {
        this.#highestKnownCursor = message.highestKnownCursor;
        this.#handshakeComplete = true;
        this.#reconnectAttempts = 0;
        this.#lastError = null;
        // The relay is caught up with us as of Hello; push anything queued.
        this.#pumpOutbox();
        this.#recomputeSyncedState();
        return;
      }
      case "ack": {
        if (
          message.ackKind === "relay_receipt" &&
          this.#inFlightRef !== null &&
          sameBytes(message.clientRef, this.#inFlightRef)
        ) {
          this.#outbox.shift();
          this.#inFlightRef = null;
          if (message.assignedCursor > this.#highestKnownCursor) {
            this.#highestKnownCursor = message.assignedCursor;
          }
          // This device authored the delta, so it holds that cursor's content.
          this.#heldAbove.add(message.assignedCursor);
          await this.#persistOutbox();
          await this.#advanceAckedPrefix();
          this.#pumpOutbox();
          this.#recomputeSyncedState();
        }
        return;
      }
      case "error": {
        this.#lastError = message.errorKind;
        if (message.errorKind === "unauthenticated") {
          // Ticket expired or the device was revoked. Drop the socket and
          // let the reconnect path mint a fresh ticket — that mint fails
          // (and we stay offline) only if the device is genuinely gone.
          this.#teardownSocket();
          this.#clearTicketTimer();
          this.#setState("offline");
          if (this.#running) this.#scheduleReconnect();
        } else {
          this.#teardownSocketAndStop();
        }
        return;
      }
      default:
        // hello / push_delta / pull_since_cursor are never relay-to-client.
        this.#lastError = "malformed_frame";
        this.#teardownSocketAndStop();
    }
  }

  #teardownSocketAndStop(): void {
    this.#teardownSocket();
    this.#clearTicketTimer();
    this.#setState("offline");
    // A protocol-level disagreement: stop retrying until the Worker restarts
    // sync explicitly.
    this.#running = false;
  }

  // --- outbound ----------------------------------------------------------

  async #enqueueLocal(bytes: Uint8Array): Promise<void> {
    this.#outbox.push(bytes.slice());
    await this.#persistOutbox();
    this.#pumpOutbox();
    this.#emitStatus();
  }

  #pumpOutbox(): void {
    if (
      !this.#handshakeComplete ||
      this.#socket === null ||
      this.#inFlightRef !== null ||
      this.#outbox.length === 0
    ) {
      return;
    }
    const chunk = this.#outbox[0]!;
    const clientRef = randomClientRef();
    this.#inFlightRef = clientRef;
    this.#send({
      type: "push_delta",
      documentId: this.#bindings.documentId,
      tierTag: "server_readable",
      payloadKind: "update",
      clientRef,
      payload: chunk,
    });
  }

  async #persistOutbox(): Promise<void> {
    await this.#bindings.storeMarker(OUTBOX_MARKER, encodeOutbox(this.#outbox));
  }

  /**
   * Walk the contiguous run of held cursors above `#ackedCursor`. When it
   * advances, persist the new durable cursor and send one cumulative `Ack` —
   * this is what makes replay acknowledgement incremental (one per applied
   * frame) rather than one at the end. A cursor is never acknowledged while a
   * lower one is still missing.
   */
  async #advanceAckedPrefix(): Promise<void> {
    let advanced = false;
    let next = this.#ackedCursor + 1n;
    while (this.#heldAbove.has(next)) {
      this.#heldAbove.delete(next);
      this.#ackedCursor = next;
      advanced = true;
      next += 1n;
    }
    if (!advanced) return;
    await this.#bindings.storeMarker(
      ACKED_CURSOR_MARKER,
      toU64Bytes(this.#ackedCursor),
    );
    this.#send({
      type: "ack",
      ackKind: "client_cumulative",
      acknowledgedCursor: this.#ackedCursor,
    });
  }

  // --- helpers ---------------------------------------------------------

  #send(message: Message): void {
    const socket = this.#socket;
    if (!socket) return;
    try {
      socket.send(encodeMessage(message));
    } catch {
      this.#handleDisconnect();
    }
  }

  #recomputeSyncedState(): void {
    if (this.#socket === null) {
      this.#setState("offline");
      return;
    }
    if (!this.#handshakeComplete) {
      this.#setState("syncing");
      return;
    }
    const caughtUp = this.#ackedCursor >= this.#highestKnownCursor;
    const idle = this.#outbox.length === 0 && this.#inFlightRef === null;
    this.#setState(caughtUp && idle ? "synced" : "syncing");
  }

  #setState(state: SyncStatusState): void {
    this.#state = state;
    this.#emitStatus();
  }

  #emitStatus(): void {
    const snapshot = this.snapshot();
    const serialized = JSON.stringify(snapshot);
    if (serialized === this.#lastEmitted) return;
    this.#lastEmitted = serialized;
    this.#onStatusChange(snapshot);
  }
}

function entry_highest(entries: readonly { cursor: bigint }[]): bigint {
  return entries.reduce((max, e) => (e.cursor > max ? e.cursor : max), 0n);
}

function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new WireError("sync frame was not binary");
}
