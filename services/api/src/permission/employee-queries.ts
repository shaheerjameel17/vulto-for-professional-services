import type { JsonValue, NodeType } from "@vulto/schema";
import type { KeyServices } from "../crypto/keys.js";
import { getNode, getNodes, type StoredNode } from "../graph/store.js";
import type { GraphTx } from "../graph/tx.js";
import {
  authorizeRead,
  filterReadable,
  type InterceptorContext,
} from "./interceptor.js";
import type { Principal } from "./principal.js";
import { readProtected, type ProtectedReadItem } from "../protected/read.js";

/**
 * Permission-aware Employee queries (RST-33): the server-side view and directory
 * reads. The Tier 0 half goes through the interceptor like every graph read;
 * the Tier 1 half goes through `readProtected`, which decides, audits and only
 * then decrypts. Both are filtered by the same reader logic, so a person who
 * may not read a row does not learn it exists.
 *
 * A device reads the Tier 0 half from its own cache (already audience-filtered)
 * and asks `protected.read` for the rest; these are the server's equivalents,
 * and what an import preview or a support tool would call.
 */

export interface EmployeeSummary {
  readonly employeeId: string;
  readonly lifecycleStatus: string;
  readonly version: number;
  /** The Tier 0 fields the reader may see; a restricted row carries no more than its identity. */
  readonly record: Readonly<Record<string, unknown>>;
  readonly restricted: boolean;
}

const toSummary = (row: StoredNode, restricted: boolean): EmployeeSummary => ({
  employeeId: row.nodeId,
  lifecycleStatus: row.lifecycleStatus,
  version: row.version,
  record: row.record as Record<string, unknown>,
  restricted,
});

/** The directory: every Employee the reader may see, filtered by status if asked. */
export async function listEmployees(
  tx: GraphTx,
  principal: Principal,
  filter: { readonly lifecycleStatus?: string } = {},
  context: InterceptorContext = {},
): Promise<EmployeeSummary[]> {
  const rows = await getNodes(tx, principal.workspaceId, {
    nodeType: "Employee" as NodeType,
    ...(filter.lifecycleStatus === undefined
      ? {}
      : { lifecycleStatus: filter.lifecycleStatus }),
  });
  const readable = await filterReadable(tx, principal, rows, context);
  return readable
    .map((row) => toSummary(row as StoredNode, false))
    .sort((a, b) => a.employeeId.localeCompare(b.employeeId));
}

export interface EmployeeView {
  readonly employee: EmployeeSummary;
  /**
   * The Tier 1 half. Empty for a reader with no grant, exactly as though the
   * fields did not exist; never null and never redacted.
   */
  readonly compensation: readonly ProtectedReadItem[];
}

/** One profile: `null` when the reader may not see the person at all. */
export async function getEmployee(
  tx: GraphTx,
  services: KeyServices,
  principal: Principal,
  employeeId: string,
  context: InterceptorContext = {},
): Promise<EmployeeView | null> {
  const row = await getNode(tx, principal.workspaceId, employeeId);
  if (!row || row.isSoftDeleted || row.nodeType !== "Employee") return null;
  const decision = await authorizeRead(
    tx,
    principal,
    { workspaceId: principal.workspaceId, nodeType: "Employee", nodeId: employeeId },
    context,
  );
  if (decision.access !== "full" && decision.access !== "read") return null;
  const compensation = await readProtected(
    tx,
    services,
    principal,
    { nodeIds: [employeeId], partitions: ["compensation"] },
    context,
  );
  return { employee: toSummary(row, false), compensation };
}

export type { JsonValue };
