/**
 * Erasing the device's cache databases, and remembering an erase that did not
 * finish. A person who signs out, or whose access is revoked, must not be left
 * with data on the device because a delete was blocked or failed: the databases
 * still to delete are recorded (names only) before anything is deleted, and the
 * next start finishes the job BEFORE it opens a cache or reads `session_hint`.
 */

/** A per-workspace cache: `vulto:<workspaceId>:<userId>`. The device-identity database is not one. */
export const isCacheDatabaseName = (name: string): boolean =>
  /^vulto:[^:]+:[^:]+$/.test(name);

export interface EraseEnvironment {
  /** Every IndexedDB database name on the origin, or `null` where the browser cannot list them. */
  listDatabases(): Promise<string[] | null>;
  /** Resolves only when the database is gone; rejects on error or after a bounded wait. */
  deleteDatabase(name: string): Promise<void>;
  readPending(): Promise<string[]>;
  writePending(names: readonly string[]): Promise<void>;
}

export class EraseIncompleteError extends Error {
  constructor(readonly remaining: readonly string[]) {
    super(`${remaining.length} cache database(s) could not be deleted yet`);
    this.name = "EraseIncompleteError";
  }
}

/** Deletes `names` (plus anything already pending), recording what is left. Throws if any remain. */
export async function eraseDatabases(
  environment: EraseEnvironment,
  names: readonly string[],
): Promise<void> {
  const wanted = [...new Set([...(await environment.readPending()), ...names])];
  if (wanted.length === 0) return;
  // Recorded first: a crash or a blocked delete still leaves the intent behind.
  await environment.writePending(wanted);
  const remaining: string[] = [];
  for (const name of wanted) {
    try {
      await environment.deleteDatabase(name);
    } catch {
      remaining.push(name);
    }
  }
  await environment.writePending(remaining);
  if (remaining.length > 0) throw new EraseIncompleteError(remaining);
}

/**
 * Sign-out: every cache database on the origin, whichever workspace or person it
 * belongs to. Where the browser cannot list databases, only `current` is known
 * and only it is erased.
 */
export async function eraseAllCaches(
  environment: EraseEnvironment,
  current: string,
): Promise<void> {
  const listed = (await environment.listDatabases()) ?? [];
  await eraseDatabases(environment, [...listed.filter(isCacheDatabaseName), current]);
}

/** Start-up: finish any erase that did not complete, before anything is opened. */
export async function completePendingErase(
  environment: EraseEnvironment,
): Promise<void> {
  if ((await environment.readPending()).length === 0) return;
  await eraseDatabases(environment, []);
}
