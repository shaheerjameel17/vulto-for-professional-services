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
| F54 | Privacy Class is prose, not a closed enum | `VPS-A002`, `VPS-A004` | **Open** — FDN-74 |
| F55 | HeadcountPlan's Privacy Class contradicts its own feature spec | `VPS-A002` | **Open, resolution decided** — FDN-74 |
| F56 | HRCase's content half claims a narrowing no document implements | `VPS-A002` | **Open, resolution decided** — FDN-74 |
| F57 | Five Privacy Classes have no Tier default | `VPS-A003` | **Open** — FDN-74 |
| F58 | Nothing distinguishes a deliberate tier departure from an error | `VPS-A002` | **Open** — FDN-74 |
| F59 | `Owner only` and `Owner-restricted` are one class under two names | `VPS-A004` | **Open** — FDN-74 |
| F60 | Reified relationships have no registered edges | `VPS-A002` | **Open** — FDN-75 |
| F61 | The edge registry does not state its own key | `VPS-A002` | **Open** — FDN-75 |
| F62 | A Rule 11 fact is cited as Rule 10 | `VPS-A002` | **Open** — FDN-74 |
| F63 | `VPS-A001` describes one build's job in terms of another's | `VPS-A001` | **Open** — FDN-46 |
| F64 | `CLAUDE.md` and `AGENTS.md` are byte-identical duplicates describing a closed phase | Repository | **Closed by FDN-76** |

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

**Proposed correction.** `VPS-A004` owns the closed set of Privacy Classes and states that it is closed. `VPS-A002`'s Privacy Class column carries exactly one member of that set per node half, and gains separate columns for the facts currently smuggled into it. Where a node departs from its class's default grants, the departure lives in `VPS-A004`'s matrix — which already carries every one of these overrides — rather than being restated as an adjective in `VPS-A002`.

Nothing in the permission model changes. Every grant this correction produces is a grant one of the three documents already states. What changes is that the value becomes checkable.

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

### F56 — HRCase's content half claims a narrowing no document implements

`VPS-A002` line 186 records HRCase as `HR-restricted identifying; content narrower still`.

There is no narrowing.

* `VPS-A004` gives HRCase identifying and HRCase content **identical** grants: Full, Full, None, None, None.
* `VRS-F046` line 191, which owns the node, states the reader set once and unambiguously: *"The reader set is Owner and HR Admin only."*
* `VRS-F046` line 119 states it again for the restricted render: *"Structurally absent for every role but Owner and HR Admin."*
* `VPS-A002`'s own prose, three rows below the table cell, says the two halves *"follow the identical pattern."*

Four statements say the halves are the same. One table cell says one is narrower.

The cell is also wrong about the class itself. `HR-restricted` grants Finance Admin `Read` and Team Member `Read (own only)`. Both are `None` here — and the second is the entire point. `VRS-F046` line 195 is explicit: **the subject of a case cannot read the case record**, and lines 197 to 201 give three paragraphs of reasoning for why that is correct and where a jurisdiction's subject-access right is served instead. A class that grants the subject `Read (own only)` is the exact opposite of what the owning document spent a section establishing.

**Correction.** HRCase and CaseEvent carry Privacy Class `Owner and HR Admin only` on **both** halves. `VRS-F046` line 135 carries the same error and is corrected with it.

**What the split actually is.** The halves differ in Tier — 2 for identifying, 1 for content — and not in Privacy Class. `VRS-F046` line 187 states the principle the split rests on: *"tier model determines protection strength; the reader set derives from Privacy Class."* The content half is Tier 1 because it holds allegations about named individuals and server-readable storage would put a customer's most sensitive employment records in Vulto's plaintext, which line 189 says in as many words. That is a statement about **protection strength**, and it was written into the **reader set** column.

**This is the generalizable finding.** A tier split and a class split are different operations, and the registry's `Split:` notation encourages conflating them. Contract, Offer, Pitch, Requisition and Employee all split *both* — different class and different tier per half. HRCase splits only the tier. The notation gives a reader no way to see the difference, which is how a tier fact ended up in a class column and stayed there.

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

### F60 — Reified relationships have no registered edges

A002-T03 requires every edge to be a first-class object with its own UUID and prohibits *"implicit foreign key joins not materialized as edge records."* Two registry rows describe a relationship that cannot satisfy it.

**`assigned_to`** is registered Employee → Project, annotated *"Via Assignment"* (line 361). Assignment is a registered node type. Its only registered edges are `logged_against` inbound from TimesheetEntry and `governed_by` outbound to RateCard. **There is no registered edge from Assignment to Employee, and none from Assignment to Project.**

**`member_of`** is registered User → Workspace, annotated *"Via WorkspaceMembership"* (line 348). WorkspaceMembership is a registered node type with no registered edges at all.

An implementer has two options and the registry sanctions neither. Putting `employee_id` and `project_id` on Assignment as properties is the implicit foreign key A002-T03 prohibits. Creating a bare Employee → Project edge discards the node carrying `effective_billing_rate` and the assignment lifecycle — and Assignment is the node the entire Bench Forecast is drawn from.

**A third pattern is in use for the same shape.** `contracted_with` (SubVendor → Project) carries `start_date`, `end_date` and `capacity_units` in edge metadata rather than a node. `has_skill` carries `proficiency_level`, `verified`, `verified_by` and `verified_at` the same way. So the registry contains relationships-as-nodes, relationships-as-annotated-edges, and relationships-as-both — with no stated rule for which is which.

**Correction.** State the rule once: a relationship carrying its own lifecycle status is a node with two edges; a relationship carrying only properties is an edge with metadata. Then register the edges Assignment and WorkspaceMembership need.

---

### F61 — The edge registry does not state its own key

`governed_by` is registered four times, against four unrelated endpoint pairs: Assignment → RateCard, Employee → LeavePolicy, PayRun → PayrollPolicy, PayRun → TaxConfig. `part_of` is registered twice. `supersedes`, `references`, `affects` and `has_custom_value` are polymorphic across many types.

So `edge_type` alone is not a unique key, and the registry never says what is. The key is the triple of edge type, from-node type and to-node type. An implementation keyed on `edge_type` — the obvious first guess, and the one the column ordering invites — would silently collapse four distinct relationships into one.

`VPS-A002` already fixed a related defect deliberately: line 342 records that ambiguous multi-value rows reading *"From: A, B, C"* against *"To: X, Y, Z"* were removed because they did not say which connects to which. That correction established that endpoint pairs are load-bearing. It did not go on to say that they are therefore part of the key.

**Correction.** State the registry key. This is an under-specification rather than a contradiction, and it is recorded because the wrong guess is cheap to make and expensive to find.

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
