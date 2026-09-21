import type { EdgeType } from "../registry/edges";
import type { NodeType } from "../registry/nodes";

/**
 * VPS-A004 "Subject exclusion" — the registered exclusions (A004-T16).
 *
 * Where a node type is listed, its reader set is the effective grant minus the
 * person the record concerns. The person is found by following `subjectPath`,
 * a chain of outgoing edges, from the record to an Employee. A node type not
 * listed has no exclusion. HRCase and CaseEvent, both halves, exclude the
 * Employee named by `case_concerns` (VRS-F046); a CaseEvent reaches its case
 * through `event_in` first.
 */
export const SUBJECT_EXCLUSIONS: Readonly<
  Partial<Record<NodeType, { readonly subjectPath: readonly EdgeType[] }>>
> = {
  HRCase: { subjectPath: ["case_concerns"] },
  CaseEvent: { subjectPath: ["event_in", "case_concerns"] },
};

export function getSubjectExclusion(
  nodeType: NodeType,
): { readonly subjectPath: readonly EdgeType[] } | undefined {
  return SUBJECT_EXCLUSIONS[nodeType];
}

/**
 * VPS-F007 / A003: where a node's erasure domain is a subject other than the
 * node itself, the path from the node to that subject. Empty today: a feature
 * adds an entry when it is built, and the default is the node itself.
 */
export const ERASURE_DOMAIN_OVERRIDES: Readonly<
  Partial<Record<NodeType, { readonly subjectPath: readonly EdgeType[] }>>
> = {};
