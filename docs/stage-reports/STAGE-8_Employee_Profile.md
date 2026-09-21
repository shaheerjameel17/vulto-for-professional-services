# Stage 8 — Spec sweep (priority slice) and the canonical Employee profile

**Status:** COMPLETE, awaiting review. **One finding (F214) is open for your ruling.**
**Branch:** stage-8-employee-profile
**Linear issues:** FDN-104 (the priority slice only), RST-33
**Date:** 2026-09-22

## 1. Summary
Five specifications are corrected for the server-authoritative architecture, and the Employee profile is built on them. The specs: `VPS-D004` (the "aged out" state is now "requires connection", with **Retry**), `VPS-F004` (audit review is always a server call), `VPS-F002` (the always-local search guarantee is scoped to Tier 0, and a server-backed search is described for everything else), `VPS-A002` (the `Client` ownership row now matches `VPS-F008`) and `VRS-F002` (the server is the only writer, transitions are validated on the server, offboarding is the revocation machinery rather than a wipe). `VPS-D004`'s "Locked shell" is **not** corrected: its premise, a sealed local store, no longer exists, so I raised F214 with a proposed replacement and marked the section, as you asked. The build: five named Employee mutations, permission-aware directory and profile queries, the real login link, and the import path routed through the same create mutation as manual entry. Building it showed the login link had three consumers that could not use it (F215), so subject exclusion (F130) and Manager scope did not fire until those were implemented too; both are now proven by paired tests that were each mutation-checked.

## 2. Done-criteria checklist
- [x] `VPS-D004`, `VPS-F004`, `VPS-F002`, `VRS-F002` each have a Decisions Recorded entry pointing at F199. `VPS-D004` had no such section, so I added one. A grep for "local store", "authorized device", "retention window" and "client-side" across the four returns only those Decisions entries and `VPS-D004`'s locked-shell section, which is the section F214 marks and which stays as written until it is ruled.
- [x] `VPS-A002`'s `Client` row matches `VPS-F008` ("Not applicable"), and so does the `OWNERSHIP_REGISTRY` entry in `packages/schema`.
- [ ] **The Locked-shell replacement is a ruled finding.** It is a raised finding, F214, not yet ruled. See section 8.
- [x] `Employee` has create, update, lifecycle (`employee.transitionStatus`), link-user and set-compensation mutations. `managed_by` and `scoped_to_entity` go through the existing governing partitions and `org.moveEmployee`. Permission-aware queries exist.
- [x] F130 is closeable and I have closed it (see section 8): paired tests prove subject exclusion and Manager scope fire with the real link, not merely that it returns non-null.
- [x] Import and manual creation produce the same canonical record — `Import and manual creation produce the same canonical record`, `employee.integration.test.ts`.
- [x] CI is green on the branch (link in section 6).

**Named tests** (all in `services/api/src/permission/employee.integration.test.ts`):

*Subject exclusion (F130):*
- `F130 — subject exclusion fires once the login link is real › excludes the subject, and only the subject, from reading a case about them`
- `› removes the subject from the resolved reader set, using the real link`
- `› applies through protected.read: the subject gets a restriction, the others the content`
- `› a login with no Employee record is not the subject of anything, so is not excluded (F215 decision a)`

*Manager scope:*
- `Manager scope — widens to direct reports and nowhere else, from the real edges › derives Manager from managed_by edges, and only for the person they point at`
- `› lets a Manager read and write their reports' operational half, and no one else's`
- `› gives team members their own record and their team, and no one else's`
- `› narrows on the very next request when a report is moved away, and in the sync audience`
- `› honors the governing partitions: whoever may write the operational half may move a person, and a team member may not`

*Mutation-checked:* removing the subject exclusion from `decideRead` fails 2 tests; making `direct-reports` never satisfied fails 3; making `own` never satisfied fails 2; making `own-plus-team` satisfied for anyone fails 5.

