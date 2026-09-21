# Vulto — Server-Authoritative Build: Instructions for Claude Code

You are starting a new build phase in this repository. Read this entire document before doing anything. It is your complete brief for seven stages of work. It was written so that you make **no product, architecture or security decisions**. Every such decision has already been made, either in the specifications or below. Your job is to implement exactly what is written, prove it with tests, and report.

---

## Part 1 — Context you must understand first

### What changed

Until 20 September 2026 this repository was building a **local-first, device-canonical** architecture: a Loro CRDT graph on each device, a Rust sync relay, a sealed encrypted device store, and end-to-end encryption of Tier 1 data (salaries, pay, contracts, HR cases) with key envelopes and 2-of-3 recovery holders.

**That architecture is retired** (finding F199). It is replaced by:

- **PostgreSQL is the single source of truth.** `services/api` is the only writer.
- **Devices hold a fast, permission-filtered cache**, fed by **Electric** (Apache-2.0) through exactly two fixed shapes filtered by a server-maintained **sync audience** (F201, F202).
- **Every write is a named mutation**: applied optimistically on the device, queued in an outbox we own, committed on the server in one transaction, idempotent and stale-state-safe.
- **Tier 1 and Tier 2 data are field-encrypted on the server** under a KMS key hierarchy, fetched on demand through an audited `protected.read`, held in memory only, and **never stored on a device**.
- **Tier 3** (wellness data) stays end-to-end encrypted, but as a **deferred module**. You do not build it in this phase.
- **Trust** is delivered through verifiable controls (VPS-A008), not through the architecture being unable to read data.

### Where the truth lives

| Question | Source |
|---|---|
| The architecture you are building | `docs/Vulto_Specs/VPS-A003_Unified_Sync_Architecture.md` |
| The stack | `docs/Vulto_Specs/VPS-A001_Technology_Stack_and_Engineering_Foundations.md` |
| The graph registry, tiers, standing rules | `docs/Vulto_Specs/VPS-A002_Master_Graph_Schema_Definition.md` |
| Permissions | `docs/Vulto_Specs/VPS-A004_Graph_Permission_Layer.md` |
| CI gates | `docs/Vulto_Specs/VPS-A007_Build_Test_and_Deployment_Pipeline.md` |
| Trust program (context only this phase) | `docs/Vulto_Specs/VPS-A008_Trust_and_Data_Protection_Program.md` |
| Why the direction changed | `docs/Foundations_Findings.md` — F199, F200, F201, F202 |
| Project rules | `CLAUDE.md` |
| Work tracking | Linear, team **Vulto Foundation**, project **Server-Authoritative Data Layer** |

### Repository state at the start of this phase

- `main` contains the rewritten specifications (commits `53803fe`, `aa1adeb`, `4e165bf`, `7b768ef`). **Main may not yet be pushed to GitHub**; Stage 1 pushes it.
- `archive/local-first-e2e` preserves the entire retired implementation **plus** FDN-68's unfinished audit work.
- `fdn-68-audit-wip` holds FDN-68's unfinished audit work alone. Stage 3 takes specific files from it.
- The retired code still lives on `main`: `services/sync-engine` (Rust), `packages/graph/src/worker/**` (Loro runtime, sealed store, Tier 1/Tier 3 envelopes), the device-unlock code in `services/api/src/auth/device-unlock.ts`, and diagnostics pages in `apps/roster-web`. **It stays, compiling and passing its unit tests, until Stage 7 deletes it.** Do not delete or refactor it earlier unless a stage says so.
- `apps/roster-web` product screens run on **fixtures**, not on the graph. Only diagnostics pages import `@vulto/graph`. **You build no product UI in this phase.**

---

## Part 2 — Rules that govern every stage

### The decision policy — read twice

1. **You do not make product, architecture, security or data-model decisions.** If the specifications or this document decide something, do exactly that.
2. **Micro-decisions are allowed only when they have no behavioral, security or data consequence**: a private function name, the split of a file into helpers, the order of test cases. Pick whatever matches existing code style, and list every such choice under "Micro-decisions" in the stage report.
3. **Anything else that is not decided is a STOP condition.** For example: the spec and this document disagree; a library does not support what is specified; a table needs a column not listed here; a test cannot be written as specified. When that happens:
   - add an **open** finding to `docs/Foundations_Findings.md`, using the next free F number and the existing table-row and section format;
   - finish nothing else in that stage that depends on it;
   - write the stage report with status **BLOCKED**, and stop.
   **Do not work around it. Do not "choose the most reasonable option."**
4. **Do not edit specifications** except to add findings. If building proves a spec wrong, stop as above.
5. **Do not gold-plate.** Build what the stage lists, nothing more. No extra abstractions for future features, no UI, no refactors of unrelated code.
6. **Do not start the next stage** until the founder writes "Stage N approved".

### Standing engineering rules (from `CLAUDE.md` and the specs)

- American English everywhere: code, comments, identifiers, docs.
- Never compute a working day. Never write a permission check in feature code; the interceptor decides.
- Tier 1 and Tier 2 values never reach device storage, logs, metrics, analytics or error reports. Tier 3 plaintext never reaches a server.
- Never write the graph except through the mutation pipeline. Never write the sync audience except through the materializer. Never add a shape beyond the two templates.
- No `localStorage` or `sessionStorage`, anywhere. IndexedDB is allowed only inside the sync client.
- Pin every new dependency to an exact version (no `^` or `~`). Pin container images by digest, and record each pin in the spec that requires it in the same commit (VPS-A001 for sync, VPS-A007 for CI images).
- UUID v4 for every ID. UTC ISO-8601 timestamps ending in `Z` in records; `timestamptz` in Postgres.
- Use the existing tools: Drizzle (`services/api/drizzle.config.ts`), Vitest, Playwright, tRPC 11 on Fastify 5, Better Auth, Zod `4.4.3`, `canonicalize`, `wa-sqlite`.

### Git workflow

