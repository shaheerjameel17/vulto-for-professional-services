import { operationalShape } from "./employee";
import { getNodeRegistration, isNodeType } from "./registry/nodes";

export interface SearchableNodeType {
  readonly nodeType: string;
  readonly labelFields: readonly [string, ...string[]];
  readonly indexedFields: readonly string[];
  readonly secondaryField?: string;
}

const fieldPattern = /^[a-z_]+$/;

/** Registration is the Tier 0 proof; a query never makes a second permission decision. */
export function validateSearchableNodeTypes(
  registrations: readonly SearchableNodeType[],
): void {
  const seen = new Set<string>();
  for (const entry of registrations) {
    if (entry.nodeType === "AuditEntry")
      throw new Error("AuditEntry is not searchable");
    if (!isNodeType(entry.nodeType)) {
      throw new Error(`Unregistered searchable node type: ${entry.nodeType}`);
    }
    if (seen.has(entry.nodeType)) {
      throw new Error(`Duplicate searchable node type: ${entry.nodeType}`);
    }
    seen.add(entry.nodeType);
    const fields = [...entry.labelFields, ...entry.indexedFields];
    if (entry.secondaryField !== undefined) fields.push(entry.secondaryField);
    if (entry.labelFields.length === 0 || entry.indexedFields.length === 0) {
      throw new Error(
        `Searchable node type needs identifying fields: ${entry.nodeType}`,
      );
    }
    for (const field of fields) {
      if (!fieldPattern.test(field)) throw new Error(`Unsafe search field: ${field}`);
    }
    for (const field of entry.labelFields) {
      if (!entry.indexedFields.includes(field)) {
        throw new Error(`Label field is not indexed: ${entry.nodeType}.${field}`);
      }
    }
    if (
      entry.secondaryField !== undefined &&
      !entry.indexedFields.includes(entry.secondaryField)
    ) {
      throw new Error(`Secondary field is not indexed: ${entry.nodeType}`);
    }

    const protection = getNodeRegistration(entry.nodeType).protection;
    if (protection.kind === "fixed" && protection.tier === 0) continue;
    if (protection.kind === "split" && entry.nodeType === "Employee") {
      const operational = protection.partitions.find(
        (partition) => partition.key === "operational" && partition.tier === 0,
      );
      if (operational && fields.every((field) => field in operationalShape)) continue;
    }
    throw new Error(`Search fields cannot be proven Tier 0: ${entry.nodeType}`);
  }
}

// Document, Policy and Deliverable are forward dependencies (F299). The owning
// stage adds one entry after it has a Tier 0 name schema, then bumps cache version.
export const SEARCHABLE_NODE_TYPES = [
  {
    nodeType: "Employee",
    labelFields: ["full_name", "job_title"],
    indexedFields: ["full_name", "preferred_name", "job_title"],
    secondaryField: "job_title",
  },
  {
    nodeType: "Skill",
    labelFields: ["name"],
    indexedFields: ["name", "category"],
    secondaryField: "category",
  },
  { nodeType: "Project", labelFields: ["name"], indexedFields: ["name"] },
  { nodeType: "Client", labelFields: ["name"], indexedFields: ["name"] },
] as const satisfies readonly SearchableNodeType[];

validateSearchableNodeTypes(SEARCHABLE_NODE_TYPES);

/** Serialized registry pinned beside CACHE_SCHEMA_VERSION: changing this changes trigger SQL. */
export const SEARCHABLE_NODE_TYPES_FINGERPRINT = JSON.stringify(SEARCHABLE_NODE_TYPES);
