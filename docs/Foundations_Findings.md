# Foundations Findings

**Status:** Open. The Core Engineering and Graph Foundations phase is in progress.
**Purpose:** Record every defect, ambiguity and contradiction found in the specification set by implementing it, so corrections go back into the document that owns the fact.

This file is not a specification and is deliberately outside `docs/Vulto_Specs/`. It is the successor to `docs/Prototype_Findings.md`, which closed at fifty-three findings.

**Finding numbers continue from that log rather than restarting.** A finding ID is unique across the whole project, so `F27` means one thing and only one thing regardless of which log a reader is holding.

**The two logs were produced by different instruments.** The prototype rendered four design documents and found what could only be found by looking at a screen. This phase implements two architecture documents and finds what can only be found by trying to turn prose into types — a column that cannot be parsed, a mapping with holes in it, a relationship with no edge to traverse. Neither instrument would have found the other's findings.

---

## ⚠ Live, present-tense gap — read before anything else in this document

**F130. Right now, in the current codebase, Owner and HR Admin see every HR case in the workspace, including one filed about themselves.** This is not a deferred feature or a theoretical edge case — it is what the code does today, and will keep doing until `VRS-F002` exists.

`VPS-A004`'s subject-exclusion rule (A004-T16) requires an Owner or HR Admin who is the subject of a disciplinary or grievance case to be excluded from reading it, so an investigating officer can take honest notes. Enforcing that requires knowing which login account belongs to which employee — a link `VRS-F002` (Atomic Employee Profiles) has not built yet. Until it does, this cannot be enforced, at all, by any means short of removing HR case access from Owner and HR Admin entirely, which would break the only two roles able to manage a case.

**This is deliberately not built as a mechanism that looks like it works but doesn't.** See F130's full entry for why that option was considered and rejected. It is instead named here, prominently, so `VRS-F002`'s priority reflects that something real and live is waiting on it — not merely a nice-to-have identity link.

---

## Status of each finding

| | Finding | Owner document | State |
|---|---|---|---|
| F54 | Privacy Class is prose, not a closed enum | `VPS-A002`, `VPS-A004` | **Closed by FDN-74** — 24 strings resolved to a closed set of 13 |
| F55 | HeadcountPlan's Privacy Class contradicts its own feature spec | `VPS-A002` | **Closed by FDN-74** — `Finance-restricted`, per `VRS-F027` |
| F56 | "HR-restricted" is used in four documents to mean a narrower class | `VPS-A002`, `VRS-F037`, `VRS-F046`, `VRS-F057` | **Closed by FDN-74** — labels corrected to the behavior all four already described |
| F57 | Five Privacy Classes have no Tier default | `VPS-A003` | **Closed by FDN-74** — the mapping is now total |
| F58 | Nothing distinguishes a deliberate tier departure from an error | `VPS-A002` | **Closed by FDN-74** — `†`, and exactly one departure |
| F59 | `Owner only` and `Owner-restricted` are one class under two names | `VPS-A004` | **Closed by FDN-74** — `Owner-restricted` removed |
| F60 | Reified relationships have no registered edges | `VPS-A002` | **Closed by FDN-75** — one rule, four edges registered |
| F61 | The edge registry does not state its own key | `VPS-A002` | **Closed by FDN-75** — the key is a triple |
| F62 | A Rule 11 fact is cited as Rule 10 | `VPS-A002` | **Closed by FDN-74** |
| F63 | `VPS-A001` describes one build's job in terms of another's | `VPS-A001` | **Closed by FDN-46** |
| F64 | `CLAUDE.md` and `AGENTS.md` are byte-identical duplicates describing a closed phase | Repository | **Closed by FDN-76** |
| F65 | `Role-dependent` was a third name for `Inherited` | `VPS-A004` | **Closed by FDN-74** — consolidated |
| F66 | Tier 1 keys are wrapped against the class default, ignoring `VPS-A004`'s overrides | `VPS-A003` | **Closed by FDN-78** |
| F67 | No document says who reads an HRCase concerning the Owner | `VRS-F046` | **Closed by FDN-79** — subject exclusion, founder decision |
| F68 | Client is registered twice, with different owner attributions | `VPS-A002` | **Closed by FDN-75** — one row |
| F69 | `VPS-A004` has one denial outcome where `VPS-D004` has two, and they disagree on the salary field | `VPS-A004`, `VPS-D004` | **Closed by FDN-80** — the outcomes are distinct and the universal-existence rule assigns them |
| F70 | FlightRiskSignal has the same subject-reads-own-record shape as HRCase | `VRS-F053` | **Open, raised not decided** — FDN-81 |
| F71 | `A007-T18` is not satisfied and cannot be yet | `VPS-A007` | **Open, recorded boundary** |
| F72 | `VPS-A007`'s first gate cites `A001-T05` for a rule `A001-T06` states | `VPS-A007` | **Closed by FDN-47** |
| F73 | `services/cross-tenant-aggregation` is specified, isolation-constrained, and owned by no issue | `VPS-A001` | **Open, raised not decided** — FDN-82 |
| F74 | A driver's return type is not stable across runtimes, and one error handler reported a healthy database as down | Repository | **Closed by FDN-47** |
| F75 | The devcontainer named a user its image does not have, and mounted the repository's parent | Repository | **Closed by FDN-47** |
| F76 | Rebuilding a Codespace does not pull latest — it re-reads the existing checkout | Tooling | **Not a defect, recorded as an operational fact** |
| F77 | The devcontainer had no Docker client, and was never run before F75 exposed it | Repository | **Closed by FDN-47** |
| F78 | The Docker feature's default packaging is unavailable on the base image's distribution | Repository | **Closed by FDN-47** |
| F79 | The development image was pinned by tag, which `A007-T16` prohibits | Repository | **Closed by FDN-47** |
| F80 | Turborepo strips undeclared environment variables, and a localhost default hid it | Repository | **Closed by FDN-47** |
| F81 | A doc comment claimed a WASM compile failure that testing proved false | Repository | **Closed by FDN-46** |
| F82 | `FDN-46` and `FDN-49` both claimed "package dependency boundaries" in their own scope | Linear | **Closed by FDN-46** |
| F83 | `None` and `Restricted` had a stated distinction but no rule for which cell gets which | `VPS-A004` | **Closed by FDN-80** — five cells reclassified |
| F84 | `VPS-D004`'s "an HR-restricted contract" example conflated a guaranteed node with an optional vault document | `VPS-D004` | **Closed by FDN-80** |
| F85 | PayRun, HeadcountPlan and HeadcountSnapshot don't sort under the `None`/`Restricted` rule | `VPS-A004` | **Open, raised not decided** — FDN-83 |
| F86 | `FDN-45` claimed all lifecycle statuses and all A002 schema where most lifecycle enums are feature-owned | Linear | **Closed by FDN-45** — scope corrected to 28 fixed and 81 feature-owned policies |
| F87 | The universal-node claim contradicted three deliberate field-omission shapes | `VPS-A002`, `VPS-A007`, `VRS-F048` | **Closed by FDN-45** — omissions are exact and closed |
| F88 | The conversion protocol forced `Converted` onto GhostResource, whose feature owns `Promoted` | `VPS-A002` | **Closed by FDN-45** — each conversion registers its domain-correct terminal status |
| F89 | Anonymous contribution nodes still carried identifying actor and exact-time provenance | `VPS-A002`, `VPS-A007`, `VRS-F048`, `VRS-F078` | **Closed by FDN-45** — six identifying provenance fields omitted exactly |
| F90 | Broad relationship endpoints could reconnect an anonymous contribution to an Employee | `VPS-A002`, `VPS-A005`, `VPS-A007` | **Closed by FDN-45** — protected-node connectivity is explicit and closed |
| F91 | “Registered both directions” required feature schema that does not exist yet | `VPS-A007`, Linear | **Open, recorded boundary** — FDN-49 checks each direction only when its artifact exists |
| F92 | `FDN-77`, `FDN-48` and `FDN-49` all claimed the same architecture enforcement | Linear | **Closed by scope amendment** — the first two define; FDN-49 enforces |
| F93 | F90's validator was generic by design but tested only the two current protected types | Repository | **Closed by FDN-45** — a synthetic future type with wildcard adjacency fails at import |
| F94 | A001-T07 named the wrong availability states and omitted retention-window absence | `VPS-A001` | **Closed by FDN-77** — Worker availability now matches the three exceptional system states plus ordinary `ready` |
| F95 | A per-row sync marker cannot describe an absent row and can leak a denied record's existence | `VPS-A001` | **Closed by FDN-77** — availability is separate from rows and restricted placeholders derive only from type schema |
| F96 | The shared Worker boundary had no package home in the repository structure | `VPS-A001` | **Closed by FDN-77** — `packages/graph` owns the client and validated local protocol; its runtime stays private |
| F97 | `packages/schema` typechecked but could not be consumed as source by Next.js | Repository | **Closed by FDN-77** — internal source specifiers now resolve in both TypeScript and the application bundler |
| F98 | The single-active relationship rule allowed two active targets and omitted `scoped_to_entity` | `VPS-A002`, Repository | **Closed by FDN-48** — one non-overlapping outgoing history per source and registered relationship |
| F99 | Temporal edge intervals had no boundary semantics | `VPS-A002` | **Closed by FDN-48** — intervals are half-open `[effective_from, effective_to)` |
| F100 | A003 said a missing protected fragment always produced structural absence after FDN-80 introduced schema-derived `Restricted` | `VPS-A003` | **Closed by FDN-48** — zero received bytes is preserved while A004 decides the render outcome |
| F101 | FDN-48 assigned itself persistence before the required local encryption system exists | `VPS-A001`, Linear | **Closed by FDN-48 scope correction** — SQLite is disposable; FDN-50 persists Loro and FDN-52 owns encryption |
| F102 | Additive record properties were preserved without proving they were JSON-native | `VPS-A002`, Repository | **Closed by FDN-48** — complete records reject runtime-specific values before materialization |
| F103 | FDN-50 was required to persist Loro before the issue owning mandatory local encryption | `VPS-A003`, Linear | **Closed by FDN-84 extraction** — sealed local storage now blocks FDN-50, which continues to block the remaining FDN-52 work |
| F104 | `managed_by` has two canonical representations and no reconciliation rule | `VPS-A001`, `VPS-A002`, `VRS-F037` | **Closed by founder ruling** — the Movable Tree is sole write target and authority on the current answer; the edge is a one-way materialization, keyed to the Tree's causal ordering |
| F105 | FDN-50 claimed an application-facing read/write path before the permission interceptor | `VPS-A004`, Linear | **Closed by FDN-50 scope correction** — only Worker-private proof seams exist before FDN-53 |
| F106 | A session-token-keyed store cannot state how it reopens after an offline cold restart | `VPS-A003`, `VPS-F001`, Linear | **Closed by founder ruling** — every cold restart requires one online, server-authorized unlock; offline operation continues after it |
| F107 | FDN-84's selected unlock still depends on session infrastructure owned downstream, while FDN-63 also claimed local encrypted storage | `VPS-F001`, Linear | **Closed by FDN-60 split and implementation** — FDN-60 now provides the upstream exact-workspace session guard; FDN-63's duplicate was removed |
| F108 | F001's API contracts expose identity and session tokens that its httpOnly-cookie boundary says application code must not receive | `VPS-F001` | **Closed by FDN-60** — browser JSON is recursively credential-free and authenticated identity derives from the host-only httpOnly cookie |
| F109 | F001 specifies bcrypt, but the selected Better Auth release uses scrypt by default | `VPS-F001`, Registry | **Closed by FDN-60** — the live 1.6.29 release is pinned and its native scrypt default is verified against the stored credential |
| F110 | F001 still models WorkspaceMembership as an edge after A002 made it a lifecycle-bearing node | `VPS-F001`, `VPS-A002`, Repository | **Closed by source correction** — F001 now requires one membership node plus `membership_of` and `membership_in`; FDN-85 owns atomic projection |
| F111 | An account session can stay valid after one workspace membership is revoked | `VPS-F001`, `VPS-A002`, Linear | **Closed by FDN-60** — the server-only guard checks the exact active, confirmed workspace membership on every call |
| F112 | Better Auth's organization/member tables and the local-first WorkspaceMembership graph have no authority or reconciliation rule | `VPS-A003`, `VPS-F001` | **Closed by founder ruling and FDN-60 substrate** — central admission is authoritative; grants wait, removals deny first, and FDN-85 projects history |
| F113 | The session schedule is undefined, and Better Auth cookie caching can delay revocation | `VPS-F001`, Registry | **Closed by FDN-60** — seven-day rolling database sessions refresh after one day and authorization uses no cookie cache |
| F114 | FDN-60 is blocked by work downstream of FDN-84 even though FDN-84 now needs FDN-60's session substrate first | Linear | **Closed by issue split** — FDN-85 and FDN-86 hold the graph/email remainder and FDN-60 now blocks FDN-84 without a cycle |
| F115 | Better Auth could not infer the client IP through the Fastify-to-Fetch bridge, collapsing rate limits into one shared bucket | Repository, Browser verification | **Closed by FDN-60** — Fastify overwrites a private bridge header from its unproxied socket address before Better Auth rate-limit keying |
| F116 | `VPS-A001` still named FDN-52 as the owner of local-storage encryption after F103 moved that ownership to FDN-84 | `VPS-A001` | **Closed by source correction** — FDN-84 named as the owner of the sealed local store and its cold-restart unlock; FDN-52 keeps the later encrypted SQLite cache or VFS |
| F117 | `VPS-D004`'s system states are all region-level; the whole-shell locked condition F106 created has no specified render | `VPS-D004` | **Closed by source correction** — a locked-shell section added, distinct from the three region-level states |
| F118 | `VPS-A003` and `VPS-F001` both cite `VPS-D004` for a SyncStatus / Offline indicator render that `VPS-D004` never defines | `VPS-A003`, `VPS-F001`, `VPS-D004` | **Open, raised not decided** — logged separately, not owned by FDN-84 |
| F119 | "Current process" left it undecided whether a tab reload requires the same online unlock as a device cold restart | `VPS-A003` | **Closed by founder ruling** — strict: any new Worker instance requires an online unlock; a SharedWorker alternative is logged as an available future softening |
| F120 | A document a client is too old to open has no specified render — not `SealedStore`'s "cannot open," not silent partial data, not any of `VPS-D004`'s existing states | `VPS-D004` | **Open, raised not decided** — FDN-50 |
| F121 | `loro-crdt@1.14.1` shallow snapshots cannot anchor a document whose history is concurrent roots — `export` accepts the anchor and `import` rejects the bytes it produced | `VPS-A001`, Repository | **Closed by founder ruling** — full snapshots only; `VPS-A001`'s shallow-snapshot reasoning corrected to say it does not hold for this system's document shape |
| F122 | The device-store browser suite cannot run green in one invocation — its own sign-ups exhaust Better Auth's rate limit partway through | Repository | **Closed by repository fix** — each spec file resets the test database's rate-limit state in `beforeAll`; the production limit is untouched |

| F123 | The passkey browser test raced its own sign-out — `generate-register-options` runs with `requireSession: false`, which makes a session optional rather than ignored | Repository | **Closed by repository fix** — the test waits for the server to confirm the session is gone before asserting the reuse refusal |

| F124 | F104 keyed the materialized edge's intervals to causal ordering, but a Loro Tree operation carries no deterministic date and a Lamport counter is not one | `VPS-A002`, `VPS-A001` | **Closed by founder ruling** — causal ordering `(lamport, peer)` selects the winning move; an effective date carried on the move operation fills the interval |
| F125 | A backdated move — one whose effective date precedes an existing edge's start — has no defined behavior under the corrected F104/F124 rule | `VPS-A002`, `VRS-F037` | **Open, raised not decided** — FDN-50 stage 4 is scoped to forward-effective moves only |

| F126 | FDN-50's "reopened … offline" done criterion predates F106 and became impossible when F106 made every cold restart an online checkpoint | Linear, Process | **Closed by criterion correction** — split into "queried offline after unlock"; the general sweep lesson is recorded below |
| F127 | `VPS-F001`'s "role changes take effect immediately, no session restart" was ambiguous between an impossible offline claim and a too-weak server-only one; FDN-53's design assumed the weaker reading | `VPS-F001`, `VPS-A004`, Linear | **Closed by wording correction; ownership of the live delivery channel left open** — FDN-53 role-refresh redesigned; no issue yet claims the transport |
| F128 | FDN-53 stage 1 resolved every "own" and "direct-reports" matrix cell at its unrestricted literal grant with no row-level filtering — 41 cells, including every employee's wellness events, pulse entries, leave, expenses and payslips readable by any Team Member, and every employee's timesheets, leave and assignments readable by any Manager — and a passing test asserted the WellnessTriggerEvent case as correct | Repository | **Closed by repository fix** — every non-`any` scope resolves to `none`; verified by exhaustively sweeping all 245 matrix cells and 30+ class-default fallback node types directly against `resolvePermission`, and by mutation-testing the fix itself |
| F129 | `LeavePolicy`, `Workspace`'s display partition and the other named "workspace-configuration pattern" node types have no override row and fall through to `Standard`'s person-scoped defaults, which don't apply to a workspace-wide record | `VPS-A004`, Repository | **Open, raised not decided** — surfaced fixing F128; currently resolves conservatively to `none` rather than the plain Read every role should have |
| F130 | ⚠ **Live gap, not deferred.** Subject exclusion (A004-T16) is entirely unbuilt — Owner and HR Admin currently see every HRCase/CaseEvent in the workspace, including one concerning themselves, because no User-to-Employee identity link exists to enforce it | `VPS-A004`, `VRS-F002`, `VRS-F046`, Repository | **Open, deliberately left unmitigated** — founder-decided against a dormant mechanism that would look enforced without being able to fire; blocks on `VRS-F002` |
| F131 | `applyDeltaBatch` is a public, application-callable `LocalGraphClient` method with zero permission check — the graph's only current mutation entrypoint bypasses the interceptor stage 1 built entirely | `Repository`, `VPS-A001` | **Closed by founder ruling** — demoted to Worker-internal/test-only, mirroring `SQLiteGraphIndex.execute()`'s treatment; a real gated mutation entrypoint replaces it as FDN-53 stage 2's actual scope |
| F132 | No Loro storage convention exists for any edge type except `managed_by`, which is derived from the Movable Tree rather than stored as a generic edge — nothing commits a write for any of `VPS-A002`'s other ~90 registered edge types | `VPS-A001`, `VPS-A002`, Repository | **Open, raised not decided** — stage 2 scopes edge writes to authorization-check-only, no commit; the convention itself needs its own dedicated design pass |
| F133 | `VPS-A004` Gate 2 (`VPS-F008` cross-suite write authority) is structurally a no-op with only Vulto Roster registered — no second application can ever hold an `Active` activation | `VPS-A004`, `VPS-F008`, Repository | **Closed by founder ruling, same standard as F130** — not built in stage 2; deferred until a second application is registered |
| F134 | `VPS-A004` Gate 3 (refusal when a write would leave an empty reader set) depends on subject exclusion, which F130 already found unbuilt | `VPS-A004`, `VRS-F002`, Repository | **Closed by founder ruling, same standard as F130** — not built in stage 2; deferred to the same identity-link dependency F130 names |
| F135 | `VPS-A004`'s per-decision `AuditEntry` requirement (`VPS-F004`) was never surfaced scoping FDN-53 stage 2, and no audit-writing code exists anywhere in `packages/graph` | `VPS-A004`, `VPS-F004`, Repository | **Closed by founder ruling** — audit writing out of stage 2's scope, same as stage 1; deferred to whichever issue implements `VPS-F004` |
| F136 | `VPS-A004` assigns no write-permission column to an edge TYPE, only to node types and partitions — which privacy partition governs an edge write on a split-protection endpoint (e.g. Employee) is undefined by the spec | `VPS-A004`, `VPS-A002`, Repository | **Closed by founder ruling** — resolves conservatively to `none` for a multi-partition endpoint, the same default direction F128 established; proven correct by exhaustive sweep, unreachable from any commit path per F132 |
| F137 | `roster-web`'s typecheck fails on two `TS2307` errors — `loro-crdt/web` and `loro-crdt/web/loro_wasm.js` unresolvable in `graph-persistence-diagnostics-client.tsx` — pre-existing on `main`, unrelated to FDN-53 | Repository | **Closed by repository fix** — diagnosis confirmed: `loro-crdt` was declared in `apps/roster-web/package.json` and present in `pnpm-lock.yaml`, but the `node_modules` symlink was absent on disk. `pnpm install` restored it; `roster-web` now typechecks clean, and the Next dev server boots — which it could not do while the module was unresolvable at runtime. A stale local install, never a config or specification defect |

| F138 | ⚠ **Most severe finding this project has recorded.** The mutation gate validates permission and never coherence, so an authorized-but-incoherent batch merges irreversibly into the canonical document and only then fails materialization — wedging the entire graph layer for the session | `VPS-A004`, Repository | **Closed by repository fix** — the gate now validates coherence on its own fork before anything merges, and fails closed on any inspection throw; proven by a named regression test at unit and real-stack level across three vectors, and mutation-tested. Containment half unproven, see F143 |
| F139 | `switchWorkspace` raw-terminated the Worker instead of disposing it, silently discarding up to 250ms of already-acknowledged writes — a clean in-app action doing what `#scheduleFlush` promises only a hard kill can | Repository | **Closed by repository fix** — the switch now disposes (and therefore flushes) the workspace being left; proven by the sibling of the existing dispose-inside-the-window test |
| F140 | A failed materialization pinned availability at `mid-sync` forever; separately, two of `VPS-A001`'s four contracted availability states (`retention-window-absence`, `permission-absence`) are never produced by anything | `VPS-A001`, Repository | **First half closed by repository fix** — availability restores to `ready`, which the transactional rebuild makes honest. **Second half open** — the unproduced states belong to whichever issue builds the conditions they describe |
| F142 | A fatal Worker error left `#disposed === false` and `#initialized === true`, so every subsequent call posted into a dead thread and hung forever — no error, no rejection, no signal | Repository | **Closed by repository fix** — `#terminate` records the fatal cause and both client guards throw it immediately; discovered by reproduction, not by reading |
| F143 | F138's containment half (`#materializationFailed`) is unreachable at test scale and therefore proven by nothing | Repository | **Closed by founder ruling** — the guard is kept, recorded as unproven at production scale rather than removed; explicitly distinguished from F130/F133, which were security controls that could read as enforced while inert. The at-scale proof is deferred and filed as a named follow-up on FDN-54 so it stays findable |

**Eighty-nine findings, seventy-eight closed.** Twelve stay open: F70, F73, F85, F118, F120, F125, F129, F132, F140 (second half) and **F130 (live, unmitigated)** remain unresolved, and F71 and F91 are recorded boundaries rather than defects — they close when the issues they name can prove them. F76 is a fact about the tool, not something to close.

*This count was itself stale, and F118 had dropped out of the open list entirely — the row was correct, the summary above it was not. Recounted from the table rows rather than incremented by hand, which is how it drifted: four findings were appended without the total being recalculated. If it disagrees with the table again, the table is right.*

**The registry now parses.** 109 node rows, every Privacy Class a member of the closed set, every tier either the class default or a registered departure, all 13 classes in use and none unused, every relationship traversable using only registered edges. That is the state FDN-45 needs in order to compile the registry to typed contracts, and it is checkable rather than asserted.

**The one that matters most is F66**, and it was not found by reading the documents against each other. It was found by being asked whether F55's correction was right for the product's users — which is a different question from whether it was right against the document, and it had a different answer.

---

## The findings, in detail

### F54 — Privacy Class is prose, not a closed enum

**This is the finding that blocks implementation**, and every other privacy finding below is a symptom of it.

`VPS-A002`'s node registry carries a Privacy Class column. `VPS-A004` carries a table of default permission mappings *by* Privacy Class. `VPS-A003` maps Privacy Class to a default Tier and calls the mapping **mechanical**. Three documents treat the value as a key into a lookup table.

It is not a key. It is a sentence.

The registry uses twenty-four distinct strings. `VPS-A004` defines fifteen classes. Eleven match exactly. The remainder fold three separately-enforced facts into one cell:

