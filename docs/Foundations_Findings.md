# Foundations Findings

**Status:** Open. The Core Engineering and Graph Foundations phase is in progress.
**Purpose:** Record every defect, ambiguity and contradiction found in the specification set by implementing it, so corrections go back into the document that owns the fact.

This file is not a specification and is deliberately outside `docs/Vulto_Specs/`. It is the successor to `docs/Prototype_Findings.md`, which closed at fifty-three findings.

**Finding numbers continue from that log rather than restarting.** A finding ID is unique across the whole project, so `F27` means one thing and only one thing regardless of which log a reader is holding.

**The two logs were produced by different instruments.** The prototype rendered four design documents and found what could only be found by looking at a screen. This phase implements two architecture documents and finds what can only be found by trying to turn prose into types — a column that cannot be parsed, a mapping with holes in it, a relationship with no edge to traverse. Neither instrument would have found the other's findings.

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
| F63 | `VPS-A001` describes one build's job in terms of another's | `VPS-A001` | **Open** — FDN-46 |
| F64 | `CLAUDE.md` and `AGENTS.md` are byte-identical duplicates describing a closed phase | Repository | **Closed by FDN-76** |
| F65 | `Role-dependent` was a third name for `Inherited` | `VPS-A004` | **Closed by FDN-74** — consolidated |
| F66 | Tier 1 keys are wrapped against the class default, ignoring `VPS-A004`'s overrides | `VPS-A003` | **Closed by FDN-78** |
| F67 | No document says who reads an HRCase concerning the Owner | `VRS-F046` | **Closed by FDN-79** — subject exclusion, founder decision |
| F68 | Client is registered twice, with different owner attributions | `VPS-A002` | **Closed by FDN-75** — one row |
| F69 | `VPS-A004` has one denial outcome where `VPS-D004` has two, and they disagree on the salary field | `VPS-A004`, `VPS-D004` | **Partly closed by FDN-79** — the outcomes are now distinct; which nodes use which is unresolved |
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

**Twenty-six findings, twenty closed.** Six stay open. F63 rides with FDN-46. F69 needs a scope decision this log should not make alone. F70 and F73 are raised rather than decided. F71 is a recorded boundary rather than a defect — it closes when the issues it names are built. F76 is a fact about the tool, not something to close.

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

## What changed in the specifications

### `VPS-A002`
`Client` deduplicated to one registry row. A new section, **When a relationship is a node instead of an edge**, carrying the one-sentence rule, why lifecycle is the test, the naming convention for a relationship-node's endpoint edges, the statement that an endpoint pair is not itself an edge, and the edge registry's key. Four edges registered; `member_of` deleted; `assigned_to` re-endpointed.

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

### `VPS-D004` — FDN-79
A copy variant for person-level exclusion. The role-naming convention — *"Visible to Finance Admin"* — renders as *"Visible to Owner and HR Admin"* to an excluded Owner, which is a contradiction rather than a next step. The copy now names the reason: *"Restricted — this record concerns you."* One new row in the state table.

## What did not change

**No permission grant, anywhere.** Every access decision after this pass is one that `VPS-A004`'s matrix already stated. The corrections moved facts to the layer that enforces them and gave duplicate concepts one name each. A reader who knew the intended behavior before would find nothing new in the behavior — only in whether a machine can now confirm it.

**No tier assignment, except in what it is called.** HeadcountSnapshot was Tier 0 and remains Tier 0; it now says that this is deliberate.
