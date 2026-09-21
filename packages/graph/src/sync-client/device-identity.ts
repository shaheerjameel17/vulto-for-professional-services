/**
 * This browser's device identifier, kept in its own small IndexedDB database so
 * it survives sign-out and revocation of a workspace's cache. It is an
 * identifier, never a secret, and lives only inside the sync client: the
 * project's ban on browser storage does not reach it, and nothing else in the
 * codebase may use IndexedDB.
 */
const DATABASE = "vulto:device";
const STORE = "meta";
const KEY = "device-id";
const PENDING_ERASE = "erase-pending";

/**
 * Everything this database may ever hold, and nothing else: the random device
 * id, and the names of cache databases still to delete. It survives sign-out
 * because a revocation must not be shed by signing in again as a new device, so
 * it must never hold anything about a person or their data. Every write goes
 * through `assertAllowedKey`, and a test pins this list.
 */
export const DEVICE_DATABASE = {
  name: DATABASE,
  stores: [STORE],
  keys: [KEY, PENDING_ERASE],
} as const;

export function assertAllowedKey(key: string): void {
  if (!(DEVICE_DATABASE.keys as readonly string[]).includes(key)) {
    throw new Error(`The device database may not hold "${key}"`);
  }
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getOrCreateDeviceId(): Promise<string> {
  const database = await open();
  try {
    const existing = await new Promise<string | undefined>((resolve, reject) => {
      const request = database.transaction(STORE).objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result as string | undefined);
      request.onerror = () => reject(request.error);
    });
    if (existing) return existing;
    // 32 hex characters: matches the server's device id pattern.
    const created = crypto.randomUUID().replaceAll("-", "");
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      assertAllowedKey(KEY);
      transaction.objectStore(STORE).put(created, KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    return created;
  } finally {
    database.close();
  }
}

/** Names of cache databases whose deletion has not finished. Identifiers only. */
export async function readPendingErase(): Promise<string[]> {
  const database = await open();
  try {
    return await new Promise<string[]>((resolve, reject) => {
      const request = database.transaction(STORE).objectStore(STORE).get(PENDING_ERASE);
      request.onsuccess = () => resolve((request.result as string[] | undefined) ?? []);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export async function writePendingErase(names: readonly string[]): Promise<void> {
  const database = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      if (names.length === 0) transaction.objectStore(STORE).delete(PENDING_ERASE);
      else {
        assertAllowedKey(PENDING_ERASE);
        transaction.objectStore(STORE).put([...names], PENDING_ERASE);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}
