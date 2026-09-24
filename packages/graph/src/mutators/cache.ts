/**
 * The device cache as the optimistic mutators see it. Stage 6 implements it over
 * the SQLite cache; until then a test double is the only implementation.
 * Everything here is Tier 0: a protected value never reaches the cache.
 */
export interface CachedNode {
  readonly nodeId: string;
  readonly nodeType: string;
  readonly lifecycleStatus: string;
  readonly isSoftDeleted: boolean;
  readonly version: number;
  readonly record: Readonly<Record<string, unknown>>;
}

export interface CachedEdge {
  readonly edgeId: string;
  readonly edgeType: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly isSoftDeleted: boolean;
  readonly version: number;
  readonly record: Readonly<Record<string, unknown>>;
}

export interface OptimisticCache {
  getNode(nodeId: string): Promise<CachedNode | undefined>;
  nodesByType(nodeType: string): Promise<readonly CachedNode[]>;
  putNode(node: CachedNode): Promise<void>;
  deleteNode(nodeId: string): Promise<void>;
  getEdge(edgeId: string): Promise<CachedEdge | undefined>;
  putEdge(edge: CachedEdge): Promise<void>;
  deleteEdge(edgeId: string): Promise<void>;
  edgesFrom(nodeId: string, edgeType: string): Promise<readonly CachedEdge[]>;
  edgesTo(nodeId: string, edgeType: string): Promise<readonly CachedEdge[]>;
}

/** The before-image of a row, so a rejected mutation can be reverted (A003-T64). */
export type UndoEntry =
  | { readonly kind: "node"; readonly id: string; readonly before: CachedNode | null }
  | { readonly kind: "edge"; readonly id: string; readonly before: CachedEdge | null };

/** Restores every before-image, latest first. */
export async function applyUndo(
  cache: OptimisticCache,
  entries: readonly UndoEntry[],
): Promise<void> {
  for (const entry of [...entries].reverse()) {
    if (entry.kind === "node") {
      if (entry.before) await cache.putNode(entry.before);
      else await cache.deleteNode(entry.id);
    } else if (entry.before) await cache.putEdge(entry.before);
    else await cache.deleteEdge(entry.id);
  }
}
