/**
 * FDN-50 stage 1: the sealed-store key a workspace's full Loro document
 * snapshot is persisted under. Namespaced with a `graph-snapshot:` prefix so
 * it cannot collide with any other logical key a caller seals through
 * `sealPayload`/`openPayload` (SealedStore itself additionally scopes every
 * key by workspace, so this is a belt-and-suspenders namespace, not the only
 * one).
 *
 * Kept in its own module, free of any Loro/SQLite import, so that anything
 * needing the key scheme (the runtime, or a browser test/diagnostics client
 * driving it from the main thread) does not have to pull the Worker's
 * WASM-backed dependencies into a bundle that has no business loading them.
 */
export function graphSnapshotStoreKey(workspaceId: string): string {
  return `graph-snapshot:${workspaceId}`;
}