| String | Node | What it is actually saying |
|---|---|---|
| `Standard, Owner-write only` | ApplicationActivation | a class, plus a write authority |
| `Standard, shared with Vulto Projects` | Project | a class, plus a cross-application fact the Cross-Suite Node Ownership table already owns |
| `Standard, Employee-shaped scoping` | UtilizationSnapshot | a class, plus a restatement of that class's own default scoping |
| `HR-restricted; the employee gets None` | ProbationCheckIn | a class, plus the signal-clearing override `VPS-A004` already names and already carries |
| `Manager-restricted, Manager gets Full` | TimesheetAnomalyFlag | as above |
| `Sensitive, self-only` | PulseEntry, CoffeePulseEntry | two of `VPS-A004`'s class names concatenated, where the first alone is complete |
| `Provenance-determined — see Standing Rule 8` | Document | `VPS-A004`'s `Inherited`, under a different name, with a pointer attached |
| `HR Admin and Owner` | ImportBatch | `Owner and HR Admin only`, reordered and missing a word |

Three facts are being conflated, and each is enforced by a different mechanism at a different layer:

* **Privacy Class** — which roles get which grant. Owned by `VPS-A004`, enforced by its query interceptor.
* **Scope shape** — over which *instances* a grant applies: own only, direct reports, team, recipient. Currently expressed as parentheticals inside `VPS-A004`'s matrix cells, and leaking into `VPS-A002`'s class strings.
* **Write authority** — which *application* may write. Owned by `VPS-A002`'s Cross-Suite Node Ownership table, enforced by `VPS-F008` at write time.

**Correction.** `VPS-A004` now states that its table is the closed set — thirteen classes, after F59 and F65 removed two duplicate names. `VPS-A002`'s Privacy Class column carries exactly one member of that set per node half, and a new section defines the column's contract: which facts live in it, which were moved out and where they went, and the two notations it uses.

Each extracted fact went to the layer that enforces it. ApplicationActivation's Owner-write restriction became a row in `VPS-A004`'s matrix. Project's *"shared with Vulto Projects"* was already stated by the Cross-Suite Node Ownership table and was simply removed — Standing Rule 7 requires one answer, and this was a second. UtilizationSnapshot's *"Employee-shaped scoping"* was a restatement of `Standard`'s own default and was removed. TimesheetAnomalyFlag's and ProbationCheckIn's overrides were already in `VPS-A004`'s matrix and already named there as the signal-clearing pattern.

**Nothing in the permission model changed.** Every grant after this correction is a grant one of the three documents already stated. What changed is that the value became checkable — and checking it immediately produced F56, which had been sitting in four documents since they were written.

---

### F55 — HeadcountPlan's Privacy Class contradicts its own feature specification

`VPS-A002` line 200 records HeadcountPlan's Privacy Class as `Owner and Finance Admin`. That string is not a member of `VPS-A004`'s set, so it would surface under F54 regardless. It is recorded separately because it is not merely unparseable — it is **wrong**, and it excludes a role the workflow requires.

Three documents disagree with it, and they agree with each other:

* `VRS-F027` line 119, which owns the node: *"Finance-restricted, Tier 1 in full."* Line 290 repeats that the plan is Tier 1 in full and not split.
* `VPS-A004` line 134 grants HR Admin `Read`.
* `VRS-F027`'s own workflow requires it. A Requisition is raised *against* a plan and carries a `requisition_for` edge to it. An HR Admin who cannot read the plan cannot tell whether a requisition sits inside it, which is the judgment the approval exists to make.

**Correction.** HeadcountPlan's Privacy Class is `Finance-restricted`. `VPS-A004`'s existing matrix row — Owner `Full`, HR Admin `Read`, Finance Admin `Full`, Manager `None`, Team Member `None` — is the authoritative override and needs no change.

**Why the tier is unaffected.** Under A003-T06 a Tier 1 document's key is wrapped for exactly the roles the Privacy Class grants read access. HR Admin holds `Read` either way, so HR Admin is a keyholder either way. The correction changes what the document says, not who can decrypt.

The string was a plausible error: it reads like a description of who the plan is *for*. But `VPS-A003` was corrected once already to stop a tier implying a reader set, and this is the same mistake in the other direction — a reader set written where a class belongs.

---

### F56 — "HR-restricted" is used in four documents to mean a class that is not HR-restricted

**This began as one wrong table cell and turned out to be a vocabulary problem.** It is recorded at the length it is because the correction touched four documents, and because the failure mode it describes will recur the moment someone registers a node type for a record that feels like HR's business.

`VPS-A004` defines `HR-restricted` as a specific grant: Owner `Full`, HR Admin `Full`, **Finance Admin `Read`**, Manager `None`, **Team Member `Read (own only)`**.

Four documents used the name to mean *restricted to HR* — Owner and HR Admin, nobody else. That is a different class, and `VPS-A004` already defines it: `Owner and HR Admin only`. The two differ in exactly the two columns that matter most, and in each case the document's own behavioral prose describes the narrow class while its label names the wide one.

| Node | The label said | The same document's behavior said | Corrected to |
|---|---|---|---|
| HRCase, CaseEvent | `HR-restricted` identifying, *"content narrower still"* | `VRS-F046` line 191: *"The reader set is Owner and HR Admin only."* Line 195: **the subject of a case cannot read the case record**, with three paragraphs of reasoning | `Owner and HR Admin only`, both halves |
| OrgScenario | `HR-restricted`, in six places including a section heading | `VRS-F037` G08: *"Managers and Team Members have no access, including to scenarios covering their own team"* | `Owner and HR Admin only` |
| ProbationCheckIn | `HR-restricted; the employee gets None` | `VRS-F057` line 245: *"never seen by its subject."* And `VPS-A004` groups it with BurnoutAlert and TimesheetAnomalyFlag under the signal-clearing pattern, which is an override on **Manager-restricted** | `Manager-restricted` |

**OrgScenario is the case that shows why this is not pedantry.** `VRS-F037` spends a section and two decision notes establishing that a draft restructure must not reach the person whose role it removes — *"there is no version of that leak that is acceptable"*. `HR-restricted` grants Team Member `Read (own only)`. Implemented from the label rather than the prose, the class would have granted precisely the read the feature exists to prevent.

**ProbationCheckIn fails in the opposite direction.** `HR-restricted` grants Manager `None`. A probation check-in is written by a manager about a direct report. The label would have locked the author out of the record.

In all three, `VPS-A004`'s matrix already carried the correct grants. The matrix and the labels have disagreed since both were written, and nothing was positioned to notice, because a Privacy Class that is prose has no checker.

**Correction.** The labels are corrected to the class each document already describes, in `VPS-A002` and in `VRS-F037`, `VRS-F046` and `VRS-F057`. **No permission changes anywhere** — every grant after the correction is a grant `VPS-A004`'s matrix already stated. `VPS-A004` gains a sentence saying a class name is not a description of who reads the node, and `VPS-A002` gains the same warning where the column is defined.

#### The original finding, which stands

`VPS-A002` line 186 recorded HRCase as `HR-restricted identifying; content narrower still`. There is no narrowing: `VPS-A004` gives both halves identical grants, and `VPS-A002`'s own prose three rows below the cell says the halves *"follow the identical pattern."*

**What the split actually is.** The halves differ in Tier — 2 and 1 — and not in Privacy Class. `VRS-F046` line 187 states the principle: *"tier model determines protection strength; the reader set derives from Privacy Class."* The content half is Tier 1 because it holds allegations about named individuals and server-readable storage would put a customer's most sensitive employment records in Vulto's plaintext. That is a statement about **protection strength**, written into the **reader set** column.

**The generalizable part.** A tier split and a class split are different operations, and the `Split:` notation encourages conflating them. Employee, Pitch, Contract, Requisition and Offer split both. HRCase and CaseEvent split only the tier. The notation gave a reader no way to see the difference, which is how a tier fact reached a class column and stayed there. `VPS-A002` now says so where splits are introduced.

---


### F57 — Five Privacy Classes have no Tier default

`VPS-A003` line 80 onward maps Privacy Class to default Tier and calls it mechanical. The mapping covers `Standard`, `Finance-restricted`, `HR-restricted`, `Owner-restricted`, `Manager-restricted`, `Self-only absolute`, `Sensitive`, `Role-dependent` and `Inherited`.

`VPS-A004` defines fifteen classes. Five of them appear in no row of that mapping:

`Recipient-only` · `Self only` · `Self and Finance-restricted` · `Owner and HR Admin only` · `HR Admin only`

Each is in live use. Notification is `Recipient-only`. BriefingNode is `Self only`. PaySlip is `Self and Finance-restricted`. AuditEntry, RetentionPolicy, ErasureRequest and FlightRiskSignal are `Owner and HR Admin only`. BackgroundCheckProvider, BackgroundCheckRecord and ClientPortalAccess are `HR Admin only`.

Every one of those nodes has a tier recorded in `VPS-A002`, so nothing is currently ambiguous in practice. What is missing is the rule that produces it — which means the next node type registered under one of those five classes has no default to fall back on, and `VPS-A007`'s schema-conformance gate has nothing to check the tier against.

**Correction.** `VPS-A003`'s mapping gains the five missing rows, with defaults derived from what the existing registry already assigns.

---

### F58 — Nothing distinguishes a deliberate tier departure from an error

`VPS-A002` line 106 states the principle plainly: Privacy Class and Tier are **two orthogonal properties**. `VPS-A003` agrees, and describes its own Privacy-Class-to-Tier table as producing a *default*, with `VPS-A002` remaining authoritative for the actual assignment.

Both are right, and together they mean the registry will contain rows where the recorded tier is not the mapped default. Those rows are correct. They are also indistinguishable from mistakes.

HeadcountSnapshot is the clearest case: Privacy Class restricted to Owner, HR Admin and Finance Admin, and **Tier 0**. Under the mapping, a restricted class implies Tier 2. The Tier 0 is right — the node holds an aggregate headcount count, and who may see the analytics view is a permission question rather than an encryption one. But nothing on the row says so, and a reader checking the registry against `VPS-A003` finds what looks like a defect.

Expense is the counter-example that proves the pattern is understood: it sits at `Standard` and Tier 0 against an intuition that financial data is Tier 1, and `VPS-A002` line 257 gives a full paragraph explaining why. The explanation exists because someone anticipated the objection. HeadcountSnapshot got no such paragraph.

**Correction.** A tier that departs from `VPS-A003`'s default is marked as a departure and carries its reason, so the conformance gate can assert *either the default or a registered departure* rather than being unable to check the column at all.

---

### F59 — `Owner only` and `Owner-restricted` are one class under two names

`VPS-A004` line 78 defines `Owner only`: Full, None, None, None, None.
`VPS-A004` line 79 defines `Owner-restricted`: Full, None, None, None, None.

Identical, adjacent, and one line apart.

`VPS-A002` uses `Owner only` — IntegrationConfig is the single instance. `VPS-A003`'s tier mapping uses `Owner-restricted`, which no node in the registry carries. So the tier map has a row matching nothing, and the one node that needs that row reaches it only because both names happen to resolve to Tier 2 by coincidence of the author's intent rather than by any stated rule.

**Correction.** One name survives. `Owner only` is the one `VPS-A002` uses and the one that parallels `HR Admin only`, so `Owner-restricted` is removed from `VPS-A004` and `VPS-A003`.

---

### F65 — `Role-dependent` was a third name for `Inherited`

`VPS-A004` defined two adjacent classes:

* `Role-dependent` — *"Follows the Privacy Class of the nodes the record references"*
* `Inherited` — *"Follows the referenced or parent node's Privacy Class"*

The same mechanism, described twice. Insight carried `Role-dependent`; Document, CustomFieldValue, GraphReference, ReportRun and ApprovalStage carried `Inherited`.

`VPS-A002`'s Standing Rule 8 settles it without ambiguity, and settles it against the split: *"Document, **Insight**, CustomFieldValue, GraphReference, ReportRun and ApprovalStage have no fixed tier: each takes the tier of what it derives from."* All six, named together, governed by one rule. Insight was never doing anything the other five were not.

**The name was also actively misleading.** Every Privacy Class is role-dependent — that is what a Privacy Class is. A reader meeting `Role-dependent` in the registry has no way to know it means *inherited from provenance* rather than *varies by who is asking*, which is the more natural reading and the wrong one.

**Correction.** `Role-dependent` is removed from `VPS-A004`. Insight carries `Inherited`, and `VRS-F055` — which described Insight as *"Role-dependent, no fixed tier, inheriting from what it references"*, using both names in one sentence — now says `Inherited`.

---

### F60 — Reified relationships have no registered edges

A002-T03 requires every edge to be a first-class object with its own UUID and prohibits *"implicit foreign key joins not materialized as edge records."* Two registry rows describe a relationship that cannot satisfy it.

**`assigned_to`** is registered Employee → Project, annotated *"Via Assignment"* (line 361). Assignment is a registered node type. Its only registered edges are `logged_against` inbound from TimesheetEntry and `governed_by` outbound to RateCard. **There is no registered edge from Assignment to Employee, and none from Assignment to Project.**

**`member_of`** is registered User → Workspace, annotated *"Via WorkspaceMembership"* (line 348). WorkspaceMembership is a registered node type with no registered edges at all.

An implementer has two options and the registry sanctions neither. Putting `employee_id` and `project_id` on Assignment as properties is the implicit foreign key A002-T03 prohibits. Creating a bare Employee → Project edge discards the node carrying `effective_billing_rate` and the assignment lifecycle — and Assignment is the node the entire Bench Forecast is drawn from.

**A third pattern is in use for the same shape.** `contracted_with` (SubVendor → Project) carries `start_date`, `end_date` and `capacity_units` in edge metadata rather than a node. `has_skill` carries `proficiency_level`, `verified`, `verified_by` and `verified_at` the same way. So the registry contains relationships-as-nodes, relationships-as-annotated-edges, and relationships-as-both — with no stated rule for which is which.

**Correction.** The rule, stated once in `VPS-A002` where relationships are introduced:

> **A relationship is a node when it carries its own lifecycle status, or when another node must point at it. Otherwise it is an edge carrying metadata.**

**Lifecycle is the test because `VPS-A002` already made it one.** Every node carries `lifecycle_status`; no edge does. A relationship that moves Active → Completed → Canceled is a thing with a life, and modeling it as an edge means inventing a status field the edge conventions do not have. The second clause is forced rather than chosen: A002-T03 requires an edge's endpoints to be nodes.

**The rule reclassifies nothing.** Assignment and WorkspaceMembership become nodes — which is what both already were. `has_skill`, `contracted_with`, `allocated_to`, `holds_certification`, `managed_by` and `registered_on` stay edges. A rule that had forced any existing relationship to change shape would have been the wrong rule.

Four edges registered, with the node as the `from` and each named for what it expresses, following `incurred_by` and `attributed_to` on Expense:

| Edge | From → To |
|---|---|
| `assignment_of` | Assignment → Employee |
| `assigned_to` | Assignment → Project |
| `membership_of` | WorkspaceMembership → User |
| `membership_in` | WorkspaceMembership → Workspace |

**`member_of` is deleted and `assigned_to` re-endpointed.** Both described a traversal rather than a stored record. *Which employees are on which projects* is two hops through Assignment; registering an Employee → Project edge beside it would create a second answer to a question the graph already answers, which is the denormalization Standing Rule 7 exists to prevent. Neither name appeared in any document but `VPS-A002`, so nothing else moved.

---

### F61 — The edge registry does not state its own key

`governed_by` is registered four times, against four unrelated endpoint pairs: Assignment → RateCard, Employee → LeavePolicy, PayRun → PayrollPolicy, PayRun → TaxConfig. `part_of` is registered twice. `supersedes`, `references`, `affects` and `has_custom_value` are polymorphic across many types.

So `edge_type` alone is not a unique key, and the registry never says what is. The key is the triple of edge type, from-node type and to-node type. An implementation keyed on `edge_type` — the obvious first guess, and the one the column ordering invites — would silently collapse four distinct relationships into one.

`VPS-A002` already fixed a related defect deliberately: line 342 records that ambiguous multi-value rows reading *"From: A, B, C"* against *"To: X, Y, Z"* were removed because they did not say which connects to which. That correction established that endpoint pairs are load-bearing. It did not go on to say that they are therefore part of the key.

**Correction.** `VPS-A002` states the key: the triple of `edge_type`, from-node type and to-node type. This is an under-specification rather than a contradiction, and it is recorded because the wrong guess is cheap to make and expensive to find — four relationships collapsing into one produces a graph that is wrong in a way no type error catches.

---

### F62 — A Rule 11 fact is cited as Rule 10

`VPS-A002` line 645: *"Four k-anonymity thresholds become one mechanism, per Rule 10."*

Rule 10 is *"Every application registers its node types here."* Rule 11 is *"One k-anonymity mechanism."*

Off by one, and harmless in isolation. Recorded because the Decisions section is where a future reader goes to find out why a value is what it is, and a citation that lands on the wrong rule sends them somewhere unrelated.

---

### F63 — `VPS-A001` describes one build's job in terms of another's

`VPS-A001` line 63 states that `services/sync-engine` is *"compiled native for the server, WASM for the client"* and then gives one job description covering both: *"receive CRDT deltas, enforce permission-filtered relay per VPS-A004, persist to Postgres, relay to authorized devices."*

Three of those four are server responsibilities, and *persist to Postgres* is one a browser cannot perform. Read literally, the client build has no stated job.

`VPS-A003` settles the intent. A003-T10 requires the sync engine to be *"a single shared core library used identically across all platforms"*, and the sync topology at line 40 shows the device holding the canonical local graph while the server relays between devices without holding a canonical copy of anything. So the shared core does merge, encryption and protocol on both sides, and persistence is the server deployment's additional responsibility rather than the core's.

**This is imprecision rather than contradiction**, and it is recorded because it produced a real scope question at the start of this phase: what, exactly, does the client's WASM build do before `VPS-A003` exists? The answer turned out to be *nothing this project needs*, which is why the Rust sync engine is deferred — but the sentence should not have required reading a second document to resolve.

**Correction.** `VPS-A001` states the shared core's job and the server deployment's additional job separately.

**Closed by FDN-46**, which needed the answer before it could scope the TypeScript–Rust boundary: knowing which sync-engine responsibilities cross into the WASM build and which never do is what the package-boundary work depends on.

---

### F64 — `CLAUDE.md` and `AGENTS.md` are byte-identical duplicates describing a closed phase

**Closed by FDN-76.**

`docs/Prototype_Findings.md` carried this forward deliberately, recording it as *"a standing drift risk to resolve at that point"* — the point being the start of implementation. This is that point.

Three statements were stale:

* **Typefaces.** Both files named Plus Jakarta Sans, Manrope and Geist Mono. `VPS-D001` line 223 and `VPS-A001` line 139 both specify **Inter Variable** as the single product face, with tabular numerals *"rather than introducing a separate mono family"*. `apps/roster-web/src/app/layout.tsx` loads Inter. The instruction files were the last place the three-face version survived — a leftover from FDN-11, which the prototype log records as having settled on two faces and then on one.
* **Density.** Both files said *"both themes, both densities."* `VPS-D001` settled on one information-preserving product density, recorded as F20.
* **Phase.** Both declared a static prototype with mock data and no backend, and listed a closed seven-item scope.

**The duplication itself is resolved rather than re-synchronized.** `AGENTS.md` is now a symbolic link to `CLAUDE.md`. Two files that must never disagree, kept in agreement by hand, will eventually disagree — which is the same argument `VPS-A001` line 191 makes for one repository over two, applied to two files.

---

### F66 — Tier 1 keys are wrapped against the class default, ignoring `VPS-A004`'s overrides

**The most consequential finding in this log**, and it came from being asked to re-examine F55 against what the product actually needs rather than against what the documents say to each other.

A003-T06 decides who holds a decryption key for end-to-end encrypted data:

> *"wrapped for exactly the roles its node type's **Privacy Class** grants read access"*

That resolves against the class **default**. `Finance-restricted`'s default grants Team Member `Read (own only)`, and `VPS-A004`'s matrix overrides Team Member to `None` on four Tier 1 node types:

| Node | Class default for Team Member | Matrix says |
|---|---|---|
| HeadcountPlan | `Read (own only)` | `None` |
| PayRun | `Read (own only)` | `None` |
| Requisition (budget) | `Read (own only)` | `None` |
| Offer (terms) | `Read (own only)` | `None` |

Implemented literally, **every employee in the workspace holds a decryption key for the headcount plan, the payroll run, and every offer's compensation terms.**

**Why that is worse than it first sounds.** The permission interceptor would still refuse to return those rows, so nothing visibly breaks. But `VPS-A002`'s Rule 5 states the guarantee precisely: Tier 1 adds a third layer *beneath* sync filtering and query interception, and encryption is "the layer that holds when the first two fail or Vulto itself is compelled." A key wrapped for someone the interceptor denies makes the third layer depend on the second. Two layers that fail together are one layer.

**A second route to the same failure.** `Read (own only)` has no meaning on a workspace-scoped node. There is no *own* headcount plan and no *own* pay run. The grant was written for person-scoped records; applied to a workspace-scoped one it reads as everything rather than nothing.

**Was this created by F55?** No, but F55 made it reachable. Before FDN-74, HeadcountPlan's class was `Owner and Finance Admin` — not a class at all, so nothing could resolve against it. Closing the vocabulary made A003-T06 mechanically resolvable, and resolvable in the wrong direction. It applied to PayRun, Requisition and Offer before FDN-74 and would have applied after it regardless.

**Correction.** A003-T06 resolves against the **effective grant** — the class default as overridden by `VPS-A004`'s per-node matrix — and says the class default alone must not be used. The prose gains the reasoning, and the rule that **the reader set is derived once and consumed by both layers**, since key wrapping and query interception resolving it separately is how they come to disagree.

---

### F67 — No document says who reads an HRCase concerning the Owner

**Open. Raised, not decided** — this is a product and legal question `VRS-F046` owns, and `VPS-002` is explicit that a defect is reported rather than decided. Tracked as FDN-79.

`VRS-F046` states the HRCase reader set as Owner and HR Admin only, unconditionally, in five places. It addresses one adjacent case explicitly — line 60, a grievance raised by one employee against another — and never addresses a case whose subject is the Owner.

For the market this product is built for, that is not an edge case. A professional services firm of fifteen to sixty people is usually founder-led, and `VPS-A004` caps Owner at three per workspace. A grievance raised against the founder is read, by construction, by the founder.

It also defeats the protections `VRS-F046` spends a section building. Line 195 onward argues the subject cannot read the case because live access to an investigating officer's notes would make honest note-taking impossible — reasoning that applies with more force, not less, when the subject controls the workspace. Line 332 calls this the most sensitive feature in the product and lists exclusion from the subject's own view among five protections; for an Owner-subject case that protection is simply absent.

**Why it is not resolvable here.** Excluding an Owner from cases concerning them means a case exists that its own workspace administrator cannot see, with consequences for account recovery, `VPS-F007` export, and what an Owner is told exists at all. Routing such cases outside the product avoids the modeling problem and means the product does not serve the situation it is most needed in. Doing nothing is defensible for an early workspace. There may also be a jurisdictional floor that is not a product decision.

**What is needed** is a founder decision recorded in `VRS-F046`, whichever way it goes — including "not handled at launch." An unstated gap in the most sensitive feature reads as an oversight to the next person, and this one would not be.

---

### F68 — Client is registered twice, with different owner attributions

Found by the verification pass for F60, not by reading: a script counted 110 registry rows but only 109 distinct node types.

`Client` appears in the Core people and capacity table with owner *"Vulto Sales"*, and again in the Vulto Projects section with owner *"VPJ-F001 bootstrap; Vulto Sales permanent"*. The Cross-Suite Node Ownership table then states it a third time, which is that table's job and is correct.

The two registry rows are not contradictory so much as unequal — the first omits the bootstrap the second records. But Standing Rule 10 is unambiguous that *what node types exist* has exactly one answer, and FDN-45's own done criterion requires duplicate names to fail validation. A registry that ships with a known duplicate trips its own checker on day one.

