/**
 * Tier 1 and Tier 2 values, in worker memory only (A003-T56). Never written to
 * the cache database, IndexedDB, or any browser storage. Cleared on sign-out,
 * workspace switch, role change and `access-revoked`.
 */
export type ProtectedItem =
  | {
      readonly node_id: string;
      readonly partition: string;
      readonly state: "available";
      readonly value: unknown;
    }
  | {
      readonly node_id: string;
      readonly partition: string;
      readonly state: "restricted";
      readonly label: string;
    }
  | { readonly node_id: string; readonly partition: string; readonly state: "erased" };

export class ProtectedStore {
  #items = new Map<string, ProtectedItem>();

  static key(nodeId: string, partition: string): string {
    return `${nodeId}|${partition}`;
  }

  put(items: readonly ProtectedItem[]): void {
    for (const item of items)
      this.#items.set(ProtectedStore.key(item.node_id, item.partition), item);
  }

  get(nodeId: string, partition: string): ProtectedItem | undefined {
    return this.#items.get(ProtectedStore.key(nodeId, partition));
  }

  forNodes(nodeIds: readonly string[]): ProtectedItem[] {
    const wanted = new Set(nodeIds);
    return [...this.#items.values()].filter((item) => wanted.has(item.node_id));
  }

  /** Drops everything held for these nodes: a refusal means none of it may be shown. */
  removeNodes(nodeIds: readonly string[]): void {
    const gone = new Set(nodeIds);
    for (const [key, item] of this.#items)
      if (gone.has(item.node_id)) this.#items.delete(key);
  }

  clear(): void {
    this.#items.clear();
  }

  get size(): number {
    return this.#items.size;
  }

  toJSON(): undefined {
    return undefined;
  }
}
