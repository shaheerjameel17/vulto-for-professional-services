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
- **21 September 2026 — F206 closed.** The recommendation is accepted, with three additions. (1) `AuditEntry` gains `actor_kind` (`member` | `support` | `system`); `actor_user_id` and `actor_membership_id` stay required for `member`; `support` carries `actor_grant_id`; `system` carries `actor_system_name` from the closed enum. The journal table gains the same columns. **Correct the `AuditEntry` contract in VPS-F004 accordingly** — this is a founder-decided spec correction, recorded under F206. (2) A support scope is `{ access: "read" | "read-write", node_types: NodeType[] }`, evaluated against the same policy table as a member and capped at the scope, never above Owner. **A support principal may never write** `Workspace`, `WorkspaceMembership`, `User` or `AuditEntry`, never change roles, and never reach a Tier 3 type, whatever its scope lists. VPS-A008's "areas" means node types. (3) Each stage adds the system operations it builds: Stage 5 adds `key-rotation` and `erasure` key destruction; Stage 6 adds `audience-recompute`. Implement (1) and (2) on `stage-3-interceptor` before approval, with tests that a support principal and a system principal are each evaluated and produce correctly shaped audit entries. Mark F206 **Closed by founder-delegated decision, 21 September 2026**.
- **21 September 2026 — Stage 3 micro-decisions ruled on.**
  - **The audience materializer is not audited per evaluation.** It uses the side-effect-free `decide*` functions, and handles only Tier 0 rows, whose grants are not audited anyway. Recording "who may hold which row" is the audience table itself. No audit entries are written by the materializer. (This closes the question Stage 3 left for Stage 6.)
  - **The Client ownership disagreement** between VPS-A002's ownership table and VPS-F008's policy table must be recorded as its own finding, closed with the reading you applied (F008 governs: not applicable), and listed for the FDN-104 spec sweep. A spec disagreement is never only a micro-decision.
  - The other Stage 3 micro-decisions are accepted as written.
- **21 September 2026 — F208 closed.** Declare `governingPartitions: { Employee: "operational" }` on **both** `managed_by` and `scoped_to_entity`, matching `assignment_of` and `has_skill`. A reporting line and an employing entity are operational HR facts, not compensation, so whoever may write an Employee's operational half may move them. Record the declaration in VPS-A002's `governingPartitions` table with that one-line rationale, flip `itF208` to `it`, and mark F208 **Closed by founder-delegated decision, 21 September 2026**.
- **21 September 2026 — missing schema-version header.** Refusing a request with no `x-vulto-schema-version` header as `client-outdated` is **accepted** (fail closed). Stage 6's sync client and every tRPC client in `apps/` must always send the header; add that to Stage 6's client work and test it.
- **21 September 2026 — F125 stays open** with the current behavior: a backdated `managed_by` move is refused as `invalid-args`. VRS-F037 decides backdating when the org chart is built.
- **21 September 2026 — F209 closed.** The recommendation is accepted, with one addition. Add event type `CryptographicErasureExecuted`, operation `KeyDestroy`, and a closed target `{ erasure_domain_id, tier, destroyed_key_count, erasure_request_id: uuid | null }`, written only by the `erasure` system principal, in the same transaction as the key destruction. `erasure_request_id` is `null` until VPS-F007's ErasureRequest exists, and then it is required, so every erasure traces back to an approved request. Record the event in VPS-F004's vocabulary as a founder-decided correction under F209, replace the fail-closed seam with the real audit call, keep a test that a failed audit destroys no key, and mark F209 **Closed by founder-delegated decision, 21 September 2026**.
- **21 September 2026 — key provider has no default (Stage 5 review).** `createKeyProvider` must **not** default an unset `VULTO_KEY_PROVIDER` to `local`. An unset or empty value is a startup error in every environment, and `local` is refused unless `NODE_ENV` is `development` or `test` (not merely "not production"), so a production server missing `NODE_ENV` cannot silently fall back to the development key. Update `.env.example`, CI env and the tests accordingly.
- **21 September 2026 — noted, not required now.** KEK rotation (VPS-A003 "Rotation") has no issue yet; it is added to FDN-96's follow-up list rather than built in Stage 5. `protected.read` resolves each fragment's node and key one query at a time; that is acceptable at the 500-item cap and is revisited only if measured slow.
- **21 September 2026 — pushing.** The founder has allowed `git push` to `origin` for `main`, `stage-*`, `archive/local-first-e2e` and `fdn-68-audit-wip`. A refused push is still a STOP condition.
- **21 September 2026 — Stage 6 approved and merged (`961830d`). Stage 7 amendments:**
  - **F210 (device revoke survives).** Before dropping `device_unlock_secret` (item 4), create the control-plane table `device_workspace_revocation (workspace_id, device_id, revoked_at, revoked_by, reason)`, primary key `(workspace_id, device_id)`, identifiers only, never synced. Backfill it from `device_unlock_secret` in the same migration, repoint every revoke check (session path and shape proxy) to it, then drop the old table. A test proves a device revoked before the migration is still revoked after it. "Keep the device registry, revoke and retire" in item 1 includes this.
  - **F212 (retired browser job).** Delete the disabled `device-store-browser` job, its config and its suite together with the retired code. After Stage 7 no job in either lane may be disabled or skipped except `publish-artifacts` off `main`.
  - **Accessibility smoke pass restored.** Disabling `device-store-browser` in Stage 6 stopped the accessibility smoke pass. Stage 7 moves it into a live slow-lane suite (the auth browser suite or the sync suite) against the current pages, and it must pass in CI.
  - **Check the merge-commit run first.** Confirm the fast and slow lanes on `main` at `961830d` are green before branching. If red, stop and report.
  - **Device-side rules carried from Stage 6, not to be undone:** `vulto:device` survives sign-out and holds only the device id and the pending-erase list; the outbox is versioned separately from the cache and is never wiped by a version change; every client API request carries `x-vulto-workspace-id`, and a mismatch is refused with nothing applied.
- **22 September 2026 — Stage 7 approved (`bc55274`/`d749c3c` on `stage-7-retire`). Merge and follow-ups:**
  - **Verdict: approved for merge.** Read directly against the code, not just the report. Migration `0019` creates `device_workspace_revocation`, backfills it from `device_unlock_secret` joined to the most recent matching `device_trust_event`, then drops six retired tables, in that order, inside `drizzle-kit migrate`'s transaction. Its test builds a genuine pre-0019 schema, revokes devices the old way across two workspaces (including one revoked only in a second workspace, to prove workspace scoping survives too), migrates, and proves every revoked pair is still revoked and nothing unrevoked was swept in — exactly what F210 required. `git grep -n -i -E "loro|sync-engine|sealed-store|shamir|tier1-envelope"` returns only `CLAUDE.md`'s archive line and two historical comments in the migration; no `.rs` files are tracked; `loro-crdt` and `shamir-secret-sharing` are gone from every `package.json` and the lockfile; `sync-ticket.ts` and `device-unlock.ts` are deleted with no live references outside tests and historical comments. The slow lane has exactly the five jobs claimed, no `device-store-browser` job anywhere, and `publish-artifacts` is the only conditional one (pre-existing `continue-on-error`, `main`-only, unrelated to Stage 7). The accessibility smoke pass is a real, live gate against `/sign-in`, `/sign-up` and `/devices` with a shrink-only baseline. The FDN-54 adversarial suite has the seven cases and eleven tests claimed; cases 4 (mid-session demotion), 5 (stale transition) and 6 (an audit-append failure) were read in full and all three fail closed correctly. The findings recount was independently reproduced by parsing every `| F<n> |` row of `docs/Foundations_Findings.md`: 159 rows, F54–F213, one gap (F198), 143 closed, 10 open (F70, F71, F73, F85, F91, F118, F125, F129, F130, F213), 6 recorded — an exact match to the report. `CLAUDE.md`, `Bootstrap.md` and `CONTRIBUTING.md` read as described. `git diff --shortstat main...bc55274` is 198 files, +4,263, −48,484, matching the report exactly. `workspace.create`, `changeWorkspaceRole` and `revokeMembershipForActor` are each one `db.transaction`, with no device-side step, confirming the single-transaction claim.
  - **One question resolved, no finding needed.** `device.revoke` no longer gates `protected.read` or any tRPC mutation: `requireCurrentWorkspaceSession` (used by every `protectedProcedure`) carries no device id and never touches `device_workspace_revocation`; only the shape proxy reads it. Checked against `VPS-F001`'s own contract for `device.revoke` ("revokes this workspace's trust and erases this workspace's cache only") and G04 (the device cache holds Tier 0 only; revocation erases the cache) — this is the spec as written, not a gap introduced in Stage 7. Tier 1/2 access was never meant to be device-gated in the server-authoritative model; it is membership-gated and server-audited in `protected.read`, which is the correct control surface. No code change follows. Worth knowing for the founder: "Revoke" on the Devices screen only cuts a device's sync/cache trust to one workspace, not its session's API access — a stolen device with a live browser session is stopped by suspending the account or ending the session, not by device revoke. Consider a one-line clarification on that screen's copy when the Devices UI is next touched; not a Stage 7 blocker.
  - **F213 ruling — keep `member.projection_state`, close as a recorded simplification.** The column and its check constraint are vestigial (`revocation-pending` is declared in the check constraint and the type union but never written anywhere in `services/**` or `packages/**` outside tests and Drizzle snapshots — confirmed by direct grep), but removing it touches Better Auth's member model and every query that reads it, for a column with no functional cost today. Not worth Stage 7 risk. Mark F213 **Closed by founder-delegated decision, 22 September 2026 — `member.projection_state` and its check constraint stay; the column is dead in practice, not in the schema. Revisit during the FDN-104 spec sweep, not before.**
  - **Merge.** CI is green on `stage-7-retire` at `d749c3c` (run `35637057091`), and `main` was green at `961830d`/`4d91705` before branching (confirmed). Merge `stage-7-retire` into `main` with `--no-ff`. In the same pass on `main`: update F213's row in `docs/Foundations_Findings.md` to the ruling above and fold it into the next programmatic recount.
  - **CI image repin.** Once merged, `.docker/ci/**` changed, so the `ci-image` workflow republishes without Rust. Read the new digest from that run and repin `CI_IMAGE` in `.github/workflows/ci-image-ref.env`, per the report's section 10 and the existing repin procedure.
  - **Stop after that.** Part 4 stands: the next brief is the FDN-104 spec sweep and RST-33 (canonical Employee profile). Wait for "Stage 8 go" before starting either.
