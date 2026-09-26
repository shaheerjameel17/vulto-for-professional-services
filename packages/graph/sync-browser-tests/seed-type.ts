// Client is registered, Tier 0 only, and not feature-owned, with Active/Inactive
// lifecycle states: the suite exercises graph.createNode/graph.transitionLifecycle.
// If a feature claims it, choose another registered Tier 0 type with no owning
// mutation and an Active/Inactive lifecycle; the fast-lane guard must pass.
export const SYNC_SUITE_SEED_NODE_TYPE = "Client" as const;
