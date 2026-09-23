import { createHash } from "node:crypto";

/**
 * A deterministic UUID v4-shaped id from a seed, so re-projection and
 * reconciliation are idempotent (a membership always yields the same edge
 * ids). Computed server-side and carried in the grant — the graph Worker
 * never derives an id of its own.
 */
export function deterministicUuid(seed: string): string {
  const h = createHash("sha256").update(seed, "utf8").digest();
  h[6] = (h[6]! & 0x0f) | 0x40;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function membershipOfEdgeId(membershipId: string): string {
  return deterministicUuid(`membership_of:${membershipId}`);
}
export function membershipInEdgeId(membershipId: string): string {
  return deterministicUuid(`membership_in:${membershipId}`);
}