**Correction.** One row, in the Core people and capacity table, carrying the complete attribution: `Vulto Sales` permanent, `VPJ-F001` bootstrap. The Vulto Projects duplicate is removed. Client stays in the core table rather than the Projects section because its permanent owner is Vulto Sales, which makes it no more a Projects node than a Roster one, and because Roster reads it directly through `belongs_to`.

**Worth noting how this was found.** Nothing in the prose was wrong enough to catch by reading, and both rows are individually plausible. It surfaced because a count of rows disagreed with a count of names — which is the kind of check the conformance gate exists to run, arriving three issues before the gate does.

---

### F69 — `VPS-A004` has one denial outcome where `VPS-D004` has two

Surfaced by FDN-79 and **not created by it.** The contradiction is older than the decision that exposed it.

`VPS-A004` defines a denial once: *"`None` = **structurally absent** from query results, not hidden and not redacted."* One outcome.

`VPS-D004` defines two, and calls the choice between them *"a security decision rather than a stylistic one"*: **structurally absent** where the existence of the data is itself sensitive, and **visibly restricted** where existence is unremarkable but content is not. A004-T10 then requires permission absence to render per `VPS-D004`'s states — while `VPS-A004`'s own vocabulary can only produce one of the two.

**The two documents already disagree on a concrete case.** `VPS-D004` names *"a salary field"* and *"an HR-restricted contract"* as visibly-restricted examples. `VPS-A004` grants Manager `None` on Employee (compensation) — structural absence. And `VPS-002` and the built prototype both describe *"the structurally-absent compensation section."* Two documents and one implementation say absent; one document says visible with a lock.

**Partly closed.** FDN-79 gives `VPS-A004` the second outcome it was missing — `None` and `Restricted` as distinct denials, with A004-T18 requiring each to render as its `VPS-D004` counterpart — and applies `Restricted` to exactly one case, HRCase's excluded subject.

**Deliberately not closed:** which of the roughly thirty other `None` cells should become `Restricted`. That is a per-node judgment about whether the *existence* of each record is sensitive, it touches the permission matrix broadly, and it is a decision rather than a correction. Every unqualified `None` remains structural absence until a document says otherwise, which is stated in `VPS-A004` so the ambiguity cannot be resolved by guessing.

The salary field is the case to settle first, because it is the one where the documents demonstrably disagree today.

---

### F70 — FlightRiskSignal has the same shape as HRCase

**Open. Raised, not decided**, on the same grounds F67 was: it is a product judgment rather than an implementation one.

FlightRiskSignal is `Owner and HR Admin only` and carries a `triggered_by` edge to the Employee it concerns. An Owner or HR Admin flagged as a flight risk reads their own flight-risk signal — structurally identical to the HRCase gap FDN-79 just closed.

**The stakes are much lower**, which is why it is recorded rather than fixed by extension. A grievance narrative reaching its subject damages a procedure; a retention signal reaching its subject is closer to embarrassing. It may well be acceptable, and FDN-79's subject exclusion now exists as a registered mechanism if it is not — `VRS-F053` need only register HRCase's pattern against `triggered_by`.

**OrgScenario is a third instance and a harder one.** It is `Owner and HR Admin only`, and a scenario proposing to remove an HR Admin's role is readable by that HR Admin. Unlike a case, a scenario has no single subject — it is a whole proposed hierarchy — so *whom to exclude* is not a lookup along one edge. `VRS-F037` already accepted a related cost knowingly, so this may be a decision already made; it is recorded so that it is visibly one.

**What these three share** is the pattern worth naming: a reader set written as a role list, on a node that is *about a person*, where that person may hold one of the roles. FDN-79 fixed the instance where it mattered most. The pattern is now documented in `VPS-A004`, so the next node type of this shape can be checked against it rather than rediscovering it.

---

### F71 — `A007-T18` is not satisfied and cannot be yet

**A recorded boundary, not a defect.** It closes when the issues named below are built, and it is written down so that a reader meeting a three-service compose file can tell a deliberate gap from drift.

> **A007-T18** — `docker compose` MUST bring up the full local stack, with synthetic fixtures, in one command.

What comes up today is Postgres, Redis and the sync-engine placeholder. What does not exist:

| Missing | Owner |
|---|---|
| `services/jobs` | FDN-57 |
| `services/render` | FDN-70 |
| Synthetic fixtures | FDN-55 |
| `services/cross-tenant-aggregation` | **nothing — see F73** |

`VPS-A007` is not the Core Engineering phase's specification and FDN-55 owns the pipeline, so nothing in `VPS-A007` is amended for this. The gap is recorded here and in `docs/Bootstrap.md`, which carries the same table beside the bootstrap path a reader is following when they notice it.

---

### F72 — `VPS-A007`'s first gate cites the wrong requirement

`VPS-A007`'s first gate lists the lint rules `VPS-A001` requires, and ends with:

> **No direct Loro access outside the sync engine and materialization worker**, per `VPS-A001`'s **A001-T05**.

`A001-T05` is the one-repository rule — new applications live under `apps/` and a repository per application is prohibited. It has nothing to do with Loro. The requirement being cited is **A001-T06**, which puts Loro merge and SQLite materialization in a dedicated Web Worker and forbids the main thread from importing `wa-sqlite` or processing a delta.

**This is F62 in a different document**, and F62's argument applies unchanged: a gate section is where a reader goes to find out why a rule exists, and a citation landing on an unrelated requirement sends them somewhere useless.

**How it surfaced is the part worth keeping.** The rule was implemented correctly — the lint harness cites A001-T06 — because the requirement was read rather than the pointer followed. The right answer was reached while holding a document that gave the wrong number. That is the argument for this log continuing to exist: a citation defect produces no symptom at the point where it is wrong, only later, for someone with less context.

**Correction.** `VPS-A007`'s gate now cites A001-T06. Nothing else in `VPS-A007` is touched.

---

### F73 — `services/cross-tenant-aggregation` is owned by no issue

**Open. Raised, not decided.**

`VPS-A001`'s repository structure names ten services and applications. Nine map to an issue. This one maps to nothing.

It is not an incidental service. `VPS-A001` calls it *"the one deliberate exception to this stack's per-workspace model"*, and `A001-T08` gives it the hardest isolation constraint in the document:

> MUST NOT share a database, connection pool or process boundary with per-workspace data paths, and MUST receive only anonymized, pre-bucketed contributions.

It serves `VRS-F071` and `VRS-F072`, both late-phase, so its absence from the current plan is reasonable. What is not reasonable is that **a service with a stated isolation requirement has nobody scheduled to build it correctly** — and isolation constraints are the kind that get satisfied by accident and then quietly violated by a later convenience.

Recorded rather than resolved: whether it needs an issue now, or a note in the register saying it is deliberately unscheduled until `VRS-F071`, is a planning decision.

---

### F74 — a driver's return type is not stable across runtimes, and one error handler reported a healthy database as down

Not a specification defect. Recorded because the second half is a mistake this project has already decided is worth preventing one layer down, and it was made anyway.

**The surface bug.** `SELECT now()` through `postgres-js` returned a `Date` under plain `node` and the string `2026-08-12 17:56:00.458496+00` under `tsx` — same query, same database, same driver version. The code called `.toISOString()` on it. That string is also not valid ISO 8601: Postgres renders the offset `+00` where ISO wants `+00:00`, so a naive re-parse produces `Invalid Date` and `.toISOString()` throws a `RangeError` rather than returning null.

**The real bug, and the one worth the entry.** The whole procedure sat inside one `try`. So when the caller's own type assumption threw, the handler reported:

> `database: "unreachable"`, `detail: "row?.now?.toISOString is not a function"`

Postgres was up and answering in 52 milliseconds. The diagnostics page said the database was down. **The database was fine; the caller was broken**, and the interface could not tell the difference because both states resolved to one value.

That is precisely what `VPS-A001`'s A001-T07 exists to prevent one layer down — a `NULL` cannot distinguish not-yet-synced from permission-denied from genuinely-empty, so the materialization worker carries a separate marker. The same collapse was reintroduced in the first thing built on top of it. The cost is concrete: someone reads "unreachable" and restarts a database that was never the problem.

**Correction.** Only the query is inside the `try`, so only a genuine connection failure can produce `unreachable`. Normalization runs after it and cannot throw — the invalid case is checked with `Number.isNaN` rather than caught by an optional chain, since `toISOString()` throws rather than returning null. Verified in both directions: Postgres up gives `ok` with an ISO timestamp; Postgres stopped gives `unreachable — ECONNREFUSED` rather than a 500.

**Worth keeping about how it was found.** Every static check passed. `pnpm verify` was green, TypeScript was satisfied — `sql<{ now: Date }[]>` is an *assertion* about what the driver returns, not a check of it, and the driver was under no obligation to agree. It surfaced only when the database was actually running and a real query came back. A stack that has never had its dependencies up has not been tested.

---

### F75 — the devcontainer named a user its image does not have, and mounted the repository's parent

**The first time `A007-T14`'s configuration was ever executed, it failed.** Two defects, one fatal and one latent, in a file that had been written, reviewed, committed and pushed without ever being run.

#### The fatal one

```
Shell server terminated (code: 126, signal: null)
unable to find user node: no matching entries in passwd file
```

`devcontainer.json` set `"remoteUser": "node"`. The workspace container is built from `mcr.microsoft.com/devcontainers/base:trixie`, which creates `vscode` at uid 1000 and no user called `node`. Verified directly:

```
$ docker run --rm mcr.microsoft.com/devcontainers/base:trixie     sh -c "getent passwd vscode; getent passwd node || echo 'node: ABSENT'"
vscode:x:1000:1000::/home/vscode:/bin/bash
node: ABSENT
```

`node` is the user in the **javascript-node** images. Installing the Node feature does not create one — it installs Node into `/usr/local/share/nvm` and leaves users alone.

**What makes this worth recording is the shape of the failure.** Every prior step succeeded: both images built, the Node and Rust features installed, the Rust crate compiled under `--locked`, all four containers started, Postgres and Redis reported healthy. The container was then discarded on the last line, and the Codespace fell back to a recovery container. A log that is 99% success and 1% fatal is the one where reading only the last line tells you *what* broke and nothing about *why*, and reading only the first screen tells you everything is fine.

#### The latent one, which the fatal one hid

The overlay mounted `..:/workspace` and `devcontainer.json` set `"workspaceFolder": "/workspace"`.

**Compose resolves a relative path against the project directory** — the directory of the *first* compose file, which is the repository root where `docker-compose.yml` lives — **not against the file the path is written in.** So `..` meant the repository's parent.

The failed build's merged configuration shows it plainly:

```
source: /var/lib/docker/codespacemount/workspace     <- parent
target: /workspace
```

with the repository at `.../workspace/vulto`. Reproduced locally against the same files:

```
OLD mount: /Users/shaheerjameel/Development -> /workspaces/vulto
repo root:  /Users/shaheerjameel/Development/vulto
```

Had `remoteUser` been right, the Codespace would have opened successfully **on the wrong folder** — the directory containing the repository, with no `package.json` at its root — and the failure would have presented as a confusing empty workspace rather than a clear error.

**Correction.** `remoteUser` is `vscode`. The mount is `.:/workspaces/vulto` and `workspaceFolder` matches it. Codespaces independently mounts the parent at `/workspaces`, so `/workspaces/vulto` is the repository in both environments and the two mounts agree rather than compete.

#### What this says about the practice

`A007-T14` exists because the Codespace is a security control, and this is the second time in two issues that a thing which passed every static check failed on first execution — F74 was the first. Both were found by running something, neither could have been found by reading it.

**A configuration file that has never been executed is a draft**, whatever its review status.

---

### F76 — rebuilding a Codespace does not pull latest

Not a specification defect and not a repository defect. Recorded because it cost a diagnostic cycle: F75's fix was correct and pushed, and two rebuild attempts still failed with the pre-fix error.

**A Codespace rebuild re-reads `.devcontainer/` from the checkout already inside the Codespace.** It does not fetch or pull from origin first. A commit pushed after the Codespace was created is invisible to a rebuild until something inside the Codespace pulls it — `git pull`, or a fresh Codespace created after the push.

**The reliable fix is deleting and recreating the Codespace**, not rebuilding it. A rebuild on a stale checkout reproduces the old failure exactly, which reads as "the fix didn't work" when the fix was never in the container that ran.

---

### F77 — the devcontainer had no Docker client

The same defect as F75, found the same way: a config file that had never been run.

`devcontainer.json`'s `features` block installed Node and Rust. It installed nothing that provides a `docker` binary. The workspace container has no way to run `docker compose` on itself — `docker: command not found` — despite `docs/Bootstrap.md` and this repository's own `package.json` scripts (`stack:up`, `stack:down`) assuming it can.

**F75 exposed the placeholder-user defect because that failure occurs during container creation, before a shell is ever reached. This one only surfaces once someone is inside a working shell and tries to use Docker** — which is why it survived F75's fix and the rebuild that confirmed it, and was only found on the first Codespace that actually opened.

**Correction.** `ghcr.io/devcontainers/features/docker-outside-of-docker:1` added, not `docker-in-docker`. The workspace container needs to control the *same* daemon already running its siblings — `postgres`, `redis`, `sync-engine`, brought up by the outer compose file this devcontainer extends via `dockerComposeFile`. `docker-in-docker` starts a second, isolated daemon inside the workspace container that cannot see those siblings: `docker compose ps` run from a Codespace terminal would show nothing, because the containers it is asking about live on a different daemon. `docker-outside-of-docker` mounts the host's socket instead, so `docker` commands issued inside the Codespace see and control the stack that is already running. It is also lighter — no nested daemon to boot.

Checked before adding it: neither `VPS-A007`'s Containerization section nor A007-T14 states a preference between the two. This is a fresh decision, not a contradiction of one already made.

**Two configuration defects found in one devcontainer, both by the same mechanism — running it for the first time.** Between F75 and this: a user the image doesn't have, a mount pointed at the wrong directory, and a tool the container never installed. None of the three would surface in a diff review. All three surfaced within the first Codespace that actually opened.

---

### F78 — the Docker feature's default packaging is unavailable on the base image's distribution

**The third defect in `.devcontainer/`, and the third to appear at a phase the previous fix never reached.**

F77 added `docker-outside-of-docker`. The feature resolved and fetched correctly, then failed during its install step:

```
(!) The 'moby' option is not supported on debian 'trixie' because
    'moby-cli' and related system packages are not available in that
    distribution.
```

The feature defaults `moby` to `true`, installing Moby's packages from the distribution's own repositories. Debian trixie does not carry `moby-cli`.

**Correction: `"moby": false`.** That installs Docker CE's CLI from Docker's apt repository instead, which does publish for trixie — verified against `download.docker.com/linux/debian/dists/` rather than assumed. It is the first remedy the feature's own error message offers.

**The base image stays trixie**, which is the feature's second suggestion and the larger call. Three reasons, in order of weight:

1. `services/sync-engine` pins `rust:1.97.1-slim-trixie` and `debian:trixie-slim`. Moving the development image to bookworm would put the environment where the sync engine is developed on a different Debian generation from the images it is built and shipped in.
2. Changing a base image is a pinning decision under `A007-T16`, which requires such changes to be deliberate and reviewed. Swapping one to route around a feature's packaging default is not that.
3. `moby: false` is a supported option that resolves the failure completely. The larger change buys nothing the smaller one does not.

**Honest provenance, since it bears on reason 1:** trixie was *not* chosen for that alignment. It was written into the devcontainer with no comment justifying it, following the Dockerfile's choice, which itself followed from picking the current Rust slim variant. The alignment argument is real and it is now recorded — but it was found while answering this question, not applied when the file was written.

#### The pattern, stated plainly

Three defects in one file, each surfacing at a phase the previous fix never reached:

| Defect | Surfaced at | Why the previous fix could not have caught it |
|---|---|---|
| F75 — user the image lacks | container **creation** | earliest possible phase; nothing ran before it |
| F77 — no Docker client | first **shell** | creation had to succeed before a shell existed to try `docker` in |
| F78 — Moby unavailable on trixie | feature **install** | only reached once a feature that installs something was added |

Same root cause every time: **the configuration had never been executed against the environment it targets.** Each fix advanced the build to the next unexecuted phase, which then failed. This is F75's principle — *a configuration file that has never been executed is a draft* — demonstrated three times rather than learned once.

The corollary worth keeping: **a fix to an unexecuted config does not make it correct, it makes it correct up to the point previously reached.** Expect the next phase to fail until one full run completes end to end.

---

### F79 — the development image was pinned by tag

Found while fixing F78, in the line above the one being changed.

`A007-T16` is unqualified: *"Every base image is pinned to a digest, never a tag."* `VPS-A007` names three image roles, and Development is one of them. The workspace container read `mcr.microsoft.com/devcontainers/base:trixie` — a tag.

Every other base image in the repository was already pinned: `postgres`, `redis`, and both stages of the sync engine's Dockerfile. The development image was the single exception, and the one whose reproducibility `A007-T14` most directly depends on — `VPS-A007` says so itself: *"a Codespace is defined by a container image. Without one, each developer gets whatever the base image happened to contain that week."*

**Correction.** Pinned to `sha256:025b74bb…`, resolved from the registry and cross-checked against the digest reported when the image was pulled locally during F75's investigation.

---

### F80 — Turborepo strips undeclared environment variables, and a localhost default hid it

The Codespace reached Postgres from every direction except the one that mattered: containers healthy, `psql` fine, and the API reporting

```
unreachable — ECONNREFUSED connect ECONNREFUSED 127.0.0.1:5432
```

while `docker-compose.devcontainer.yml` set `DATABASE_URL=postgres://vulto:vulto@postgres:5432/vulto`. The API was dialling `127.0.0.1`, a value nothing in the repository configures.

**Two defects compounding, and the second is the one worth keeping.**

#### Turborepo's strict environment mode

Turborepo 2.x defaults `envMode` to `strict`: a task receives a built-in system allowlist and **nothing else** unless declared in `turbo.json`. `DATABASE_URL` was declared nowhere. `pnpm dev` runs the API through `turbo run dev`, so the container's correctly-set variable was stripped before the process started.

Demonstrated rather than inferred — same command, same shell, one through Turborepo and one not:

```
through turbo : {"DATABASE_URL": null,   "PATH": true}
directly      : {"DATABASE_URL": "postgres://…@postgres:5432/vulto", "PATH": true}
```

`PATH` survives because it is on the system allowlist. `DATABASE_URL` does not, because nobody said it should.

#### The default that made it invisible

`db.ts` read `process.env.DATABASE_URL ?? "postgres://vulto:vulto@localhost:5432/vulto"`.

**On a laptop that default is correct.** Compose port-maps Postgres to the host, the API runs on the host, and `localhost:5432` *is* the database. In a Codespace it is wrong: the API runs inside the workspace container, where `localhost` is that container and Postgres is the sibling host `postgres`.

So the environment variable was never reaching the process **on the laptop either.** The same defect was present in every local run from the day the API was written, and produced three green hops and a passing acceptance transcript, because the guess happened to match. It became visible only when an environment arrived where the guess was wrong.

**A default that is right in one environment is not a default. It is an undetected failure with a local alibi.**

That is F74's shape again — there, an error handler reported a healthy database as unreachable; here, a fallback reported a broken configuration as working. Both convert a real problem into a plausible-looking answer, and the plausible answer is worse than the error, because an error gets investigated.

#### Correction

`turbo.json` declares `globalPassThroughEnv` for runtime configuration — `DATABASE_URL`, `REDIS_URL`, and the API's host, port and origin. `passThroughEnv` rather than `env` because these are runtime values, not build inputs: changing a database URL should not invalidate a typecheck cache. `VULTO_DIAGNOSTICS` goes in `build.env` instead, since it genuinely changes build output.

`services/api/src/env.ts` resolves configuration once, in a stated order:

1. the real environment, whatever the container or shell already set;
2. `.env` at the repository root, for local development;
3. nothing — throw, naming the variable.

`process.loadEnvFile` fills gaps and never overwrites, verified rather than assumed. **That ordering is load-bearing:** `.env.example` says `localhost`, and a `.env` copied from it inside a Codespace would otherwise override the container's correct value and reintroduce this exact bug.

Verified end to end against a running database, including that precedence holds where it matters — with both a `.env` and an environment variable present, Postgres's own `pg_stat_activity` confirms the connection arrived from the environment variable, not the file.

---

### F81 — a doc comment claimed a WASM compile failure that testing proved false

Found while building FDN-46's multi-target proof for `services/sync-engine`, and worth recording precisely because it is the same mistake this log has caught twice already (F55's HeadcountPlan wording, F74's error handler) in a new shape: an assertion written with confidence and never run against reality.

The crate was restructured into a `[lib]` (the shared core) and a `[[bin]]` (the native placeholder server), and the reason given — in both `Cargo.toml`'s comments and `main.rs`'s module doc — was that `main.rs`'s `TcpListener` *"needs an OS socket, which neither WASM nor a mobile FFI target has,"* stated as why building `--lib` alone was necessary rather than merely tidy.

**Building the whole package for `wasm32-unknown-unknown` proved that false.** It compiled cleanly, producing a 22.7KB artifact. Rust's `std` ships stub network types for that target rather than refusing to build them — `TcpListener::bind` exists at compile time and would fail only at runtime, which is a different and much weaker claim than "cannot compile."

**The split was kept, for a reason that survived being checked.** `--lib` alone produces the 43-byte artifact the shared core actually is, rather than a 22.7KB bin nothing will ever load, and it is insurance against the day `main.rs` gains a genuinely native-only dependency — a Postgres driver, `tokio`'s epoll bindings — that has no `wasm32` story at all and would fail for real. That argument does not need the false one to stand.

**Corrected** in `Cargo.toml`'s comment and `lib.rs`'s module doc, both stating what was tried, what was found, and why the false claim's conclusion still held for a different reason. Left the wrong reasoning visible rather than deleting it silently — a future reader re-deriving the same false shortcut is exactly what a corrected-in-place comment prevents.

---

### F82 — `FDN-46` and `FDN-49` both claimed "package dependency boundaries"

Not a specification defect — a Linear defect, the same shape as F68's duplicate Client registration. Found while writing FDN-46's decision memo and confirmed by the person reviewing it before any code existed to paper over the disagreement.

FDN-49's scope read *"Enforce approved graph access and package dependency boundaries."* FDN-46's own done criteria independently read *"Automated verification detects a dependency-direction or boundary violation."* Two issues, the same enforcement claimed by each, written months apart with no reference to the other.

**Correction.** FDN-46 keeps package dependency direction — it is generic across every package, not specific to the graph, and was already in FDN-46's own done criteria rather than borrowed from FDN-49's. FDN-49 keeps *graph* access enforcement specifically — raw Loro reads and raw SQL bypassing the typed query interface, per A001-T03 and A002-T05 — because that check is meaningless without the registry context FDN-49 already owns and FDN-46 does not. Recorded in both issues, each stating why the other kept what it kept rather than one silently losing a line.

---

### F83 — `None` and `Restricted` had a stated distinction but no rule for which cell gets which

FDN-79 gave `VPS-A004` the vocabulary — two denial outcomes instead of one, a table stating what each returns — and applied `Restricted` to exactly one case, HRCase's excluded subject. Everything else stayed `None`, including cells where two documents and a working prototype already disagreed about which was correct (F69). The vocabulary existed; the rule for using it did not.

**The rule, decided:** `Restricted` where the record exists for everyone in that position — a locked box discloses nothing if everyone has one. `None` where its existence is a fact about that particular person — the lock *is* the disclosure there, and protecting the content does not fix a leak the interface commits by rendering at all.

**Not a new principle.** `VPS-A005`'s A005-T07 already bars every Tier 1 and Tier 3 node type from the mention picker on identical reasoning — *"a reference a viewer cannot decrypt still reveals that something was mentioned."* The picker and a profile's restricted field are the same leak on two surfaces. FDN-80 extends a decided principle rather than inventing one, and a cross-reference now sits in `VPS-A005` confirming A005-T07 is unaffected — checked explicitly rather than assumed, since the two rules governing adjacent surfaces is exactly the situation where one could be silently weakened by the other.

