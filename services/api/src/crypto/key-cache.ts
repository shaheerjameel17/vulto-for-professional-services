/**
 * Unwrapped keys held in this process's memory only (A003-T61): at most five
 * minutes, at most 1,000 entries, never logged, serialized or written. A
 * private field keeps the key bytes out of any object spread or JSON dump.
 */
export const KEY_CACHE_TTL_MS = 5 * 60 * 1000;
export const KEY_CACHE_MAX_ENTRIES = 1000;

export class KeyCache {
  readonly #entries = new Map<string, { key: Uint8Array; expiresAt: number }>();
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #clock: () => number;

  constructor(
    options: { ttlMs?: number; maxEntries?: number; clock?: () => number } = {},
  ) {
    this.#ttlMs = Math.min(options.ttlMs ?? KEY_CACHE_TTL_MS, KEY_CACHE_TTL_MS);
    this.#maxEntries = Math.min(
      options.maxEntries ?? KEY_CACHE_MAX_ENTRIES,
      KEY_CACHE_MAX_ENTRIES,
    );
    this.#clock = options.clock ?? Date.now;
  }

  get(keyId: string): Uint8Array | undefined {
    const entry = this.#entries.get(keyId);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.#clock()) {
      this.#entries.delete(keyId);
      return undefined;
    }
    return entry.key;
  }

  set(keyId: string, key: Uint8Array): void {
    this.#entries.delete(keyId);
    while (this.#entries.size >= this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    this.#entries.set(keyId, { key, expiresAt: this.#clock() + this.#ttlMs });
  }

  evict(keyId: string): void {
    this.#entries.delete(keyId);
  }

  clear(): void {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }

  toJSON(): undefined {
    return undefined;
  }
}
