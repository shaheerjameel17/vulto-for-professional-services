/**
 * The A003-T04 sealed local device store (FDN-84).
 *
 * This module protects the DEVICE's own copy of graph bytes from a lost or
 * stolen device, and denies a centrally revoked or offboarded user's
 * offline access to it after their next cold restart. It does NOT make the
 * server unable to read Tier 0/2 data — the server's own copy is untouched
 * by this module, and this is not an end-to-end encryption scheme. Tier 1
 * and Tier 3 end-to-end wrapping belongs to FDN-52, downstream of this.
 *
 * Design (split-key unlock, per the approved founder memo):
 *  - The device holds one half of an unlock secret in IndexedDB, in the
 *    clear. Alone it opens nothing.
 *  - The server holds the other half, released only after
 *    requireCurrentWorkspaceSession validates a current, non-revoked
 *    session (services/api's /device-store/unlock).
 *  - The two halves are combined with HKDF-SHA256 (Web Crypto, no bespoke
 *    primitive) into a non-extractable AES-256-GCM CryptoKey that lives
 *    only in this Worker instance's memory for the life of that instance.
 *    It is never written to disk and never crosses postMessage.
 *  - A new Worker instance (cold restart, reboot, tab reload) always
 *    starts locked. There is no cross-instance carry-over by design.
 */

import type { WorkspaceRole } from "@vulto/schema";

const DATABASE_NAME = "vulto-sealed-store";
const DATABASE_VERSION = 1;
const DEVICE_STORE = "device-identity";
const ENVELOPE_STORE = "envelope";
const PAYLOAD_STORE = "payload";
const DEVICE_RECORD_KEY = "device";

const HKDF_INFO_PREFIX = "vulto-sealed-store:v1:epoch:";

export interface SealedStoreEnvelope {
  workspaceId: string;
  deviceId: string;
  keyEpoch: number;
  algorithm: "AES-GCM-256";
  createdAt: string;
}

/**
 * FDN-53 stage 1: `roles` and `membershipId` are siblings of `envelope`,
 * deliberately NOT part of it. `envelope` is persisted into IndexedDB by
 * `unlock()` below and read back on a future unlock attempt to check for a
 * workspace/key-epoch mismatch — durable, on-disk contract. Role data must
 * never behave that way: it is a live fact from `requireCurrentWorkspaceSession`
 * at the moment of THIS unlock (or refresh), and persisting it would let a
 * stale, once-true role survive in the clear on disk and get read back
 * before any fresh online check on a later unlock. Held only in this class's
 * private Worker memory, exactly like the derived AES key, and cleared by
 * `lock()`/`dispose()` the same way.
 */
export interface DeviceUnlockGrant {
  serverHalf: string;
  envelope: SealedStoreEnvelope;
  roles: WorkspaceRole[];
  membershipId: string;
}