**Checked and corrected before it shipped:** a first draft of the extension claimed WellnessTriggerEvent, PulseEntry, CoffeePulseEntry *and FlightRiskSignal* all fell under A005-T07's Tier 1/3 bar. FlightRiskSignal is Tier 2 — verified against `VPS-A002`'s registry rather than assumed from memory. It stays `None` on this rule's own merits (its existence per employee is not universal), not because A005-T07 reaches it. The sentence was corrected rather than left as a plausible-sounding overclaim.

#### Three checks, done before any cell was touched

**Can a locked box even be rendered, given a Tier 1 field's ciphertext never reaches an unauthorized device?** Yes, and the mechanism is the whole reason the rule works at all: `Restricted` is drawn from the node *type's* schema — "this node type always has this field" — never from data received about the specific instance. `VPS-A002`'s registry already guarantees Employee's compensation half exists on every Employee node; the client needs no bytes about a particular employee to know that, only its own copy of the schema, which every device has regardless of tier authorization. Recorded as A004-T19: a `Restricted` render for a Tier 1 or Tier 3 field must be schema-derived, never instance-derived. This is also what keeps the rule from ever applying to an optional, cardinality-variable related record — an HRCase, a FlightRiskSignal — where the device may hold nothing at all and there is nothing but the sensitive fact itself to render from.

**`VRS-F022`'s second contradiction, resolved.** See F84.

**Does anything here weaken A005-T07's absolute bar?** No, confirmed explicitly in both directions — a note in `VPS-A004` stating no node type is reclassified into picker-eligibility, and the cross-reference now in `VPS-A005` itself.

#### Five cells reclassified

Employee (compensation), Manager: `None` → `Restricted`, "Visible to Finance Admin" — the flagship case, where the documents already disagreed.

Contract (identifying), Manager → `Restricted`, "Visible to HR Admin." Contract (content), Manager → `Restricted`, "Visible to Finance Admin." Every active employee has at least one employment Contract, by definition of being employed — distinguished carefully from a *Document* in `VRS-F022`'s vault, which is not guaranteed the same way. See F84.

Requisition (budget), Manager → `Restricted`, "Visible to Finance Admin." Manager already reads Requisition's identifying half; the budget half is a guaranteed sibling on the same node.

Workspace (billing) — a gap the existing matrix never named as its own row. Every workspace has exactly one billing and subscription state, structurally guaranteed, and the four non-Owner roles previously got an undifferentiated `None` from the `Owner only` class default. Now `Restricted`, "Visible to Owner," for HR Admin, Finance Admin, Manager and Team Member alike.

#### Everything else, checked and kept at `None`

WellnessTriggerEvent, PulseEntry, CoffeePulseEntry — absolute, Tier 3, A005-T07 and A003's own acceptance criterion both require it. BurnoutAlert, TimesheetAnomalyFlag, ProbationCheckIn, FlightRiskSignal — each an optional signal about a specific person; the signal-clearing pattern's own reasoning already explains why the subject is not automatically its audience, and the same logic bars an unrelated role. Invoice, WorkAuthorization, CompensationChange — instance-informative (not every employee has one). HRCase, CaseEvent, OrgScenario — the case this project has already reasoned through twice (F56, FDN-79); existence itself is the sensitive fact. Document (provenance-elevated) — the vault case, see F84. Candidate-pipeline node types, TalentPool, SubVendor — mostly moot, no anchor screen for the roles in question. AuditEntry, ImportBatch, ErasureRequest, RetentionPolicy — access-event metadata, existence is exactly what these protect.

**Three cells did not sort**, and per the rule's own instruction to default conservative on ambiguity, none were forced. See F85.

#### The asymmetry, recorded as the thing worth keeping

Moving a cell from `Restricted` to `None` only removes information a viewer had, and needs no review to be safe. Moving a cell from `None` to `Restricted` adds information — even "this type of thing exists" is information — and needs the same scrutiny any other access widening gets. Recorded in `VPS-A004`'s Decisions section so a future change tightening toward `None` reads as a bug fix and one loosening toward `Restricted` reads as a decision, rather than both reading as equally casual.

---

### F84 — `VPS-D004`'s "an HR-restricted contract" example conflated a guaranteed node with an optional vault document

The second contradiction the founder asked to be checked before implementing anything, and it resolved cleanly once F83's rule existed to resolve it against.

`VRS-F022` already states, explicitly and with reasoning: *"A Tier 1 document a viewer cannot open does not appear as a locked row. It is structurally absent... because the existence of a signed contract for a specific person is itself an inference a Manager should not draw from a grayed-out entry."* `VPS-D004` separately named *"an HR-restricted contract"* as its own worked example of the opposite treatment, visibly restricted.

**Both are correct, and they were never actually describing the same object.** `VRS-F022`'s claim is about a `Document` row in the encrypted vault — a specific uploaded file, whose presence is optional and whose cardinality varies per employee. Which document types exist for a given person is informative, exactly as `VRS-F022` argues. `VPS-D004`'s intended example was the Contract *node* — the structured record of employment terms, which every active employee has at least one of, by definition of being employed. A guaranteed field on a guaranteed node, and a variable-cardinality related record, are the two branches F83's rule exists to separate, and `VPS-D004`'s illustrative phrase sat exactly on the seam between them.

**Correction.** `VPS-D004`'s example changed to *"a Contract's own commercial terms once its identifying half is already visible"* and a Requisition budget-line example, both unambiguously the guaranteed-node case. A new paragraph states the distinction directly and cross-references `VRS-F022`'s reasoning rather than repeating it, so the vault case's correct treatment is confirmed rather than silently left to look like a leftover contradiction.

**Nothing in `VRS-F022` changed.** Its resolution was correct from the start; only `VPS-D004`'s example needed correcting to match it.

---

### F85 — PayRun, HeadcountPlan and HeadcountSnapshot don't sort under the `None`/`Restricted` rule

**Open. Raised, not decided**, per the founder's own instruction: where a cell genuinely doesn't sort, it stays `None` and gets listed rather than guessed at.

All three are workspace-scoped operational or analytics objects rather than records *about* a specific person, so F83's test — does everyone in this position have one — does not cleanly apply to any of them. A PayRun is not "a thing an employee has"; it is a scheduled company-wide event a specific PaySlip belongs to. HeadcountPlan is not a split node at all — it is `Finance-restricted` in full, per `VPS-A002`'s registry — so there is no partially-visible identifying half for a lock to sit next to, which is the structural precondition every one of the five reclassified cells shares. HeadcountSnapshot is an aggregate headcount count, closer to an analytics artifact than a record with a subject.

**Why forcing an answer would have been the wrong instinct.** A `PayRun`'s existence is arguably common knowledge — every company running payroll has PayRuns on a schedule — which would suggest `Restricted` costs nothing. But `HeadcountPlan`'s existence might carry real strategic sensitivity even without content — a Manager learning "a Finance-restricted plan exists for Q3" is arguably learning something already, before any lock is rendered. The two pull in different directions under intuitions this rule was not built to adjudicate, and `HeadcountSnapshot` sits closer to a tooling-scope question than a privacy one. Three different shapes of ambiguity, not one.

**What is needed:** a founder decision per cell, or a decision that the current conservative default is correct and should stay. Either is a fine answer, consistent with `VPS-A004`'s own note that the direction to be wrong in is known — leaving these at `None` costs nothing to reverse later. Tracked as **FDN-83**, low priority, since conservative is safe and nothing depends on this resolving first.

---

### F86 — `FDN-45` claimed schema ownership broader than `VPS-A002` actually carries

`FDN-45` said the canonical registry would contain *all lifecycle statuses* and *100% of A002's schema*. Parsing the registry proved that only 28 of its 109 node rows declare a lifecycle enum; the other 81 point to feature specifications that own those states. Workspace configuration is likewise field-level schema owned by its features, not a node-registration fact.

**Correction.** The issue now distinguishes 28 fixed lifecycle policies from 81 feature-owned policies and excludes workspace field configuration. The registry records that ownership boundary explicitly instead of inventing values to make an over-broad done criterion pass.

---

### F87 — “Universal without exception” contradicted three deliberate omission shapes

`VPS-A002` said every node carries the universal shape *without exception*. `VPS-F004` intentionally omits `updated_at`, `updated_by` and all soft-delete fields from immutable `AuditEntry`; `VRS-F048` and `VRS-F078` intentionally omit `created_by` from their anonymous contribution nodes. `VPS-A007` named only AuditEntry's soft-delete fields, while `VRS-F048` described AuditEntry as though it were the other anonymous omission.

**Correction.** The omissions are now a closed field-by-field list in `VPS-A002`, and `VPS-A007` points its conformance gate at that exact list. `VRS-F048` names `WellnessAggregateContribution` as the matching anonymity case and keeps AuditEntry's immutability rule separate. Every unlisted field remains required; an implementation cannot infer a fourth exception.

---

### F88 — The conversion protocol overwrote domain vocabulary with `Converted`

`VPS-A002` required every conversion source to become `Converted`, but the shipped Ghost Resources feature deliberately uses `Promoted` and the `promoted_to` edge when a GhostResource becomes an Employee. Renaming that state would break a feature that already owns and correctly names the transition.

**Correction.** The protocol now registers a terminal status and directed edge per source/destination pair: Candidate and Pitch use `Converted`; GhostResource uses `Promoted`. The universal part is retention, traversal and a registered conversion edge — not one status word imposed on every domain.

---

### F89 — Anonymous contribution nodes retained identifying provenance

The first F87 correction removed only `created_by`. Building the structural anonymity test showed that `updated_by`, both soft-delete actor/time fields and the exact creation and update timestamps could still identify a contributor by correlation with the private source record.

**Correction.** Both anonymous contribution types now omit exactly `created_at`, `created_by`, `updated_at`, `updated_by`, `soft_deleted_at` and `soft_deleted_by`, while retaining the non-identifying `is_soft_deleted` flag. The private companion records own the identifying audit provenance.

---

### F90 — Broad relationship endpoints defeated structural anonymity

The registry's `Any Node` endpoints made both anonymous contribution types legal endpoints for `affects`, cross-app references, custom values and imports. A node with no identifying field could therefore acquire an edge back to a specific Employee, defeating the guarantee structurally.

**Correction.** Broad endpoints became named, bounded endpoint sets that never match an anonymity-protected node. Every protected node — both current types and every future one — must have an explicit connectivity registration, even when the permitted set is empty. There is no wildcard or endpoint-set exception. `PulseAggregateContribution` permits only its outgoing `part_of` edge to `PulseCycle`; `WellnessAggregateContribution` permits none.

---

### F91 — The two-way registration gate required an artifact that does not exist yet

`VPS-A007` required every registry row to have a feature implementation and every implementation to have a row. That contradicts A002-T09's registration-before-implementation order: the FDN-45 catalog deliberately contains future node types whose feature-owned field schemas do not exist yet.

**Boundary.** FDN-49 will compare the specification catalog with the executable registry in both directions now. It will also reject any implemented feature schema without a registry row. A registry row without a feature schema remains valid until that feature exists; enforcing the converse begins only when there is an implementation artifact to compare.

---

### F92 — Three issues claimed one architecture enforcement

FDN-77 claimed the Worker-boundary lint, FDN-48 claimed prevention of raw graph access, and FDN-49 claimed the automated architecture checks for both. Leaving all three as owners would recreate F82 with a different boundary.

**Correction.** FDN-77 defines the permitted Worker execution boundary. FDN-48 defines the typed query boundary and the sole raw local-SQL implementation surface. FDN-49 owns the automated rules and violating fixtures that keep both boundaries true. The three Linear issues now state that split explicitly.

---

### F93 — The future-node anonymity rule was designed but not proven

F90's validator derives the protected set from the registry, so its design covered a future third anonymity-protected type. Its test asserted only the two current registrations, however, which proved today's data rather than the generic failure path.

**Correction.** A deliberately malformed fixture module registers a synthetic `FutureAnonymousContribution` and gives it an `Any Node` adjacency. Dynamically importing that module must reject during initialization with the future type and offending edge named. The test now proves that the closed rule applies to a type that does not exist in the product registry, not only to Pulse and Wellness as currently written.

---

### F94 — A001-T07 named the wrong availability states

The former requirement listed not-yet-synced, permission-denied and genuinely-empty as three states. It omitted retention-window absence, which A004-T10 and [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] require, and treated an ordinary empty result as an exceptional system state.

**Correction.** The Worker contract reports `mid-sync`, `retention-window-absence`, `permission-absence` or ordinary `ready`. A ready result may contain zero rows without changing its availability.

---

### F95 — A per-row marker cannot describe absence safely