## 3. Spec clauses implemented
| Spec ID | Where implemented | Test proving it |
|---|---|---|
| VRS-F002 G01, G02 (schema, never hard-deleted) | `packages/schema/src/employee.ts`, `services/api/src/mutations/employee.ts` | `creates the Tier 0 record and the scoped_to_entity edge, with the stated defaults` |
| VRS-F002 G06 (status transitions) | `employeeTransitionOutcome`, `employee.transitionStatus` | `enforces the status table on the server...`; client: `applies the same status table as the server...` |
| VRS-F002 G07 (`contracted_hours` default 40) | `employeeOperationalRecord` | the create test above |
| VRS-F002 (Tier 1 half never on a device) | `employee.setCompensation`, `writeProtected` | `writes only ciphertext, and only an authorized reader gets the value`; client: `refuses the generic mutators on an Employee, and never puts compensation in the cache` |
| VRS-F002 (workspace-scoped uniqueness) | `requireUnique` | `rejects a duplicate email or code within the workspace, however it is cased` |
| VRS-F002 (invitation links the login) | `employee.linkUser`, `resolveEmployeeForUser` | `links a login once, to a person the graph knows...` |
| A004-T16 (subject exclusion) | `decideRead` in `permission/interceptor.ts` | the four F130 tests |
| A004 (Manager derived scope, row scopes) | `rowScopeSatisfied` | the five Manager tests |
| A003-T63 (Tier 1 writes are online-only) | `employeeSetCompensation` (tier 1, `defineMutation` forces online-only) | `is the seven building blocks plus the Employee mutations, and only compensation is protected` |
| F208 (governing partitions honored) | existing `moveEmployee`, unchanged | `honors the governing partitions...` |

## 4. Files changed
```
docs/Vulto_Specs/VPS-D004…, VPS-F004…, VPS-F002…, VPS-A002…, VRS-F002…   corrected, with Decisions Recorded entries
docs/Foundations_Findings.md                          F130 closed, F214 and F215 raised, recount
packages/schema/src/employee.ts                       new: field schemas, status table, shared record and transition rules
packages/schema/src/mutations/employee.ts             new: the five named mutations and the feature-lifecycle guard
packages/schema/src/registry/ownership.ts             Client write policy reconciled (F207)
packages/graph/src/mutators/foundation.ts (+ employee.test.ts)   optimistic Employee mutators
services/api/src/mutations/employee.ts                new: server implementations
services/api/src/mutations/{pipeline,foundation}.ts   registered; generic transition refuses Employee
services/api/src/graph/store.ts                       findNodeByRecordField
services/api/src/permission/{employee-link,interceptor,reader-set}.ts   the real link, row scopes, subject exclusion, own-scope readers
services/api/src/permission/employee-queries.ts       new: directory and profile queries
services/api/src/employee/import.ts                   new: import routed through employee.create
services/api/src/router.ts                            employee.list, employee.get
services/api/src/permission/employee.integration.test.ts   new (19 tests)
tests adjusted where they used the generic transition on an Employee (pipeline, adversarial, graph client)
```

## 5. Database changes
None. Employee fields live in the existing `graph_nodes.record` (Tier 0) and `graph_protected_fragments` (Tier 1); the `scoped_to_entity` edge is an ordinary `graph_edges` row. No migration.

## 6. Tests and gates
- `pnpm verify:full` — exit 0; `@vulto/api`: `Tests  237 passed | 2 skipped (239)`; `@vulto/graph`: 63 tests; `@vulto/schema`: 74 tests.
- `pnpm arch:check` — exit 0. `pnpm --filter roster-web build` + artifact check — clean.
- Live-Electric proxy tests — `Tests  11 passed (11)`. `pnpm test:sync-browser` — `11 passed (38.0s)`. `pnpm test:auth-browser` — `6 passed (12.1s)`.
- GitHub slow lane, all jobs green (`api-integration`, `sync-browser`, `auth-browser`, `production-build`): https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/35658951785 (commit `d61f0cd`; fast lane green on the same commit).

## 7. Micro-decisions
- **`employment_status` is not stored.** `VRS-F002`'s field list has it, but it is the node's `lifecycle_status`; storing it twice would be a second answer. `end_date` is set and cleared by the transition.
- **Email is stored lower-cased and compared case-insensitively;** uniqueness of email and `employee_code` is per workspace.
- **`user_id` is not accepted by create or update.** It decides whose "own record" this is, so only `employee.linkUser` sets it: the login must be a `User` node the graph already knows in that workspace, and one login links to one Employee.
- **Going Inactive requires an `end_date`;** returning to Active clears it; Converted is terminal.
- **The generic `graph.transitionLifecycle` now refuses a feature-owned lifecycle** (`FEATURE_LIFECYCLE_NODE_TYPES`, currently Employee), because it would skip the transition table. Three existing tests that used it on an Employee moved to `employee.transitionStatus` or to an Entity node.
- **Compensation defaults:** `VRS-F002` says the currency defaults to the scoped Entity's currency; that default is not applied (no Entity currency field exists yet), so the caller supplies it or leaves it null.
- **The queries live in `permission/`,** because `arch-check` (A003-T52) allows only that folder, `graph`, `mutations`, `protected`, `audience` and `jobs` to read the graph store, and a feature folder must not.
- **`employee.list` and `employee.get` are tRPC queries;** a device still reads the Tier 0 half from its own cache and asks `protected.read` for the rest.
- **Import** maps a row of strings to the same validated fields, then the same `employee.create` envelope as manual entry, so there is one path. `VPS-F006` is not corrected; nothing needed changing there, and when it is, its rows go to `importEmployees`.
- **`Client`'s registry entry keeps `mode: activation-handoff`** with a "not applicable" write policy, because the write-authority gate treats an owner outside the four activatable applications as imposing no restriction; changing the mode to `permanent` would start refusing Roster's writes.

