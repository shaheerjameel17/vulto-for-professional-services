import { getProtectionPartitions, NODE_TYPES, type NodeType } from "@vulto/schema";
import { POLICY_ROLES, resolvePermission, type PolicyRole } from "./policy-table";

/**
 * FDN-55 Stage 1 — the permission-matrix coverage measurement.
 *
 * `VPS-A007` A007-T06: the permission matrix suite MUST cover every role and
 * Privacy Class combination, and **coverage MUST NOT decrease between
 * releases**. The existing `policy-table.test.ts` sweep proves the current
 * matrix resolves for every combination; this measures the size of that
 * sweep so a change that removes a node type, drops a partition, or narrows
 * the role set is caught as a coverage regression rather than passing
 * silently because the smaller matrix still resolves cleanly.
 */

/** Every (role, node type, real partition) combination the interceptor governs. */
export function enumerateMatrixCells(): {
  role: PolicyRole;
  nodeType: NodeType;
  partitionKey: string;
}[] {
  const cells: { role: PolicyRole; nodeType: NodeType; partitionKey: string }[] = [];
  for (const nodeType of NODE_TYPES) {
    const partitions = getProtectionPartitions(nodeType);
    // `getProtectionPartitions` returns [] for inherited protection, which
    // `resolvePermission` handles without a partition key — mirror
    // `policy-table.test.ts`'s own convention of the synthetic "record" key.
    const keys = partitions.length > 0 ? partitions.map((p) => p.key) : ["record"];
    for (const partitionKey of keys) {
      for (const role of POLICY_ROLES) {
        cells.push({ role, nodeType, partitionKey });
      }
    }
  }
  return cells;
}

/**
 * The number of matrix cells that resolve to a concrete permission outcome
 * without throwing. This is the number A007-T06's "must not decrease" is
 * measured against.
 */
export function countMatrixCoverage(): number {
  let covered = 0;
  for (const { role, nodeType, partitionKey } of enumerateMatrixCells()) {
    try {
      resolvePermission(role, nodeType, partitionKey);
      covered += 1;
    } catch {
      // An unresolvable cell is not covered.
    }
  }
  return covered;
}

/**
 * Committed baseline. Regenerate deliberately — with a one-line note on why
 * the matrix grew or shrank — when a schema change legitimately changes the
 * cell count. A silent decrease is an A007-T06 violation.
 *
 * Last set: FDN-55 Stage 1, against `main` at the FDN-63 merge — 590 cells
 * (109 node types, 9 of them split-protected into 2 partitions, × 5 policy
 * roles), all resolving.
 */
export const MATRIX_COVERAGE_BASELINE = 590;