Mid-sync, aged-out and permission absence are query or subscription availability outcomes, not properties of a materialized row. A row may not exist in all three cases. Manufacturing a permission-denied row would also disclose that a particular instance exists, contradicting [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s zero-instance-metadata rule.

**Correction.** Availability is carried separately from result rows. Permission absence carries no node or edge instance metadata. A visible Restricted placeholder is derived from registered type schema under A004-T19, never from received instance data.

---

### F96 — The Worker boundary had no package home

`VPS-A001` required Loro merge and SQLite materialization in a dedicated Web Worker but its repository structure named no TypeScript package that could own the shared client, protocol and private Worker runtime. Leaving it inside one application would make a suite-wide boundary application-owned.

**Correction.** `packages/graph` owns the public Worker client and runtime-validated local protocol. Its Worker implementation remains private and is the only browser-side TypeScript surface that imports Loro or `wa-sqlite`; FDN-49 later enforces that definition.

---

### F97 — `packages/schema` passed TypeScript but failed the application bundler

The schema package's internal imports named emitted `.js` files while the package exports its TypeScript source directly. TypeScript's bundler resolution accepted those specifiers, but the first legitimate browser consumer — `packages/graph` — made Next.js resolve the package and fail because no `.js` files exist in the source tree.

**Correction.** Internal schema source specifiers are extensionless, matching the already-working source-package convention in `packages/ui`. The registry still typechecks and tests independently, and Next.js can now consume the public schema surface rather than requiring a duplicate validator in `packages/graph`.

---

### F98 — the single-active relationship rule allowed two active targets and omitted `scoped_to_entity`

`VPS-A002` said a relationship was single-active *between a pair of nodes*. That key does not enforce the domain rule. One Employee could have simultaneous `managed_by` edges to two different managers because each source-target pair remained unique. Both managers would then appear to have a direct report, widening manager-level permission scope as well as corrupting the reporting line.

The executable registry compounded the gap: it marked `managed_by` as single-active but omitted `scoped_to_entity`, even though `VRS-F003` explicitly requires at most one active Entity per Employee.

**Correction.** The policy is `single-active-outgoing`: for each registered relationship, one source may have only one active target at any moment. Both current relationships are registered. FDN-48 enforces one open edge in SQLite and rejects every overlapping historical interval, including overlap between already-closed edges.

---

### F99 — temporal edge intervals had no boundary semantics

The graph promoted `effective_from` and `effective_to` to first-class indexed fields but never said what happens at the exact instant one edge closes and its replacement opens. Inclusive ends would make both active at the handoff; inconsistent callers could produce different reporting lines from the same rows.

**Correction.** Every interval is half-open: `[effective_from, effective_to)`. Null is unbounded. At the handoff timestamp the old relationship is inactive and the new one is active.

---

### F100 — A003 still said every absent protected fragment was structurally absent

FDN-80 established that a device may render a `Restricted` placeholder from type schema even though it received zero bytes about the protected instance. `VPS-A003` still said omitting an unauthorized Tier 1 half *produced structural absence*, conflating what the device stores with how A004 renders a denial.

**Correction.** The device still receives and materializes no ciphertext or instance metadata. A004 independently decides `None` versus schema-derived `Restricted`; neither outcome changes the sync guarantee.

---

### F101 — FDN-48 assigned itself persistence before local encryption exists

FDN-48 claimed durable SQLite and VFS ownership while A003-T04 requires all local device storage to be AES-256 encrypted with a session-derived key. The key lifecycle belongs to FDN-52 and does not exist yet. Persisting readable SQLite pages in IndexedDB or OPFS would therefore violate the architecture in the issue intended to implement it. The issue also claimed deterministic rebuilding from a canonical Loro layout that FDN-50 owns and has not defined.

**Correction.** FDN-48 owns an in-memory, disposable SQLite read model and deterministic materialization from validated graph records. FDN-50 owns canonical Loro persistence and extraction; FDN-52 owns local encryption and any later encrypted SQLite cache. Rebuilding from encrypted canonical state is the safe default until measured startup evidence justifies another encrypted copy.

---

### F102 — additive properties were not proven JSON-native

The executable record schemas preserved unknown additive properties, but Zod's passthrough accepted runtime-specific values inside them. A JavaScript `Date` could therefore pass the TypeScript boundary even though Rust and JSON do not share that representation; canonicalization would silently change it rather than fail. That is the same failure class F80 exposed at the database boundary.

**Correction.** The complete node and edge object is now recursively constrained to JSON-native values before materialization, not only its named fields and edge metadata. Unknown properties remain additive and preserved, while `Date`, `undefined`, class instances and non-finite numbers fail loudly.

---

### F103 — FDN-50 was required to persist Loro before the issue owning mandatory local encryption

FDN-48 correctly stayed in memory because A003-T04 requires every local device store to be AES-256 encrypted and forbids persisting its plaintext key alongside the data. Its then-current wording tied that key to the authenticated session. The F101 correction assigned canonical Loro persistence to FDN-50 and local-storage encryption to FDN-52. Linear then made FDN-50 block FDN-52.

That order is impossible. A serialized Loro snapshot or update is readable graph state. Tier 0 and Tier 2 are not exceptions to A003-T04, and Tier 1 or Tier 3 end-to-end encryption does not substitute for the device-store layer. FDN-50 could satisfy its restart criterion only by writing prohibited plaintext or by presenting a test-only fake as durable production behavior.

**Correction.** FDN-84 extracts the A003-T04 sealed local store and offline-unlock mechanism from FDN-52 and blocks FDN-50. FDN-50 continues to block FDN-52's remaining privacy-tier partitioning, reader-key, envelope-wrapping, grant, revocation, rotation and retention work. The dependency is now FDN-84 → FDN-50 → FDN-52, with one owner for each layer.

---

### F104 — `managed_by` has two canonical representations and no reconciliation rule

`VPS-A001` chose Loro partly for its Movable Tree and explicitly prohibits replacing the reporting hierarchy with flat parent pointers. `VRS-F037` says the live `managed_by` hierarchy uses that tree so concurrent moves cannot create a cycle. `VPS-A002` separately requires every `managed_by` relationship to be a first-class UUID edge with half-open effective dates and preserved history. FDN-48 materializes and validates those edge records.

The documents never state which representation owns the current parent or how a winning concurrent tree move deterministically creates, closes or rejects the corresponding temporal edges. Persisting both without that rule creates two answers to “who manages this employee”; deriving the tree from edges forfeits the guarantee Loro was selected to provide; deriving edges naively from the tree loses UUID provenance and temporal history.

**Closed by founder ruling.** The Movable Tree is the sole write target and sole authority on "who manages this person right now"; the `managed_by` edge is a deterministic, one-way materialization of the Tree's resolved state and is never written to directly by any code path, from any surface. This is forced rather than preferred: deriving the Tree from the edges forfeits the concurrent-merge guarantee `VPS-A001` selected Loro for, while deriving the edge from the Tree loses nothing, because the Tree has already resolved the conflict by the time the edge is written.

The reconciliation protocol keys the materializer's edge transitions to the Tree operation's own causal ordering, not local arrival time or wall-clock timestamps: whenever a device observes its Tree's merged state differ from the currently-active edge for an employee, it closes that edge and opens a new one to the Tree's resolved target, timestamped to the Tree operation itself. Because every device performs this same deterministic comparison against the same converged Tree state, every device computes the identical edge history once fully synced, regardless of merge order — the CRDT convergence property applied one level up to the derived edge, rather than a second conflict-resolution mechanism invented for it.

This closes the concurrent-same-employee case F104 named specifically: two devices, offline, each move the same employee to a different manager. Neither creates a cycle — it isn't a cycle, just a conflicting single-parent assignment — and each device's local materializer correctly, if provisionally, reflects what it currently knows. On merge, Loro's Movable Tree resolves the two moves to one deterministic outcome, which is the guarantee `VRS-F037` already cites Loro for and whose own acceptance criterion states resolves "with no manual resolution required." The losing move never becomes a separately materialized active period once the merge superseding it has been observed.

`VPS-A001`, `VPS-A002` and `VRS-F037` are corrected: the Tree-backed edge is now stated as derived rather than independently maintained, and no application code — including `VRS-F037`'s own Move and Commit actions — writes `managed_by` directly. FDN-50 proves the concurrent-same-employee scenario above in its own verification, with a real Loro merge of two genuinely offline devices, not a simulated one.

---

### F105 — FDN-50 claimed an application-facing path before the permission interceptor

FDN-50's original scope promised an application-facing offline read/write path. FDN-48 deliberately exposes no production query method: FDN-53 is the first issue allowed to wrap its private executor with the permission interceptor. FDN-53 also owns interception of mutation paths under `VPS-A004`.

Exposing either path from FDN-50 would make the issue intended to add persistence also create the first permission bypass. Calling it “offline” changes where the check runs, not whether the check is required.

**Correction.** FDN-50 now owns only Worker-private mutation, reopening, extraction and materialization seams. Its offline query criterion is proven through a test-only/private executor. FDN-53 remains the first application-callable read and write path.

---

### F106 — offline cold restart has no stated key-recovery path

Before this ruling, `VPS-A003` said every feature worked offline without qualifying cold restart, while FDN-50 required local changes to survive process and device restarts. A003-T04 and `VPS-F001` G04 said the local AES-256 store was keyed from the session token and the key was never stored alongside the data. On web, `VPS-F001` also made the session a secure httpOnly cookie.

After a browser or device restart without connectivity, the Worker could not read that cookie and a memory-only derived key no longer existed. Storing the raw token or AES key would have defeated the requirement. The documents therefore specified both offline cold reopening and a key source unavailable to the component that had to reopen the store, without stating the bridge between them.

**Closed by founder ruling.** Every cold restart requires one online, server-authorized unlock. The deciding factor is revocation, not convenience: Vulto Roster holds salaries, grievance cases, wellness records and performance reviews. If a local WebAuthn credential could unlock the store by itself, an offboarded person could continue decrypting that HR data indefinitely while the device remained disconnected, despite central revocation and the commitments in [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]. Under the selected behavior, every cold restart is a revocation checkpoint. An offboarded person cannot reopen the product after a fresh boot because the server denies the unlock.

The accepted cost is explicit: a user who has both cold-restarted and lost connectivity cannot open Vulto in that window. Offline operation itself is unchanged. Once an authorized online unlock succeeds, the complete product works without the network until the next cold restart.

WebAuthn PRF is not universally available across browsers and authenticators, so the selected online path would have to exist as a fallback even if credential-bound unlock were supported. Credential-bound unlock would therefore add another security and recovery surface rather than replace this one, and the restrained default matches Vulto's product philosophy. The ruling remains revisable if customer evidence after launch shows that the cold-start limit genuinely blocks work. Moving from the selected behavior to an optional credential-bound unlock is additive; reversing that move later would take access away from customers who had come to rely on it, the same asymmetry recorded for FDN-80.

`VPS-A003` and `VPS-F001` now qualify the offline promise, define the online session checkpoint and carry real revocation and cold-restart acceptance criteria.

---

### F107 — FDN-84's unlock provider is owned downstream, and FDN-63 also claims local encrypted storage

FDN-84 is now the prerequisite for FDN-50 and is intended to be built next. The F106 ruling removes the need for FDN-84 to register a passkey or depend on WebAuthn PRF, but the selected design still needs an authenticated session and a server-authorized checkpoint that releases or derives volatile unwrap material. FDN-60 owns authentication and session lifecycle and is currently downstream of FDN-53. The existing blocking order is FDN-84 → FDN-50 → FDN-52 → FDN-53 → FDN-60; making all of FDN-60 block FDN-84 would close a dependency cycle.

There is no Better Auth implementation in the repository today. The dependency tangle is therefore **smaller but still blocking**: FDN-84 no longer needs passkey registration, PRF-capable browser or authenticator support, or `@better-auth/passkey`, but it cannot prove its defining cold-restart and revocation behavior without a real current-session validation path. Supplying a test-only key provider would prove AES-GCM but would not close FDN-84.

FDN-63's duplicate “local encrypted storage” claim can be resolved now and has been corrected in Linear. FDN-84 owns the sealed local byte store and its cold-restart unlock. FDN-63 consumes that store while owning device registration, trust, authorized bootstrap and revocation orchestration.

**Closed by FDN-60 split and implementation.** FDN-60 was narrowed to account, login and revocable workspace sessions and moved ahead of FDN-84. FDN-85 now owns graph projection behind FDN-53; FDN-86 owns verification, invitations and recovery behind FDN-56. The implemented server-only guard revalidates the database session, active user, exact workspace and active confirmed membership and can be called inside FDN-84's unlock operation without importing either downstream scope.

---

### F108 — the API contracts defeat the httpOnly session boundary

`VPS-F001` says web sessions use secure httpOnly cookies. It then declares sign-up, email sign-in, passkey sign-in and invitation acceptance as returning `{ sessionToken }`; `device.register` accepts that token as an ordinary argument; and `auth.registerPasskey` accepts a caller-supplied `userId`.

Those are not equivalent representations. Returning a session token in a browser response makes the credential available to application JavaScript, which is exactly what httpOnly prevents. Accepting identity as an input also asks each call site to preserve an authority fact the server can derive from the authenticated request. A caller-supplied `userId` on passkey registration is an avoidable identity-confusion and object-reference surface.

Better Auth's actual web model is cookie-based: the browser carries the session token in an httpOnly cookie, and the server derives the user and session from request headers. The product API should return public user/session metadata, never the raw token. Passkey registration, device registration and every authenticated operation should derive the user from the validated request. Native keychain handling belongs to the later native client and does not justify exposing the web token.

**Closed by FDN-60.** `VPS-F001` now declares public user/session metadata rather than credentials. Fastify carries Better Auth's host-only httpOnly cookie without returning the token in application JSON; the response boundary recursively removes credential fields, and real Chromium proves no token appears in network JSON, application-readable cookies, localStorage or sessionStorage. Passkey pre-authentication uses a signed single-use server context rather than a caller-supplied user ID.

---

### F109 — F001 pins the wrong password hashing behavior

`VPS-F001` says Better Auth's built-in credential provider uses bcrypt. The live Better Auth documentation for the selected stable release says its default is scrypt, using Node's native memory-hard implementation. The repository contains neither Better Auth nor a bcrypt package today.

Keeping the bcrypt sentence would require overriding the selected authentication library and introducing another hashing implementation solely to preserve prose that does not state a product requirement. Using the library default preserves the intended property — passwords are slow-hashed in Better Auth's credential store and never enter the graph — without additional native or security-sensitive surface.

**Closed by FDN-60.** `better-auth@1.6.29` is pinned exactly after a fresh registry check, F001 names its scrypt default, and the real-PostgreSQL test verifies both the published salt/hash form and successful/failed verification through Better Auth's own scrypt verifier.

---

### F110 — WorkspaceMembership is still an edge in F001 and a node everywhere executable

F60 corrected `VPS-A002` before FDN-60 was scoped: WorkspaceMembership is a node because it has its own Active/Revoked lifecycle. Its endpoints are the registered `membership_of` edge to User and `membership_in` edge to Workspace. The executable registry carries exactly that node and those two edges.

`VPS-F001` still calls WorkspaceMembership an edge throughout, and G02 says it connects User directly to Workspace. Its atomic workspace-creation criterion therefore names a graph shape that the canonical registry rejects.

**Closed by source correction and scope extraction.** F001 now names the same one-node/two-edge shape as A002 and the executable registry. FDN-85 owns that atomic graph projection and blocks claiming workspace bootstrap complete; FDN-60 implements only the deliberately central, non-admitting pending row and its confirmation boundary.

---

### F111 — “valid session” is not enough to reopen one workspace

`VPS-A002` explicitly allows one User to hold WorkspaceMembership in more than one workspace. Better Auth sessions identify the account, not permanent authorization to every workspace the account has ever joined. A person can therefore remain correctly signed in to Vulto while their membership in one company has been revoked.

FDN-84 protects a particular workspace's local HR store. If its cold-restart checkpoint asks only whether the account session is valid, an offboarded person can sign in for another workspace and use that valid account session to reopen the former employer's local data. That defeats the revocation reason F106 selected Option 2.

**Closed by FDN-60.** `requireCurrentWorkspaceSession(headers, workspaceId)` is server-only and fails with one non-enumerating error unless the database session is unexpired, the user and workspace are active, and the same user has an active, projection-confirmed membership in that exact workspace. Real-PostgreSQL proof revokes Workspace A while preserving B, then suspends the account and denies both. FDN-84 calls this guard inside its future unlock operation; no public check-then-unlock route was added.

---

### F112 — the central membership row and local membership graph have no named authority

Better Auth's organization plugin persists `organization` and `member` tables in PostgreSQL. Vulto's architecture persists Workspace and WorkspaceMembership in the local-first Loro graph and says there is one role system, not two. The documents say the plugin “maps directly” onto the graph but never define whether the central row or graph node owns active/revoked state and role, how their identifiers correspond, or what happens when they disagree.

FDN-84 makes that omission blocking. A cold-restart revocation checkpoint needs an online authority it can query before the local graph is decrypted. Making the unopened graph the authority recreates the dependency cycle; making a second unrelated membership table authoritative creates the drift the “one role system” rule prohibits.

**Closed by founder ruling and FDN-60 substrate.** Better Auth's organization/member tables are the server admission and revocation control plane; WorkspaceMembership is the deterministic local graph projection used for offline permission evaluation. Both consume the shared fixed role enum and stable identifiers. A pending central grant cannot authorize until projection confirmation; revocation changes the central row to denied before its historical graph projection completes. FDN-85 owns the sole projection/reconciliation command path. The public Better Auth organization mutation routes remain closed so no second write path exists.

---

### F113 — “defined schedule” defines no schedule, and a cache can outlive revocation

`VPS-F001` says sessions expire on a defined schedule but supplies no lifetime, renewal interval or authoritative store. Better Auth defaults to a seven-day rolling session renewed after one day of use. It also offers a signed cookie cache, and its current documentation states plainly that a revoked session may remain accepted on another device until that cache expires unless the cache is bypassed.

That optional performance feature conflicts with F106's reason for requiring an online checkpoint: the server must get a current say after every cold restart, not an answer cached before offboarding.

**Closed by FDN-60.** PostgreSQL-backed sessions use the approved seven-day rolling lifetime and one-day renewal interval. Better Auth's cookie cache is disabled, and the exact-workspace guard explicitly requests database revalidation. Controlled-time tests prove creation lifetime, renewal after the update age and rejection after expiry. A valid session is sufficient; cold restart does not force another credential ceremony.

---

### F114 — FDN-60's issue-wide blockers make its newly required first slice impossible

FDN-60 currently bundles login and session lifecycle with graph workspace creation, role changes, invitations and password recovery. Linear blocks the whole issue on FDN-53 and FDN-56. FDN-53 is downstream of FDN-52, which is downstream of FDN-50, which is downstream of FDN-84. Making the unchanged FDN-60 block FDN-84 would close the cycle the F107 memo identified.

The blockers are valid for the bundled remainder. Graph membership changes need the permission layer. Invitations and password recovery need the governed email service. Neither is required to establish a real database session and server-side workspace-session guard.

**Closed by issue split.** Linear now narrows FDN-60 to the account, login, passkey, database-session and exact-workspace authorization substrate. FDN-85 owns atomic graph workspace/membership projection downstream of FDN-53; FDN-86 owns email-backed verification, invitations and recovery downstream of FDN-56 and FDN-85. FDN-60 now blocks FDN-84 without a dependency cycle.

---

### F115 — the Fastify bridge hid the client IP from Better Auth

The first real-Chromium run emitted a Better Auth warning that rate limiting could not determine a client IP. Fastify knew the unproxied socket address, but converting its request into the Web `Request` Better Auth consumes did not carry that trusted transport fact. Better Auth therefore fell back to one shared per-path bucket. The endpoint was limited, but one person's attempts could exhaust the bucket for everyone and a production deployment could not make the intended per-client claim.

Trusting an incoming `X-Forwarded-For` header would have replaced the shared bucket with a spoofable one. Fastify's `trustProxy` remains disabled. The bridge now overwrites a private `x-vulto-client-ip` header from `request.ip`, and Better Auth reads only that header for rate-limit and session IP behavior. A caller cannot choose its value. The subsequent real browser run is warning-free, while hostile API tests still prove password and passkey authentication limits.

**Closed by FDN-60.** The correction is executable at the Fastify/Better Auth boundary and was found by real transport proof rather than a simulated request alone.

---

### F116 — `VPS-A001` still assigned local-storage encryption to FDN-52

F103 moved the sealed local device store and its cold-restart online unlock from FDN-52 to FDN-84, and reordered the chain to FDN-84 → FDN-50 → FDN-52 so canonical Loro persistence is never written unencrypted. `VPS-A001`'s own statement of that ownership, in its Local graph query layer section, was never updated to match — it still read "FDN-50 owns durable canonical Loro persistence, and FDN-52 owns local-storage encryption," naming an issue the chain no longer permits to hold that work first.

**Closed by source correction**, scoping FDN-84. `VPS-A001` now names FDN-84 as the owner of the sealed local device store and its cold-restart unlock, FDN-50 as writing canonical Loro persistence into that sealed store, and FDN-52 as owning privacy-tier partitioning, envelope-wrapped reader keys and any later encrypted SQLite cache or VFS.

---

### F117 — `VPS-D004` has no render for the whole-shell locked condition F106 created

F106's ruling made every cold restart a revocation checkpoint: the local store stays sealed until the server validates a current session. That is a new, user-visible, whole-application condition — signed in, store sealed, nothing to show — and nobody has specified what it looks like.

`VPS-002`'s own lookup table sends an implementer to `VPS-D004` for "what does absent, restricted or loading look like." `VPS-D004`'s system-states section is explicitly region-level: Syncing, Aged out, and the two Restricted variants each describe a piece of content inside an already-rendered shell, and the document states plainly that "no feature may invent a fourth state." A sealed store is not a fourth region-level state and is not any of the three that exist — it is a precondition on the shell rendering at all.

**Closed by source correction.** A locked-shell section, distinct from the region-level three, is now in `VPS-D004`, immediately before "The three system states." It defines when the locked render appears, what it shows, how it differs from an already-unlocked Offline device, and why a denied revocation and an unreachable server render identically under the workspace-session guard's non-enumeration requirement.

---

### F118 — `VPS-A003` and `VPS-F001` cite `VPS-D004` for a SyncStatus indicator `VPS-D004` never defines

Scoping F117 surfaced a second, separate gap. `VPS-A003`'s Offline behavior section states the application "exposes a SyncStatus observable at all times... surfaced per `VPS-D004`." `VPS-F001`'s offline acceptance criterion says "the Offline indicator shows." `VPS-D004` does not mention SyncStatus, an Offline indicator, or any shell-level status treatment anywhere in the document — its sidebar diagram reserves a `Status` row, but the row is never specified.

This is `VPS-002`'s first named signal for a defect: a field referenced by more than one document and defined by none.

**Open, raised not decided.** Logged here rather than folded into FDN-84, per founder instruction — FDN-84 needs only the locked-shell render (F117) to define its own unlock UI; the ongoing SyncStatus indicator is a standing shell concern with no obvious single owner among the issues currently open, and deciding that owner is a separate question from FDN-84's sealed store.

---

### F119 — "current process" left the tab-reload case undecided

`VPS-A003`'s offline-behavior prose said the online unlock holds "in the current process" without stating whether a browser tab reload starts a new one. The unlock material lives only in the Worker's memory per A003-T04, and a new tab genuinely starts a new Worker with nothing carried over — so the ambiguity was whether the specification's own wording already meant a reload requires a fresh unlock, or left room for some carried-over convenience the text never described.

**Closed by founder ruling.** Strict: any new Worker instance requires an online unlock, matching the specification's literal wording. A SharedWorker that survived a tab reload while keeping the key in-memory-only would satisfy A003-T04 and remains available as a future softening if customer evidence shows the reload cost is worth the added complexity; it is not built now because it would revise the Worker topology `packages/graph` just settled without a demonstrated need. Recorded with the same restrained-default asymmetry as F80 and F106: loosening later is additive, tightening after people rely on the looser behavior would take something away.

---

### F120 — a document a client is too old to open has no specified render

FDN-50's decision memo established a document-level schema-version gate, separate from the record-level tolerance F102 already built: a client too old for a document a newer client already wrote refuses to open it, distinct from `SealedStore`'s "cannot open" (which is specifically an authentication failure) and distinct from silent partial data.

`VPS-D004` has no render for this. It is not Locked (F117's condition — no unlock has completed), not any of the three region-level system states, and not Empty (the query didn't return none; it never ran). Forcing it into an existing state would misrepresent what's actually happening, the same mistake F117 named and avoided for the sealed-store case.

**Open, raised not decided.** Not blocking FDN-50 — the gate itself needs no UI to exist and be correct; only the render is missing. Logged as a future finding rather than built now, per founder instruction, the same way F118's SyncStatus gap was logged separately rather than folded into the issue that surfaced it.

---

### F121 — shallow snapshots cannot anchor a document built from concurrent roots

`VPS-A001` cites Loro's shallow snapshots — "trimming CRDT history while preserving mergeability" — as part of why Loro was selected over Automerge and Yjs, and names unbounded tombstone accumulation as the failure it avoids. FDN-50's Decision 2 scoped that capability into the durable flush: a full snapshot on first persist, then every later flush shallow-anchored to the previous durable frontier.

That design is not implementable on the pinned `loro-crdt@1.14.1`, for a narrower reason than it first appeared.

**The failure is on import, not export.** `export({ mode: "shallow-snapshot", frontiers })` accepts the anchor and returns bytes. Importing those bytes throws *"You cannot switch a document to a version before the shallow history's start version"* — as a bare string, with no `.message` and no `.stack`. A flush that does not round-trip its own output before committing therefore writes a snapshot that cannot be read back, and the workspace fails only at the *next* `initialize()`. That is silent durable corruption discovered long after the flush that caused it, which is a materially worse failure than a flush that simply errors.

**The trigger is concurrent roots, not unfamiliar peers.** A brand-new peer whose operations are causal descendants of the anchor round-trips cleanly and stays genuinely shallow, repeatedly, across reopen cycles. The shape that reproducibly fails is a document whose history contains two or more *concurrent root* operations with the anchor naming only some of them. Verified directly against the pinned version:

| later ops | anchor | result |
|---|---|---|
| causal descendant | previous durable frontier | round-trips, genuinely shallow |
| concurrent root | previous durable frontier | **export succeeds, import throws** |
| concurrent root | current frontier at export | round-trips, but not shallow — degenerates to a full snapshot |

This is why an earlier investigation reported no failure at all: its reproductions happened to build causally ordered histories, where the constraint does not bite.

**The boundary is narrower still and is deliberately not generalized here.** A concurrent operation grafted onto a deeper shared history, anchored mid-chain, did round-trip cleanly. This finding records the one shape the local graph Worker actually produces — a forest of concurrent roots, because every delta it merges arrives as an independently authored document whose first operation is its own root — and does not claim a general law about Loro's shallow-snapshot semantics.

**Closed by founder ruling — full snapshots only.** Decision 2 is not implemented, and the two workarounds are both rejected for stated reasons. Anchoring at the current frontier was rejected because it is not actually shallow: it round-trips only by dropping all history, which defeats the purpose the capability was scoped for. Upgrading past `1.14.1` was rejected because no evidence exists that a later release changes this behavior, and this project has already been burned by unverified dependency assumptions — F47 records `typescript@^5.7.3` and `turbo@^2.3.4` drifting unintentionally, which is why A001-T02 requires exact pins in the first place.

**Correctness is not at risk either way.** A full snapshot is a complete, correct, readable durable record. What the ruling forgoes is history trimming, and the cost is therefore storage growth over time rather than data loss or divergence. That is an acceptable trade to revisit later against real evidence — a workspace whose snapshot size actually becomes a problem, or a verified change in Loro's own shallow-snapshot semantics. Neither is a reason to act now.

`VPS-A001`'s shallow-snapshot reasoning is corrected rather than left standing: it does not hold for this system's document shape, and the document now says so plainly and cites this finding.

Any future shallow-snapshot work must round-trip its own bytes before committing them, whatever path is taken.

---

### F122 — the device-store browser suite cannot run green in one invocation

Running `pnpm test:device-store-browser` executes three spec files in one Playwright invocation, each performing real sign-ups against the real API. Better Auth's sign-up rate limit (3 per 60 seconds, deliberately configured and proven under F115) is exhausted partway through, and the run fails inside `signUp` — the "Account ready" heading never appears — rather than in anything the tests are actually asserting.

Confirmed as infrastructure rather than product behavior: the same spec file passes 3/3 when the `pretest` step truncates `rate_limit` immediately beforehand and it runs alone. The rate limit itself is correct and must not be weakened to make tests pass.

This matters more than a flake: a suite that cannot run green end-to-end cannot serve as a CI gate, and the failure looks like a product defect at first reading rather than a test-infrastructure one.

**Closed by repository fix.** Each spec file in the directory now truncates the browser-test database's `rate_limit` table in its `beforeAll`, before signing up — the same reset the pretest step already performs once, applied per file so one file's sign-ups cannot exhaust the window for the next. The rate limit itself is unchanged: it remains 3 per 60 seconds, still proven hostile-tested under F115, and was never a candidate for relaxation. Verified by running the full twelve-test suite green twice in succession in a single invocation, with no isolation, no grep filtering and no special sequencing.

---

### F123 — the passkey test raced its own sign-out, and `requireSession: false` does not mean "session ignored"

`auth.spec.ts`'s passkey test intermittently failed at `expect(reusedContext).toBe(400)`, receiving `200` — roughly one run in four or five. The assertion checks that a registration context already used cannot be reused after signing out.

**The reasoning that looked right and was wrong.** `services/api/src/auth/config.ts` configures the passkey plugin's registration with `requireSession: false` and a `resolveUser` that calls `resolvePasskeyRegistrationUser(context)`, which requires `consumedAt IS NULL`. Read quickly, that says session state is irrelevant to this endpoint and a consumed context must always be refused — so the failure could not be a sign-out race, and had to be something in how the test captured its context. That reading was recorded during review as a correction to an earlier, correct diagnosis. It was wrong, and it was wrong in the direction that would have sent the next reader hunting a nonexistent bug in the test's data capture.

**What the evidence actually showed.** Reproducing it under instrumentation (roughly one failure per four runs, with the database queried at the moment of failure) established three facts at once: exactly one registration context was ever issued, its `consumed_at` **was set** in the database, and `generate-register-options` still returned `200`. A consumed context returning 200 means `resolveUser` was never consulted. `requireSession: false` makes a session **optional, not ignored** — while one is still live, the plugin derives identity from it and the context path is not reached at all. The test clicked "Sign out" and issued its next request without waiting for the server to agree the session was gone.

**No product defect.** Single-use enforcement is intact and behaved correctly throughout: the context was consumed exactly once, atomically, and every replay of `verify-registration` was refused. What the test proved on a passing run was the right thing; what it did on a failing run was ask the question before the precondition it depends on had actually taken effect.

**Closed by repository fix.** The test now polls `get-session` until the server reports no session before asserting the reuse refusal. Asserting on the signed-out UI alone would not have closed it — the redirect can land before the session row is gone. Verified by ten consecutive green runs against a failure rate previously around one in four.

**The lesson worth keeping is about the reasoning, not the race.** A configuration flag named `requireSession: false` reads as "this endpoint does not consider sessions." It means the opposite of what it appears to: sessions are consulted first and merely not mandatory. Deriving a conclusion from the flag's name rather than from the plugin's actual resolution order produced a confident, evidence-shaped, wrong answer — and it took reproducing the failure with the database in view to correct it.

**Reasoning about what code should do is not the same confidence level as reproducing what it actually does under the failure condition**, and the two should not be reported in the same voice. This applies to every claim of independent verification in this project, including ones made while reviewing someone else's work.

---

### F124 — causal ordering cannot supply an effective date

F104 ruled that the `managed_by` edge is a one-way materialization of the Movable Tree's resolved state, with the edge's temporal intervals "keyed to the Tree operation's own causal ordering rather than local arrival time." Implementing it showed that one sentence asks a single mechanism to answer two unrelated questions.

**Which concurrent move wins is causal, and has a correct answer.** It is the pair `(lamport, peer)` — not Lamport alone. Reproduced against the real pinned `loro-crdt@1.14.1`: two separate documents, each offline, moving the same employee to a different manager produce moves carrying the *same* Lamport value, and the peer identifier is what decides the winner.

```
A move lamport: 4 peer: 21
B move lamport: 4 peer: 22
LAMPORT TIE: true
```

Convergence itself holds exactly as F104 assumed — both merge orders agree on the resolved parent and on the winning move's OpId:

```
A-then-B: parent=3@11 moveId={"peer":"22","counter":0} lamport=4
B-then-A: parent=3@11 moveId={"peer":"22","counter":0} lamport=4
converged parent: true | converged moveId: true
```

**When the winning move took effect is not causal, and no deterministic answer exists in the operation.** A Lamport counter is not a date. Loro records `timestamp: 0` on an operation unless timestamp recording is explicitly enabled, and once enabled it is the originating device's wall clock at one-second granularity — non-deterministic across devices, non-monotonic under clock skew, and too coarse to separate two moves in the same second. `VPS-A002` types `effective_from` and `effective_to` as ISO 8601 timestamps and promoted them to first-class indexed columns precisely so temporal queries could filter on them; writing a causal key into those columns would date every reporting line to 1970 and break the thing the columns exist for. `VRS-F037`'s Move payload — `{ type: 'Move', employee_id, new_manager_id }` — carries no date either.

**Closed by founder ruling — the two concerns are separated.** Causal ordering `(lamport, peer)` selects which concurrent move wins and orders the resulting history. The effective date is carried **on the move operation itself**, as data on the Tree node, authored by whoever performed the move. It replicates with the operation, so every device reads an identical copy and no second channel exists that could disagree with it — preserving the same one-write guarantee F104 was built on. The winning move's carried date becomes the new edge's `effective_from` and closes the prior edge's `effective_to`.

`VPS-A002` and `VPS-A001` are corrected. The user-facing question of whether a Move dialog prompts for an effective date or defaults to today belongs to `VRS-F037` and is not settled here.

---

### F125 — a backdated move has no defined behavior

The F124 ruling makes an effective date an explicit input rather than something derived from the CRDT's clock. That makes backdating expressible for the first time: a move whose effective date precedes the start of the currently active `managed_by` edge, or falls inside a closed historical interval.

Nothing defines what should happen. The single-active-outgoing-edge-with-history pattern assumes each new edge opens at or after the previous one closes, and `materialization.ts` rejects overlapping intervals for one source. A backdated move would either be refused, or would have to split or rewrite existing history — and if two devices concurrently backdate into the same interval, concurrent-loser elimination is no longer straightforwardly correct, because the losing move may cover a period the winner does not.

This is a real HR case rather than a contrived one: reorganizations are frequently recorded after they take effect.

**Open, raised not decided.** FDN-50 stage 4 is deliberately scoped to forward-effective moves only, per founder instruction, rather than folding an unresolved question into a ruling that has just been corrected once. Closing it needs a decision on whether backdating is refused outright, permitted with history rewriting, or permitted only where it does not overlap a closed interval — and that decision belongs with `VRS-F037`, which owns the surface a person would perform it from.

---

### F126 — a done criterion outlived by a later ruling that made it impossible

FDN-50's done criteria included: *"A workspace can be created, mutated, closed, reopened, materialized, and queried offline through the Worker-private proof seam."* Read as one unbroken path, that cannot be satisfied and never will be.

F106 made every cold restart a revocation checkpoint: the sealed local store stays locked until the server validates a current session. **Reopening therefore requires connectivity, by deliberate design.** The chain proof's reopen calls a real `unlockSealedStore(..., apiOrigin)` for exactly that reason. "Reopened … offline" asks for the one thing F106 exists to prevent.

The criterion was written before F106 was decided, and was never revisited when it was. Nothing was wrong with either statement when it was made; the contradiction was created by the later ruling and left in place.

**Closed by criterion correction.** The criterion now reads as two separable claims, both of which are proven: a workspace can be created, mutated, closed, reopened, materialized and queried through the Worker-private proof seam (`graph-materialization-chain.spec.ts`, "maps a Tree move through materialization into SQLite and answers it back, across a close and reopen"); and mutation, materialization and query all work with the network cut once an unlock has succeeded in the current process (same file, "mutates, materializes and queries with the network cut, after one online unlock"). The unlock itself stays online, which is F106's whole point rather than a limitation.

**The general lesson, which is the more valuable half.** This is a category of gap distinct from every other finding in this log: not a defect in a document, and not something implementation revealed about the world — a **spec-level promise silently outlived by a later decision that made it impossible.** Nobody wrote anything wrong. The contradiction appeared between two correct statements made at different times.

Findings like F54 or F104 were discoverable by reading the documents against each other. This one was not: both texts read fine in isolation, and only a reader holding F106 and this criterion at the same moment sees the conflict — which, in practice, means only the person who happens to be implementing that criterion.

**So when a ruling changes what is possible rather than merely what is preferred, the specifications and issues that predate it should be swept for this exact shape, not only the ones actively being worked on at the time.** F106 is the clearest instance so far, because it converted an availability property into a security checkpoint and therefore invalidated any earlier promise of unconditional offline behavior. F121 has the same shape at smaller scale: it removed a capability `VPS-A001` had cited as a selection reason, and that citation had to be withdrawn rather than left standing. A ruling of that kind should end with a sweep, and the sweep's results should be recorded — otherwise the next contradiction is found the same way this one was, by accident, at the moment someone tries to prove it.

---

### F127 — an ambiguous sentence produced a design that satisfies the wrong half of it

`VPS-F001` stated *"Role changes take effect immediately on the next query, with no session restart, per `VPS-A004`."* `VPS-A004`'s own A004-T06 is no less ambiguous in isolation: *"Permission changes MUST take effect immediately. Active sessions MUST NOT require restart."* Neither line states which of two very different claims it's making, and FDN-53's decision memo initially resolved the ambiguity toward the reading that was easiest to build: role cached once at online unlock, held for the life of the Worker instance, refreshed only at the next cold restart.

**That reading does not survive the rest of `VPS-F001`'s own text.** Two lines away: *"Revocation fires on Tier 1 access change, not only offboarding... a demotion removing Finance Admin is a revocation event in its own right,"* and *"device wipe completes within 60 seconds of signal receipt, online or on next connection."* The system already has a live, seconds-bounded channel for exactly this case — a role narrowing on an already-unlocked, still-connected device — and it is not gated behind a cold restart. A design that only refreshes role at the next unlock would let a demoted Finance Admin keep querying compensation and payroll data for the rest of an online session, which is precisely the failure the existing wipe-signal language was written to prevent.

**Neither of the two obvious readings is exactly right, and stating that precisely matters more than picking one.** An offline Worker instantly losing stale permissions with zero data transfer is a physical impossibility no design can satisfy, and F106 already establishes that bounded offline staleness is the accepted, safe default — the same principle applies here. But "only the server's own enforcement, decoupled from the offline Worker" is too weak a reading to satisfy A004-T06 at all: `VPS-A003` makes the server *"a coordination layer, never a source of truth"* that serves no graph queries of its own, so the local interceptor is the only graph query layer A004-T06's *"active sessions"* language can bind to.

**Closed by wording correction.** `VPS-F001`'s Security Considerations now state the bound precisely: role narrowing reaches an online session live, within the same window already specified for device wipe; offline staleness resolves on next connection, bounded the same way the unlock key's own staleness already is. FDN-53's design is corrected to match: the unlock grant still supplies the initial role, but the Worker now exposes an in-place role-refresh entrypoint a live signal can call, rather than gating every update behind a full re-`initialize()`.

**Ownership of the live delivery channel — decided.** No issue currently claims it: `FDN-63` owns *"device registration, trust, authorized bootstrap... and revocation orchestration"* — full device wipe and untrusting a device — which is a different case from a still-trusted device whose holder's role narrows without the device itself being revoked. Rather than guess at a proper push design that belongs to whoever eventually owns `FDN-63`'s broader transport work, or leave the receiving surface untested against anything but a mock, FDN-53 builds both halves now: the receiving surface, and a minimal delivery mechanism — short-interval polling, explicitly labeled a placeholder rather than a final design. FDN-53 unavoidably owns the receiving half regardless of who ends up owning transport, and building a working minimal delivery alongside it is what lets the whole live-refresh path be proven end to end now, real signal to real effect, rather than asserted against a stub — the same standard held everywhere else in this project.

**`FDN-63` is the natural place to revisit this** with a real delivery mechanism once device-level revocation transport exists anyway — replacing the poll is then one localized change behind an interface FDN-53 already defines, not a redesign of how role-refresh reaches the interceptor.

---

### F128 — the interceptor's own policy table certified a data leak as correct

**This is the most severe finding recorded in this project.** It is stated here at full severity, without softening, because the record exists for exactly this case.

FDN-53 stage 1's first submission resolved every matrix cell carrying an `own` or `direct-reports` qualifier — a grant that depends on knowing whether a specific record belongs to, or is a direct report of, the person asking — at its literal, unrestricted outcome. No row-level filtering existed anywhere in the interceptor. Verified directly by calling `resolvePermission` for eight representative cells, not inferred from reading the table:

```
team-member / WellnessTriggerEvent → full
team-member / PulseEntry           → full
team-member / LeaveRequest         → full
team-member / Expense              → full
team-member / PaySlip              → read
manager / TimesheetEntry           → read
manager / LeaveRequest             → full
manager / Assignment               → full
```

**The scope, counted precisely by exhaustive sweep, not sampling: 41 cells in the matrix, plus 16 more in the class-default fallback table reachable by 30-odd node types with no matrix row of their own** — 12 `Full (own only)`, 9 `Read (own only)`, 8 `Full (direct reports)`, 4 `Read (pipeline)`, 3 `Read (direct reports)`, and several smaller categories in the matrix alone — every one of them resolved wide open. Concretely, as submitted: any Team Member listing `WellnessTriggerEvent` received every employee's wellness trigger events in the workspace, not their own. The same for `PulseEntry`, `CoffeePulseEntry`, `LeaveRequest`, `Expense`, `PaySlip` and `WorkAuthorization`. Any Manager listing `TimesheetEntry`, `LeaveRequest` or `Assignment` received every employee's rows company-wide, not their direct reports'. This is the majority of the personal and manager-scoped data in the entire permission matrix, and it includes `VPS-A004`'s own named example of the product's most sensitive category — wellness data, which the same document states is protected by three independent layers specifically so no single layer's failure is sufficient to leak it. This was that layer's failure.

**This is not the same shape as an honestly-scoped limitation, and was not presented as one.** The same policy table already applies the correct, conservative treatment to three other cases where a qualifier cannot be resolved from schema alone: `Sensitive`'s `Full (aggregate only)` is forced to `none`, with a comment stating plainly that reading it literally would leak raw survey content; `Recipient-only` and `Inherited` protection both resolve to `none` for every role, including the nominal recipient. That is the correct judgment, applied correctly, three times over. It was not applied to `own` or `direct-reports` — structurally the identical problem, at more than ten times the scope, covering the data the product exists to protect.

**A passing test certified the leak as the expected, correct answer.** `policy-table.test.ts` asserted `resolvePermission("team-member", "WellnessTriggerEvent", ...)` equals `"full"` — directly contradicting `VPS-A004`'s own text, quoted in the same repository: *"WellnessTriggerEvent carries the most sensitive data in the graph. Its rule is absolute: only the employee to whom it belongs may traverse to it."* A green test suite is not evidence of correctness when the test itself encodes the wrong answer. This is why the suite passing, and the report describing four categories of independently confirmed mutation testing, did not settle the question — calling the function directly, with concrete inputs and inspected output, is what found it.

**Closed by repository fix, verified the same way the defect was found.** `resolvePermission` now resolves any cell whose scope is not `any` to `none`, with no exception — the identical rule already correct for the other three cases, extended to cover all of them rather than three of seven. The fix sits at the single function every resolution path — exact matrix override, bare matrix override, class-default fallback — already funneled through, so it cannot be bypassed by a future entry that forgets to apply it.

Verification, in the order it was actually done:

1. **The original leak, reproduced empirically**, not inferred from re-reading the table — the eight cases above, called directly.
2. **An exhaustive sweep of every cell**, not a sample: all 245 entries across `MATRIX_OVERRIDES`, and every one of the 16 non-`any` class-default cells exercised through real node types that reach them via the fallback path (`RateCard`, `BriefingNode`, `SkillGap` and 30-odd others) — every single one resolves to `none`, with the sweep itself asserting this in a loop rather than a fixed list of expectations.
3. **The nine existing tests the fix legitimately changed the answer for were corrected, not merely made to pass.** Two are worth naming specifically: the `WellnessTriggerEvent` test that certified the leak now asserts `none` for every role including Team Member, with the contradicted `VPS-A004` quote left in the test file's own comment so a future reader sees exactly what was wrong and why. A second, adjacent gap surfaced while fixing these — `LeavePolicy` and `Workspace`'s display partition inherit `Standard`'s person-scoped qualifiers ("direct reports," "own + team") despite being workspace-wide records with no such relationship to any one employee, because `VPS-A004`'s own named "workspace-configuration pattern" (a plain Read grant for every role) has no override row in this table yet. `none` is still correct and safe for these under the same rule; the pattern's row is not added here, noted instead for a later pass rather than guessed at now.
4. **The fix was mutation-tested**, the same obligation held for every stage in this project: `toResolution`'s new branch was removed, and the exact 9 tests corrected in step 3 — plus both exhaustive-sweep checks from step 2 — failed immediately and specifically, not vaguely. Restored afterward and confirmed byte-identical to the fixed version.
5. **The full suite green in one pass**: 109 unit tests including the corrected policy-table and interceptor suites; all 26 device-store browser tests in one invocation, including the F127 live role-refresh proof that exercises this exact interceptor mid-session; `worker-browser` and `auth-browser` unaffected. `pnpm verify` clean throughout.

**The process point, worth keeping.** This did not ship. It was caught specifically because independent verification refused to accept a written summary — however detailed, however honestly the author believed it — and instead ran the actual function against concrete inputs. A report that a suite passes describes what the author believes the code does. Calling the code and reading the output is the only thing that describes what the code actually does, and the difference between those two, at this scope and on this category of data, is the entire reason this discipline exists.

---

### F129 — the workspace-configuration pattern has no override row of its own

Surfaced while fixing F128, not independently. `VPS-A004` names an explicit pattern: *"LeavePolicy, Entity, OnboardingTemplate, CareerPath, Certification, CustomFieldDefinition, WorkingCalendar and Policy all grant every role Read and restrict write to Owner and HR Admin."* These are workspace-wide documents — a leave policy, a working calendar — with no "owner" or "direct reports" relationship to any one employee.

None of the eight has a `MATRIX_OVERRIDES` row encoding that grant. Each falls through A004-T08's fallback to `Standard`'s raw class default instead, which carries exactly the person-scoped qualifiers ("direct reports," "own + team") the pattern exists to say don't apply here. `Workspace`'s `display` partition (name, logo — also not person-scoped) has the same shape via the same fallback.

**This is the opposite direction from F128, and safe for now on the same terms.** F128 was cells resolving too open; this is cells resolving too closed, since F128's fix now sends every one of these through the same conservative `none` default. The cost is Manager and Team Member currently seeing `none` instead of the `Read` `VPS-A004` actually grants them — an over-restriction, not a leak, and consistent with the same asymmetry this project holds elsewhere: too closed is the safe direction to be wrong in.

**Open, raised not decided.** Closing it means adding eight-plus explicit `MATRIX_OVERRIDES` rows transcribing the pattern `VPS-A004` already states in prose — small and mechanical, but a scope decision about this table's completeness rather than a correction to the fix just made, and not decided unilaterally while fixing F128.

---

### F130 — subject exclusion is unbuilt, and the gap is live, not deferred

Also surfaced while scoping FDN-53 stage 2, and distinct from F128 in a way worth stating precisely: F128 was matrix cells that inherently *carry* a qualifier in their own text ("Full (own only)") going unenforced. This is a different mechanism entirely, registered separately in `VPS-A004`: *"Where a node type registers a subject exclusion, the reader set is its effective grant minus any person who is the subject of that record."* `HRCase` and `CaseEvent`, both halves, are the two node types that register one, excluding whoever `case_concerns` names. `VRS-F046` explains why: *"the subject of a case cannot read it, so that an investigating officer can take honest notes."*

Checked directly against the table: `HRCase`'s Owner and HR Admin cells are plain `FULL_ANY()` — not flagged as carrying any qualifier at all, because the exclusion is a fact about the *node type*, not about the cell. F128's fix does not reach this, and was never going to.

**Enforcing it requires comparing the caller's identity against a specific record's subject field — a User-to-Employee link that does not exist until `VRS-F002`.** This is the identical root cause F128's writeup already named for row-scoped qualifiers. It does not have F128's answer, though: `none` is not a safe default here, because it would remove HRCase access from the only two roles that can manage a case at all, which is a materially worse outcome than the gap it would close.

**Three options were weighed, in the open, before deciding.** Register the mechanism now, dormant — it exists in the code, but cannot fire without an identity link, so Owner and HR Admin keep unconditional `Full` exactly as today. Leave it out entirely and log the gap. Or find some narrower partial signal, none of which surfaced.

**Rejected: registering it dormant.** The founder's reasoning, recorded in full because it generalizes beyond this one finding: *"a future reader sees an enforcement mechanism sitting in the code and reasonably assumes it's live. That's a subtler version of exactly what F128 just taught this project: something that looks protected but isn't."* A subject-exclusion check that is structurally incapable of ever firing is not a smaller version of the F128 problem — it is the F128 problem, deliberately built in with better intentions. This project does not ship code shaped like a guarantee it cannot keep, even when the code is honest about why in a comment. A comment is read by someone already looking; the shape of the code is read by everyone else.

**Decided: left out of stage 2 entirely, and named here at the top of this document rather than only in sequence.** Not because it is more numerically severe than F128 — it isn't; nothing has read from it yet either, and the population affected is two roles rather than every employee. It is flagged this prominently because it is a **standing condition of the current codebase**, not a stage that will complete and close it: every day between now and `VRS-F002` shipping, this gap is live in exactly the same shape. F128 was closed within the hour it was found. This one cannot be closed the same way, and pretending otherwise by hiding it below the fold would be its own small version of the same mistake.

**What this changes going forward.** `VRS-F002`'s priority should reflect that something real and already-built (`HRCase`/`CaseEvent`, per `VRS-F046`) is waiting on the identity link it provides, not merely that a future feature would benefit from it. This is not a request to reorder the roadmap — it's the fact that needs to be visible wherever that ordering gets decided.

---

### F131 — the graph's only mutation entrypoint bypasses the interceptor it was built to sit behind

Surfaced scoping FDN-53 stage 2, before any code was written for it. `docs/Foundations_Findings.md` records F105 as closed on the premise that no application-callable write path exists before FDN-53 — *"FDN-50 now owns only Worker-private mutation, reopening, extraction and materialization seams."* Checked directly rather than assumed true because a prior stage said so: `applyDeltaBatch` is exported on `LocalGraphClient`'s public interface (`packages/graph/src/client.ts`), reachable from `packages/graph`'s public `index.ts`, and `entry.ts`'s `apply-delta-batch` Worker-message case calls `runtime.applyDeltaBatch` with no permission check of any kind — it imports arbitrary CRDT delta bytes straight into the canonical document.

**This is not currently reachable through a live route** — the two application pages that call it (`/graph-persistence-diagnostics`, `/worker-diagnostics`) both 404 outside an explicit test-only environment flag, confirmed by reading their `page.tsx` guards directly. But the hole is at the protocol layer, not the page layer: the Worker's own message handler enforces nothing, so any caller of `createLocalGraphClient().applyDeltaBatch()` — a future feature, not only today's gated diagnostics — bypasses the interceptor entirely, regardless of which UI happens to invoke it.

**Closed by founder ruling.** `applyDeltaBatch` is demoted off `LocalGraphClient`'s public interface, Worker-internal/test-only — the identical treatment `SQLiteGraphIndex.execute()` already has, which stage 1 relied on without incident. A real, permission-gated mutation entrypoint replaces it as FDN-53 stage 2's actual scope, mirroring exactly how stage 1 made `query` the sole gated read path rather than leaving `SQLiteGraphIndex.execute()` reachable alongside it.

---

### F132 — no edge type except `managed_by` has a defined CRDT storage representation

Surfaced alongside F131, same review. `packages/graph/src/worker/document-node-fragments.ts` defines the complete storage contract for node fragments — a reserved `LoroMap` container, a frozen key scheme. Searched for the equivalent for a generic edge and found none: the only edge-shaped Loro representation anywhere in the codebase is `managed-by-materialization.ts`'s Movable Tree, and `managed_by` is not stored as a generic edge at all — per F104, it is derived, one-way, from Tree state, specifically so it never needs one. `VPS-A002` registers roughly ninety other edge types (`has_skill`, `assigned_to`, `contracted_with`, and the rest) with endpoints and, for a few, lifecycle policy — but none of them has a container name, a key format, or any committable representation to write to.

This blocks more than FDN-53: every future feature that creates any edge other than `managed_by` hits the same wall. Designing the convention — container naming, key scheme, whether it needs per-edge-type conflict semantics analogous to `managed_by`'s causal ordering — is an architectural decision on the order of `VPS-A001`/`VPS-A002`, not something to improvise inside a stage scoped for mutation *interception*.

**Open, raised not decided.** FDN-53 stage 2 scopes edge writes to authorization-check-only: permit/deny is computed and exhaustively tested against the existing policy table and graph traversal rules, but nothing commits. The storage convention itself is logged here for a dedicated design pass, not decided as a side effect of this stage.

---

### F133 — `VPS-A004` Gate 2 (cross-suite write authority) is a structural no-op with only one registered application

Surfaced scoping FDN-53 stage 2's write gates against `VPS-A004`'s own text, before building any of them. `VPS-A004` names three sequential write gates: role-based permission (Gate 1), cross-suite write authority for bootstrap node types per `VPS-F008` (Gate 2), and refusal when a write would leave an empty reader set (Gate 3, see F134). `VPS-F008` defines Gate 2's mechanism concretely — an `ApplicationActivation` node type and a `writeAuthority.check(workspaceId, nodeType, fieldGroup?, callingApplication)` call, checking whether an `Active` activation exists for the node type's owning application per `VPS-A002`'s Cross-Suite Node Ownership table.

The schema pieces already exist (`ApplicationActivation` in `packages/schema`, the policy table entry in `policy-table.ts`), so Gate 2 is buildable in the narrow sense that the code would compile and run. But Vulto Roster is the only application ever registered in this phase — no second application exists to activate, so every bootstrap node type's owning application is always Roster, no `Active` activation for any other application can ever exist, and the check is structurally unable to produce a `false` in practice. Building it now would be exactly the dormant-mechanism shape F130 already rejected for subject exclusion: a gate that reads as enforced to a future reader without ever being able to fire.

**Closed by founder ruling, same standard as F130.** Gate 2 is not built in stage 2. It is deferred until a second application is registered against this workspace graph, at which point it has something real to evaluate. No dormant `writeAuthority.check` call is wired into the interceptor in the meantime.

---

### F134 — `VPS-A004` Gate 3 (empty-reader-set refusal) depends on subject exclusion, which F130 already found unbuilt

Surfaced alongside F133, same review. Gate 3 refuses a write that would produce a Tier 1 or Tier 3 node with no independent reader — a workspace whose only Owner and only HR Admin are the same person, or where a record's subject is its sole remaining reader once subject exclusion is applied. `VPS-A004`'s own text states the failure mode "becomes possible once subject exclusion exists" (A004-T16): without it, the reader set for a subject-excludable node type is just its ordinary role-based grant, which for every node type currently registered includes at least the Owner role and therefore is never empty by construction.

F130 already found subject exclusion entirely unbuilt — no User-to-Employee identity link exists (`VRS-F002`, out of this phase's scope), and F130 was explicit that building a dormant enforcement mechanism ahead of that link is the wrong move. Gate 3 depends on exactly the same missing link: without subject exclusion, there is no case this stage can construct where Gate 3 would ever refuse anything a role check did not already refuse, so building it now carries the identical risk F130 already ruled against.

**Closed by founder ruling, same standard as F130 and F133.** Gate 3 is not built in stage 2. It is deferred to whichever issue implements the User-to-Employee identity link and subject exclusion — the same dependency F130 already names — at which point Gate 3 has a real empty-reader-set case to guard against.

---

### F135 — the interceptor's audit-writing requirement (`VPS-A004`, `VPS-F004`) was never surfaced when FDN-53 stage 2 was scoped

Surfaced independently of F133/F134, while checking `VPS-A004` against the current codebase before writing the mutation interceptor. `VPS-A004`'s Context section states plainly that every decision the interceptor makes — every denial at any tier, and every successful grant of Tier 1 or Tier 3 data — writes an `AuditEntry` per `VPS-F004`. This is stated as intrinsic to the interceptor being the single choke point every query and mutation already passes through, not as an optional extension.

Checked directly: no `AuditEntry`-writing code exists anywhere in `packages/graph`, in either the stage 1 read path or stage 2's mutation path. `VPS-F004` itself is fully specified as a document, but nothing implements it. Unlike F133/F134, this gap was not named when F131/F132 scoped stage 2's boundaries — it is not a deferred decision, it is an unaddressed requirement of the specification stage 2's own interceptor is supposed to satisfy.

**Closed by founder ruling.** Audit writing is out of stage 2's scope: it is a separate, unbuilt system (`VPS-F004`'s silent audit log), and stage 2 delivers permission gating for mutations only, matching the read path's own scope in stage 1 (which also does not write audit entries). Recorded here rather than built as a one-off writer inside this stage, so the gap is visible to whichever issue implements `VPS-F004` for real, and so `VPS-A004`'s own stated requirement is not silently left unread.

---

### F136 — `VPS-A004` assigns no write-permission column to an edge TYPE, only to node types and partitions

Surfaced building `authorizeEdgeWrite`, the standalone Gate 1 check for an edge write (F132: computed and exhaustively tested, never wired to a commit path). The read path's `interceptedEdgeNeighbors` already documents the identical gap for Read — `VPS-A004`'s matrix and `VPS-A002`'s edge registry assign Privacy Class and permission outcomes to node types and node-type partitions, never to an edge type itself — and resolves it by treating Read on the edge type as satisfied once both endpoint node types are readable, since that grants nothing the endpoint checks would not already allow.

The write-side approximation used here is the natural analogue — Full write permission required on both endpoint node types — but it runs into a case the read path's binary satisfied/not-satisfied check never had to resolve: where an endpoint node type has more than one registered privacy partition (Employee's operational/compensation split is the only current case, but not the only possible one), the spec gives no basis for choosing which partition governs an edge write. Guessing would be exactly the kind of invention `CLAUDE.md` prohibits.

