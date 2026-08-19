/**
 * FDN-53 stage 2 (F131). The one place `applyDeltaBatch` is reachable from
 * outside `packages/graph` after stage 2 demotes it off `LocalGraphClient`.
 *
 * Exists for the pre-FDN-53 browser proofs — FDN-50's persistence, debounce
 * and main-thread-responsiveness harnesses — that need to commit synthetic,
 * non-schema-conformant CRDT bytes (an arbitrary map key, a generation
 * stamp) directly into a live client Worker's document, unchecked, on the
 * SAME instance their other assertions (`initialize`, `getSealedStoreStatus`,
 * `dispose`) already run against. `mutate`, the gated entrypoint, cannot
 * serve that need: its Gate 1 check requires every changed node fragment to
 * resolve to a registered node type and partition, and these harnesses
 * deliberately write bytes that are neither.
 *
 * `createUncheckedLocalGraphClient` returns the exact same
 * `BrowserLocalGraphClient` — same production `worker/entry.ts`, same
 * protocol, same document — as `createLocalGraphClient` does; only the
 * TypeScript type is wider. No new Worker-side capability is added by
 * importing from this subpath, and no application code should ever import
 * it: enforced by convention and by this subpath never being re-exported
 * from `@vulto/graph`'s main entry point, the same boundary
 * `SQLiteGraphIndex` itself relies on.
 */
export {
  createUncheckedLocalGraphClient,
  type DeltaBatchResult,
  type UncheckedLocalGraphClient,
} from "../../client";
