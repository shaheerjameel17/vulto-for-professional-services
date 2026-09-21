/**
 * FDN-51 Stage 4a — single-active-sync arbitration (founder ruling, Option B).
 *
 * `deviceId` is persisted in IndexedDB and therefore shared across every tab
 * of the origin, but the graph Worker is dedicated per tab, so N tabs run N
 * runtimes that would each open a relay connection with the same `deviceId` —
 * thrashing the `sync_ticket` (each mint deletes the others') and racing the
 * shared `sync_device_ack` row.
 *
 * The fix is one exclusive `navigator.locks` lock per `(workspace, device)`.
 * The tab that holds it runs the sync client; the others queue and take over
 * automatically when the holder releases — on `stop()`, or when the tab
 * closes and the browser frees the lock. Full multi-tab live convergence is
 * out of scope here (tracked as FDN-90).
 *
 * `navigator.locks` is absent in a few old engines and some test runners;
 * there this degrades to running sync directly, which is correct for the
 * single-tab case the whole mechanism protects the multi-tab case of.
 */

interface ExclusiveLockOptions {
  mode: "exclusive";
  signal?: AbortSignal;
}

/** The one method of `LockManager` this uses. `navigator.locks` satisfies it. */
export interface LockManagerLike {
  request(
    name: string,
    options: ExclusiveLockOptions,
    callback: () => Promise<void>,
  ): Promise<unknown>;
}

/**
 * `onLead` runs when leadership is acquired and returns a teardown callback;
 * the teardown runs when leadership is given up (which, under a real lock,
 * releases it for the next waiter).
 */
export type LeadershipStart = () => Promise<() => Promise<void>>;

export class SyncLeadership {
  #active = false;
  #abort: AbortController | null = null;
  #release: (() => void) | null = null;
  #lease: Promise<void> | null = null;

  constructor(
    private readonly lockName: string,
    private readonly onLead: LeadershipStart,
    private readonly locks: LockManagerLike | undefined,
  ) {}

  /** Request leadership. Idempotent; returns immediately (leadership may be queued). */
  start(): void {
    if (this.#active) return;
    this.#active = true;
    this.#lease = this.#acquire();
  }

  /** Give up leadership (or cancel a queued request) and wait for teardown to finish. */
  async stop(): Promise<void> {
    if (!this.#active) return;
    this.#active = false;
    this.#abort?.abort();
    this.#abort = null;
    const release = this.#release;
    this.#release = null;
    release?.();
    const lease = this.#lease;
    this.#lease = null;
    await lease;
  }

  /** True while this instance currently holds leadership (its `onLead` teardown not yet run). */
  get leading(): boolean {
    return this.#release !== null;
  }

  async #acquire(): Promise<void> {
    if (!this.locks) {
      await this.#lead();
      return;
    }
    const abort = new AbortController();
    this.#abort = abort;
    try {
      await this.locks.request(
        this.lockName,
        { mode: "exclusive", signal: abort.signal },
        () => this.#lead(),
      );
    } catch (error: unknown) {
      // AbortError: `stop()` cancelled a still-queued request. Expected.
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        throw error;
      }
    }
  }

  async #lead(): Promise<void> {
    if (!this.#active) return;
    const teardown = await this.onLead();
    await new Promise<void>((resolve) => {
      this.#release = resolve;
    });
    await teardown();
  }
}