interface PayloadRecord {
  storeKey: string;
  workspaceId: string;
  generation: number;
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

/** Wrong key and corrupted ciphertext are indistinguishable by design: one failure mode. */
export class SealedStoreCannotOpenError extends Error {
  constructor() {
    super("This payload cannot be opened");
  }
}

/** Distinguishable from SealedStoreCannotOpenError, and checked from unencrypted envelope metadata BEFORE any decryption is attempted. */
export class SealedStoreEnvelopeMismatchError extends Error {
  constructor(reason: "workspace" | "key-epoch") {
    super(`Sealed store envelope mismatch: ${reason}`);
  }
}

export class SealedStoreLockedError extends Error {
  constructor() {
    super("The sealed local store is locked");
  }
}

export class SealedStoreUnlockDeniedError extends Error {
  constructor() {
    super("The server denied this device's unlock request");
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DEVICE_STORE)) {
        database.createObjectStore(DEVICE_STORE);
      }
      if (!database.objectStoreNames.contains(ENVELOPE_STORE)) {
        database.createObjectStore(ENVELOPE_STORE);
      }
      if (!database.objectStoreNames.contains(PAYLOAD_STORE)) {
        database.createObjectStore(PAYLOAD_STORE, { keyPath: "storeKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open sealed store database"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

interface DeviceIdentity {
  deviceId: string;
  deviceHalf: Uint8Array;
}

function randomBase64Url(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/**
 * The sealed store's public surface never exposes that its implementation
 * is IndexedDB; a later move to OPFS would not change this class's API.
 */
export class SealedStore {
  #database: IDBDatabase | null = null;
  #key: CryptoKey | null = null;
  #envelope: SealedStoreEnvelope | null = null;
  #roles: WorkspaceRole[] | null = null;
  #membershipId: string | null = null;

  get isUnlocked(): boolean {
    return this.#key !== null;
  }

  /**
   * FDN-53 stage 1. The role set from the most recent unlock or role
   * refresh, held in Worker memory exactly like the derived AES key — never
   * persisted, never exposed outside this Worker instance. Throws when
   * locked, matching `put`/`get`'s own `#requireUnlocked` behavior, so a
   * caller cannot silently read a stale empty array.
   */
  get roles(): readonly WorkspaceRole[] {
    if (this.#key === null || this.#roles === null) throw new SealedStoreLockedError();
    return this.#roles;
  }

  get membershipId(): string {
    if (this.#key === null || this.#membershipId === null) {
      throw new SealedStoreLockedError();
    }
    return this.#membershipId;
  }

  async #requireDatabase(): Promise<IDBDatabase> {
    if (this.#database === null) this.#database = await openDatabase();
    return this.#database;
  }

  async #deviceIdentity(): Promise<DeviceIdentity> {
    const database = await this.#requireDatabase();
    const readTx = database.transaction(DEVICE_STORE, "readonly");
    const existing = (await requestToPromise(
      readTx.objectStore(DEVICE_STORE).get(DEVICE_RECORD_KEY),
    )) as DeviceIdentity | undefined;
    if (existing) return existing;

    const identity: DeviceIdentity = {
      deviceId: randomBase64Url(24),
      deviceHalf: crypto.getRandomValues(new Uint8Array(32)),
    };
    const writeTx = database.transaction(DEVICE_STORE, "readwrite");
    writeTx.objectStore(DEVICE_STORE).put(identity, DEVICE_RECORD_KEY);
    await transactionDone(writeTx);
    return identity;
  }

  /** The device half alone; useless without the server's half. Callers use this to know what device identity to request an unlock for. */
  async deviceId(): Promise<string> {
    return (await this.#deviceIdentity()).deviceId;
  }

  /**
   * Requests the server's half over the network (requireCurrentWorkspaceSession
   * checkpoint), combines it with the device's own half, and derives the
   * AES-256-GCM key entirely inside this Worker. Never returns or exposes
   * the derived key or either half to the caller.
   */
  async unlockOnline(workspaceId: string, apiOrigin: string): Promise<void> {
    const identity = await this.#deviceIdentity();
    const response = await fetch(`${apiOrigin}/device-store/unlock`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, deviceId: identity.deviceId }),
    });
    if (!response.ok) throw new SealedStoreUnlockDeniedError();
    const grant = (await response.json()) as DeviceUnlockGrant;
    await this.unlock(grant, identity.deviceHalf);
  }

  /** Lower-level unlock for tests and for callers that already fetched a grant. */
  async unlock(
    grant: DeviceUnlockGrant,
    deviceHalfOverride?: Uint8Array,
  ): Promise<void> {
    const deviceHalf = deviceHalfOverride ?? (await this.#deviceIdentity()).deviceHalf;
    const serverHalf = Uint8Array.from(atob(grant.serverHalf), (char) =>
      char.charCodeAt(0),
    );

    const inputKeyMaterial = new Uint8Array(serverHalf.length + deviceHalf.length);
    inputKeyMaterial.set(serverHalf, 0);
    inputKeyMaterial.set(deviceHalf, serverHalf.length);

    const baseKey = await crypto.subtle.importKey(
      "raw",
      inputKeyMaterial,
      "HKDF",
      false,
      ["deriveKey"],
    );
    const key = await crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new TextEncoder().encode(
          `${grant.envelope.workspaceId}:${grant.envelope.deviceId}`,
        ),
        info: new TextEncoder().encode(`${HKDF_INFO_PREFIX}${grant.envelope.keyEpoch}`),
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );

    const database = await this.#requireDatabase();
    const tx = database.transaction(ENVELOPE_STORE, "readwrite");
    tx.objectStore(ENVELOPE_STORE).put(grant.envelope, grant.envelope.workspaceId);
    await transactionDone(tx);

    this.#key = key;
    this.#envelope = grant.envelope;
    this.#roles = grant.roles;
    this.#membershipId = grant.membershipId;
  }

  /**
   * FDN-53 stage 1, F127's live role-refresh path. Updates the in-memory
   * role set without touching the AES key, the envelope, or any persisted
   * bytes — a role narrowing must reach an already-unlocked session live,
   * not only through a full re-`unlock()`. Throws when locked: a refresh
   * has nothing to refresh if no unlock has happened this instance.
   */
  refreshRoles(roles: readonly WorkspaceRole[]): void {
    if (this.#key === null) throw new SealedStoreLockedError();
    this.#roles = [...roles];
  }

  /** Drops the in-memory key. Does not touch persisted ciphertext or either unlock half. */
  lock(): void {
    this.#key = null;
    this.#envelope = null;
    this.#roles = null;
    this.#membershipId = null;
  }

  #requireUnlocked(): { key: CryptoKey; envelope: SealedStoreEnvelope } {
    if (this.#key === null || this.#envelope === null)
      throw new SealedStoreLockedError();
    return { key: this.#key, envelope: this.#envelope };
  }

  /**
   * Seals arbitrary opaque bytes under the given logical key. Writes the
   * new generation and bumps it atomically inside one IndexedDB
   * transaction: a write killed mid-flight leaves the previous committed
   * generation's record untouched (the transaction never commits), never a
   * torn mix of old and new bytes.
   */
  async put(storeKey: string, plaintext: Uint8Array): Promise<void> {
    const { key, envelope } = this.#requireUnlocked();
    const database = await this.#requireDatabase();

    const readTx = database.transaction(PAYLOAD_STORE, "readonly");
    const existing = (await requestToPromise(
      readTx.objectStore(PAYLOAD_STORE).get(`${envelope.workspaceId}:${storeKey}`),
    )) as PayloadRecord | undefined;
    const nextGeneration = (existing?.generation ?? -1) + 1;

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        plaintext as BufferSource,
      ),
    );

    const record: PayloadRecord = {
      storeKey: `${envelope.workspaceId}:${storeKey}`,
      workspaceId: envelope.workspaceId,
      generation: nextGeneration,
      iv,
      ciphertext,
    };

    const writeTx = database.transaction(PAYLOAD_STORE, "readwrite");
    writeTx.objectStore(PAYLOAD_STORE).put(record);
    await transactionDone(writeTx);
  }

  /**
   * Reads unencrypted envelope metadata first, so a workspace or key-epoch
   * mismatch is reported distinctly from an AES-GCM authentication failure
   * (wrong key or corrupted ciphertext), which is never distinguished from
   * one another. Returns null if nothing is stored under this key.
   */
  async get(storeKey: string): Promise<Uint8Array | null> {
    const { key, envelope } = this.#requireUnlocked();
    const database = await this.#requireDatabase();

    const envelopeTx = database.transaction(ENVELOPE_STORE, "readonly");
    const storedEnvelope = (await requestToPromise(
      envelopeTx.objectStore(ENVELOPE_STORE).get(envelope.workspaceId),
    )) as SealedStoreEnvelope | undefined;
    if (storedEnvelope) {
      if (storedEnvelope.workspaceId !== envelope.workspaceId) {
        throw new SealedStoreEnvelopeMismatchError("workspace");
      }
      if (storedEnvelope.keyEpoch !== envelope.keyEpoch) {
        throw new SealedStoreEnvelopeMismatchError("key-epoch");
      }
    }

    const payloadTx = database.transaction(PAYLOAD_STORE, "readonly");
    const record = (await requestToPromise(
      payloadTx.objectStore(PAYLOAD_STORE).get(`${envelope.workspaceId}:${storeKey}`),
    )) as PayloadRecord | undefined;
    if (!record) return null;

    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: record.iv as BufferSource },
        key,
        record.ciphertext as BufferSource,
      );
      return new Uint8Array(plaintext);
    } catch {
      throw new SealedStoreCannotOpenError();
    }
  }