- Each stage runs on its own branch from the latest `main`: `stage-<N>-<slug>`, for example `stage-2-graph-store`.
- Commit in small logical steps: `feat(FDN-94): ...`, `test(FDN-94): ...`, `docs(FDN-94): ...`.
- At the end of a stage: run the gates, push the branch, write the report, update Linear, and **stop**.
- When the founder writes "Stage N approved": merge the branch into `main` with `git merge --no-ff stage-N-...`, push `main`, set that stage's Linear issues to **Done**, then start Stage N+1 from the new `main`.
- Never force-push `main`. Never rewrite `archive/local-first-e2e` or `fdn-68-audit-wip`.

### Linear workflow

- When a stage starts, set its issues to **In Progress**.
- When the stage report is written, set them to **In Review** and add a comment on each: the report path, the branch name, and a one-paragraph summary.
- Do not set anything to **Done** before approval.
- If you raise a finding, comment it on the relevant issue.

### The stage report

At the end of every stage, write `docs/stage-reports/STAGE-<N>_<Slug>.md` with **exactly** these sections, in this order:

```markdown
# Stage <N> — <Name>

**Status:** COMPLETE | BLOCKED
**Branch:** stage-<N>-<slug> @ <commit sha>
**Linear issues:** FDN-xx, FDN-yy
**Date:** YYYY-MM-DD

## 1. Summary
Five sentences maximum, plain English, for a non-engineer founder.

## 2. Done-criteria checklist
Every done criterion listed for this stage in this document, one per line:
- [x] <criterion> — evidence: <test file>::<test name>, or <command> output
- [ ] <criterion> — why not done

## 3. Spec clauses implemented
A table: Spec ID (e.g. A003-T53) | Where implemented (file path) | Test proving it (file::test)

## 4. Files changed
Output of `git diff --stat main...HEAD`, verbatim.

## 5. Database changes
Every migration file created, with the tables, columns, indexes and constraints it adds. "None" if none.

## 6. Tests and gates
For each command in the stage's "Gates" list: the exact command, the exit code, and the pass/fail/skip counts, copied from the output. No summarizing: paste the final lines of each run.

## 7. Micro-decisions
Every micro-decision under the decision policy, one line each. "None" if none.

## 8. Findings raised
Every new F-number, one line each, with state. "None" if none.

## 9. Deviations from this brief
Anything done differently from this document, and why. This should be "None". A non-empty section without a matching finding is a defect.

## 10. Known limitations and risks
Things that work as specified but that a reviewer should know.

## 11. Readiness for the next stage
Yes or No, and what the next stage depends on from this one.
```

Keep reports factual. Do not claim anything that is not backed by a test name or command output.

### Gates that apply to every stage

Unless a stage adds more, a stage cannot be COMPLETE unless all of these pass:

```
pnpm install --frozen-lockfile
pnpm stack:up
pnpm verify
pnpm verify:full
```

Any pre-existing failure you find in Stage 1 is recorded as a baseline and must not get worse.

---

## Amendments

- **21 September 2026 — F203 closed.** GitHub Actions service containers cannot override the Postgres command. Decision: CI gets a tiny Postgres image of its own whose default command carries the replication flags, built and pinned exactly like the existing CI image. Implemented in Stage 6 item 0, because no CI suite needs replication before then. When merging Stage 1, update F203 to **Closed by founder-delegated decision, 21 September 2026 — CI Postgres image, built in Stage 6**, and move its detailed section so it follows F202.
- **21 September 2026 — F204 closed.** A `User` is stored **once per workspace** it belongs to, under the same `node_id` (its Better Auth account id). `graph_nodes` gets a composite primary key `(workspace_id, node_id)`; every row has a non-null `workspace_id`; every other node type's `node_id` stays globally unique through a partial unique index; edges reference endpoints by `(workspace_id, node_id)`. Rejected: a null `workspace_id` for `User` rows, because a row outside every workspace breaks per-workspace residency (VPS-A008 P8), export and erasure, and would let one workspace's edits to a person's node appear in another's. Stage 2 and Stage 6 below are updated. When resuming Stage 2, update F204 to **Closed by founder-delegated decision, 21 September 2026 — one `User` row per workspace under a composite key; VPS-A002 and VPS-A003 amended on `main`**.
- **21 September 2026 — F205 closed.** Your recommendation is accepted. `graph_nodes.created_at` becomes nullable, with a check constraint allowing null **only** for `PulseAggregateContribution` and `WellnessAggregateContribution`; every other type stays not-null in practice. This follows VPS-A002's closed omission policy and keeps those contributions uncorrelatable. Do it in a new migration on `stage-2-graph-store`, remove the store's refusal, extend the round-trip test to all registered types, and mark F205 **Closed by founder-delegated decision, 21 September 2026 — nullable `created_at` for the two anonymous contribution types only, by check constraint**.
- **21 September 2026 — membership changes reach the graph (added to Stage 3).** Stage 2 wrote only the founding records, so the graph's `WorkspaceMembership` node goes stale on later changes. In Stage 3, extend the membership projection so **invitation acceptance, role change and member removal** each write the matching `User`, `WorkspaceMembership` and endpoint-edge changes in the **same transaction** as the Better Auth change, the same way `workspace.create` now does. Permission decisions still read the central Better Auth row (Stage 3 item 2); the graph copy is history and the input Stage 6's audience recompute listens to.
- **21 September 2026 — generic mutations are Tier-0-only (added to Stage 4).** The registry has no field-to-partition map, so a generic mutation on a split or protected node type could put protected fields into `graph_nodes.record`. The foundation mutations `graph.createNode` and `graph.updateNodeFields` therefore accept **only node types whose every partition is Tier 0**. Split types and Tier 1/2/3 types are refused with reason `requires-feature-mutation`; the feature that owns such a type will define a named mutation that routes each field to its partition. Add a test for the refusal.
- **21 September 2026 — pushing.** The founder has allowed `git push` to `origin` for `main`, `stage-*`, `archive/local-first-e2e` and `fdn-68-audit-wip`. A refused push is still a STOP condition.

---

## Part 3 — The stages

### Stage 1 — Alignment, baseline and local stack

**Linear:** none moved to In Progress. Comment on FDN-102 when done.
**Branch:** `stage-1-alignment`

**Read, in this order:** `CLAUDE.md`; VPS-002; VPS-A003 in full; VPS-A001; VPS-A004 "Where enforcement runs" plus its technical specifications; VPS-A007 gates 5 and 6; Foundations_Findings F199–F202; this document again.

**Do:**

