import { expect, it } from "vitest";
import {
  FEATURE_LIFECYCLE_NODE_TYPES,
  getNodeRegistration,
  isNodeType,
  isTier0Only,
} from "@vulto/schema";
import { SYNC_SUITE_SEED_NODE_TYPE } from "../../sync-browser-tests/seed-type";

it("keeps the browser suite seed valid for the generic graph mutations", () => {
  const instruction =
    "The sync browser suite seeds this type through graph.createNode and graph.transitionLifecycle. Change sync-browser-tests/seed-type.ts to a suitable registered Tier 0 type.";
  expect(
    isNodeType(SYNC_SUITE_SEED_NODE_TYPE),
    `Unregistered seed. ${instruction}`,
  ).toBe(true);
  expect(
    isTier0Only(SYNC_SUITE_SEED_NODE_TYPE),
    `Seed is not Tier 0 only. ${instruction}`,
  ).toBe(true);
  expect(
    FEATURE_LIFECYCLE_NODE_TYPES.has(SYNC_SUITE_SEED_NODE_TYPE),
    `A feature has claimed it. ${instruction}`,
  ).toBe(false);
  const lifecycle = getNodeRegistration(SYNC_SUITE_SEED_NODE_TYPE).lifecycle;
  expect(lifecycle.kind, `Seed has no fixed lifecycle. ${instruction}`).toBe("fixed");
  const statuses = lifecycle.kind === "fixed" ? lifecycle.statuses : [];
  expect(statuses, `Seed cannot transition from Active. ${instruction}`).toContain(
    "Active",
  );
  expect(statuses, `Seed cannot transition to Inactive. ${instruction}`).toContain(
    "Inactive",
  );
});
