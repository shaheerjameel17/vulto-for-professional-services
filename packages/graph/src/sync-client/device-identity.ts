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
      transaction.objectStore(STORE).put(created, KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    return created;
  } finally {
    database.close();
  }
}