**Closed by founder ruling.** `authorizeEdgeWrite` resolves a multi-partition endpoint to `none`, unconditionally — the same conservative direction F128 already established for every other unresolvable case in this table, and consistent with the project's own stated asymmetry that moving a cell toward `none` is always safe. In practice this means `managed_by` (Employee → Employee) denies for every role today, since Employee is split-protected; the function is proven correct in isolation by an exhaustive sweep, and nothing currently reaches it from a commit path regardless (F132).

---

### `VPS-A001` — FDN-50 stage 2
The shallow-snapshot selection rationale withdrawn per F121, and a Decisions-section entry recording why. The CRDT-selection paragraph no longer claims shallow snapshots as a reason Loro was chosen; it states plainly that the capability does not hold for this system's document shape, that full snapshots are written instead at a cost in storage rather than correctness, and that the Movable Tree remains the load-bearing reason for the selection. Revisitable only against verified evidence of changed Loro semantics, not a release note.

### `VPS-A001` — FDN-84
The Local graph query layer section corrected per F116: FDN-84 named as the owner of the sealed local device store and its cold-restart online unlock, FDN-50 as writing canonical Loro persistence into that sealed store, and FDN-52 as owning privacy-tier partitioning, envelope-wrapped reader keys and any later encrypted SQLite cache or VFS. A Decisions-section entry recording the correction.