1. **Push existing history:** `git push origin main archive/local-first-e2e fdn-68-audit-wip`. If the push fails for credentials, stop and report BLOCKED.
2. **Baseline:** run `pnpm install --frozen-lockfile`, `pnpm stack:up`, `pnpm verify` and `pnpm verify:full`. Record every result verbatim in the report as the baseline. Fix nothing yet.
3. **Postgres logical replication.** In `docker-compose.yml`, give the `postgres` service:
   `command: ["postgres", "-c", "wal_level=logical", "-c", "max_replication_slots=10", "-c", "max_wal_senders=10"]`
   **CI is not changed in Stage 1.** GitHub Actions service containers cannot take a command (F203); Stage 6 item 0 gives CI its own Postgres image.
4. **Retire the Rust relay from the default stack without deleting it.** Give the `sync-engine` compose service `profiles: ["retired"]`, so `pnpm stack:up` no longer builds Rust. Stage 7 deletes it.
5. **Add Electric** to `docker-compose.yml`:
   - service name `electric`; image `electricsql/electric`, using the latest stable **1.x** release as of the day you run this;
   - pin it by digest: `docker pull electricsql/electric:<version>`, then `docker inspect --format='{{index .RepoDigests 0}}'`;
   - host port `5133` mapped to container port `3000` (host port 3000 is Next.js's);
   - environment: `DATABASE_URL: postgres://vulto:vulto@postgres:5432/vulto`, `ELECTRIC_SECRET: ${ELECTRIC_SECRET}`;
   - `depends_on` Postgres healthy;
   - if the image contains a shell with `curl` or `wget`, add a healthcheck on `/v1/health`; otherwise document the host-side check, as the old sync-engine comment did.
   - Record the version and digest in VPS-A001's "Sync client selection" section, replacing "Versions are pinned exactly…" with the actual pins.
6. **Environment variables.** Add to `.env.example` with safe local defaults, and to `turbo.json` `globalPassThroughEnv`:
   - `ELECTRIC_URL=http://localhost:5133`
   - `ELECTRIC_SECRET=` a 32-character local-only value
   - `VULTO_KEY_PROVIDER=local`
   - `VULTO_LOCAL_ROOT_KEY=` a base64 32-byte local-only value, labeled as never for production
   - `AWS_REGION=`, `VULTO_KMS_ROOT_KEY_ARN=` (empty locally)
7. **Update the compose header comment** to describe the new stack: Postgres with logical replication, Redis, Electric; sync-engine retired under the `retired` profile.
8. **Create `docs/stage-reports/`** and write the Stage 1 report into it.

**Done criteria:**
- `main`, `archive/local-first-e2e` and `fdn-68-audit-wip` exist on origin.
- `pnpm stack:up` starts Postgres, Redis and Electric, and does not build Rust.
- `docker compose exec postgres psql -U vulto -c "SHOW wal_level"` returns `logical`.
- Electric's `/v1/health` responds from the host on port 5133.
- The baseline of `pnpm verify` and `pnpm verify:full` is recorded, and neither is worse than before the stage.

**Gates:** the standard four, plus the psql and health checks above.

---

### Stage 2 — The canonical PostgreSQL graph store

**Linear:** FDN-94.
**Branch:** `stage-2-graph-store`

**Read:** VPS-A003 "The canonical store"; VPS-A002 "Universal node conventions", "Universal edge conventions", "The edge storage contract", "Privacy classes and tiers", "Schema Evolution Protocol"; `packages/schema/src/records.ts`; `packages/schema/src/registry/*`; `services/api/src/auth/workspace-projection.ts`; `services/api/src/auth/schema.ts`.

**Build:**

1. **New Drizzle schema file** `services/api/src/graph/schema.ts`. Add it to `drizzle.config.ts` so `schema` is an array: `["./src/auth/schema.ts", "./src/graph/schema.ts"]`.
2. **One migration**, generated with `pnpm --filter @vulto/api db:generate`, then hand-appended with the SQL Drizzle cannot express. It creates:
   - `CREATE EXTENSION IF NOT EXISTS btree_gist;`
   - **`graph_nodes`**
     - `node_id uuid not null`, `workspace_id uuid not null`, **primary key `(workspace_id, node_id)`**, `node_type text not null`, `lifecycle_status text not null`, `schema_version integer not null`, `version bigint not null default 1`
     - `is_soft_deleted boolean not null default false`
     - `created_at timestamptz not null`, `created_by uuid`, `updated_at timestamptz`, `updated_by uuid`, `soft_deleted_at timestamptz`, `soft_deleted_by uuid`
     - `record jsonb not null`
     - check constraints: `record->>'node_id' = node_id::text`; `record->>'lifecycle_status' = lifecycle_status`
     - index `(workspace_id, node_type, lifecycle_status) where not is_soft_deleted`
     - partial unique index on `(node_id) where node_type <> 'User'` — every node ID except a `User`'s is globally unique
     - check `node_type <> 'Workspace' or workspace_id = node_id`
   - **`graph_edges`**
     - `edge_id uuid primary key`, `workspace_id uuid not null`, `edge_type text not null`
     - `from_node_id uuid not null`, `to_node_id uuid not null`, with foreign keys `(workspace_id, from_node_id)` and `(workspace_id, to_node_id)` referencing `graph_nodes(workspace_id, node_id)`, so an edge can never cross workspaces
     - `effective_from timestamptz`, `effective_to timestamptz`, `version bigint not null default 1`, `is_soft_deleted boolean not null default false`
     - the same created/updated/soft-deleted columns as `graph_nodes`
     - `record jsonb not null`, with check `record->>'edge_id' = edge_id::text`
     - indexes `(workspace_id, edge_type, from_node_id, effective_from, effective_to)` and `(workspace_id, edge_type, to_node_id, effective_from, effective_to)`
     - partial unique index `(edge_type, from_node_id) where effective_to is null and not is_soft_deleted and edge_type in ('managed_by','scoped_to_entity')`
     - exclusion constraint `exclude using gist (from_node_id with =, edge_type with =, tstzrange(effective_from, effective_to, '[)') with &&) where (not is_soft_deleted and edge_type in ('managed_by','scoped_to_entity'))`
   - **The Workspace node's `workspace_id` equals its own `node_id`.**
   - **A `User` node is one row per workspace**, `node_id` = the Better Auth `user.id`, its `record` exactly as `records.ts` defines it (no `workspace_id` field). Only the membership projection writes `User` rows; the store refuses a `User` write from any other caller.
   - **No foreign key to Better Auth tables.** Consistency with them is enforced in code, in the same transaction.
3. **What goes in `record`.** The complete Tier 0 partition record, validated by the existing Zod record schemas in `packages/schema/src/records.ts`:
   - for a node type whose registry tier is 0, the whole record;
   - for a split node type, the Tier 0 partition only;
   - for a node type whose every partition is Tier 1, 2 or 3, only the universal fields (no content). Content arrives in Stage 5.
   - Edges: every edge is a row in `graph_edges`, including edges with a protected endpoint. Metadata that belongs to a protected tier is not written in this stage.
4. **Store module** `services/api/src/graph/store.ts` — internal, not an API. Every function takes a Drizzle transaction as its first argument:
   - `insertNode(tx, record)`, `updateNodeFields(tx, nodeId, expectedVersion | null, patch)` (increments `version`), `softDeleteNode(tx, nodeId, actor)`
   - `insertEdge(tx, record)`, `closeEdge(tx, edgeId, effectiveTo, actor)`
   - `getNode(tx, workspaceId, nodeId)`, `getNodes(tx, workspaceId, filter)` — **every** read and write takes `workspaceId`; there is no workspace-less lookup
   - `outgoing(tx, nodeId, edgeType, at?)`, `incoming(...)`
   - `traverse(tx, startNodeId, edgeTypes, maxDepth)`, implemented with a recursive CTE
   - Every write validates against the registry: node type registered, edge triple registered, record passes its Zod schema. Invalid input throws a typed `GraphValidationError`, never a raw database error.
   - **No permission logic here.** Stage 3 adds the interceptor above this layer.
5. **Architecture rule.** Extend `scripts/arch-check.mjs` so that `services/api/src/graph/store.ts` may be imported only from `services/api/src/{graph,permission,mutations,protected,audience,jobs}/**`. Anything else fails `pnpm arch:check`.
6. **Workspace creation writes the Postgres graph.** In the existing `workspace.create` flow, write the five founding records into `graph_nodes` and `graph_edges` (Workspace node, the Owner's User node, the WorkspaceMembership node, `membership_of`, `membership_in`), **in the same Postgres transaction** as the central Better Auth membership row. Leave the existing device-projection path in place: **it is a temporary dual write that Stage 7 removes.** Mark it with a `// F199: removed in Stage 7 (FDN-103)` comment.

**Tests** — Vitest integration tests against the real Postgres, following the existing `db-preflight` pattern:
- every node type in `NODE_REGISTRY` round-trips through `insertNode`/`getNode`, using a minimal valid record built from the registry;
- inserting an edge with an unregistered triple throws `GraphValidationError`;
- two open `managed_by` edges from one employee → rejected by the database;
- overlapping closed intervals for `scoped_to_entity` → rejected by the exclusion constraint;
- `updateNodeFields` with a stale `expectedVersion` → typed `StaleVersionError`, and `version` unchanged;
- `workspace.create` rolls back graph rows if the Better Auth insert fails, and the reverse;
- `traverse` returns correct depth-limited results on a five-level `managed_by` chain;
- one person creating two workspaces produces two `User` rows with the same `node_id`, each in its own workspace, and an edge from workspace A to a node in workspace B is rejected by the foreign key;
- inserting a non-`User` node whose `node_id` already exists in another workspace is rejected;
- the arch-check rule fails when a file outside the allowed folders imports the store (a fixture file created in the test's temp directory).

**Done criteria:**
- The migration applies cleanly on an empty database and on the current development database.
- All tests above pass.
- `pnpm arch:check` enforces the import rule.
- `workspace.create` is atomic across Better Auth and graph rows.

**Gates:** the standard four, plus `pnpm --filter @vulto/api db:migrate` on a fresh database.

---

### Stage 3 — The server-side permission interceptor and audit journal

**Linear:** FDN-98; FDN-89 (partial — see item 5); FDN-68 (server half).
**Branch:** `stage-3-interceptor`

**Read:** VPS-A004 in full; VPS-F004; `packages/graph/src/worker/permission/*`; on branch `fdn-68-audit-wip`: `packages/schema/src/audit.ts`, `packages/schema/src/audit.test.ts`, `services/api/src/auth/audit-journal.ts`, `services/api/src/auth/audit-pseudonymizer.ts`, `services/api/drizzle/0010_nosy_zzzax.sql`, `services/api/drizzle/0011_wild_next_avengers.sql`, and the FDN-68 comments on Linear.

**Build:**

1. **Move the pure policy code into `packages/schema/src/policy/`:** `policy-table.ts`, `matrix-coverage.ts` and every pure helper they need, plus their unit tests. Export them from `@vulto/schema`. Replace the originals in `packages/graph/src/worker/permission/` with **re-export shims**, so the retired worker still compiles until Stage 7. Behavior must be byte-for-byte identical: the moved unit tests pass unchanged.
2. **Principals** — `services/api/src/permission/principal.ts`. One discriminated union:
   - `member { userId, workspaceId, membershipId, roles }` — roles come from the central Better Auth member row, read on every request (this closes F127);
   - `support { grantId, workspaceId, scope, expiresAt }` — type and evaluation only; nothing issues support grants yet (FDN-106);
   - `system { name, workspaceId }` — `name` is one of a closed enum: `audience-recompute`, `retention-sweep`, `erasure`, `key-rotation`.
   Each system principal's permitted operations are listed in the policy table and nowhere else.
3. **Derived Manager scope.** Manager is derived from active `managed_by` edges, read from Postgres at request time. It applies only where a User↔Employee identity link exists. **That link does not exist yet (VRS-F002 / RST-33)**, so Manager scope currently resolves to nothing. Implement the lookup against a single function `resolveEmployeeForUser(tx, workspaceId, userId): Promise<string | null>` that returns `null` today, with a comment naming RST-33. Do not invent a link.
4. **The interceptor** — `services/api/src/permission/interceptor.ts`:
   - `authorizeRead(tx, principal, target)`, `authorizeWrite(tx, principal, target, change)`, `filterReadable(tx, principal, rows)`, `authorizeTraversal(...)`;
   - VPS-A004's graph traversal rules;
   - `None` versus `Restricted` outcomes per A004-T18/T19;
   - the three write gates in order: role → write authority → empty reader set (A004-T17);
   - aggregate disclosure control stays as currently implemented; port it if it lives in the moved code.
5. **FDN-89, partial.** Implement subject exclusion and concrete reader-set resolution against `resolveEmployeeForUser`. While it returns `null`, any protected write needing a concrete reader set is refused with reason `reader-set-unresolvable`, per A004 ("refused or deferred rather than guessed at"). F130 remains open and must be restated in the report.
6. **tRPC wiring.** A tRPC context that resolves the Better Auth session and the active workspace into a `member` principal; a `protectedProcedure` that requires one; the principal is never taken from client input.
7. **Server audit journal** (FDN-68, server half):
   - Take, with `git checkout fdn-68-audit-wip -- <path>`, **only**: `packages/schema/src/audit.ts`, `packages/schema/src/audit.test.ts`, `services/api/src/auth/audit-journal.ts`, `services/api/src/auth/audit-pseudonymizer.ts`, and the two migrations.
   - Move the journal and pseudonymizer to `services/api/src/audit/`.
   - Re-generate the migration numbering so it follows Stage 2's migration. Keep the SQL content.
   - Change the append path so an audit event is written **inside the caller's transaction** (`appendAudit(tx, event)`), per A003-T59. Remove the device outbox and sealed-journal assumptions; keep idempotency on `audit_entry_id` and "no update or delete path".
   - Every denial, and every Tier 1, 2 or 3 grant decided by the interceptor, calls `appendAudit` in the same transaction.
   - F198: reserve `AuditEntry` from every generic write path in the new interceptor. The only writer is `appendAudit`; the only post-append change is the pseudonymization operation.
   - **Do not build the hash chain.** That is FDN-108, later.
8. **Port the permission matrix suite** (A004-T07): every role × privacy class in the default mapping, and every role × node type in the matrix, now against `services/api/src/permission`. Coverage must not fall below the current suite's; report both counts.

**Done criteria:**
- The moved unit tests pass unchanged; the retired worker still compiles.
- The ported matrix suite passes against the server interceptor, with a case count ≥ the old suite's.
- A role change takes effect on the very next request, with no cache and no restart.
- Every denial and every protected grant produces exactly one audit row, in the same transaction.
- `AuditEntry` cannot be written through any generic path.
- Support and system principals are evaluated and audited.
- The report restates F130 as open.

**Gates:** the standard four.

---

### Stage 4 — The named-mutation pipeline

**Linear:** FDN-95.
**Branch:** `stage-4-mutations`

**Read:** VPS-A003 "Writes", "Conflict resolution", A003-T53, T54, T64, T69, T71.

**Build:**

1. **Definitions** — `packages/schema/src/mutations/`:
   `defineMutation({ name, input: ZodSchema, tier: 0 | 1 | 2, onlineOnly: boolean, stateTransition: boolean })`. A registry `MUTATIONS` of all definitions. `onlineOnly` is forced to `true` whenever `tier > 0`.
2. **The foundation mutation set** — exactly these, no feature mutations:
   - `graph.createNode`, `graph.updateNodeFields`, `graph.softDeleteNode`, `graph.createEdge`, `graph.closeEdge` — Tier 0, registry-validated, the building blocks features will wrap;
   - `graph.transitionLifecycle` — `stateTransition: true`, carries `expected_version`;
   - `org.moveEmployee` — serializable transaction; rejects a cycle; closes the prior `managed_by` edge's `effective_to` and opens the new edge's `effective_from` together; effective date from input, never the clock.
3. **Mutation log table** `graph_mutations`: `mutation_id uuid primary key`, `workspace_id uuid not null`, `actor_user_id uuid`, `name text not null`, `args_sha256 text not null`, `outcome jsonb not null`, `created_at timestamptz not null default now()`.
4. **Server pipeline** — `services/api/src/mutations/pipeline.ts`. For each mutation, in one transaction, in this order:
   1. idempotency check (step 1 below);
   2. authorize (Stage 3 interceptor write gates);
   3. registry and Zod validation;
   4. domain rule (the mutation's server implementation);
   5. `appendAudit` where required;
   6. `audience.onRowsChanged(tx, changedRowIds)` — an interface with a **no-op** implementation now, implemented in Stage 6;
   7. insert into `graph_mutations`;
   8. commit.
   On any failure the whole transaction rolls back, and a rejection outcome is recorded in its own small transaction.
   - **Idempotency:** same `mutation_id` and same `args_sha256` → return the stored outcome with status `duplicate`. Same id with different args → reject `mutation-id-conflict`.
   - **Stale state:** `stateTransition` mutations compare `expected_version` with `graph_nodes.version`; a mismatch → reject `stale-state`. Every successful update increments `version`.
   - **Schema version:** clients send header `x-vulto-schema-version`. Below `MIN_CLIENT_SCHEMA_VERSION` (a new exported constant in `packages/schema`, set to `1`) → tRPC error code `PRECONDITION_FAILED`, reason `client-outdated`.
5. **tRPC** — `graph.applyMutations({ mutations: Array<{ mutation_id, name, args }> })`, maximum 100 per call. Mutations are processed **in order**, each in its own transaction. Returns `Array<{ mutation_id, status: 'applied' | 'duplicate' | 'rejected', reason?, result? }>`. Processing stops at the first rejection; the remaining mutations are returned as `rejected` with reason `blocked-by-earlier-rejection`, so client ordering is preserved.
6. **Client halves** — `packages/graph/src/mutators/`: an optimistic implementation for each foundation mutation, operating on the Stage 6 cache interface. In this stage, test them against an in-memory implementation of that interface only.

**Tests:**
- replay of the same `mutation_id` applies once and returns `duplicate`;
- same id with different args → `mutation-id-conflict`;
- an approve/reject race on one node via `graph.transitionLifecycle` → exactly one `applied`, the other `stale-state`;
- `org.moveEmployee` rejects A→B→A and a longer cycle, and keeps history half-open and non-overlapping;
- a mutation denied by the interceptor writes an audit row and no graph change;
- an ordered batch stops at the first rejection with the specified statuses;
- `client-outdated` is returned below the minimum version;
- a Tier 1 mutation definition is `onlineOnly` even if declared otherwise.

**Done criteria:** all tests pass; no path writes `graph_nodes` or `graph_edges` except the pipeline and the Stage 2 `workspace.create` transaction. Extend `pnpm arch:check` to enforce this.

**Gates:** the standard four.

---

### Stage 5 — Protected data and field-level encryption

**Linear:** FDN-96; FDN-97 (erasure only — blob encryption waits for object storage, FDN-70).
**Branch:** `stage-5-protected-data`

**Read:** VPS-A003 "Data protection tiers", "The encryption architecture", "Cryptographic erasure", A003-T55, T56, T59–T62, T73; VPS-A006 logging rules; VPS-F007 "What erasure actually does, per tier".

**Build:**

1. **Tables:**
   - **`protected_data_keys`**: `key_id uuid primary key`, `workspace_id uuid not null`, `kind text not null check (kind in ('kek','dek'))`, `tier smallint check (tier in (1,2))`, `erasure_domain_id uuid`, `parent_key_id uuid references protected_data_keys(key_id)`, `root_key_ref text`, `wrapped_key bytea`, `created_at timestamptz not null default now()`, `destroyed_at timestamptz`.
     - A KEK has `root_key_ref` and no parent. A DEK has a parent KEK.
     - Unique: one live Tier 2 DEK per workspace; one live Tier 1 DEK per `(workspace_id, erasure_domain_id)`.
   - **`graph_protected_fragments`**: `fragment_id uuid primary key`, `workspace_id uuid not null`, `owner_kind text not null check (owner_kind in ('node','edge'))`, `owner_id uuid not null`, `schema_partition text not null`, `tier smallint not null check (tier in (1,2))`, `erasure_domain_id uuid not null`, `data_key_id uuid not null references protected_data_keys(key_id)`, `nonce bytea not null`, `ciphertext bytea not null`, `header jsonb not null`, `version bigint not null default 1`, created/updated columns; unique `(owner_kind, owner_id, schema_partition)`.
2. **Key providers** — `services/api/src/crypto/`:
   - interface `KeyProvider { wrapKek(plain: Uint8Array, ctx): Promise<{ wrapped, rootKeyRef }>; unwrapKek(wrapped, rootKeyRef, ctx): Promise<Uint8Array> }`;
   - `AwsKmsKeyProvider` using `@aws-sdk/client-kms` (pinned exactly), `Encrypt`/`Decrypt` with `EncryptionContext = { workspace_id }`;
   - `LocalKeyProvider`: AES-256-GCM under `VULTO_LOCAL_ROOT_KEY`, with the workspace ID as AAD;
   - the factory selects by `VULTO_KEY_PROVIDER`; it **throws at startup** if `NODE_ENV=production` and the provider is `local` (A003-T73);
   - no other code imports `@aws-sdk/client-kms`. Add an arch-check rule.
3. **Envelope encryption:**
   - DEK: 32 random bytes. Content: AES-256-GCM with a fresh 12-byte random nonce per encryption, via Node `crypto`.
   - AAD = `canonicalize(header)` (RFC 8785), with header fields exactly: `format: "vulto:protected-fragment:v1"`, `workspace_id`, `owner_kind`, `owner_id`, `owner_type` (node or edge type), `schema_partition`, `tier`, `erasure_domain_id`, `data_key_id`.
   - DEKs are wrapped by the KEK with AES-256-GCM and AAD `canonicalize({ format: "vulto:dek:v1", key_id, workspace_id, tier, erasure_domain_id })`.
4. **Erasure domain:** default = the owner node's ID. Add `ERASURE_DOMAIN_OVERRIDES` to `packages/schema`, empty today; features add entries when built.
5. **Key cache:** unwrapped KEKs and DEKs held in process memory only; TTL ≤ 5 minutes; maximum 1,000 entries; never logged or serialized.
6. **Workspace key provisioning:** `workspace.create` creates the workspace KEK inside its existing transaction. It shows the Owner nothing.
7. **Write path:** `writeProtected(tx, owner, partition, value)` used by the pipeline; Tier 1 and Tier 2 mutation input is written here, never into `graph_nodes.record`.
8. **Read path** — tRPC `protected.read({ node_ids: uuid[] (max 500), partitions?: string[] })`. Per fragment:
   1. interceptor `authorizeRead`;
   2. `appendAudit` (a failure withholds the data);
   3. decrypt;
   4. return.
   Set the HTTP response header `Cache-Control: no-store`. A destroyed key → the fragment is returned as state `erased`, with no content.
9. **Job principal wrapper** — `services/api/src/jobs/principal.ts`: `runAsPrincipal(principal, fn)`. A `member` principal is re-resolved at execution; if the grant was withdrawn, throw `PrincipalWithdrawnError` before any read. There is no jobs service yet (FDN-57); build the wrapper and its tests only.
10. **Cryptographic erasure** — `services/api/src/protected/erasure.ts`, callable only by the `erasure` system principal: set `wrapped_key = NULL` and `destroyed_at = now()` for the domain's DEKs, evict them from the cache, and `appendAudit`. **Backup key expiry is an operations task (FDN-58)**; list it under Known limitations.
11. **Decryption reachability** (A007-T08): arch-check rule — the decrypt function is importable only from `protected/read.ts`, `jobs/principal.ts` and `protected/erasure.ts`.
12. **Logging:** if `services/api` has a logging redaction allowlist, extend it to every protected field. If it does not, add a test that captures Fastify logger output during `protected.read` and asserts that no plaintext sentinel value appears.

**Tests:**
- a dump of both tables (`SELECT *`) contains no plaintext sentinel;
- a fragment's ciphertext copied onto another owner fails authentication;
- a denied read writes an audit row and returns nothing;
- a forced audit-append failure withholds the data;
- erasing one employee's domain leaves another employee's content readable;
- `runAsPrincipal` for a demoted member throws before reading;
- the production guard rejects `LocalKeyProvider`;
- `AwsKmsKeyProvider` is unit-tested with a mocked KMS client (no network in tests).

**Done criteria:** all of the above; the arch-check rules pass; VPS-A003's acceptance criteria for dump safety, fragment moving and erasure are cited with test names.

**Gates:** the standard four.

---

### Stage 6 — Sync: audience, shape proxy, device cache, outbox, offline

**Linear:** FDN-100, FDN-99, FDN-101.
**Branch:** `stage-6-sync`

**Read:** VPS-A003 "Reads", "Offline behavior", "Revocation", A003-T56–T58, T63–T67, T72; VPS-A001 "Sync client selection" and "Local graph query layer"; VPS-F001 "Session expiry and offline access", "Device revocation", G04; Electric's documentation on shapes, subqueries, auth proxy and the TypeScript client, for the pinned version.

**Server:**

0. **CI Postgres image (F203).** Create `.docker/ci-postgres/Dockerfile`: `FROM` the same `postgres:17-alpine@sha256:742f40ea…` digest the workflows use today, with `CMD ["postgres", "-c", "wal_level=logical", "-c", "max_replication_slots=10", "-c", "max_wal_senders=10"]`. Extend `.github/workflows/ci-image.yml` to build and publish it as `ghcr.io/<repo>/ci-postgres`, triggered by changes under `.docker/ci-postgres/**`, exactly as the CI image is. Add `CI_POSTGRES_IMAGE=<digest pin>` to `.github/workflows/ci-image-ref.env`, and have `slow-lane.yml`'s `resolve-image` job output it, so every Postgres `services:` entry uses `${{ needs.resolve-image.outputs.postgres_image }}` instead of the literal digest. Publishing needs a merge to `main` followed by a repin, as the CI image README describes: do the Dockerfile and workflow change first, stop and report so the founder can merge it, then repin once the digest exists. Until the repin, the Stage 6 browser suite runs locally only; say so in the report.

1. **Audience tables:** `sync_node_audience (workspace_id uuid, user_id uuid, node_id uuid, primary key (workspace_id, user_id, node_id))` and `sync_edge_audience (workspace_id uuid, user_id uuid, edge_id uuid, primary key (workspace_id, user_id, edge_id))`. Identifiers only. (Keyed by workspace because a `User` node's `node_id` repeats across workspaces, per F204.)
2. **Materializer** — `services/api/src/audience/`:
   - implements `audience.onRowsChanged` from Stage 4: for each touched Tier 0 node or edge, and each active member of the workspace, insert or delete audience rows so they equal `interceptor.authorizeRead` for that member;
   - `recomputeWorkspace(tx, workspaceId)` — a full recompute, run as the `audience-recompute` system principal, called on every membership, role or `managed_by` change;
   - only Tier 0 node types, and edges whose both endpoints are Tier 0, are ever eligible.
3. **Electric database role and publication:**
   - a migration creates the role `vulto_electric` with `REPLICATION`, `LOGIN` and `SELECT` on exactly `graph_nodes`, `graph_edges`, `sync_node_audience` and `sync_edge_audience`, and a publication `electric_publication_default` containing exactly those four tables;
   - Electric connects as `vulto_electric`, with manual table publishing enabled, using the environment variable Electric documents for that in the pinned version;
   - **if the pinned version cannot run with a pre-created publication and a SELECT-only role, STOP with a finding.**
   - The role's password comes from a new environment variable `ELECTRIC_DB_PASSWORD`.
4. **Shape proxy** — Fastify route `GET /v1/shape/:template`, with `template ∈ { nodes, edges }`:
   - requires a valid Better Auth session, an active membership in the session's workspace, and a non-revoked device;
   - sets `table`, `where` and `params` server-side:
     - nodes: `workspace_id = $1 AND node_id IN (SELECT node_id FROM sync_node_audience WHERE workspace_id = $1 AND user_id = $2)`
     - edges: the same, over `graph_edges` and `sync_edge_audience`;
   - forwards only Electric's protocol parameters (`offset`, `handle`, `live`, `cursor`) from the client, adds `ELECTRIC_SECRET` server-side, and streams the response back;
   - any client-supplied `table`, `where`, `columns` or `params` → `400`;
   - a revoked device or removed membership → `401` with body `{ "code": "access-revoked", "erase": true }`.

**Client** — inside `packages/graph/src/sync-client/`. The public API is exported from `@vulto/graph`:

5. **Host:** a SharedWorker `sync-worker.ts` shared by every tab. Where `SharedWorker` is unavailable, a dedicated Worker that holds `navigator.locks.request("vulto-sync:<workspaceId>:<userId>")`; non-holding tabs read the same database and receive change notifications over `BroadcastChannel("vulto-sync:<workspaceId>:<userId>")`.
6. **Cache database:** `wa-sqlite` with `IDBBatchAtomicVFS`, database name `vulto:<workspaceId>:<userId>`, with tables:
   - `cache_nodes (node_id primary key, node_type, lifecycle_status, is_soft_deleted, version, record_json)`
   - `cache_edges (edge_id primary key, edge_type, from_node_id, to_node_id, effective_from, effective_to, is_soft_deleted, version, record_json)`
   - `sync_cursor (template primary key, handle, offset)`
   - `outbox (seq integer primary key autoincrement, mutation_id unique, name, args_json, undo_json, status check in ('pending','inflight','rejected'), reason, created_at)`
   - `session_hint (singleton primary key check (singleton = 1), user_id, workspace_id)` — identifiers only, used to open the cache offline. **No tokens, ever.**
7. **Replication:** `@electric-sql/client` `ShapeStream` against the proxy for both templates. Apply inserts, updates and deletes into the cache tables. Persist `handle` and `offset`. On `must-refetch`, clear that table and resync.
8. **Outbox:** `mutate(name, args)`:
   1. generate a `mutation_id`;
   2. run the optimistic client mutator (Stage 4) against the cache, recording before-images in `undo_json`;
   3. append to `outbox`;
   4. upload in `seq` order via `graph.applyMutations`.
   - `applied` or `duplicate` → delete the outbox row (replication delivers the authoritative row).
   - `rejected` → apply `undo_json`, mark `rejected` with the reason, and surface `NeedsAttention`.
   - Network failure → leave the row `pending` and retry with exponential backoff (1 s doubling to 60 s).
   - `onlineOnly` mutations are refused immediately while offline, with reason `requires-connection`.
9. **Query layer:** port `packages/graph/src/query.ts`'s typed query API so it runs against `cache_nodes` and `cache_edges`, preserving its public types. Recursive traversal via recursive CTE. Availability outcome per A001-T07: `mid-sync | requires-connection | permission-absence | ready`.
10. **Protected values:** `protectedRead(nodeIds)` calls `protected.read`. Results are held **only in worker memory**, keyed by node and partition, and cleared on sign-out, workspace switch, role change and `access-revoked`. `prefetchProtected(nodeIds)` warms the same memory store.
11. **SyncStatus observable:** `Synced | Syncing | PendingChanges | Offline | NeedsAttention`.
12. **Erasure on revocation and sign-out:** delete the IndexedDB database and the in-memory protected store, then emit `Offline` with a signed-out state.
13. **Public API:** `createGraphClient({ workspaceId, userId, apiOrigin })` → `{ query, subscribe, mutate, protectedRead, prefetchProtected, syncStatus, signOut }`.

**Tests:**
- **Server:**
  - the audience conformance suite (A003-T57): for every role × privacy class on a synthetic fixture workspace, audience ⊆ interceptor-permitted, and interceptor-permitted Tier 0 ⊆ audience;
  - the publication allowlist test (queries `pg_publication_tables`);
  - the proxy rejects `table` and `where`;
  - the proxy returns `access-revoked` for a removed member.
- **Browser** — new Playwright config `packages/graph/playwright.sync.config.ts`, against the real stack:
  1. first sign-in replicates and a query returns the member's rows;
  2. **cold offline boot**: after the network is cut and the page reloaded, queries still return rows and SyncStatus is `Offline`;
  3. three offline Tier 0 mutations, then reconnect → each applied **exactly once** (assert on `graph_mutations`);
  4. two tabs: a mutation in tab A appears in tab B without a reload;
  5. a queued state transition rejected as `stale-state` → reverted locally and `NeedsAttention`;
  6. removing the member's role → the forbidden rows disappear from the cache on next connection;
  7. device revocation → the IndexedDB database is gone;
  8. **no protected data on the device**: seed Tier 1 and Tier 2 sentinel values, exercise `protectedRead`, then scan every IndexedDB database and every cache table for the sentinels — none are found.

**Done criteria:** every test above passes; VPS-A003's acceptance criteria for offline boot, queued writes, stale-state, the device-storage scan and revocation are cited with test names.

**CI:** add an `electric` service to the slow-lane job that runs this suite, using the same pinned digest and the `vulto_electric` role, and run the suite there once item 0's repin has landed.

**Gates:** the standard four, plus `pnpm exec playwright test --config packages/graph/playwright.sync.config.ts`.

---

### Stage 7 — Retire the local-first implementation and harden CI

**Linear:** FDN-103, FDN-54.
**Branch:** `stage-7-retire`

**Do:**

1. **Delete:**
   - `services/sync-engine/`, `rust-toolchain.toml`, the `sync-engine` compose service, every Rust CI job, and the sync-engine image publish step;
   - `packages/graph/src/worker/**` except anything Stage 6 still imports (there should be nothing);
   - the re-export shims from Stage 3;
   - `packages/graph/src/sync/**` (the old relay client);
   - `services/api/src/auth/device-unlock.ts` and the per-workspace unlock secret (keep the device registry, revoke and retire);
   - `services/api/src/auth/sync-ticket.ts` if nothing in Stage 6 uses it;
   - the diagnostics pages under `apps/roster-web/src/app/*-diagnostics/`, `LockedShellGate`, and the `next.config.ts` aliases for them;
   - `services/api/browser-tests-device-store/`, its Playwright config and its root scripts;
   - the `pretest:sync-engine`, `test:sync-engine`, `stage5:opacity-fixtures`, `*device-store*` and `*worker-browser*` root scripts.
2. **Remove the temporary dual write** in `workspace.create` (Stage 2 item 6).
3. **Remove dependencies** `loro-crdt` and `shamir-secret-sharing`. Keep `wa-sqlite`, `canonicalize` and `zod`.
4. **Drizzle:** a migration dropping the `device_unlock_secret` table and any other table that only the deleted code used. List each one in the report.
5. **CI**, per VPS-A007: the fast lane runs `pnpm verify`; the slow lane runs `pnpm verify:full` plus the Stage 6 Playwright suite and the existing auth browser suite. Add the gates:
   - audience conformance
   - publication allowlist
   - shape proxy tests
   - the no-protected-data-on-device browser test
   - the arch-check rules from Stages 2, 4 and 5
6. **FDN-54 adversarial suite** — `services/api/src/test/adversarial/`, covering:
   - a forged `mutation_id` replay;
   - a principal supplied in client input (must be ignored);
   - client-supplied shape parameters;
   - a Tier 1 value requested by a demoted member mid-session;
   - a stale transition after reconnect;
   - an audit-append failure;
   - decryption attempted from a non-allowed module (arch-check).
7. **Documentation:** rewrite `docs/Bootstrap.md` and `CONTRIBUTING.md` for the new stack (Node, pnpm, Docker; `pnpm stack:up` starts Postgres, Redis and Electric). Remove the `The archive` section's "removed from main by a tracked Linear issue" sentence from `CLAUDE.md`, and replace it with "Removed from main in Stage 7; preserved on `archive/local-first-e2e`."
8. **Findings:** recount the findings summary table programmatically, the way the file describes, and update the count paragraph.

**Done criteria:**
- `git grep -n -i -E "loro|sync-engine|sealed-store|shamir|tier1-envelope"` on `main` returns only historical documentation.
- No Rust files remain.
- `pnpm verify`, `pnpm verify:full` and the slow-lane suites pass locally.
- CI passes on the pushed branch.
- The adversarial suite passes.

**Gates:** the standard four, plus the Stage 6 Playwright suite and a green CI run on the branch (link it in the report).

---

## Part 4 — After Stage 7

Stop. The next brief will cover the feature-spec sweep (FDN-104) and the first Roster features, starting with the canonical Employee profile (RST-33), which unlocks Manager scope, subject exclusion and F130.

---

## Part 5 — What to do right now

Begin **Stage 1**. When its report is written and Linear is updated, stop and wait for the founder.
