import { describe, expect, it } from "vitest";
import {
  ANONYMITY_REGISTRY,
  EDGE_REGISTRY,
  NODE_REGISTRY,
  PRIVACY_CLASSES,
  resolvePrivacyClassDefaultTier,
} from "./index";
import { validateRegistryDefinition } from "./registry/validate";

/**
 * FDN-55 Stage 1 — the schema conformance gate (`pnpm conformance`), promoted
 * from an incidental unit test to a named gate per `VPS-A007` gate 3 and
 * A007-T05.
 *
 * `VPS-A007` A007-T02: failure output names the specific rule, test or file.
 * Vitest already does that per assertion; the `expect(...).toBe(..., message)`
 * strings here add the `VPS-` citation so an agent reading the failure knows
 * which document it just violated.
 *
 * A007-T05 has four parts. Three are enforced here and by
 * `validateRegistryDefinition` (which runs at module load). The fourth —
 * additive-only evolution — needs a committed baseline snapshot to diff
 * against, and that belongs to FDN-49; it is an `it.todo` below rather than a
 * silent omission.
 */

describe("VPS-A007 gate 3 — schema conformance (A007-T05)", () => {
  it("the registry is structurally valid (validateRegistryDefinition, runs at import)", () => {
    // Importing `@vulto/schema` above already ran this against the real
    // registry. Re-running it explicitly makes this file the thing that fails,
    // with this name, when the registry is malformed.
    expect(() =>
      validateRegistryDefinition({ nodes: NODE_REGISTRY, edges: EDGE_REGISTRY }),
    ).not.toThrow();
  });

  it("every node type is registered exactly once (Standing Rule 6)", () => {
    const seen = new Map<string, number>();
    for (const { nodeType } of NODE_REGISTRY) {
      seen.set(nodeType, (seen.get(nodeType) ?? 0) + 1);
    }
    const dupes = [...seen].filter(([, n]) => n > 1).map(([t]) => t);
    expect(
      dupes,
      `VPS-A002 Standing Rule 6: each node type has exactly one registry row. Duplicated: ${dupes.join(", ")}`,
    ).toEqual([]);
  });

  it("every node carries the Universal Node Conventions, with only the enumerated omissions", () => {
    // VPS-A002 enumerates exactly three deviations. A007-T05: every omitted
    // field and node type is enumerated in the check, so another omission
    // cannot be introduced silently.
    const ENUMERATED = new Map<string, string>([
      ["PulseAggregateContribution", "anonymous-contribution"],
      ["WellnessAggregateContribution", "anonymous-contribution"],
      ["AuditEntry", "immutable-audit"],
    ]);
    const deviations = NODE_REGISTRY.filter(
      ({ universalFields }) => universalFields !== "standard",
    ).map(({ nodeType, universalFields }) => [nodeType, universalFields] as const);

    for (const [nodeType, policy] of deviations) {
      expect(
        ENUMERATED.get(nodeType),
        `VPS-A002 Universal Node Conventions: ${nodeType} deviates ("${policy}") but is not one of the three enumerated exemptions (AuditEntry, PulseAggregateContribution, WellnessAggregateContribution). A007-T05 forbids an unlisted omission.`,
      ).toBe(policy);
    }
    // And the reverse: no enumerated exemption silently reverted to standard.
    for (const [nodeType, expectedPolicy] of ENUMERATED) {
      const row = NODE_REGISTRY.find((n) => n.nodeType === nodeType);
      expect(
        row?.universalFields,
        `VPS-A002: ${nodeType} must keep its "${expectedPolicy}" universal-field policy`,
      ).toBe(expectedPolicy);
    }
  });

  it("every tier assignment matches the Privacy Class default or a declared departure", () => {
    // validateRegistryDefinition's assertConcreteProtection already enforces
    // this; asserted here so the failure names A007-T05 and A003's total map.
    const departures = NODE_REGISTRY.filter(
      ({ protection }) =>
        protection.kind === "fixed" && protection.tierDepartureReason !== undefined,
    ).map(({ nodeType }) => nodeType);
    expect(
      departures,
      `VPS-A003 Privacy Class → tier map: exactly one node departs from its class default, and it is marked. Found departures: ${departures.join(", ")}`,
    ).toEqual(["HeadcountSnapshot"]);
  });

  it("every Privacy Class in the registry resolves through A003's total tier map", () => {
    for (const cls of PRIVACY_CLASSES) {
      if (cls === "Inherited") continue; // resolved from source tiers, not a default
      expect(
        () => resolvePrivacyClassDefaultTier(cls),
        `VPS-A003: Privacy Class "${cls}" has no default tier — the map must be total`,
      ).not.toThrow();
    }
  });

  it("no wildcard or endpoint set touches an anonymity-protected node (A007-T10)", () => {
    // assertAnonymityRegistry runs inside validateRegistryDefinition; this
    // asserts the registry is non-empty so a future refactor that drops the
    // check entirely is caught.
    expect(
      ANONYMITY_REGISTRY.length,
      "VPS-A002 / A007-T10: the anonymity adjacency allowlist must be present and enforced",
    ).toBeGreaterThan(0);
  });
});

describe("A007-T05 — additive-only evolution (deferred to FDN-49)", () => {
  // Needs a committed baseline snapshot of the registry to diff a change
  // against: a removed or renamed property fails, a deprecation with a
  // `deprecated_at` timestamp passes. That baseline and its diff logic are
  // FDN-49's ("enforce schema evolution, graph invariants, architecture
  // conformance"). Recorded as a todo so the gate's coverage gap is visible,
  // not silent — the F130/F133 pattern.
  it.todo(
    "a removed or renamed registry property fails against the committed baseline",
  );
  it.todo("a deprecation carrying a deprecated_at timestamp passes");
});