## 8. Findings raised
- **F214 (open, for your ruling): the locked shell has no store left to lock.** `VPS-D004`'s section gates the whole application on a sealed local store and an online unlock, with cold-start and mid-session variants. Neither exists. The finding proposes one state (any `401`/`UNAUTHORIZED` or `access-revoked`; never an outage), one Retry, the same copy for cold start and mid-session, and the same refusal to say why, and sets out four tradeoffs: an expired session looks the same as a removal (alternative: send a plainly missing session to sign-in); a removed person sees Retry forever; `access-revoked` erases the cache so the client distinguishes what it must not render; and nothing is sealed on a plain `401`. **I recommend the single state, with a missing session going to sign-in.** The section carries a marker and is otherwise unchanged.
- **F215 (implemented, for you to confirm): the identity link had three consumers that could not use it.** The brief expected `resolveEmployeeForUser` to be the only change. The interceptor's `rowScopeSatisfied` was a stub that honored only scope `any`, so `own`, `direct-reports` and `own-plus-team` all resolved to no access whatever the link said; `resolveReaderSet` returned "unresolvable" for any such grant, so Employee compensation could never pass Gate 3 and no compensation could be written by anyone; and subject exclusion existed only in the write gate, not on reads, in `protected.read` or in the audience, though A004-T16 requires all three. All three are implemented for what the link can decide; everything else stays conservative. Three decisions inside it need your confirmation: (a) a login with no Employee record is treated as not being the subject; (b) a case with no recorded subject excludes no one; (c) `own-plus-team` means "shares my active manager".
- **F130 closed** by RST-33, for logins linked to the subject's Employee record. The banner at the top of the findings file now says so, with the limit stated: a subject whose login is not linked is not excluded. **Please confirm the closure.**
- The findings table is recounted programmatically: 161 rows, F54–F215 with one gap (F198), 146 closed, 9 open (F70, F71, F73, F85, F91, F118, F125, F129, F214), 6 recorded.

## 9. Deviations from this brief
- The brief says to register `Employee` in `packages/schema/src/registry.ts`. It was already registered as a node type with both partitions (`operational` Tier 0, `compensation` Tier 1), so I did not touch the registry entry; what was missing was the field schemas and the mutations, which are in `employee.ts` and `mutations/employee.ts`.
- The brief says the two callers of `resolveEmployeeForUser` need no changes. That is true of the two named callers, but the seam went deeper (F215), so the interceptor and the reader-set changed.
- Offboarding's access-ending sequence (revoke the membership, the devices for the workspace, recompute the audience) is not wired into `employee.transitionStatus`. It is existing machinery (`revokeMembershipForActor`) and the transition does not call it; a later offboarding feature does. This report says so rather than claiming the transition ends access.
- `VPS-F004`, `VPS-F002` and `VRS-F002` were corrected in their bodies as well as their Decisions Recorded sections, as the brief's item 5 describes for `VRS-F002`; each Decisions entry records what the body said before.

## 10. Known limitations and risks
- **`VPS-D004`'s locked shell is unresolved (F214).** Nothing in this stage renders a shell state, so nothing is blocked, but the section will mislead anyone who reads it as current until it is ruled.
- **Subject exclusion applies to linked logins only** (F130's stated limit).
- **Row scopes are implemented for Employee rows only.** Every other type with a row-qualified grant (leave requests, timesheets, and so on) still resolves it to no access until it has its own subject path.
- **A Manager cannot move people.** Edge writes name no row, so a row-qualified grant cannot authorize one; Owner and HR Admin can.
- **Read cost:** each Employee read decision resolves the caller's Employee and up to two edge lookups; fine for a directory of 150, a per-request cache if not.
- **The offboarding sequence is not wired** (section 9).
- **VPS-A002's node-registration table** still lists `Client`'s lifecycle owner as "Vulto Sales permanent; VPJ-F001 bootstrap". That column says who defines the lifecycle, not who may write, and is unchanged; I noted it in `VPS-A002`'s Decisions entry.

## 11. Readiness for the next stage
Yes, once F214 is ruled and F215 and F130's closure are confirmed. `VPS-D004`'s locked shell is the one correction still owed from this slice; the remaining specs in FDN-104 are corrected just in time, per the brief.