- **22 September 2026 — Stage 8 reviewed (`c733763` on `stage-8-employee-profile`). Rulings, merge and follow-ups:**
  - **Verdict: approved for merge**, once the fixes below land. Read directly against the code, not just the report. `rowScopeSatisfied` and `decideRead` in `services/api/src/permission/interceptor.ts` were read in full: subject exclusion is layered on top of the role-based outcome and correctly overrides a full/read grant when caller === subject, and correctly does nothing when the link or the subject can't be resolved (F215 a/b, below). `resolveReaderSet` resolves `own` from the real link and leaves every manager-derived scope unresolvable, which is harmless because `Employee:compensation`'s manager cell is `restricted`, not a grant, so Gate 3 never reaches it. `employeeLinkUser` enforces the bidirectional one-Employee-per-login uniqueness the report claims, checked in both directions. The `Employee` registry entry (`packages/schema/src/registry/nodes.ts`) is byte-for-byte unchanged from before Stage 8, confirmed with `git show`. `FEATURE_LIFECYCLE_NODE_TYPES` refuses `graph.createNode`, `graph.updateNodeFields` and `graph.transitionLifecycle` for `Employee` symmetrically on client and server, and the test at `employee.integration.test.ts` proves all three. The four F130 subject-exclusion tests were read in full, including one that asserts a literal sentinel string is absent from `protected.read`'s response to the excluded subject and present to everyone else — end-to-end proof, not an access-flag check. `transitionStatus` was read against its test: the status table is enforced server-side (Active↔Inactive requires `end_date`, `Converted` is terminal), and a stale `expected_version` is reported as `stale-state` ahead of transition validation, exactly as the code comment says it must be. The import-equivalence test was read in full: an imported row and a manually created one produce identical canonical records (case-normalized email, coerced numeric fields, same lifecycle status, same `scoped_to_entity` edge), and one malformed row is rejected without harming the batch. `VPS-D004`'s F214 marker is present exactly as described, and the section's original body is otherwise untouched. The findings recount was independently reproduced by parsing every `| F<n> |` row: 161 rows, F54–F215, one gap (F198), 146 closed, 9 open — an exact match to the report. The mutation-testing pass/fail counts in the report (removing subject exclusion fails 2 tests, `direct-reports` never satisfied fails 3, `own` never satisfied fails 2, `own-plus-team` satisfied for anyone fails 5) were not independently re-run — running them would mean breaking the code and re-running the suite on the linked machine, which has no `pnpm` available in this session — but they are consistent with the actual test bodies at lines 483, 500, 519, 540 (exclusion), 582, 670, 685 (direct-reports) and 622, 685 (own) read in full, and are accepted on that basis.
  - **F130 — closure confirmed.** The report's claim is correct: `decideRead` now applies the exclusion for every node type that registers one, feeding the interceptor, `protected.read` and the sync audience from the one decision, as A004-T16 requires. No further action.
  - **F215 — all three decisions confirmed as written.** (a) A login with no linked Employee record is not treated as the subject of anything — correct, because denying access whenever the link can't be resolved would blind an Owner to every case, including ones about people other than themselves, for a data-completeness reason that has nothing to do with who the case concerns; not excluding is the conservative direction here, since it grants nothing beyond the existing role-based grant. (b) A case with no recorded subject excludes no one — correct, since the write gate already refuses a subject-less case, so this is unreachable in practice and, if it were ever reached by a data defect, still leaves HRCase gated at the role level. (c) `own-plus-team` means "shares my active manager" — accepted as the definition going forward. One follow-up: `VPS-A004_Graph_Permission_Layer.md`'s own matrix is where `Read (own + team)` is written (line 128 and 159) and "team" is not defined anywhere in that document — checked directly, there is no definition to conflict with, only a gap. Add one sentence to `VPS-A004`, next to the matrix or in Role definitions, stating the definition this finding settled: team member scope's "team" means "shares the caller's active manager, derived the same way Manager status is (`VPS-F001` G06)." Cite F215. This is a documentation fix only, no code change, and belongs in this same pass.
  - **F214 — the design is ruled, the shell is not built yet.** The proposed replacement is accepted as written: one `Reconnect` state, triggered only by `401`/`UNAUTHORIZED` on an authenticated call or `access-revoked` from the shape proxy, never by a network failure, timeout, 5xx or rate limit; full-bleed, no illustration, one `Retry` that re-issues the failed call and says why nothing else. Both tradeoffs are decided as recommended: **tradeoff 1** — a call carrying no session at all (never authenticated on this device, or already signed out) goes to sign-in, not `Reconnect`; `Reconnect` is reserved for a call that had a session and was refused. This does not weaken non-enumeration: within the "had a session, got refused" bucket, an expired session and a revoked one still render identically, which is the actual guarantee F148 protects. Whether a device ever had a session in the first place is not information about any workspace or person — every never-authenticated visitor gets the same sign-in screen regardless of what happened to anyone else. **Tradeoff 4** — nothing is erased on a plain `401`; cached rows stay until a call succeeds or the person signs out. Accepted, and only because it is scoped to what the cache can ever hold: Tier 0 only, by the tier system's own design, so an expired session sitting on a shared device exposes nothing beyond what that design already decided is safe to leave there. If a future stage ever widens what the device cache holds, this decision must be revisited — record that as a note next to the ruling, not as an open question now. Tradeoffs 2 and 3 are accepted as stated, unchanged from the proposal. **Implement the design in `VPS-D004` now**: replace the "Locked shell" section's body with the Trigger / Rendering / What Retry does / Data / Kept / Removed structure from the F214 write-up (adapted to the document's own voice), remove the F214 marker blockquote, and update the Decisions Recorded entry to record the ruling and this date rather than pointing at an open question. **Do not build the `Reconnect` component, the tRPC/shape-proxy wiring, or its tests in this pass.** Stage 8 touched no `apps/` code, and a first client shell feature — with its own browser test proving cold-start and mid-session render identically and that Retry behaves correctly — deserves its own reviewed stage rather than being folded into this merge. Name it **Stage 9 — the Reconnect shell state** in `docs/Reviewer_Handoff.md`'s follow-ups; it is briefed separately once "Stage 9 go" is given. Mark F214 **Closed by founder-delegated decision, 22 September 2026 — one `Reconnect` state, non-enumerating, `401`/`access-revoked` only; missing-session routes to sign-in; no erase on a plain `401`, scoped to Tier 0. `VPS-D004` corrected to match. Build tracked separately as Stage 9.**
  - **Merge.** Confirm CI is green on `stage-8-employee-profile` at its current head (and that `main` was green before branching, as it was at Stage 7's merge). Apply the `VPS-D004` and `VPS-A004` doc fixes above, update F214's and F215's rows in `docs/Foundations_Findings.md`'s status table to the rulings above, and fold both into the next programmatic recount (161 rows becomes 160 open-minus-one: 147 closed, 8 open — F70, F71, F73, F85, F91, F118, F125, F129 — recount it programmatically, do not hand-count). Merge `stage-8-employee-profile` into `main` with `--no-ff`.
  - **Linear.** Move `RST-33` to Done — its own done criteria (canonical record, validated relationships, history-preserving lifecycle, protected fields, import/manual equivalence) are each verified above. Leave `FDN-104` **in progress, not Done** — this was its priority slice only (`VPS-D004`, `VPS-F004`, `VPS-F002`, `VPS-A002`'s `Client` row, `VRS-F002`); 39 of its 44 affected specs are still uncorrected and are scoped for just-in-time correction ahead of their own features, per FDN-104's own text. Add a comment on `FDN-104` noting the priority slice is complete and pointing at this stage's commits.
- **22 September 2026 — F216 ruled; Stage 9 redefined, original Reconnect brief renumbered Stage 10.** The Stage 9 (Reconnect) brief went to OpenAI Codex this round, a fresh session against the same repo, not Claude Code — the loop is agent-agnostic (see `Reviewer_Handoff.md` section 1). Codex traced the brief before writing UI and stopped with F216 rather than inventing a bootstrap design locally, which is the correct call under this project's decision policy. Verified directly: `apps/roster-web/src/app/(shell)/layout.tsx` wraps only the fixture `Shell.tsx`, which hardcodes `workspaceName="Northgate Studio"` and `syncStatus="Synced"` as literals; `createGraphClient` is mounted nowhere but `/sync-harness`; `authClient.useSession()` appears only on `/auth-ready` and `/devices`, outside the shell, and `/auth-ready`'s own copy says workspace access stays closed until the server confirms the membership projection; `SyncEngine.#handleRevoked` stops every source and publishes `signedOut: true` before any retry could reuse that worker. Every screen under `(shell)/` renders from fixtures (`EMPLOYEES`, a fixed viewer, a client-side `canSeeCompensation()` helper unrelated to the real interceptor). This is `FDN-69`'s scope — the shared shell and workspace bootstrap — never built, sitting in Backlog since before Stage 1; Reconnect assumed it already existed.
  - **The ruling is not invented from scratch — it's already half-built server-side.** `services/api/src/auth/config.ts` already configures Better Auth's `organization()` plugin; the session already carries `activeOrganizationId`, and `services/api/src/auth/workspace-session.ts` already clears it to `null` on revocation — `requireCurrentWorkspaceSession` already treats it as the workspace claim. The only gap is client-side: `apps/roster-web/src/lib/auth-client.ts` never added `organizationClient()`, so nothing in the shell can read what the server already tracks.
  - **Founder's sequencing call.** Given three options (a minimal real bootstrap now; deferring shell-wiring and continuing the backend-only `VRS-001` order; or a full `FDN-69` migration of every fixture screen in one pass), the founder chose the minimal bootstrap. Stage 9 becomes that: authenticate, resolve the workspace via `activeOrganizationId`, mount the real graph client, replace `Shell.tsx`'s fixture props with real state, keep offline cold start working from `session_hint` with no network call, and surface (not render) a `401`/`access-revoked` at the shell boundary. No fixture screen (Home, People, Timesheets, Foundations) is touched — that migration is explicitly out of scope and not yet briefed as its own stage.
  - **The original Reconnect brief is unchanged in substance and renumbered Stage 10**, now depending on Stage 9's exposed refusal signal and bootstrap re-invocation (Retry, once `access-revoked` has stopped a client, means re-running the bootstrap from scratch — there is nothing left inside a stopped client to retry). `FDN-114` (Codex's issue) stays Stage 10's; it already carries the F216 discovery and the blocked report.
  - **F216 marked Closed by founder-delegated decision, 22 September 2026** — the shell bootstrap contract above, with Stage 9/10 as its build. Findings table and recount updated (162 rows, F54–F216, 148 closed, 8 open).
  - **Branch state.** `stage-9-reconnect-shell` is pushed and holds only the F216 discovery commits and the blocked stage report — no Reconnect or bootstrap code. Start Stage 9 from a **new** branch off `main` (`stage-9-shell-bootstrap` or similar); don't build the bootstrap on top of the old branch's name, since Stage 9 and Stage 10 are now different, separately-reviewed stages.
- **22 September 2026 — F217 ruled; the Stage 9 brief updated in place.** A first Stage 9 attempt (Codex, `stage-9-shell-bootstrap`, abandoned) traced F216's ruling against the live workspace lifecycle before writing code and stopped correctly: `session.activeOrganizationId` is read correctly per F216, but nothing populates it. Verified directly: `createWorkspace` → `createPendingWorkspaceAdmission` → `confirmWorkspaceAdmission` never touches the field; the only production write to it anywhere is the revocation path's clear-to-null. Offline, each `(workspace, user)` pair has its own cache with no marker of which was last active, and `device-identity.ts`'s database is deliberately, test-enforced narrow (device id and pending-erase names only) — not a place to add one without reopening that contract. F216's ruling should have checked this and didn't; that gap is this review's, not the builder's.
  - **Ruling.** `confirmWorkspaceAdmission` sets `session.activeOrganizationId` in its existing transaction, only when the confirmed membership is the person's sole active one — mirroring how `revokeWorkspaceAdmission` already checks membership state. A person already active in one workspace who creates or joins a second is never auto-switched. A null active organization with exactly one active membership resolves to it (no real ambiguity); with more than one, or none, the shell must not guess — a minimal holding state, distinct from F214's `Reconnect`, covers it until workspace switching (already tracked as undesigned) is built. Offline, the identical rule: exactly one cached workspace boots from it; more than one requires coming online. `F217` closed.
  - **The Stage 9 section in Part 3 is updated in place** with these two additions (its point 2 and point 4) rather than kept as a separate amendment to reconcile later — read Part 3 directly, not this bullet, when building.
  - **Branch state.** `stage-9-shell-bootstrap` is pushed and holds only the F217 discovery and blocked report — no bootstrap code. Start Stage 9 from a fresh branch off `main` again (a third name, e.g. `stage-9-shell-bootstrap-v2`), same as the Stage 9/10 split did for the Reconnect branch.
  - **Stop after that.** Wait for "Stage 9 go" (the real shell bootstrap, now covering both F216 and F217) before starting either Stage 9 or Stage 10.
- **22 September 2026 — F218 ruled; the Stage 9 brief updated in place again.** A second Stage 9 attempt (Codex, `stage-9-shell-bootstrap-v2`, abandoned) stopped correctly before writing code: the F217-updated brief's point 1 ("no data after `isPending` clears" unconditionally means sign in) and point 4 (a cold offline boot must mount from cache with no network call) both fire on the same event — a cold offline load also resolves `useSession()` to "no data" — and the brief never said which wins. Verified directly against the pinned client: Better Auth's session atom (`session-atom.mjs`, 1.6.29) sets `data: null` with a structured `error` (a `BetterFetchError`, always carrying a numeric `.status`) when `/get-session` reaches the server — this covers both a genuine no-session answer (`error: null`) and any HTTP-level failure — and sets `data: null` with an *unstructured* error (whatever the fetch layer itself threw; never a `BetterFetchError`, no numeric `.status`) only when the request never reaches the server at all. That is exactly the offline case, and it is distinguishable from a confirmed no-session answer by checking whether `error` carries a numeric `.status`. The sync engine already makes this same split for the same reason (`engine.ts`'s `failure.kind === "network"` vs `"unauthenticated"`).
  - **Ruling.** Point 1 fires only on a confirmed answer: `data` null and `error` either `null` or carrying a numeric `.status`. An `error` present without one is indeterminate — the request never reached the server — and falls through to point 4 instead of sign-in. Point 4 is extended to cover the case its wording didn't anticipate: when point 1 couldn't resolve at all, there is no `user.id` to filter cached workspaces by, so enumerate every `vulto:<workspaceId>:<userId>` cache on the device unfiltered; the same one-cache-mounts, more-than-one-requires-online rule applies regardless of whether "more than one" means two workspaces for one person or two people sharing the device. `F218` closed.
  - **The Stage 9 section in Part 3 is updated in place** with these changes to points 1 and 4, plus matching updates to Done criteria and Gates, rather than kept as a separate amendment to reconcile later — read Part 3 directly, not this bullet, when building.
  - **Branch state.** `stage-9-shell-bootstrap-v2` is pushed and holds only the F218 discovery and blocked report — no bootstrap code. Start Stage 9 from a fresh branch off `main` again (a fourth name, e.g. `stage-9-shell-bootstrap-v3`).
  - **Stop after that.** Wait for "Stage 9 go" (the real shell bootstrap, now covering F216, F217 and F218) before starting either Stage 9 or Stage 10.
- **22 September 2026 — F219 ruled; Stage 9 continues on its existing branch, not a new one.** A third Stage 9 attempt (Codex, `stage-9-shell-bootstrap-v3`, FDN-117, in progress) implemented the F216/F217/F218-corrected brief and, for the first time, actually exercised it in a real browser — and stopped correctly on a gap only real execution surfaces: point 3's `organizationClient()` design calls Better Auth's `organization.list()`/`listMembers()`, and `services/api/src/auth/http.ts` returns 404 for every `/api/auth/organization/*` path, reads included, by deliberate design (FDN-85/FDN-86's "no second write path" boundary, stated in the route's own comment). A real single-membership browser test reached the 404 and stayed stuck in the unresolved holding state that's supposed to be point-3's unambiguous case.
  - **Ruling.** No `/api/auth/organization/*` route opens, for reads or writes — that boundary is correct as built. One new route instead: `POST /workspace/list-active-memberships` in `services/api/src/auth/http.ts`, session-gated with no workspace scope (mirrors the existing `/devices/retire`), returning `{ workspaceId, workspaceName }` for the caller's `active`/`confirmed` memberships only — the exact predicate `requireCurrentWorkspaceSession` and `confirmWorkspaceAdmission` already use, so nothing new is invented, and Better Auth's own `member.status` values (`pending`/`active`/`revoked` sit directly on the row the closed plugin would have read) are never surfaced unfiltered. `F219` closed. `VPS-F001`'s "Workspace admission control" section gets one new bullet recording the boundary and the one exception, so the route's code comment isn't the only place this is written down.
  - **The Stage 9 section in Part 3 is updated in place** — point 3 replaces `organizationClient()` with the new route — rather than kept as a separate amendment to reconcile later.
  - **Branch state — do not restart.** Unlike F216/F217/F218, this finding does not invalidate the branch it was found on. `stage-9-shell-bootstrap-v3`'s preliminary work — the F218 `hasServerAnswer` split, the offline cached-workspace fallback, the graph client construction, the refusal-signal wiring in `Shell.tsx`/`layout.tsx`, the `packages/graph/src/sync-client/*` changes — is sound and was read directly, not just reported. Only `auth-client.ts`'s `organizationClient()` import and the preliminary `soleActiveWorkspace` function's Better-Auth calls need replacing with a call to the new route. Continue on `stage-9-shell-bootstrap-v3`, `FDN-117` stays In Progress.
  - **Stop after that.** Wait for "Stage 9 go" (the real shell bootstrap, now covering F216, F217, F218 and F219) before merging Stage 9 or starting Stage 10.
- **22 September 2026 — F220 ruled; Stage 9 continues on the same branch a second time.** Still on `stage-9-shell-bootstrap-v3`, FDN-117, after applying the F219 fix (its route works, server test 45/45), the browser test that was failing on F219 still failed: the resolved workspace name never rendered. F219's route correctly names the sole active workspace, but nothing made that name the server's actual active-session claim — `/devices/register` still rejected the workspace header with 403, `trpc.ts`'s context builder still returned `principal: null`, both because `session.activeOrganizationId` was still `null`. Checked directly: `confirmWorkspaceAdmission` (F217's fix) is the *only* production write to that field for the ordinary case, and it fires once, at confirmation — it cannot reach a session created afterward. A fresh sign-in on a new device or browser, for someone already an active confirmed member, gets a brand-new session row at the column's `null` default, and nothing before this ruling ever gave it a way forward. This is not a rare edge case — it is the ordinary state of every fresh sign-in for an already-confirmed single-workspace person.
  - **Ruling.** A second new route, `POST /workspace/activate-sole-membership`, beside F219's route in `services/api/src/auth/http.ts`: session-gated, no request body, trusts nothing the client asserts — it re-derives the caller's active/confirmed memberships itself. Exactly one → the identical write `confirmWorkspaceAdmission` already performs (`update(session).set({ activeOrganizationId })`, filtered by that user's id, covering every session row they hold), returning `{ workspaceId }`. Zero or more than one → writes nothing, returns `{ workspaceId: null }` — the same "unresolved" state point 3 already defines, not a new error shape. It only ever writes from `null`; an already-set `activeOrganizationId` is never its target, so this cannot become a hidden workspace-switcher. `F220` closed. `VPS-F001` gets one more clause naming both F219's and F220's routes together as the session's active-organization boundary.
  - **The Stage 9 section in Part 3 is updated in place** — point 3 now calls both new routes in sequence before constructing the graph client — rather than kept as a separate amendment to reconcile later.
  - **Branch state — still no restart.** Same as F219: `stage-9-shell-bootstrap-v3`'s preliminary work (the F218 split, offline fallback, graph client construction, refusal-signal wiring, sync-client changes, and now the F219 list route with its passing test) is sound and untouched by this finding. Only the missing activation call and its route need adding. Continue on `stage-9-shell-bootstrap-v3`, `FDN-117` stays In Progress.
  - **Stop after that.** Wait for "Stage 9 go" (the real shell bootstrap, now covering F216 through F220) before merging Stage 9 or starting Stage 10.
- **22 September 2026 — Stage 9 completion report reviewed and approved for merge.** `stage-9-shell-bootstrap-v3` at `08e2873` (FDN-117, In Review) was read directly against the code, not just the report. Both new routes (F219, F220), `auth-client.ts`, `shell-bootstrap.tsx`'s full boot sequence, the `packages/graph/src/sync-client` refusal-signal wiring (`engine.ts`, `host.ts`, `client.ts`, `protocol.ts`, `status.ts`), `Shell.tsx`/`(shell)/layout.tsx`'s final diffs, all eight browser tests in `shell-bootstrap.spec.ts`, and the key `auth.integration.test.ts` tests were each read in full and match the ruled contract exactly; the two new routes exceed the minimal requirement (transactional, row-locked, belt-and-suspenders `isNull` guard). The non-doc diff is 13 files with no fixture screen among them. The findings recount was independently reproduced against this branch's own `docs/Foundations_Findings.md`: 166 rows, F54–F220, one gap (F198), 152 closed, 8 open, 6 recorded — an exact match. No discrepancy found. **Verdict: approved for merge, no further findings.**
  - **Merge.** `--no-ff` merge `stage-9-shell-bootstrap-v3` into `main`, push both. Move `FDN-117` to Done. Update `docs/Reviewer_Handoff.md`'s Stage status table (section 5) with the merge commit.
  - **Proceed straight into Stage 10** — already briefed below, and in `Reviewer_Handoff.md` section 10 — on the merged `main`. No further "go" is needed for Stage 10 specifically; it was unblocked the moment Stage 9 was approved.
  - **Full brief in Part 3 below reflects the final, F220-updated Stage 9 contract** — read it directly if anything here is ambiguous, don't reconstruct it from this amendment.
- **22 September 2026 — Stage 9 merged (`5a0e9ee`); Stage 10 completion report reviewed and approved for merge.** `stage-10-reconnect-shell` at `cf59ed5` (FDN-114, In Review) was read directly against the code: `ReconnectState.tsx`'s copy matches `VPS-D004` byte-for-byte; `Shell.tsx` gates the whole tree on `state.refusal`; `shell-bootstrap.tsx`'s Retry re-runs the full Stage 9 bootstrap and correctly guards against an unrelated session auto-refresh redirecting to sign-in mid-Reconnect, and against a refetch/attempt race stranding the shell on its holding copy; `host.ts`'s new `notifyOnline()` call on re-init correctly restarts an `unauthorized` source that `engine.ts` deliberately gives no restart timer, distinct from the existing `access-revoked` teardown path. All eight browser tests in `reconnect.spec.ts` were read in full, including a literal byte-for-byte `outerHTML` comparison proving cold-start and mid-session render identically. Exactly 8 files touched, no fixture screen among them, no finding or spec correction needed. **Verdict: approved for merge, no further findings.**
  - **Merge.** `--no-ff` merge `stage-10-reconnect-shell` into `main`, push both. Move `FDN-114` to Done. Update `docs/Reviewer_Handoff.md`'s Stage status table (section 5) with the merge commit.
  - **Housekeeping, now that Codex has full permissions on this machine:** delete the two stray, locked worktrees left over from earlier reviewer sessions (`.wt-stage9-check`, `.wt-f218-main`, both at the repo root) with `git worktree remove --force` for each, followed by `git worktree prune`; and remove the untracked leftover file `docs/stage-reports/STAGE-9_Reconnect_Shell.md` (from an old, abandoned Stage 9 attempt, not part of any branch's current history) with `git clean -fd -- docs/stage-reports/STAGE-9_Reconnect_Shell.md`. Confirm `git status --short` is clean afterward and mention in the next report if anything unexpected turned up.
  - **Stop after that.** Both Stage 9 and Stage 10 are done. The next brief (the FDN-104 spec sweep's next feature, per `Reviewer_Handoff.md` section 11 — VRS-F003 or VRS-F004 in the prior MVP order) waits for the founder's go, same as every stage boundary.
- **22 September 2026 — Stage 11 briefed: Multi-Entity and Jurisdiction Foundation (`VRS-F003`), F221 and F222 ruled.** `VRS-001`'s Feature Register settles the MVP-order question left open above: `VRS-F003` sits at position three, directly after `VRS-F002` (RST-33, built), and before `VRS-F004`. Checked directly against the code before writing this brief: `Entity`, `scoped_to_entity` and Entity's ownership row are already fully registered (`packages/schema/src/registry/{nodes,edges,ownership}.ts`) — nothing schema-level is missing — but no mutation, no permission-matrix row, and no bootstrap path exists anywhere; `VRS-F002`'s own `employeeCreate` already requires a valid `entity_id` and would reject on a workspace with none. Two findings surfaced while confirming the brief and are both ruled the same day (full reasoning in `docs/Foundations_Findings.md`; `VRS-F003`'s own text corrected to match): **F221** — Entity transfer is not a `VPS-F004`-audited event; `scoped_to_entity`'s own edge history already records every transfer, actor and timing, and `VPS-F004`'s closed, access-focused `event_type` taxonomy is not extended for it. **F222** — no code path creates a workspace's first Entity (`VPS-F006`, the spec's stated source, is not built); `services/api/src/graph/founding.ts`'s `writeFoundingRecords` gains a sixth founding record — a default Entity named after the workspace, `jurisdiction: "Global"`, `default_currency: "USD"` — so G04 holds from workspace creation onward without waiting on `VPS-F006`.
  - **Full brief below (Part 3, new Stage 11 section).** Server-side only, following Stage 8's own precedent exactly — Stage 8 (`VRS-F002`) touched no `apps/` code, and this stage doesn't either. The Entities screen (`VPS-F005`'s host) and the entity selector on the Employee profile both wait for the fixture-migration work already on the follow-up list, rather than being built piecemeal ahead of it.
  - **File a Linear issue for this stage** before starting, same convention as every prior stage (`FDN-118` is the next number as of this writing; confirm before filing in case another issue landed first).
  - **Stop after that.** Wait for the founder's go before starting Stage 11.
- **22 September 2026 — Stage 11 correctly stopped once before any code, on F223; now ruled and unblocked.** Tracing the brief before implementation (`FDN-118`), the builder found that `entity.deactivate(entityId)`'s stated contract left two things undefined: which field deactivation changes (`VRS-F003` listed both `is_active` and `lifecycle_status: Active | Dissolved`) and how it carries the caller's base version, which `VPS-A003` A003-T54 requires of every state-transition mutation. That is a real gap — `VRS-F003` never resolved it — and stopping before writing code was correct. **F223, ruled and closed the same day:** `is_active` is dropped from Entity's schema (a `featureOwnedLifecycle`-convention leftover; Entity is `fixedLifecycle`, like `VRS-F004`'s WorkingCalendar/Holiday/WorkingPattern, which carry `lifecycle_status` alone). Deactivation transitions `lifecycle_status` from `Active` to `Dissolved`. `Entity` joins `packages/schema/src/mutations/employee.ts`'s `FEATURE_LIFECYCLE_NODE_TYPES` alongside `Employee`, so the generic `graph.transitionLifecycle` correctly refuses it; `entity.deactivate`'s corrected signature is `entity.deactivate(entityId, expectedVersion)`, checking the version first (`stale-state`, A003-T54) and only then G04/G05 — exactly `employee.transitionStatus`'s own pattern. Full reasoning in `docs/Foundations_Findings.md`; `VRS-F003` and the Stage 11 section below are both corrected to match.
  - **Resume Stage 11** on the corrected brief below. No other part of the brief changes.
- **22 September 2026 — Stage 11 stopped a second time before optimistic mutators, on F224; now ruled and unblocked.** Implementing the brief, the builder found that the four new mutations live in the shared `packages/schema/src/mutations/foundation.ts` registry `packages/graph` also consumes, and `OPTIMISTIC_MUTATORS`'s exhaustive type requires a client handler for every registered name — `pnpm verify` fails typecheck without one for each. `employee.setEntity`'s handler needs to find and close the device's currently-open `scoped_to_entity` edge, which the builder read as a second direct traversal G06 forbids outside `entity.resolveForEmployee`. That is a real, if narrower, gap — the brief specified the server-side resolver but never the client optimistic halves. **F224, ruled and closed the same day:** G06 protects `entity.resolveForEmployee`'s *temporal* (`asOf`-based) resolution only; it does not reach the mechanical, non-temporal "find the one currently-open edge" lookup a single-active-edge-with-history mutation's own optimistic half must perform on its own state — already precedented by `org.moveEmployee`'s existing optimistic mutator for `managed_by`, with no comparable restriction. `entity.create`/`entity.update` get ordinary node-write optimistic handlers; `employee.setEntity`'s handler closes the open edge and reopens a new one via the already-shared `moveEmployeeEdgeId`; `entity.deactivate`'s handler checks only `expected_version` and leaves G04/G05's workspace-wide counts to the server, relying on the sync outbox's existing rejection/undo path rather than replicating them client-side. Full reasoning in `docs/Foundations_Findings.md`; `VRS-F003`'s G06 and the Stage 11 section below are both corrected to match.
  - **Resume Stage 11** on the corrected brief below (new Do item 7). No other part of the brief changes.

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

### Stage 8 — Spec sweep (priority slice) and the canonical Employee profile

**Linear:** FDN-104 (the priority slice below only — not all 44 specs, per FDN-104's own "not in one large pass"), RST-33.
**Branch:** `stage-8-employee-profile`

**Do:**

1. **Correct `VPS-D004` (Application Shell Navigation and System States) first — everything else in this slice, and RST-33 itself, renders through it.**
   - **The "Locked shell" section describes retired architecture, not a wording fix.** It gates on "the local store... stays sealed until a server-authorized online unlock succeeds" (F106), with Cold-start and Mid-session variants keyed to a role-refresh checkpoint (F127) sealing a live Worker store. None of that exists after Stage 7: there is no local store to seal, no unlock endpoint, no Worker. Read the whole section before touching it. **This is a design question, not a find-and-replace — raise it as a numbered finding with your recommended replacement; do not decide it unilaterally.** The replacement must preserve the property the old design protected: a denied session and an unreachable server render identically (non-enumeration, per F148) — `requireCurrentWorkspaceSession`'s `UnauthorizedWorkspaceSessionError` still does not distinguish "no session," "wrong workspace" or "revoked membership," so the client still cannot either. A plausible shape: one full-bleed "reconnect" state triggered by any `401`/`UNAUTHORIZED` response, same Retry action, same refusal to say why — propose it with the tradeoffs, don't assume it's right.
   - **The "Aged out — Fetch" state no longer describes what happens.** It reads "data outside the local retention window... present on the server, simply not cached here," dashed border, a **Fetch** action, "remains locally cached for the retention period" afterward. Tier 1 and Tier 2 data is never cached on a device at all now — every render of a protected field is a live `protected.read` call, not a cache-age question. Correct this to a `requires-connection` state with a **Retry** action (FDN-104's own wording), shown whenever a protected field's fetch is pending or has failed for lack of connectivity, with no claim about caching once it succeeds. Update the state-comparison table at the end of the section.
   - Leave Syncing and Restricted alone — they describe the audience-filtered Electric cache and the permission interceptor, both unchanged by Stage 7.

2. **Correct `VPS-F004` (Silent Audit Log).** Its core design — append-only, every denial at every tier, every successful Tier 1/3 access, excluded from search — is architecture-agnostic and stays. Remove the "entries older than the local retention window are not materialized on device... render as the aged-out state and fetch on demand" language (two places): audit history was never Tier 0, so it was never eligible for the local cache under the current architecture either. State instead that reviewing Tier 1/3 access history is always a server call, gated the same way the record itself is, rendering through whatever item 1's ruling produces.

3. **Correct `VPS-F002` (Local-First Search).** It claims to index "every nameable entity in the graph entirely from the local index with no network round-trip." Per FDN-104: scope the always-local, always-offline guarantee to Tier 0 entities only — what the device cache actually holds. A query that could match a Tier 1/2/3 entity is a server-backed search call: slower, online-only, itself an access the interceptor and (where the matched type is Tier 1/3) the audit log govern, and it degrades on item 1's `requires-connection` state when offline. `AuditEntry`'s total exclusion from the index (G07) is unaffected. Re-read the whole document — the "no spinner, no *searching* state, no difference the user can perceive" framing is only true for Tier 0 now and needs qualifying everywhere it appears, not once.

4. **Correct `VPS-A002`'s Client ownership row**, per F207's closure: reconcile the Cross-Suite Node Ownership table's `Client` row with `VPS-F008`'s "not applicable" so the two tables state one answer. This is the only outstanding correction in `VPS-A002` — the rest is already updated for F199 (`managed_by`'s single-writer mutation, the retired-Loro history, the deprecated retention-window field are all already correct; do not re-touch them).

5. **Correct `VRS-F002` (Atomic Employee Profiles).** It is written throughout as writing to "the local store" first and syncing outward, with client-side validation ("rejected before reaching the local store") and a Tier 1 "local wipe" on offboarding. Correct to: a named server mutation is the only writer (per `VPS-A002`'s already-updated rule); status-transition validation happens server-side before the mutation commits; Tier 0 fields then reach the device cache through the ordinary Electric shape sync, so the 200ms-offline-directory claim stays true, scoped explicitly to the Tier 0 half; Tier 1 (`base_compensation_amount` and the rest) was never on a device, so offboarding's "Tier 1 access revoked" step is the `device_workspace_revocation`/audience-recompute machinery Stage 6/7 already built, not a wipe. Update each corrected clause's Decisions Recorded section with a pointer to F199 — don't silently reword the body text.

6. **Implement RST-33 on the corrected specs.**
   - Register `Employee` as a real node type in `packages/schema/src/registry.ts`: the Tier 0 identifying half and the Tier 1 compensation half, exactly as `VPS-A002` already documents them (it uses Employee as its running example for the tier-split pattern throughout — read that document's Employee entries directly rather than re-deriving the field list). Both halves' privacy classes and the tier split are already specified; this stage wires the registry entry, it does not redesign the schema.
   - Named mutations for create, update, and the lifecycle transition (Active → Inactive → Converted, `VRS-F002` G06's transition table, validated server-side per item 5). Employee is tier-split, so update needs its own named mutations, not `graph.updateNodeFields` — Stage 4's rule restricts the generic mutations to Tier-0-only node types.
   - Relationships: `managed_by` already carries `governingPartitions: { Employee: "operational" }` from F208's closure — confirm the mutation that moves a report honors it; don't re-decide it. `scoped_to_entity` the same way. Link to `User`/`WorkspaceMembership` for workspace, role and identity rather than duplicating those facts on Employee.
   - Wire `services/api/src/permission/employee-link.ts`'s `resolveEmployeeForUser` to a real lookup. Its two callers (`reader-set.ts`'s subject exclusion, `roles.ts`'s Manager derivation) already treat `null` as "cannot tell, resolve conservatively" and need no changes themselves — once this returns a real Employee id, both go live for the first time. This is exactly the kind of seam this project's review process has caught before (Stage 2/3's membership-graph gap, Stage 4's generic-mutation leak): write paired tests proving subject exclusion actually excludes the subject now, and a Manager's derived scope actually widens to their reports and nowhere else — not only that the code compiles with a non-null id.
   - Permission-aware typed queries for view/directory: Tier 0 fields through the ordinary graph read path, Tier 1 fields through `protected.read`, both filtered by the reader-set logic subject exclusion now participates in.
   - Import and manual creation must produce equivalent canonical records (RST-33's own done criterion). If `VPS-F006` (Workspace Setup and Data Import) isn't corrected yet, route its Employee-shaped import rows through the same named mutation as manual creation rather than a separate path; raise a finding if that isn't achievable without also touching `VPS-F006`.

**Done criteria:**
- `VPS-D004`, `VPS-F004`, `VPS-F002`, `VRS-F002` each have their Decisions Recorded section updated with a pointer to F199; a grep for "local store", "authorized device", "retention window" and "client-side" across these four documents returns only historical Decisions Recorded entries.
- `VPS-A002`'s Client row matches `VPS-F008`.
- The Locked-shell replacement is a ruled finding, not a silent decision.
- `Employee` is registered, with create/update/lifecycle mutations, `managed_by`/`scoped_to_entity` wired through the existing governing-partitions and mutation machinery, and permission-aware queries.
- F130 is closeable: paired tests prove subject exclusion and Manager-scope both fire correctly once `resolveEmployeeForUser` is real, not merely that it returns non-null.
- Import and manual creation produce equivalent canonical records, or a finding says why not yet.

**Gates:** the standard four (format, lint, typecheck, `pnpm verify`), plus `pnpm verify:full`, the arch-check rules, and a green CI run on the branch (link it in the report). Name the subject-exclusion and Manager-scope tests individually in the report, the way Stage 7 named its gates.

---

### Stage 9 — the real shell bootstrap

Raised by F216 while tracing the original Stage 9 (now Stage 10) before implementation: the shell has never been wired to the real backend Stages 1–8 built. Every screen under `apps/roster-web/src/app/(shell)/` renders from hardcoded fixtures (`EMPLOYEES`, a fixed viewer, a client-side `canSeeCompensation()` toy). `createGraphClient` is mounted nowhere but the `/sync-harness` diagnostic route. This is `FDN-69`'s actual scope, narrowed to the minimum that unblocks Stage 10 — **not** a migration of every screen off fixtures. Home, People, Timesheets and the rest stay on fixtures after this stage; only the shell's own bootstrap becomes real.

A first attempt at this brief (branch `stage-9-shell-bootstrap`, now abandoned) stopped correctly on F217: F216's ruling assumed `session.activeOrganizationId` was already populated somewhere; it wasn't. A second attempt (branch `stage-9-shell-bootstrap-v2`, now abandoned) stopped correctly on F218: the F217-updated point 1 (unconditional sign-in on "no data") and point 4 (offline boot from cache, no network call) contradicted each other on a cold offline load, where `useSession()` also resolves to "no data." A third attempt (branch `stage-9-shell-bootstrap-v3`, in progress) implemented the corrected brief and stopped correctly on F219, found only once the bootstrap was actually exercised in a browser: `organizationClient()` (point 3's original design) calls Better Auth's `organization/list`, which `services/api/src/auth/http.ts` deliberately 404s along with every other `/api/auth/organization/*` route. Continuing on the same branch after F219's fix, it stopped a second time, correctly, on F220: the new list route correctly names the sole active workspace, but nothing made that the server's active-session claim — `/devices/register`, `trpc.ts`'s context builder and the shape proxy all still saw `activeOrganizationId: null` and refused. F217 through F220 are all ruled now — F217's two steps are points 2 and 3 below; F218's split is folded into points 1 and 4; F219's and F220's fixes (two new server routes, replacing `organizationClient()` and closing the establish-session gap) are both folded into point 3. **None of F219 or F220 restarts the branch.** `stage-9-shell-bootstrap-v3`'s preliminary code is correct apart from the calls this ruling adds and replaces — continue on that same branch, applying only the point-3 fixes below to what's already there, and keep the branch's existing commits and working tree rather than starting a new branch.

**Linear:** `FDN-117` (the fourth attempt, `stage-9-shell-bootstrap-v3`) is already filed and In Progress — continue on it, do not file a new issue. `FDN-114` (Stage 10's Reconnect issue), `FDN-115` and `FDN-116` (the two earlier abandoned attempts) all stay as-is.

**The ruled contract (F216 + F217 + F218 + F219 + F220).** Checked directly against the code: `services/api/src/auth/config.ts` already configures Better Auth's `organization()` plugin server-side, and the session already carries `activeOrganizationId` — `requireCurrentWorkspaceSession` already treats it as the workspace claim, and `workspace-session.ts`'s revocation path already clears it to `null`. But nothing populates it: a repository-wide search found only that one write (the clear-to-null). `apps/roster-web/src/lib/auth-client.ts` also has no `organizationClient()` plugin, so nothing in the shell can read the field even once it holds something.

1. **No session → sign-in (F218: only on a confirmed answer).** This needs no workspace call at all, and is checked first, purely client-side — but "no data after `isPending` clears" is not by itself confirmation of "no session." Better Auth's pinned session atom (`session-atom.mjs`) only sets `data: null` with a structured error — `error` is a `BetterFetchError`, always carrying a numeric `.status` (401, 5xx, whatever the server answered) — when `/get-session` actually reached the server; a genuine no-session response also lands here, with `error: null`. It sets `data: null` with an *unstructured* error — whatever the fetch layer itself threw (a `TypeError`, an abort `DOMException`; never a `BetterFetchError`, no numeric `.status`) — only when the request never reached the server at all: offline. Sign in only when `error` is `null` or carries a numeric `.status`. When `error` is present without one, the answer is indeterminate, not "no session" — fall through to point 4's offline path instead. This is the same split the sync engine already makes for the same reason (`engine.ts`'s `failure.kind === "network"` vs `"unauthenticated"`); reuse that shape, don't invent a new one.
2. **Populate the active organization server-side (F217).** In `services/api/src/auth/workspace-session.ts`'s `confirmWorkspaceAdmission`, in the same transaction, set `session.activeOrganizationId` to the confirmed workspace **only when it is that person's sole active membership** — check the same way `revokeWorkspaceAdmission` already checks membership state. Do **not** auto-switch a person who already has an active workspace when they create or join a second one; leave their current active organization untouched. This covers the ordinary first-workspace case without inventing workspace switching, which is already deferred (see `Reviewer_Handoff.md`'s follow-ups).
3. **A session → resolve the workspace, establish it server-side, then mount the real client (F219 + F220).** Do **not** add `organizationClient()` to `auth-client.ts` — every `/api/auth/organization/*` route, reads included, is deliberately closed (FDN-85/FDN-86's "no second write path" boundary), and the plugin has nothing legitimate to call. Read `user.id` and `session.activeOrganizationId`. If `activeOrganizationId` is already set, use it directly — skip the two calls below, it's already the server's active-session claim. If it's `null`, resolve it by calling `POST /workspace/list-active-memberships` — a session-gated, workspace-independent route (add it to `services/api/src/auth/http.ts`, same shape as the existing `/devices/retire`: session-only, no workspace header). It returns `{ workspaceId, workspaceName }` for each of the caller's memberships that are `active`/`confirmed` on both the membership and its organization, using the exact predicate `requireCurrentWorkspaceSession` and `confirmWorkspaceAdmission` already use — nothing else (no roles, no pending/revoked rows). Exactly one result → **before** constructing the graph client, call a second new route, `POST /workspace/activate-sole-membership` (same file, same session-gated shape, no request body) — it independently re-derives the caller's sole active confirmed membership itself (it does not trust the `workspaceId` the list call returned) and, only when there really is exactly one, sets `session.activeOrganizationId` on every session row that user holds — the exact write `confirmWorkspaceAdmission` already performs for the confirming session, now reachable from a later sign-in too. Proceed to construct the client only if the activation call confirms the same workspace; if it returns `{ workspaceId: null }` (the membership picture changed underneath — a race, not the common case), or the list call returned zero or more than one result to begin with, this is unresolved workspace selection, not this stage's to invent — render a minimal holding state (plain copy is enough; this is **not** F214's `Reconnect` and must not reuse its trigger, copy, or component). Construct the real graph client (`createGraphClient`, the same one `/sync-harness` already exercises) with the resolved workspace and `user.id`, sending `x-vulto-workspace-id` per the existing convention (`packages/schema/src/mutations/define.ts`'s `WORKSPACE_HEADER`). Mount it in the shell layout, replacing `Shell.tsx`'s hardcoded `workspaceName` and `syncStatus` props with the client's real state.
4. **Offline boot stays offline, single-cache only (F217, extended by F218).** `VPS-A003`: "booting offline is restored." If there is no network, enumerate cached workspaces. When point 1 resolved a `user.id` (a structured error reached the server, or a genuine no-session answer that was somehow followed by an offline retry), filter to that user's `vulto:<workspaceId>:<userId>` caches. When point 1 could not resolve at all — the indeterminate case, a cold boot with no server reachable and so no known user — there is no user to filter by yet: enumerate every `vulto:<workspaceId>:<userId>` cache on the device via `listIdbDatabases()`, unfiltered. Either way, exactly one eligible cache → mount from it via `session_hint`, no network call; its `workspaceId` and `userId` are enough to construct the graph client even with no live session. More than one → this is the same unresolved-selection case as point 3, not a silent pick (whether that means one user with two workspaces or two different people sharing the device); require coming online. Do not add anything to `device-identity.ts`'s allowed-key list — that database's narrowness is a deliberate, test-enforced contract, and neither F217 nor F218 reopens it.
5. **Surface refusals, don't render them.** This stage's job is to make a `401`/`UNAUTHORIZED` from an authenticated call, and an `access-revoked` from the shape proxy, reach the shell as a signal — a callback, an exposed field on the client's public state, whatever fits the existing `SyncState` shape best. **Do not build the Reconnect screen itself here** — that is Stage 10, unblocked once this lands.
6. **Retry, for Stage 10, means re-running this bootstrap.** `#handleRevoked` stops every source; there is nothing left inside a stopped client to retry. Design the bootstrap so it can be re-invoked from scratch (construct a fresh client, same resolution above) — that re-invocation *is* what Stage 10's Retry button calls. Say this explicitly in the report so Stage 10 doesn't have to rediscover it.
7. **Do not touch `Offline`.** It already exists from Stage 6 and is out of scope here.

**Done criteria:**
- A real, authenticated user creating or accepting their first workspace membership gets `activeOrganizationId` set server-side, proved by a test — not asserted from the diff.
- That same user's shell mounts the live graph client, not fixtures — proven with a browser test.
- A user with no Better Auth session is sent to sign-in without any workspace call being attempted, and only on a confirmed answer (`error` null or carrying a numeric `.status`) — never on a network-level failure standing in for "no session" (F218).
- A cold offline boot with exactly one cached workspace mounts from cache with no network call, including when `useSession()` never resolved at all; more than one cached workspace does not silently pick and does not crash.
- A `401` and an `access-revoked` are each observably surfaced to the shell (a test asserting the signal fires is enough; rendering it is Stage 10's job, not this stage's).
- No existing screen's fixture data is migrated in this stage — Home, People, Timesheets and Foundations are explicitly out of scope, and any change to them is a deviation to flag, not a bonus.
- A second workspace created or joined by a person already active elsewhere does not change their active organization.

**Gates:** the standard four (`pnpm install --frozen-lockfile`, `pnpm stack:up`, `pnpm verify`, `pnpm verify:full`), plus a real browser test proving: (a) a first-time workspace creation/join sets the active organization and mounts the real client; (b) no session redirects to sign-in with zero workspace calls; (c) offline cold start with exactly one cached workspace mounts without network, and with more than one does not silently pick — proven with a real network-level failure (not a mocked 401), and separately that the same network-level failure never redirects to sign-in; (d) a `401`/`access-revoked` from the client is observable at the shell boundary; (e) creating a second workspace while already active elsewhere does not switch the active organization (an integration test on `confirmWorkspaceAdmission` is enough for this one, a browser test isn't required).

**What to check in the Stage 9 report:** that `POST /workspace/list-active-memberships` returns exactly the active/confirmed rows the ruling specifies and nothing else (test a pending and a revoked membership are both excluded, not just the happy path); that `POST /workspace/activate-sole-membership` independently re-derives sole membership rather than trusting the caller, only ever writes from `null` (never switches an already-set `activeOrganizationId`), and is proven with a real end-to-end browser run — device registration succeeds, the shape proxy accepts the workspace, and the real workspace name renders, not just that the two new routes return the right JSON in isolation; that `organizationClient()` and every `/api/auth/organization/*` call are gone from the final diff, not merely unused; that no screen outside the shell's own bootstrap was touched; that the refusal-signal shape is documented clearly enough that Stage 10 can consume it without re-deriving anything; that offline boot was tested, not just reasoned about; and that the sign-in-vs-offline split (F218) was tested with an actual network-level failure (request aborted or refused before any response), not merely a mocked 401 or a mocked empty response standing in for "offline."

---

### Stage 10 — the Reconnect shell state

Depends on Stage 9 (the real shell bootstrap). Originally briefed as "Stage 9" before F216 discovered the shell had no real authenticated call to refuse in the first place; renumbered once that dependency was ruled. `FDN-114` is its Linear issue, already filed and In Progress.

**Source of truth for the design — read it, do not re-derive it.** `docs/Vulto_Specs/VPS-D004_Application_Shell_Navigation_and_System_States.md`, section **"The reconnect state"** (just above "## The three system states"), is the ruled design: F214, closed 22 September 2026. Every rule below is already written there in full — Trigger, Rendering, What Retry does, Data, Kept, Removed, and the note about revisiting if a future stage widens the device cache. Build exactly that, nothing more, nothing reinterpreted.

**Do:**
1. Consume the refusal signal Stage 9 exposed at the shell boundary — do not re-derive `401`/`access-revoked` classification from scratch; Stage 9's report says where that signal lives.
2. Build the `Reconnect` component per the spec's **Rendering** section: full-bleed, centered, no illustration, the exact copy given, one **Retry** action.
3. Wire the trigger exactly as specified: only a `401`/`UNAUTHORIZED` from an authenticated call, or `access-revoked` from the shape proxy, ever shows it. A network failure, timeout, 5xx or rate limit must leave the shell exactly as it is (the existing `Offline` treatment already covers connectivity loss from Stage 6 — do not touch that path).
4. Wire the sign-in split: this is already Stage 9's job (no session → sign-in, before any workspace call). Confirm it holds; don't rebuild it.
5. Wire **Retry** to Stage 9's bootstrap re-invocation (Stage 9's point 5) — not a literal re-issue of a call on a stopped client, which cannot work; re-running the bootstrap is what a correct Retry does.
6. Confirm the **Data** behavior: `access-revoked` already erases that workspace's cache (Stage 6's existing machinery) — verify this still fires, don't rebuild it. A plain `401` erases nothing; cached Tier 0 rows stay but are not rendered until a call succeeds or the person signs out.
7. Guard against reuse: nothing else in the codebase may trigger this treatment. If you add any check or flag that could let a future feature reuse it, that's a deviation from the brief — don't.

**Done criteria:**
- The four building blocks above (trigger, rendering, Retry, sign-in split) exist and are exercised by tests, not just present in the diff.
- A cold-start refusal and a mid-session refusal render identically — same component, same copy, no branch on which one it was.
- `Offline` (already built) and `Reconnect` (this stage) are visibly distinct and never triggered by the same condition.
- A network failure, timeout, 5xx, or rate limit never shows `Reconnect`.

**Gates:** the standard four, plus a real browser test that proves: (a) a `401` on an authenticated call with no prior session goes to sign-in; (b) a `401` with a prior session shows `Reconnect`, and Retry re-issuing a now-successful bootstrap mounts the shell; (c) `access-revoked` shows `Reconnect` and the workspace's cache is gone when it does; (d) a simulated network failure or 5xx does not show `Reconnect` and leaves the existing state alone.

**What to check in the Stage 10 report:** that no code path outside the one trigger can show `Reconnect`; that the sign-in-vs-Reconnect branch was tested with an actual no-session call, not asserted from reading the code; that `Offline` was not modified beyond what distinguishing it from `Reconnect` required; and that Retry genuinely re-runs Stage 9's bootstrap rather than something that only works on a client that was never stopped.

---

### Stage 11 — Multi-Entity and Jurisdiction Foundation (`VRS-F003`)

Depends on `VRS-F002` (Employee, built in Stage 8) and the schema-level registration `VRS-F003` already owns — `Entity`, `scoped_to_entity` and Entity's `OWNERSHIP_REGISTRY` row are already complete in `packages/schema/src/registry/{nodes,edges,ownership}.ts`; none of that needs touching. Read `docs/Vulto_Specs/VRS-F003_Multi-Entity_and_Jurisdiction_Foundation.md` directly — its Technical Architecture, Graph Specifications (G01–G07) and its own corrected Non-Functional Requirements, Security Considerations and Decisions Recorded sections (F221, F222) are the source of truth this brief summarizes, not the reverse.

**Do:**
1. **Entity's own mutations.** Following `services/api/src/mutations/employee.ts`'s exact pattern (checks/validate/apply, `ServerMutation<MutationArgs<...>>`, argument schema in a new `packages/schema/src/mutations/entity.ts`, registered in `services/api/src/mutations/pipeline.ts`): `entity.create(name, jurisdiction, defaultCurrency, fields?)`, `entity.update(entityId, fields)`, `entity.deactivate(entityId, expectedVersion)`. `entity.create` validates `jurisdiction` against the closed enum (`PK, UK, US, AE, SA, IN, SG, Global`) and `defaultCurrency` as ISO 4217. Add `"Entity"` to `packages/schema/src/mutations/employee.ts`'s `FEATURE_LIFECYCLE_NODE_TYPES` (alongside `Employee`) so the generic `graph.transitionLifecycle` correctly refuses it (F223) — `entity.deactivate` is the only path that may change Entity's `lifecycle_status`, and there is no separate `is_active` field to update; `VRS-F003`'s schema no longer has one. `entity.deactivate`'s `validate()` checks `expected_version` against the current row first, rejecting a mismatch `stale-state` (`VPS-A003` A003-T54, exactly `employeeTransitionStatus`'s own first check), then refuses (`MutationRejection`, a new reason string each) in **two distinct business-rule cases, checked after the version check, never before it, and never collapsed into one:** any Active employee remains scoped to it (G05, naming the count), or it is the workspace's sole remaining Active Entity (G04 — this invariant must hold even when the entity being deactivated happens to have zero employees scoped to it). `apply()` writes `lifecycle_status: "Dissolved"` through `updateNodeFields` under the checked version, the same call `transitionLifecycle` and `employeeTransitionStatus` both make.
2. **The transfer mutation.** `employee.setEntity(employeeId, entityId, effectiveFrom)`: closes the employee's current active `scoped_to_entity` edge with `services/api/src/graph/store.ts`'s existing `closeEdge` (already exactly this primitive — row-locked, rejects a double-close) at `effectiveFrom`, then inserts a new active edge to the new entity, following the same single-active-edge-with-history shape `employeeCreate` already uses to create the first one. No audit-log call — see F221; `scoped_to_entity`'s own edge fields are the record.
3. **Temporal resolution.** `entity.resolveForEmployee(employeeId, asOf?)`: one implementation in `services/api`, usable directly server-side. This stage has no real caller yet (contract generation, leave policy and payroll are later features), so prove it with tests against `scoped_to_entity`'s own history rather than a real caller — including the UK→1 March→Pakistan transfer example from the spec's own acceptance criteria. `asOf` defaults to now. G06: nothing else may traverse `scoped_to_entity` directly; if anything in this stage's own code needs the employee's entity, it calls this function too.
4. **The founding-record bootstrap (F222).** Extend `services/api/src/graph/founding.ts`'s `writeFoundingRecords` (or add a same-transaction sibling call from `createWorkspace` in `services/api/src/auth/workspace-projection.ts`) to also write a default Entity: name = the workspace's own name (already available, no new input needed), `jurisdiction: "Global"`, `default_currency: "USD"`, `lifecycle_status: "Active"`. Must commit or roll back with the other five founding records — never a follow-up write that could leave a workspace with zero entities if it failed partway.
5. **The permission matrix.** Add an explicit `MATRIX_OVERRIDES["Entity"]` row to `packages/schema/src/policy/policy-table.ts`, matching `VPS-A004`'s already-written "workspace-configuration pattern" (the same pattern the document already applies in prose to LeavePolicy, WorkingCalendar and others — it names Entity explicitly): `owner`/`hr-admin` → `FULL_ANY()`, `finance-admin`/`manager`/`team-member` → `READ_ANY()`. Without this row, Entity silently falls through to `Standard`'s default class mapping, which is person-scoped (`own-plus-team` for Team Member, `direct-reports` for Manager) and wrong for a workspace-wide record with no owner or reports of its own — write a test that fails before the override and passes after, so the gap can't silently reopen.
6. **No UI.** Stage 8 (`VRS-F002`) touched no `apps/` code, and this stage follows the same discipline. The Entities screen (`VPS-F005`'s host, not built) and the conditional entity selector on the Employee profile (the People/Employee screen is still fixture data per `Reviewer_Handoff.md`'s open follow-ups) both wait for that work rather than being built piecemeal now. Nothing under `apps/roster-web` changes in this stage.
7. **The four optimistic mutators (F224).** `packages/graph/src/mutators/foundation.ts`'s shared `OPTIMISTIC_MUTATORS` registry requires a client handler for every registered mutation name; add the four this stage introduces. `entity.create` and `entity.update` are ordinary node-write handlers, the same shape `employeeCreate`/`employeeUpdate` already use. `employee.setEntity`'s handler finds the employee's currently-open `scoped_to_entity` edge directly in the device cache (`effectiveTo === null` — the same non-temporal lookup `moveEmployee`'s existing handler already performs on `managed_by`; this is not the G06-restricted `asOf` question), closes it at `effective_from`, and opens a new edge to the destination Entity with its id derived from `moveEmployeeEdgeId(mutationId)` — the same portable, deterministic function the server's own `employee.setEntity` implementation already uses for this edge, so client and server compute the identical id. `entity.deactivate`'s handler checks only `expected_version` (`stale-state` on a mismatch) and writes `lifecycle_status: "Dissolved"` optimistically; it must NOT re-check G04 or G05 client-side — those are workspace-wide counts a single device's cache cannot answer reliably offline, and a server-side refusal the client couldn't predict is handled by the existing outbox `reject()`/`undo` path, not a new mechanism.

**Done criteria:**
- `entity.create`/`update`/`deactivate` and `employee.setEntity` each exist as named server mutations, permission-interceptor-gated, proven by integration tests — not asserted from the diff.
- `entity.deactivate` is refused, with the correct distinct reason each time, both when an Active employee remains scoped and when it is the workspace's sole remaining Active Entity (G04, G05) — two separate tests, including the case where the sole remaining entity has zero employees scoped to it.
- `entity.deactivate` rejects a stale `expectedVersion` with `stale-state` before it ever reaches the G04/G05 checks (F223, A003-T54) — a version-mismatch test distinct from the two G04/G05 tests.
- `entity.resolveForEmployee` returns the entity in force at a given `asOf`, proven with the spec's own UK→Pakistan transfer example (or an equivalent), and a later Entity change never alters an already-closed edge's own recorded history (G03).
- A newly created workspace has exactly one Active Entity, named after the workspace, with no manual step (F222) — proven by a test on workspace creation, not read off the code.
- Team Member and Manager get Read, never Full, on Entity; Owner and HR Admin get Full — proven by a test that fails against `Standard`'s unmodified default mapping and only passes with the new `MATRIX_OVERRIDES` row (item 5).
- No file under `apps/` appears in the diff.
- `pnpm verify` passes typecheck with real optimistic handlers for all four mutations — no stub, no-op, or placeholder handler (F224).
- `employee.setEntity`'s optimistic handler closes the correct currently-open `scoped_to_entity` edge and derives the new edge's id from `moveEmployeeEdgeId`, proven by a device-cache test mirroring `moveEmployee`'s own coverage of `managed_by` — not asserted from the diff.
- `entity.deactivate`'s optimistic handler does not evaluate G04 or G05 client-side — proven by a test that an optimistically-applied deactivation the server later refuses is rolled back through the outbox's existing rejection path, not by a client-side re-check.

**Gates:** the standard four (`pnpm install --frozen-lockfile`, `pnpm stack:up`, `pnpm verify`, `pnpm verify:full`). No browser suite is required — this stage has no UI.

**What to check in the Stage 11 report:** that `entity.create`/`update`/`deactivate` and `employee.setEntity` each go through the same checks/validate/apply pipeline every other mutation does, not a shortcut; that the two distinct deactivation refusals (G04, G05) are each independently tested, including the sole-remaining-entity-with-zero-employees case; that `entity.resolveForEmployee` is called by nothing that bypasses it — grep the diff for any direct `scoped_to_entity` traversal outside this one function (G06); that the founding-record bootstrap runs in the same transaction as the other five founding records; that the new `MATRIX_OVERRIDES["Entity"]` row is tested against a Team Member and a Manager specifically, not just Owner/HR Admin; that `entity.deactivate` checks `expected_version` before G04/G05, not after and not skipped (F223); that nothing anywhere reads or writes a field called `is_active` on Entity (F223 dropped it — grep the diff); that no file under `apps/` appears in the diff; that all four Stage 11 mutations have real optimistic handlers in `packages/graph/src/mutators/foundation.ts`, none of them stubs (F224); that `employee.setEntity`'s handler only looks up the open `scoped_to_entity` edge and takes no `asOf` argument; and that `entity.deactivate`'s optimistic handler contains no G04/G05 count logic, relying on the outbox's rejection path instead.

---

## Part 4 — After Stage 7

Stage 8 was the priority slice of the feature-spec sweep (FDN-104) and the first Roster feature, the canonical Employee profile (RST-33); it merged as `5897b7b`, F130 closed, F215 confirmed, F214 ruled. Stage 9 (above) was meant to be that ruling's build, the Reconnect shell state — but tracing it before implementation surfaced F216: the shell was never wired to the real backend at all (`FDN-69`, never built). Stage 9 is now the minimal real shell bootstrap F216 ruled, and the original Reconnect brief is renumbered Stage 10, unblocked once Stage 9 lands. The remaining 40-odd FDN-104 specs are corrected just-in-time, before each one's own implementation stage — never in one large pass, per FDN-104 itself.

---

## Part 5 — What to do right now

Stages 1–10 are merged (Stage 10 as `570b15d`). Stage 11 — Multi-Entity and Jurisdiction Foundation (`VRS-F003`) — is briefed above, server-side only apart from the four Tier 0 optimistic mutators item 7 now covers, with F221, F222, F223 and F224 all ruled; F223 and F224 each correctly stopped Stage 11 once, before and during implementation — see the latest two Amendments entries. Resume Stage 11 on the corrected brief. When its report is written and Linear is updated, stop and wait for the founder, same as every stage boundary.
