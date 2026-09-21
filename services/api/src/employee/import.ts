import { randomUUID } from "node:crypto";
import { employeeCreateFieldsSchema, type EmployeeCreateFields } from "@vulto/schema";
import { applyMutations, type MutationEnvelope } from "../mutations/pipeline.js";
import type { MemberPrincipal } from "../permission/principal.js";

/**
 * Employee creation, whichever way it arrives. Manual creation and an import
 * row both become the same `employee.create` envelope through
 * `employeeCreateEnvelope`, so there is one path, one validation and one
 * canonical record (RST-33). `VPS-F006` (Workspace Setup and Data Import) is not
 * corrected yet; when it is, its Employee-shaped rows are passed to
 * `importEmployees` and do not get a writer of their own.
 */

export interface EmployeeCreateInput {
  readonly entityId: string;
  /** Supplied by the caller; the clock is never read for a business date. */
  readonly effectiveFrom: string;
  readonly fields: EmployeeCreateFields;
  readonly employeeId?: string;
  readonly mutationId?: string;
}

export function employeeCreateEnvelope(input: EmployeeCreateInput): MutationEnvelope {
  return {
    mutation_id: input.mutationId ?? randomUUID(),
    name: "employee.create",
    args: {
      employee_id: input.employeeId ?? randomUUID(),
      entity_id: input.entityId,
      effective_from: input.effectiveFrom,
      fields: input.fields,
    },
  };
}

/** A row as an import file gives it: every value a string, empty meaning absent. */
export type EmployeeImportRow = Readonly<Record<string, string | undefined>>;

const NUMBER_COLUMNS = new Set([
  "billing_rate_default",
  "contracted_hours",
  "billability_target_override",
]);

/** Maps one import row to validated create fields, or returns why it cannot. */
export function parseEmployeeImportRow(
  row: EmployeeImportRow,
): { ok: true; fields: EmployeeCreateFields } | { ok: false; issues: string[] } {
  const candidate: Record<string, unknown> = {};
  for (const [column, raw] of Object.entries(row)) {
    if (raw === undefined || raw.trim() === "") continue;
    const value = raw.trim();
    candidate[column] = NUMBER_COLUMNS.has(column) ? Number(value) : value;
  }
  const parsed = employeeCreateFieldsSchema.safeParse(candidate);
  return parsed.success
    ? { ok: true, fields: parsed.data }
    : {
        ok: false,
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      };
}

export interface ImportedEmployees {
  /** One outcome per row that parsed, in order, exactly as `employee.create` reported it. */
  readonly results: Awaited<ReturnType<typeof applyMutations>>;
  /** Rows that did not parse, by position, with the reasons. */
  readonly rejected: readonly { readonly row: number; readonly issues: string[] }[];
}

/**
 * Imports Employee rows through the ordinary named mutation. Rows apply in
 * order, and processing stops at the first mutation the server rejects, like any
 * queued batch.
 */
export async function importEmployees(
  principal: MemberPrincipal,
  input: {
    readonly entityId: string;
    readonly effectiveFrom: string;
    readonly rows: readonly EmployeeImportRow[];
  },
): Promise<ImportedEmployees> {
  const envelopes: MutationEnvelope[] = [];
  const rejected: { row: number; issues: string[] }[] = [];
  input.rows.forEach((row, index) => {
    const parsed = parseEmployeeImportRow(row);
    if (!parsed.ok) rejected.push({ row: index, issues: parsed.issues });
    else
      envelopes.push(
        employeeCreateEnvelope({
          entityId: input.entityId,
          effectiveFrom: input.effectiveFrom,
          fields: parsed.fields,
        }),
      );
  });
  return { results: await applyMutations(principal, envelopes), rejected };
}
