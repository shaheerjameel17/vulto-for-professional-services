# Stage 23 finding — browser assertion has no named Employee fixture

The F301 correction's Do item 8 requires one assertion in the existing `packages/graph/sync-browser-tests/sync.spec.ts`: after the suite's existing seeding and sync, a seeded Employee's `cache_search.search_text` must contain its lowercased `full_name`, without building a new scenario.

The existing `seedEntities` helper creates only `Entity` nodes. The suite's `no Tier 1 or Tier 2 value reaches any browser storage` test also calls `seedProtected`, which creates an `Employee` through `addNode(tx, workspaceId, "Employee")`. That `addNode` builds `nodeRecord`, whose record has universal fields only and no `full_name`. No existing Employee in this suite has a `full_name` for the required assertion.

Satisfying the assertion requires a fixture change or an additional Employee write, neither specified by the one-assertion/no-new-scenario instruction. No Stage 23 product code has been written. Reviewer ruling requested: identify the intended existing named Employee fixture, or authorize a specific fixture change and update Do item 8 accordingly. The F301 five-gate correction remains accepted.