### F138 — the mutation gate validates permission and never coherence, so an authorized batch merges irreversibly before anyone asks whether the result is a graph

Surfaced in the Data Foundation integration review, hunting for defects at the seams between FDN-45 and FDN-53 rather than inside any one of them. `VPS-A004`'s Gate 1 answers exactly one question: may this caller write this node type and this partition. Nothing between the gate and the canonical Loro document asks whether the resulting graph is one the schema permits. So a batch can pass the gate, merge, and only then be refused by `materialization.ts` — at which point the merge cannot be undone, because a CRDT merge is not undoable.

**Three vectors, each confirmed directly against `authorizeMutationBatch` before any fix was written**, not reasoned about: a fragment carrying a foreign `workspace_id` ("belongs to workspace X, not Y"); two partitions of one node id disagreeing about their own `node_type` ("has conflicting node types"); and a record with an unregistered enum value, which never even reaches the coherence question because `parseNodeRecord` throws a raw `ZodError` inside the gate itself.

**The severity is not what the review's memo predicted, and the correction matters.** The memo argued the danger was poisoned bytes reaching disk and making the workspace permanently unopenable. Reproduced end to end on the real stack — real Postgres, real Chromium, real `SealedStore` behind a real online unlock, real Loro and SQLite WASM — that outcome did **not** occur. Materialization is far faster than assumed (11.6ms for 150 employees), so the failure throws long before the 250ms flush debounce fires, the client terminates the Worker, and the pending timer dies with it. The poison never reached disk. That containment is entirely accidental: it holds only while materialization is faster than the remaining debounce window, which stops being true at a few thousand employees — an ordinary size for the firms this product serves.

What did reproduce, on all three vectors, is worse in the near term: **one authorized-but-incoherent batch permanently wedges the whole graph layer for the session.** The throw becomes a fatal `runtime-failure`, the Worker is terminated, and every subsequent query and mutation hangs forever with no error and no signal (see F142). It also silently discards writes still inside the open debounce window, including a 150-employee batch this proof had already been told was `applied`.

**Closed by repository fix, in two halves.** *Prevention:* `authorizeMutationBatch` now validates coherence on the fork it was already building — the same edge derivation and `validateGraphSnapshot` the real `#materialize()` runs, against the same workspace id — so anything the materializer would refuse is refused first, on a throwaway fork, with the canonical document untouched. The whole function is wrapped so no inspection failure can escape as a throw: every operation in it parses untrusted candidate bytes, and a throw from any of them is a statement about the batch, not the Worker. *Containment:* a materialization failure now sets `#materializationFailed`, cancels any pending flush, and makes `#persist` refuse, because `#persist` exports the document's state at flush time rather than at schedule time — see F143 for the honest limits of that half.

The refusal returns a fixed, non-specific reason. `validateGraphSnapshot`'s messages name node ids, and the fork it validates is the whole document plus the candidate batch, so a failure can be caused by interaction with a node the caller was never permitted to read; echoing it back would make the refusal an existence oracle. Same leak `VPS-A004` prohibits on the read path, same answer, per F128's rule that conservative wins anything ambiguous.

Proven by a permanently named regression test at both levels: five unit tests in `mutation-interceptor.test.ts` and `services/api/browser-tests-device-store/graph-mutation-poisoning.spec.ts`, which drives all three vectors through the real production `mutate` protocol message and asserts four properties — refused cleanly, document untouched, runtime not wedged, workspace still opens. Mutation-tested: disabling the coherence check fails 3 tests, removing the fail-closed catch fails 4.

---

### F139 — a workspace switch silently discarded up to 250ms of acknowledged writes

Surfaced in the same review, confirmed by reading before it was tested. `BrowserLocalGraphClient.switchWorkspace` called `#terminate()` directly — killing the Worker thread, and the pending debounce timer inside it, without ever running `dispose()`'s synchronous drain. FDN-50 stage 2's `#scheduleFlush` doc comment promises the opposite in as many words: *"A clean shutdown never loses this window: dispose() below flushes synchronously before tearing down."* A user picking a different workspace from a menu is a clean, deliberate, in-app action, not the hard kill that comment carves out.

It went unnoticed because the debounce suite proved the `dispose()` path and only that path, and the client unit tests drive a `FakeWorker` with no runtime behind it — so `terminate()` had no flush to lose.

**Closed by repository fix.** `switchWorkspace` now disposes the previous Worker (flushing) before standing up the new one. A Worker already torn down by a fatal error has nothing to flush and cannot answer a `dispose` message, so that case still terminates directly. A flush failure does not abandon the switch — the caller ends up on the new workspace either way — but is re-thrown once the new workspace is live, because unflushed data on the workspace just left is something the caller must be told about. Proven by the sibling of the existing dispose test in `graph-persistence-debounce.spec.ts`.

---

### F140 — a failed materialization pinned availability at `mid-sync` forever, and two of the four contracted states are never produced at all

Two defects in one contract, both confirmed by reading.

First: `#commitDeltaBatch` set `#availability` to `mid-sync`, awaited `#materialize()`, and set `ready` only on the success path. A materialization failure escaped between the two, so every later response reported `mid-sync` on a Worker that was otherwise serving queries correctly.

Second, and larger: F94 corrected A001-T07 to require exactly four availability states — `mid-sync`, `retention-window-absence`, `permission-absence`, `ready`. Grep confirms `retention-window-absence` and `permission-absence` appear **only in `protocol.ts`'s schema**. Nothing in the runtime has ever produced either. The protocol test validates all four shapes; nothing asserts anything emits them.

**First half closed by repository fix; second half open.** A failed materialization now restores `ready`, which is the honest answer rather than a consolation: `rebuild` validates before it writes and `#commitGeneration` runs inside `BEGIN IMMEDIATE`/`ROLLBACK`, so a refused materialization leaves the previous generation intact and the index a caller reads is coherent. The unproduced states are left as they are — inventing emitters for them without the retention-window and permission-absence machinery they describe would be exactly the dormant mechanism F130 and F133 were kept out of stage 2 to avoid. The gap belongs to whichever issue builds those conditions.

---

### F142 — a fatal Worker error left every later caller hanging forever, with no error and no signal

Discovered while reproducing F138 on the real stack, and initially mistaken for a slow test: the first proof run consumed its entire 180-second budget without reaching a single assertion.

`#terminate` killed the Worker and rejected in-flight requests, but left `#disposed === false` and `#initialized === true`. Any subsequent call therefore passed both guards, `postMessage`d into a terminated thread, and returned a promise that **never settled**. Not a rejection an application could catch — a permanent, silent hang of every query and mutation for the rest of the session. Reproduced on all three F138 vectors: the poison threw, the Worker died, and the next two calls hung until the harness's own 20-second races cut them off.

**Closed by repository fix.** `#terminate` now records the fatal cause; both client guards check it and throw immediately with the original error, so a caller learns the graph layer is gone and why. `#createWorker` clears it, so `switchWorkspace` still works. Verified incidentally on a path the tests were not designed around: a later malformed-request rejection surfaced as a thrown `GraphWorkerProtocolError` rather than a hang.

---

### F143 — F138's containment half is unreachable at test scale and therefore unproven

Recorded deliberately rather than left implied, because the alternative is a guard a future reader assumes is protecting them.

F138's fix has two halves. Prevention at the gate is fully proven — mutation-tested, three vectors, real stack. Containment (`#materializationFailed`, which stops a known-bad document being persisted over a good one) is **not exercised by any test**. Post-fix, the only remaining route to a materialization failure is the unchecked test-only `applyDeltaBatch`, and there the Worker dies from the fatal error roughly 12ms in — far before the 250ms flush timer could carry anything to disk. Reproducing that race requires a workspace large enough that materialization outlasts the debounce window, measured at several thousand employees.

So the guard protects a genuine production scenario at scale that the test suite cannot reach at test scale. That is uncomfortably close to the dormant-mechanism pattern F130 and F133 were kept out of FDN-53 stage 2 to avoid, and the resemblance is acknowledged rather than argued away — the difference being that this is five lines on a persistence path, not a permission mechanism that would read as enforced. It also becomes reachable the moment `VPS-A003`'s sync engine merges remote deltas (F141), or if a future change makes materialization failures non-fatal.

**Closed by founder ruling; the proof itself is deferred and filed.** The guard is KEPT, recorded as unproven at production scale rather than removed. The ruling distinguishes this from F130 and F133 explicitly: those were permission mechanisms that could be mistaken for active enforcement while silently inert, where the danger is false confidence in a security control. This is a persistence guard with a narrow, honestly-labeled, well-understood gap — a different category, not a smaller instance of the same one.

The large-workspace test that would prove it is **not commissioned now**, as expensive and not urgent. So that "prove this at scale" cannot quietly vanish, it is filed as a named follow-up on **FDN-54** ("Prove sync and permission security invariants under adversarial conditions"), which already owns adversarial proofs in this project and milestone — alongside the three concurrency-seam scenarios the same review scoped but did not run (S1, S3, S4). The guard also stops being unreachable the moment `VPS-A003`'s sync engine merges remote deltas, which is FDN-54's own territory (see F141).

---

### F141 — the mutation entrypoint cannot tell a local author from an arriving peer

Surfaced in the Data Foundation integration review, reading FDN-53 stage 2 against `VPS-A003`'s eventual needs rather than against its own stage scope. `LocalGraphWorkerRuntime#mutate` applies **the local device's** role set — `deriveEffectiveRoles(this.#sealedStore.roles)` — to whatever delta bytes it is handed. There is no parameter, no message field, and no concept anywhere on the path expressing *whose* authority a batch carries.

That is correct and complete for the only caller that exists today, which is this device's own user. It stops being correct the moment a second source of deltas exists. When `VPS-A003`'s sync engine lands, a peer's legitimately-authorized write arriving at this device would be evaluated against **this** device's roles: a Team Member's device would refuse an Owner's changes, `mutate` would return `denied`, and the two devices would silently diverge — each locally consistent, permanently disagreeing, with no error surfaced to either user. The failure is quiet, which is what makes it dangerous; a refused remote delta looks exactly like a delta that never arrived.

The distinction the path is missing is not "skip the check for remote deltas." A remote batch still needs authorization — but against the authority of the peer that authored it, established at origin and carried with the operation, in the same way F124 established that a Tree move's effective date must replicate with the operation rather than be recomputed locally. That is the same class of fact and it wants the same treatment.

**Open, raised not decided, deliberately not built.** `VPS-A003` does not exist yet, and inventing an origin-authority representation now — before the sync protocol that must carry it is designed — would be the same mistake F132 (edge storage), F133 (Gate 2) and F135 (audit writing) were each kept out of FDN-53 stage 2 to avoid. Recorded here so the sync engine's design starts from a known constraint rather than discovering it after `mutate`'s current shape has been built against. Whoever scopes `VPS-A003` owns this.

---

### F144 — a revocation landing inside the flush window discarded an acknowledged, authorized write, and reported it in words a caller could not tell apart from an ordinary lock

Surfaced running **S1**, the first of the three concurrency-seam scenarios the Data Foundation integration review scoped but left filed on FDN-54. The seam is four components wide, which is why no stage-level suite sees it — each component is correct on its own: F127's role poll (FDN-53 stage 1) locks the store on a denial, `SealedStore` (FDN-84) refuses everything once locked, the flush is debounced 250ms (FDN-50 stage 2), and `mutate` (FDN-53 stage 2) authorizes, merges and materializes before that window opens.

`mutate` authorizes a batch against the roles this device holds, merges it, materializes it, answers `applied`, and schedules the durable write for 250ms later. Inside that window the membership is revoked; the next role refresh is denied; `refreshRoleOnline` locks the sealed store. The flush timer then fires into a locked store and throws into `#pendingFlushError`. The write never reaches disk, and nothing ever says so.

**"Never reaches disk" is the accurate claim, and an earlier draft of this finding overstated it as "the write is gone."** Independent verification caught it. The deltas are still merged in the in-memory document, and `#persist` exports the document's whole current state rather than a captured diff — so a later successful flush, after a successful re-unlock, would carry them out along with everything else. F145's own instrument demonstrates exactly that. What is true is narrower and still serious: the write is **not durable**, it does not survive the Worker instance, and nothing retries it — `#flushBeforeTeardown` finds the timer already fired and the flush already settled, so `dispose()` does not re-attempt it, and no `beforeunload` or `pagehide` handler exists anywhere. For a genuinely revoked device the loss is permanent in practice, because the re-unlock that would let a later flush succeed is itself denied.

**Reproduced on the real stack, with controls, before anything was proposed** — real Postgres, real Chromium, real `SealedStore` behind a real online unlock, real Loro and SQLite WASM, a real revocation through the real `member` row (`status = 'revoked'`, exactly what `requireCurrentWorkspaceSession` refuses), and the real production `mutate`/`refresh-role`/`query` protocol messages. The write is authorized and acknowledged `applied`, and is absent from disk on a genuinely new Worker afterwards, while the pre-revocation seed is still there.

Three controls, because a missing row near a revocation has many possible causes and only one of them is this finding:

* **The window is the cause.** The identical write, with the revocation allowed to land *after* the 250ms window closes, is durable. Same write, same revocation, same reopen, one difference.
* **The loss is silent.** A lock that discarded a write and a lock that discarded nothing produce the byte-identical report: `runtime-failure: The sealed local store is locked`. `SealedStoreLockedError` carries one fixed message and is thrown both by `SealedStore.put` (the failed flush, captured into `#pendingFlushError`) and by the `roles` getter (`mutate`'s own first read of a locked store); both reach `entry.ts`'s generic catch and become the same `runtime-failure` code with the same message, and an error response carries no other discriminant. Asserted from **both** sides — the lossy run and the lossless run each assert the identical pinned string — so the reproduction fails the moment either side is made distinguishable. Mutation-tested: making `#pendingFlushError` throw a distinct "writes were discarded" error fails the lossy assertion and leaves the lossless one passing.
* **Nobody has to do anything.** With no `refreshRole()` call and no interaction at all, the runtime's own 15-second poll locks the store on its own, ~14.9s after the revocation.

**FDN-54's own framing of this needs correcting in one direction and strengthening in the other.** It said the flush "throws into `#pendingFlushError` unobserved until the next call." Observed, that is optimistic: if the next call is a **query**, the error is never observed at all — `executeQuery` never calls `#throwPendingFlushError`, its own lock failure is reported as a *fatal* `runtime-failure`, the client terminates the Worker, and `#pendingFlushError` dies with it, never having been read. And where the mechanism does get its chance — `mutate` or `dispose()`, both of which call it first — it fires and still tells the caller nothing, because of the shared message above. `#pendingFlushError`'s promise that a background failure is "never swallowed" is met in letter and not in substance.

Worth naming separately: reporting a merely **locked** store as `fatal: true` is itself questionable. Locking is recoverable — a re-unlock fixes it — yet it terminates the Worker for the rest of the session and destroys the in-memory document. That choice is what swallows `#pendingFlushError` here, and it is also what bounds F145's exposure.

**Two questions, and only one of them is open.**

*Whether losing the write is correct* is a genuine ruling, not a defect with an obvious fix, and it is left for the founder. The case for losing it: the device is revoked, and even a successful flush would strand the write in a local store the device can never reopen — `VPS-A003`'s cold-restart checkpoint denies the unlock — so it would be recoverable only if the membership were restored. The case against: F139 already ruled that a clean, deliberate in-app transition must flush its window rather than kill it, and the instant before the lock is applied this device is still authorized, which is exactly F139's situation. The two rule differently on the same shape of event, and that inconsistency is the thing to settle.

*That the loss is silent* is a defect on either ruling. Whichever way the write goes, a caller must be able to tell "your store locked" from "your store locked and writes were discarded," and today cannot.

**Founder ruling: losing the write is not correct.** At the instant before the lock this device's writes were legitimate and the user had been told they were `applied`. F139 already ruled that a clean, deliberate transition flushes its window rather than killing it, and a revocation arriving is that same shape of event from this device's side.

**Closed by repository fix, as an ordering in which every step is load-bearing: flush while still authorized, then lock, then purge.** Flushing after the lock is impossible — the store refuses — and purging before the flush would destroy the writes the flush exists to save. That is why this is an order rather than a set of independent steps, and why it is implemented as one sequence (`#endLocalSession`) rather than three call sites that a later edit could reorder.

**The second half — the silence — is closed too, and separately.** A discarded durability window now raises `PendingFlushDiscardedError` and reports under its own protocol code, `local-writes-discarded`, rather than re-throwing the raw `SealedStoreLockedError` whose fixed message an ordinary locked-store call also produces. It is non-fatal on purpose: terminating the Worker over the report is precisely what destroyed it before anyone read it. Asserted from both sides, so collapsing them back together fails two tests rather than none.

**F148's fix independently reduced the reach of this finding.** The loss requires a lock landing inside the flush window, and until F148 was closed *any* server hiccup produced that lock. Only a genuine revocation does now.

Proven by the permanently named spec, which is written in pairs the way F148's is: the write survives revocation landing in its window; no plaintext remains queryable afterwards; **an ordinary lock does not purge**; a genuinely discarded window reports distinguishably while a lossless one does not; and the unattended poll still triggers the whole sequence with no interaction.

Mutation-tested against four mutants, each caught by the test built for it: removing the purge fails Q2; purging on *every* lock — the over-correction, and the F148 mistake pointing the other way — fails the paired test; removing the pre-lock flush fails Q1; and reverting the discarded-window report to its raw cause fails the reporting test.

---

### F145 — a revoked device kept its materialized plaintext index and its Loro document in memory, and the lock revocation fires did not touch them

The second question S1 was scoped to answer. `lockSealedStore()` drops the AES key and the role set. It does not touch `#document` or `#index` — the plaintext Loro document and the fully materialized SQLite index over the whole workspace stay allocated in the Worker, and the runtime that holds them is the one whose authority just ended.

**Proven, not read off the source.** Structure alone would only show the code does not free them; it would not show the plaintext is intact. The instrument is the write F144 discards: that node is provably *not* on disk, so if it can still be read, the only place it can have come from is memory the Worker held across the revoked interval. After a revocation locked the store, re-unlocking the **same** Worker — no reload, no re-initialize, the same `LocalGraphClient#unlockSealedStore` the locked shell's Retry button calls — returns it. Re-granting is how the plaintext is *read*; it is not how it is retained.

**This is residency, not a live read path, and the distinction is worth keeping straight.** All twelve protocol messages were enumerated: `query` throws at the roles getter, `open-payload` and `seal-payload` throw at the sealed store's own guard, `initialize`, `mutate` and `refresh-role` all throw, and `get-availability`, `get-sealed-store-status`, `lock-sealed-store` and `dispose` return no graph data. `materializedIndexForDiagnostics` is reachable only from `worker/testing/`, never from `entry.ts`. No production message returns graph data while locked.

**Two corrections to an earlier draft of this finding, both from independent verification, and both matter.**

*The exposure is bounded more tightly than first written.* An earlier draft said the plaintext is resident "for as long as the tab lives." It is resident until the tab closes **or the first `query`/`mutate` after the lock**, whichever comes first — because that call's failure is reported as fatal and the client terminates the Worker, freeing the heap. The draft noted the fatal termination in the next breath without noticing it bounds the very window it had just described.

*`apply-delta-batch` is not lock-gated.* It checks neither the lock nor permission — only the pending flush error and that the document and index exist. On a locked store it will merge deltas into the retained plaintext document and re-materialize the index. It returns no graph data, so the read claim above survives, but "the lock's purpose is to make this device unable to serve workspace data" is too generous: a revoked Worker can still be made to **write** the plaintext it retains. It is demoted off `LocalGraphClient` (F131) and reachable only through an env-gated diagnostics route, so this is defense-in-depth rather than a live hole — but it belongs here, not least because freeing `#document` and `#index` would turn this path into a crash rather than a refusal.

**The claim that this violates no specification was WRONG, and the correction raises the finding's severity.** An earlier draft asserted it, having checked `VPS-A003` and `VPS-A004` and never opened `VPS-F001` — which is the document that owns the fact. `VPS-F001` is unambiguous, in four places:

* G04: "**Revocation wipes the store entirely within 60 seconds of signal receipt**"
* Device revocation: "the local store is wiped within 60 seconds of the signal being received — whether the device is online at the moment of revocation or reconnects later"
* Its acceptance criterion and its non-functional requirements both restate the same 60-second bound
* And "Nothing is wiped on expiry — **only on explicit revocation or offboarding**" — so a membership revocation, which is what this reproduction performs, is a named wipe trigger, not merely device revocation

A003-T16 also carries no "persisted data only" restriction; that qualifier was this finding's own gloss, added in the direction that made the current behavior conform. And `VPS-A003`'s "cannot retroactively make someone un-see data they already decrypted" was being stretched: in context it is about lazy key rotation and data a person could already have copied — an inherent limit of cryptography, not a licence for the running process to keep a queryable plaintext index of the whole workspace after revocation.

**So the honest statement is the opposite of the draft's.** The role-refresh denial is the first and only moment in the built system where a device learns it has been revoked — the natural signal-receipt point — and its entire response is `lockSealedStore()`, which wipes nothing: not the persisted ciphertext, not the in-memory plaintext. `VPS-F001` G04 requires an entire wipe within 60 seconds and **nothing anywhere implements one**. This phase has built the trigger without the response.

That may still be defensible as an unbuilt requirement whose mechanism — a Device node, a revocation signal queue, a wipe path — belongs to `VPS-A003` and the device-management feature, neither of which is in this phase. But that is a scoping argument, and it has to be made rather than assumed. This is the F130 pattern exactly: a specified control that is unbuilt, where the gap is live rather than deferred, and where the danger is a reader assuming the lock is doing the wipe's job.

**The phasing question, answered by checking rather than by assuming.** Whether `VPS-F001`'s wipe was ever scoped into or out of this phase was researched before any ruling, and the answer is none of the three expected ones. It was **scoped in — explicitly — to an issue that is now closed as Done.**

* **FDN-84** ("Encrypt local device storage and define offline unlock", **Done**) names **`VPS-F001` — G04** in its own source specs: the exact clause carrying the 60-second wipe. Its scope reads "Define creation, online unlock, lock, key replacement, corruption, wrong-key, sign-out and **revocation-wipe** behavior," and one of its done criteria is "Sign-out, **revocation** and explicit **wipe** make local graph ciphertext unavailable under the source specifications."
* **FDN-63** ("Register trusted devices…", **Backlog**, never started) is named in FDN-84's own ownership boundary as owning "**revocation orchestration** across those existing layers," with a done criterion that device removal updates unlock and key behavior.
* **No phasing document mentions a wipe at all** — not `VPS-002`, not `VPS-A001`, not `docs/Bootstrap.md`, not `CLAUDE.md`. The scoping happened entirely in the issue tracker.
* **Nothing implements one.** `SealedStore` has no delete, clear or `deleteDatabase` path; `dispose()` locks and closes the handle, leaving the ciphertext in IndexedDB.

The one genuine ambiguity, recorded rather than resolved in the finding's favor: FDN-84's scope verb is "**Define** … revocation-wipe behavior," which can be read as defining a contract rather than implementing an erase. Its done criterion is an outcome rather than a definition, which reads the other way. What the delegation to FDN-63 covers is unambiguous, though — orchestration, meaning who fires the wipe and on what signal. The **mechanism**, a store capable of erasing itself, sits in the layer FDN-84 explicitly owns ("FDN-84 owns encryption of local persisted bytes, store lock/unlock behavior") and is absent.

**Founder ruling on the phasing: a done-criteria gap, not a phase boundary.** The wipe was not deliberately deferred — FDN-84 promised it in its own criteria and was closed without it existing. Filed as **FDN-87**, with the record placed on FDN-84 itself as well, so the gap is visible from where it originated rather than absorbed silently into FDN-54's scope. FDN-84 is left Done rather than reopened: the parts it did deliver are delivered, and the fact that it was *marked* Done without the wipe is itself worth preserving.

**Closed in two halves, along the boundary FDN-84 itself drew.**

*The purge (in scope, built).* Authority ending now releases the plaintext: `#endLocalSession` flushes the open window while still authorized, locks, and then disposes the index and frees the document, returning the runtime to its pre-`initialize()` state rather than inventing a fourth lifecycle condition. A device that legitimately regains access re-unlocks and re-initializes, reading the last good snapshot — including that final flush — from disk.

*The erase (the mechanism, built; the signal, not).* `SealedStore.erase` now exists — the `VPS-F001` G04 capability FDN-84 was closed without — reachable through a real `erase-local-store` protocol message and `LocalGraphClient#eraseLocalStore`. It is callable **while locked**, deliberately: a device that has lost authority can never unlock again, so an erase requiring an unlocked store would be unreachable in the only situation it exists for. Erasing destroys ciphertext rather than reading it, so it needs no key. It erases the named workspace only, leaving other workspaces on the same device untouched, and it does not touch the device identity, which is per-device and shared across workspaces this revocation says nothing about.

**Nothing in production calls the erase, and that is a boundary rather than an omission — with a concrete reason, not a scoping preference.** The role-refresh checkpoint is non-enumerating by design, so its `401` means revoked OR user-suspended OR workspace-suspended OR **merely session-expired**. `VPS-F001` is explicit: "Nothing is wiped on expiry — only on explicit revocation or offboarding." Wiring the erase to the denial path would destroy the local store of every user whose session simply timed out — the F148 mistake exactly, an ambiguous answer treated as a security event. Distinguishing revocation from expiry needs a signal that says which, and that signal is FDN-63's revocation orchestration, as FDN-84's own ownership boundary already assigned.

**That leaves an unwired mechanism, which is the F130/F133/F143 pattern, and it is labeled rather than argued away.** The difference is the same one the F143 ruling drew: this is a persistence capability with a narrow, honestly-stated gap, not a permission mechanism that could be mistaken for active enforcement. Its spec file, its protocol message and its runtime method all say in as many words that nothing fires it and that FDN-63 owns wiring it.

Proven on the real stack: the erase removes the payloads with no readable remnant, erases **only** the workspace it was given, and works while the store is locked after a real revocation. Mutation-tested: a no-op erase fails two tests, and an erase that takes out every workspace on the device fails the bystander test.

---

### F146 — `VPS-D004`'s locked shell is specified as a cold-start condition, and F127 created a mid-session locked state the document does not cover

Found while reproducing F145, and recorded against the document that owns the fact rather than the component.

`VPS-D004`'s locked-shell section defines *when it renders* as "immediately on cold start — including a Worker restart from a tab reload… before the sidebar, page header, panel or any content mounts, whenever that unlock has not yet succeeded in this process." `LockedShellGate` implements precisely that: it reads the sealed-store status once, on mount, and never again.

Observed on the real stack: after a revocation locked the store mid-session, the shell went on rendering its unlocked content. The store was locked and the interface said otherwise. Nothing re-checks, so the condition surfaces only when the user next touches something that needs the store — at which point it arrives as a fatal Worker failure rather than as the locked shell.

**Two qualifications, from independent verification, that keep this the right size.** The shell observed was the *diagnostics harness's*, and `LockedShellGate` is currently consumed only by the three diagnostics routes — no product shell mounts it yet. So this has no live user-facing consequence today; it is a gap to close before one does. And by `VPS-D004`'s own literal wording a mid-session-revoked device is not in the Locked state at all, since an unlock *did* complete in this process — which makes `LockedShellGate` conformant rather than merely uninstructed, and sharpens the point: the document does not under-specify this state, it defines it in a way that excludes it.

**This is a gap in the specification, not a component that disobeyed it.** When `VPS-D004` was written nothing could lock a live store; every locked state was a cold start, and the section's language reflects that honestly. FDN-53 stage 1's F127 role-refresh denial introduced the mid-session lock afterwards, and no document was revisited.

**Proposed correction, for `VPS-D004` to make.** The locked-shell section gains the mid-session condition explicitly, and states which treatment it takes. It cannot simply inherit the cold-start one by extension: that treatment is defined as rendering before any content mounts, and a mid-session lock has content already on screen and possibly half-entered work in it — the case the existing section assumes away. `VPS-D004`'s own non-enumeration rule already constrains the answer, and still holds: a denied revocation and an unreachable server must render identically.

**Closed by founder ruling and specification correction.** `VPS-D004`'s locked-shell section now defines Locked as having **two entries** rather than one — cold-start locked, and mid-session locked — and says plainly that the original single definition excluded the second by wording rather than by decision, because nothing could seal a live store when it was written.

The mid-session case takes the same full-bleed treatment (the store is sealed, so there is nothing legitimate left to render around it) with two differences, both because content was already on screen: unsaved work in progress is not silently discarded by the transition, and the copy names the transition instead of reading as a startup step. The section also now states that only an authoritative denial produces this condition, per F148 — an unreachable or erroring server is not a lock and must not render as one.

One further correction went in alongside it, because F148 proved the confusion was live rather than theoretical: non-enumeration governs **what is rendered, never what the client concludes**. A device may distinguish a denial from a failure precisely enough to decide whether to seal its own store, while still rendering both identically when it does show Locked. Reading that rule as forbidding the distinction is what produced F148.

---

### F147 — the permission interceptor read the caller's role array live, so a narrowing arriving mid-traversal changed the hops it had not reached yet

**S3**, the second of FDN-54's three concurrency-seam scenarios, and the finding is not the one S3 predicted.

S3 was filed as: "`executeQuery` snapshots roles once; `interceptedRecursiveNeighbors` then loops hop-by-hop with awaits between, so a narrowing landing at hop 2 does not affect hops 3+. A consistent snapshot is defensible, but it is currently emergent rather than decided."

**The premise was wrong. `executeWithPermissions` did not snapshot anything.** It held a live reference to the caller's array and passed that same reference down through every hop, and `bestResolution` re-reads it for every fragment it filters. `readonly PolicyRole[]` does not prevent this — it stops the interceptor mutating the caller's array, not the caller mutating its own.

Demonstrated rather than argued, against the real interceptor: a `recursive-neighbors` walk that began with `["owner"]`, whose array is narrowed in place to `["team-member"]` between hop 1 and hop 2, returns **nothing at all**. Hop 1 was resolved at Owner authority; every hop after it was filtered as a Team Member, so the intermediate node became invisible and the walk never expanded through it. The result is one no single role set would ever have produced.

**The consistency S3 credited to `executeQuery` was real, but at a different layer and by accident.** Both call sites in `runtime.ts` build a fresh array per call via `deriveEffectiveRoles`, and `SealedStore.refreshRoles` replaces `#roles` rather than mutating it — so the array reaching the interceptor is private to that call and nothing upstream retains a handle to narrow. Not reachable in production today. The single most obvious optimization on that path — caching the derived array instead of rebuilding it on every query — would have made it reachable, silently, with no test anywhere objecting.

**Two containments FDN-54 did not account for, both of which shrink this and are worth recording so nobody re-derives them.**

*Protocol messages cannot interleave with a query at all.* `entry.ts` serializes every request through one promise chain, so `refresh-role` and `lock-sealed-store` queue behind an in-flight query rather than racing it. The **only** thing that can change roles mid-query is `#startRolePolling`'s `setInterval`, which runs outside that chain.

*It is not observable end to end today, for an independent reason.* The only materialized edge type is `managed_by`, Employee→Employee (F132), and no role resolves Employee to `none` — so no narrowing changes the outcome of the only traversal this stage can actually run. That is why this was proven at unit level against a `SQLiteGraphIndex` test double rather than on the real stack, and that limit is stated plainly rather than dressed up: the real-stack proof is not available until an edge type is registered whose endpoints some role cannot read, or until instance-scoped enforcement lands (F128, F130) and `own`/`own-plus-team` scopes start making role changes materially change traversal results.

**Closed by repository fix, and the fix is the ruling.** `executeWithPermissions` copies the role set once, at the top, and every branch reads the copy: **a query is evaluated against the roles held when it started, and a role change lands on the next query rather than partway through one.** That is the answer S3 asked for, and it is now the interceptor's own guarantee rather than an accident of two callers upstream. It changes no behavior today, which is the point — it makes a property that was true by luck true by construction.

Proven by two permanently named tests in `interceptor.test.ts`, covering the multi-hop walk and a single-shot query. Mutation-tested: restoring the live reference fails both.

**One consequence, now decided rather than emergent.** A traversal in flight when a revocation-driven lock fires still completes at the authority it started with, because the snapshot outlives `lock()` nulling `#roles`. Bounded by one traversal — `maxDepth` at most 8 and `maxResults` at most 500, so a few hundred index queries. That is the correct behavior under the ruling above, and it is now a stated property rather than something a future reader has to rediscover.

---

### F148 — the device cannot tell "the server says you are revoked" from "the server had a problem," and treats both as revocation

**S4**, the last of FDN-54's three concurrency-seam scenarios. Like S3, the finding is not the one S4 predicted, and S4's premise is corrected first because it is wrong.

**S4's premise does not hold.** It was filed as a race: "on reconnect the ordering between 'pending flush lands' and 'first poll returns a denial' is racy, and if the flush wins, a revoked device persists writes authorized against arbitrarily stale roles." There is no such race, because `#persist` writes to IndexedDB and needs no network. Reproduced with the network genuinely cut: an offline write applies, its 250ms debounce elapses offline, and the bytes are durable before connectivity ever returns — confirmed by reopening on a new Worker and reading the node back. Nothing is pending at reconnect for the first poll to race. Offline writes authorized against stale roles are durable on the device immediately, which is the accepted offline-staleness tradeoff F106 and F127 already record, not a new race.

**What driving the reconnect path actually found is worse and much more ordinary.** `fetchCurrentRoles` classifies the checkpoint's answer in one line — `if (!response.ok) throw new RoleRefreshDeniedError()` — so **every** non-2xx becomes a revocation: 500, 502, 503, a gateway timeout, a rate-limit 429. `refreshRoleOnline` locks the sealed store on that error.

And the server makes it worse rather than better. `services/api/src/auth/http.ts`'s `/device-store/roles` handler catches any unexpected error — a database outage, a driver failure, a bug — logs it, and replies **`401`**. Not a 5xx. So an infrastructure failure does not merely arrive at the device as an ambiguous non-2xx; it arrives as an explicit "you are not authorized."

**This contradicts the system's own stated intent, in writing.** `runtime.ts`'s polling loop says: "A poll tick's own failure (network blip while offline, or a **transient server error**) must not crash the Worker or stop future ticks... A genuine denial is handled inside `refreshRoleOnline` itself (locks the store)." The comment names a transient server error as precisely the thing that must not be treated as a denial. `fetchCurrentRoles` makes it one.

**Reproduced on the real stack, with the membership asserted VALID at the end of every test** — the server never revoked anything in this entire file. A 503 injected on the role-refresh checkpoint locks the store, on a fully authorized Owner.

Three consequences, each reproduced:

* **The device never recovers on its own.** `lockSealedStore()` stops the poll timer *and* nulls `#apiOrigin`, and `refreshRoleOnline` throws immediately when `#apiOrigin` is null. So the spurious denial switches off the very mechanism that would notice the server is healthy again. Measured: more than a full poll interval after the outage ended, with a valid membership and a healthy server, the device is still locked and stays locked for the session.
* **It silently destroys an authorized user's acknowledged write.** F144's data loss, triggered by a server hiccup instead of a revocation. Reproduced: an Owner's `applied` write, a 503 landing inside the 250ms window, and the write absent from disk afterwards while the pre-hiccup seed survives. This raises F144's severity considerably — being offboarded is rare, a 502 is not.
* **The device then reports a server decision that never happened.** After the lock, every `refresh-role` returns "The server denied this device's role refresh request" without contacting the server at all, because the `#apiOrigin === null` throw is caught by the same handler that reports denials. Observed with the route un-intercepted and the server healthy.

Compounded by F146: no shell ever re-checks, so none of this surfaces to the user until they touch something, at which point it arrives as a fatal Worker failure.

**The argument on the other side was considered and rejected.** Treating an ambiguous answer as a denial is fail-closed, and F128's rule is that conservative wins anything ambiguous. It does not apply here, because this is not fail-closed in any useful sense: the plaintext this device already decrypted stays resident and readable (F145), so nothing is protected — while availability is destroyed for the session and an acknowledged write is silently lost. It fails closed for availability and open for confidentiality, which is the wrong way round.

**Founder ruling: a server error must not lock the device. Only an explicit, unambiguous denial may.** Timeouts, 500-series responses, rate limits and network failures are "temporarily unable to reach the server, try again," never a security event.

**Closed by repository fix, in both halves, which had to move together** — fixing either alone changes nothing, because the server was manufacturing the very 401 the client over-trusted.

*Server.* `/device-store/roles` answers an internal failure with `503` and a message about the checkpoint, not `401` and a message about the caller's authorization. A denial is still `401`.

*Client.* `fetchCurrentRoles` locks only on `401`/`403`. Everything else — transport failure, 5xx, 429, an unreadable 2xx body — raises a new `RoleRefreshUnavailableError`, which `refreshRoleOnline` does not lock on. The protocol gained `role-refresh-unavailable` alongside `role-refresh-denied`, so a caller is no longer told a revocation happened when none did; that also fixes the post-lock refresh reporting a server decision that was never requested.

**The accepted consequence, stated rather than discovered later:** while the server is erroring, this device's roles go stale and stay stale. That is the same position an offline device is already in, bounded the same way — resolved on the next answer the server can actually give, per `VPS-F001`'s "within 60 seconds while online, or on next connection."

**Proven, and written in pairs on purpose.** `graph-role-refresh-classification.spec.ts` is now the permanent proof rather than a reproduction: a 503 does not lock, the device works through an outage and picks its roles back up unattended, an authorized write survives a 503 landing inside the flush window — and, as the counterweight, a **real** revocation still locks and is still reported as a denial. Three integration tests in `auth.integration.test.ts` cover the server half, which the browser suite cannot reach because it intercepts the response before the server is involved; the failure there is induced by genuinely breaking the admission query rather than simulating it.

Mutation-tested from both directions, which is the point of the pairing: restoring the pre-fix classification fails three tests and leaves the revocation test passing; over-correcting so that nothing ever denies fails **only** the revocation test. Reverting the server's 503 to a 401 fails the server-half test.

**This directly reduces F144's severity.** F144's silent data loss is still open, but what made it common rather than rare was that any server hiccup produced the same lock. That door is now shut.

---

### `VPS-A003` — FDN-84
A clarifying paragraph in Offline behavior, and a Decisions-section entry, closing F119: "current process" means the Worker instance, so a tab reload requires the same online unlock as a device cold restart. A SharedWorker alternative is named as an available future softening rather than built now.

---

### `VPS-A002`, `VPS-A001` — F124
The F104 correction refined where it conflated two facts. Both documents now state that `(lamport, peer)` selects which concurrent move wins — Lamport alone ties — and that the edge's effective date is carried on the move operation as replicated Tree data rather than derived from the CRDT's logical clock. Decisions-section entries in both, recording that this was found by implementation rather than by reading.

### `VPS-A002`, `VPS-A001`, `VRS-F037` — F104
Closing the blocker on FDN-50. `VPS-A002`'s single-active-outgoing-edge-with-history section now states that a Movable-Tree-backed edge is a downstream materialization of the Tree's resolved state, never independently written, with the reconciliation protocol's causal-ordering rule stated once and cited from both other documents. `VPS-A001`'s Movable Tree section gets the matching statement, framed as the same category of violation as replacing the Tree with flat pointers. `VRS-F037` gains one clarifying sentence that its Move and Commit actions write the Tree only — the edge rewrite already described there was always the materializer's response, not a second write the feature performs. Decisions-section entries added to `VPS-A001` and `VPS-A002`.

---

### `VPS-A002`
`Client` deduplicated to one registry row. A new section, **When a relationship is a node instead of an edge**, carrying the one-sentence rule, why lifecycle is the test, the naming convention for a relationship-node's endpoint edges, the statement that an endpoint pair is not itself an edge, and the edge registry's key. Four edges registered; `member_of` deleted; `assigned_to` re-endpointed.

FDN-45 closed the implementation boundary: 28 lifecycle policies are fixed here and 81 remain explicitly feature-owned; nine split registrations guarantee partition identity while feature schemas own field membership. The universal-node claim now carries its exact three omission shapes instead of saying “without exception.” The anonymous-contribution shape omits all six identifying actor and exact-time provenance fields, and protected-node connectivity is explicitly enumerated with no wildcard or endpoint-set exception. The conversion protocol now registers each domain's terminal status, preserving GhostResource's shipped `Promoted` vocabulary alongside Candidate and Pitch's `Converted`.

A new section, **How the Privacy Class column is written**, defining the column as closed and stating where the three conflated facts now live. The `Class A (half) / Class B (half)` and `Class †` notations. The rule that a split row's identifying half carries its class default while the protected half is the declared split. The distinction between a tier split and a class split, stated where splits are introduced. Twenty-four registry cells rewritten. HeadcountSnapshot's tier departure marked and explained. One citation corrected from Rule 10 to Rule 11.

### `VPS-A004`
The default mapping table is declared the closed set, and says so. `Owner-restricted` and `Role-dependent` removed as duplicate names. A sentence establishing that **a class name is not a description of who reads the node**, with OrgScenario as the worked example. One matrix row added for ApplicationActivation, carrying the write restriction extracted from `VPS-A002`.

### `VPS-A003`
The Privacy Class to Tier mapping is now **total** — five missing classes added, and the table reordered by tier so a gap is visible. A statement that the table produces a default rather than the assignment, and that an unmarked mismatch with `VPS-A002` is a defect.

**A003-T06 resolves against the effective grant**, not the class default, and says the class default alone must not be used. The prose carries the reasoning, the four Tier 1 nodes it would have got wrong, and the rule that the reader set is derived once and consumed by both the key layer and the query layer.

### `VRS-F037`, `VRS-F046`, `VRS-F057`, `VRS-F055`
Privacy Class labels corrected to the class each document's own behavioral prose already described. Six sites in `VRS-F037` including a section heading and an acceptance criterion, three in `VRS-F046`, two in `VRS-F057`, one in `VRS-F055`.

### `VRS-F046`, again — FDN-79
Four new sections: an Owner who is the subject is a subject; the excluded subject sees the case exists; creating a case with no reader is refused; and what this does not settle. Export confirmed to need no special case. Three acceptance criteria, G11 through G13, and a system-state row for the subject-excluded render.

### `VPS-A004` — FDN-79
`None` and `Restricted` as two distinct denial outcomes, with the rule that every unqualified `None` is structural absence. A **Subject exclusion** section, and a **Refusal when a reader set would be empty** section carrying the reasoning that encrypting to nobody is theater. A004-T16, T17 and T18.

### `VPS-A003` — FDN-79
A003-T06 resolves a reader set of **people**, not roles, less any registered subject exclusion. Prose stating that becoming a subject is a revocation event under A003-T16, which needs no new mechanism because A003-T07 already requires readers removable without re-encrypting.

### `VPS-A001` — FDN-47
The Loro version pin recorded under CRDT library selection — `loro-crdt@1.14.1`, declared in `packages/schema` — satisfying A001-T02. The Decisions entry that called the version *"a specification requirement, not an open item"* now says what it was settled to, and cites the drift this repository had already suffered from ranges: `typescript@^5.7.3` had reached `5.9.3` and `turbo@^2.3.4` had reached `2.10.8`.

### `VPS-A007` — FDN-47
One citation, A001-T05 to A001-T06, per F72. Nothing else.

### `VPS-A001` — FDN-46
The two-language boundary table's `services/sync-engine` row, per F63: one job description covering two builds replaced with the shared core's job stated once and the server deployment's additional relay-and-persistence responsibility stated separately. A Decisions-section entry recording why and what it was found while scoping.

### `VPS-A001` — FDN-45
The runtime validation pin recorded under the settled stack: `zod@4.4.3`, declared exactly in `packages/schema`, with TypeScript types inferred from the runtime validator rather than maintained as a second representation.

### `VPS-A001` — FDN-77
Availability moved out of materialized rows and into the Worker response contract, with `mid-sync`, `retention-window-absence`, `permission-absence` and ordinary `ready` aligned to A003, A004 and D004. `packages/graph` was added as the shared home of the Worker client and validated local protocol; its Loro and SQLite-WASM runtime remains private.

### `VPS-A007`, `VRS-F048` — FDN-45
The schema-conformance gate now enumerates AuditEntry's five omitted universal fields and the two anonymous nodes' six identifying provenance omissions exactly. Its structural-anonymity gate requires every current and future protected node to enumerate its complete permitted connectivity without a wildcard or endpoint set. A synthetic third protected type with wildcard adjacency proves that the generic import-time failure path works before such a product type exists. Pulse Survey and Wellness prose carry the same closed field and edge contracts rather than treating AuditEntry's separate immutability rule as the same shape.

### Linear — FDN-48, FDN-49, FDN-77
The ownership split is explicit: FDN-77 defines the Worker boundary, FDN-48 defines the typed query and raw local-SQL boundary, and FDN-49 alone implements the automated enforcement and violating fixtures. FDN-49's two-way registration check is staged so registration-before-implementation remains valid.

### `VPS-D004` — FDN-79
A copy variant for person-level exclusion. The role-naming convention — *"Visible to Finance Admin"* — renders as *"Visible to Owner and HR Admin"* to an excluded Owner, which is a contradiction rather than a next step. The copy now names the reason: *"Restricted — this record concerns you."* One new row in the state table.

### `VPS-A004` — FDN-80
A new section stating the `None`/`Restricted` rule: existence universal to the position renders `Restricted`, existence contingent on the individual renders `None`. Explicit extension of A005-T07's already-decided reasoning rather than a new principle, with the FlightRiskSignal overclaim caught and corrected before it shipped. A004-T19, requiring a `Restricted` render to be schema-derived rather than instance-derived, since an unauthorized device holds nothing for a Tier 1 or Tier 3 field to derive one from. Five matrix cells reclassified — Employee compensation, both Contract halves, Requisition budget, and a new Workspace billing row the matrix had never carried. Three cells (PayRun, HeadcountPlan, HeadcountSnapshot) checked and left `None`, recorded as F85 rather than guessed at. A Decisions-section entry recording the `Restricted`-to-`None`-is-always-safe asymmetry.

### `VPS-D004` — FDN-80
The *"an HR-restricted contract"* visibly-restricted example replaced — it was actually describing `VRS-F022`'s vault-document case, which is the opposite treatment. New examples unambiguous for the guaranteed-node case, and a paragraph distinguishing a guaranteed node from an optional related record, cross-referencing rather than duplicating `VRS-F022`'s own reasoning.

### `VPS-A005` — FDN-80
A confirming cross-reference beside A005-T07: FDN-80's `None`/`Restricted` rule reclassifies five profile-field cells and none of them are picker eligibility, so A005-T07's absolute bar is unaffected. Checked and stated explicitly rather than left implicit, since two rules governing adjacent surfaces is exactly the situation where one could be silently weakened by the other.

### `VPS-002` — FDN-80
The prototype scope list's *"structurally-absent compensation section"* corrected to reflect the revised rendering, with a note that the prototype-era description is superseded rather than silently rewritten.

## What did not change

**No permission grant, anywhere.** Every access decision after this pass is one that `VPS-A004`'s matrix already stated. The corrections moved facts to the layer that enforces them and gave duplicate concepts one name each. A reader who knew the intended behavior before would find nothing new in the behavior — only in whether a machine can now confirm it.

**No tier assignment, except in what it is called.** HeadcountSnapshot was Tier 0 and remains Tier 0; it now says that this is deliberate.
