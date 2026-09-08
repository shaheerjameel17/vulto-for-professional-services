/**
 * FDN-50 stage 1: the sealed-store key a workspace's full Loro document
 * snapshot is persisted under. Namespaced with a `graph-snapshot:` prefix so
 * it cannot collide with any other logical key a caller seals through
 * `sealPayload`/`openPayload` (SealedStore itself additionally scopes every
 * key by workspace, so this is a belt-and-suspenders namespace, not the only
 * one). Generic sealing/opening now exists only in the separate test Worker;
 * the production graph protocol cannot address this key directly.
 *
 * Kept in its own module, free of any Loro/SQLite import, so that anything
 * needing the key scheme (the runtime, or a browser test/diagnostics client
 * driving it from the main thread) does not have to pull the Worker's
 * WASM-backed dependencies into a bundle that has no business loading them.
 */
export function graphSnapshotStoreKey(workspaceId: string): string {
  return `graph-snapshot:${workspaceId}`;
}

/** FDN-52 Stage 3's sealed manifest of independently encrypted protected Loro documents. */
export function protectedPartitionManifestStoreKey(workspaceId: string): string {
  return `protected-partition-manifest:${workspaceId}`;
}

/** FDN-52 Stage 5's sealed subject-rooted Tier 3 manifest. */
export function tier3PartitionManifestStoreKey(workspaceId: string): string {
  return `tier3-partition-manifest:${workspaceId}`;
}

/**
 * FDN-51 Stage 4a's durable sync markers — the last acknowledged relay cursor
 * and the outbox of local commits not yet pushed. Namespaced like the others so
 * a `sealPayload` caller cannot collide with them.
 */
export function syncMarkerStoreKey(workspaceId: string, marker: string): string {
  return `sync-marker:${workspaceId}:${marker}`;
}

/** FDN-52's wrapped Tier 1 identity record, one generation per workspace/person. */
export function tier1IdentityStoreKey(
  workspaceId: string,
  canonicalUserId: string,
): string {
  return `tier1-identity:${workspaceId}:${canonicalUserId}`;
}