  /**
   * FDN-87 (F145). The erase mechanism `VPS-F001` G04 requires and FDN-84
   * was closed without: this workspace's persisted payloads and its envelope
   * removed, leaving no readable remnant on disk.
   *
   * **Deliberately callable while LOCKED, and it takes the workspace id as an
   * argument rather than reading it from the envelope.** A device that has
   * lost authority can never unlock again — that is the entire point of
   * F106's cold-restart checkpoint — so an erase that required an unlocked
   * store would be unreachable in exactly the situation it exists for.
   * Erasing needs no key: it destroys ciphertext rather than reading it.
   *
   * **The device identity is deliberately NOT erased.** `DEVICE_STORE` holds
   * this device's half of the unlock secret, which is per-device and shared
   * across every workspace on it; it is useless alone, and destroying it
   * would take out the local stores of unrelated workspaces this revocation
   * says nothing about. `VPS-F001`'s wipe is scoped to "the local store" of
   * the workspace whose access ended.
   *
   * **This is a mechanism, not a policy, and nothing in production calls it
   * yet.** Per FDN-84's own ownership boundary, FDN-63 owns revocation
   * orchestration — which signal fires this, and when. That boundary is not
   * bureaucratic here: the role-refresh checkpoint is non-enumerating, so its
   * `401` means revoked OR suspended OR merely expired, and `VPS-F001` is
   * explicit that "Nothing is wiped on expiry — only on explicit revocation
   * or offboarding." Calling this from the denial path would erase the local
   * store of every user whose session simply timed out. See FDN-87.
   */
  async erase(workspaceId: string): Promise<void> {
    const database = await this.#requireDatabase();

    const transaction = database.transaction(
      [PAYLOAD_STORE, ENVELOPE_STORE],
      "readwrite",
    );
    const payloads = transaction.objectStore(PAYLOAD_STORE);

    // Cursored and matched on the record's own `workspaceId` field rather
    // than on a key prefix. The key is `${workspaceId}:${storeKey}` and a
    // prefix range would depend on no store key ever containing a colon —
    // a constraint nothing enforces and a future caller would not know to
    // preserve. Under-erasing here would leave readable ciphertext behind.
    const cursorRequest = payloads.openCursor();
    await new Promise<void>((resolve, reject) => {
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          resolve();
          return;
        }
        const record = cursor.value as PayloadRecord | undefined;
        if (record?.workspaceId === workspaceId) cursor.delete();
        cursor.continue();
      };
      cursorRequest.onerror = () =>
        reject(cursorRequest.error ?? new Error("Could not scan sealed payloads"));
    });

    transaction.objectStore(ENVELOPE_STORE).delete(workspaceId);
    await transactionDone(transaction);
  }

  dispose(): void {
    this.lock();
    this.#database?.close();
    this.#database = null;
  }
}
