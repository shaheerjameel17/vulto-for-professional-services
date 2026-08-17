---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Architecture
Feature Type:
  - Compliance
aliases:
  - VPS-A004
---

# VPS-A004 — Graph Permission Layer

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (node registry and privacy classes), [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (tier model and encryption)
**Blocks:** [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]] and every feature in every application

This document is the single source of truth for who may read and write what, how permission is enforced, and how aggregates are prevented from identifying individuals.

**One interceptor serves every application.** A person's role resolves identically whether the query came from Roster or Projects, because both are lenses over the same graph and the same session.

---

## Decision

Access control is enforced **at the graph query layer, not the UI layer**. A role without permission to reach a node type cannot reach it via any query path, regardless of how the query is constructed or which application's interface issued it. UI-only access control is a false security model and is prohibited.

Permission is derived by default from each node type's Privacy Class in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]. The detailed matrix that follows is reserved for node types whose behavior genuinely needs more nuance than the default provides. With ninety-three registered node types, hand-maintaining a bespoke row for each is neither realistic nor something an implementer should be left to infer.

---

## Context

A property graph connects everything. Without a principled permission layer, a sufficiently creative traversal can navigate from a broadly visible node to a sensitive one it was never meant to reach. This is acute here specifically, because Roster stores wellness signals, salary figures and performance assessments alongside project assignments, skills and team structure in the same graph. Separating them into different databases would destroy the intelligence value of the graph. They must coexist with architecturally enforced boundaries.

Enforcement is layered, per [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Standing Rule 5. The sync layer prevents sensitive nodes from reaching an unauthorized device at all — cryptographically for Tiers 1 and 3, by distribution control for Tiers 0 and 2. This document prevents sensitive nodes from appearing in query results even where the data exists locally. For Tiers 1 and 3 this is defense in depth behind a mathematical guarantee. For Tiers 0 and 2 it is the primary mechanism.

Every decision this interceptor makes — every denial at any tier, and every successful grant of Tier 1 or Tier 3 data — writes an AuditEntry per [[VPS-F004_Silent_Audit_Log|VPS-F004]]. This is intrinsic to the single choke point every query already passes through, not a per-feature integration a future feature could forget to wire up.

---

## Role definitions

| Role | Description | Assignment |
|---|---|---|
| **Owner** | Founder or executive with full traversal rights | Manually assigned, maximum 3 per workspace |
| **HR Admin** | Full HR operational access. No access to others' wellness | Assigned by Owner |
| **Finance Admin** | Full financial access. Read-only on HR operational nodes | Assigned by Owner |
| **Manager** | Full access to direct reports' operational data. No salary, no wellness | Automatic, from `managed_by` |
| **Team Member** | Full access to own nodes. Read on shared project and team nodes | Default for all employees |
| **Candidate** | Read-only on own Candidate node via [[VRS-F030_Candidate_Portal|VRS-F030]] only | Automatic on candidate creation |
| **Client** | Read-only on own Project nodes via [[Vulto Comms]]' portal only | Assigned by Owner or HR Admin |

**Role combinations.** A user may hold several roles and receives the union of their permissions — the higher grant wherever rules differ. A founder who also manages a team holds both Owner and Manager permissions.

**Cross-application evaluation.** Role is evaluated per authenticated user, never per application. A person's WorkspaceMembership role applies identically regardless of whether the query came from Roster, [[Vulto Projects]] or [[Vulto Accounts]], because local-first means every application is a different lens over the same session and the same local graph, not a separate service with its own identity.

**Recovery keyholders are not a role.** [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s Tier 1 recovery model designates trusted people as keyholders. These are existing Owner, Finance Admin or HR Admin holders selected for recovery, not a new permission category.

---

## Default permission mapping by privacy class

Unless a node type appears in the detailed matrix with an explicit override, this table is its grant.

**This table is the closed set of Privacy Classes.** [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s registry may carry no value that is not a row here, spelled identically, and a class is added by adding a row rather than by describing one in a registry cell. Thirteen classes, and every one of them is in use.

**A class name is not a description of who reads the node.** `HR-restricted` grants Finance Admin `Read` and grants the subject `Read (own only)`; a node genuinely restricted to two roles is `Owner and HR Admin only`. The distinction reads as pedantic and is not: four documents used the first name while describing the second, and on OrgScenario that would have granted a manager's direct report read access to a draft restructure removing their own role.

`Full` = create, read, update, soft-delete. `Read` = read only. `None` = **structurally absent** from query results, not hidden and not redacted.

**A denial has two possible outcomes, and they are not interchangeable.** [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] renders them differently because they leak differently:

| Outcome | The query returns | Renders as | Used when |
|---|---|---|---|
| `None` | nothing — the row is absent as though it did not exist | structurally absent | the *existence* of the record is itself the sensitive fact |
| `Restricted` | the record's existence, with its content withheld | visibly restricted, per [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] | existence is unremarkable; only the content is sensitive |

**`None` is the default and remains what every cell in the tables below means.** `Restricted` is used only where a document explicitly says so. A cell reading `None` is structural absence, without exception — reading it as "hidden" is the false-security model this document's Decision prohibits.

### The rule that decides which outcome a cell gets

**`Restricted` where the record exists for everyone in that position. `None` where its existence is a fact about that particular person.**

A locked box tells the viewer a record exists. Where everyone in a role has one — every Employee has a compensation half, every workspace has one billing state — that discloses nothing, and naming the role converts a dead end into a next step. Where only some people have one — an HRCase, a FlightRiskSignal, a wellness entry — the lock *is* the disclosure. Protecting the content does not fix a leak the interface commits by rendering at all.

**This is not a new principle, and it governs by extension rather than invention.** [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]] already bars every Tier 1 and Tier 3 node type from the mention picker, for exactly this reasoning: *"a reference a viewer cannot decrypt still reveals that something was mentioned"* (A005-T07). The picker and a profile's restricted field are the same leak on two different surfaces. Nothing here creates an exception to A005-T07 — no node type is reclassified into a picker-eligible state, and the reclassifications below apply only to how a query denial renders on a record the viewer already has partial, legitimate access to.

**Checked rather than assumed, since it would have been a false claim otherwise:** not every node type kept at `None` below is Tier 1 or Tier 3. WellnessTriggerEvent, PulseEntry and CoffeePulseEntry are, and A005-T07 already governs them directly. FlightRiskSignal is Tier 2 — A005-T07 does not reach it, and it stays `None` on this rule's own merits: its existence for a given employee is not universal, so a Manager or Finance Admin learning one exists learns a true and damaging fact about that specific person regardless of A005.

**The test, applied precisely: does a guaranteed field-level split exist on a node instance the viewer can already see part of, or is the hidden thing a separate, optional, cardinality-variable related record?** Employee's compensation half is guaranteed — every Employee node has one, by schema, whether or not a value was ever set. A Manager who can already see an Employee's operational half loses nothing new by learning the compensation half exists too. An HRCase is not guaranteed — most employees never have one — so a Manager learning an HRCase exists for a direct report learns something true and damaging about that specific person that no amount of content-hiding undoes. The same distinction separates a Contract *node* (every active employee has at least one, by definition of being employed) from a Document *row in the vault* (a specific uploaded file's presence is optional and instance-informative) — [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] already reasons through the second case correctly; see its cross-reference below.

**Restricted must be renderable from schema knowledge alone, never from received data.** For a Tier 1 or Tier 3 field, [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] guarantees an unauthorized device receives no ciphertext, no metadata and no indication of existence for that field — there is nothing locally present to build a locked box from. A `Restricted` placeholder is therefore drawn from the fact that this is an instance of a node type whose registry entry guarantees the field, not from anything the device received about this specific instance. This is what makes `Restricted` safe to use on a field the device may hold zero bytes for: the box says "this node type always has this," which is public information about the schema, not private information about the row.

**The asymmetry to hold onto as this rule gets applied further.** Moving a cell from `Restricted` to `None` is always safe — it only removes information a viewer had. Moving a cell from `None` to `Restricted` is a disclosure decision and needs the same review any other access change gets, because it adds information a viewer did not have, even if that information is "this type of thing exists." Where a cell does not obviously sort — where it cannot be determined whether existence is universal for the node type or contingent on the individual — it stays `None`. Conservative is the correct default for anything ambiguous, and this rule is revisable on user evidence after launch precisely because the safe direction to be wrong in is already known.

---

## Subject exclusion

A reader set names roles. For most node types that is sufficient. For a record *about a person*, it is not: the person the record concerns may hold one of the roles that reads it.

**Where a node type registers a subject exclusion, the reader set is its effective grant minus any person who is the subject of that record.** This is a filter applied when the reader set is resolved, not a new Privacy Class and not a parallel mechanism — it composes with the resolution [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s A003-T06 already performs.

**The exclusion makes a role-holder equal to everyone else, not less than them.** [[VRS-F046_Case_Management_Disciplinary_and_Grievance|VRS-F046]] establishes that the subject of a case cannot read it, so that an investigating officer can take honest notes. An Owner who is the subject of a case *is* a subject. Writing the reader set as a fixed list of roles rather than "those roles, minus whoever this record concerns" granted the Owner a privilege no other employee has, in the one record type where privilege is least defensible.

**Registered subject exclusions.** HRCase and CaseEvent, both halves, excluding the Employee named by `case_concerns` — per [[VRS-F046_Case_Management_Disciplinary_and_Grievance|VRS-F046]]. A node type not listed here has no exclusion.

**A subject excluded from a record still sees that it exists**, as `Restricted` rather than `None`, unless the owning document says otherwise. Every other employee facing a formal procedure is told one is underway, because the procedure requires it; and a workspace administrator who cannot account for a record their own workspace holds has a governance problem under [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] and under statutory access rights. Visible-but-unreadable is both fairer and cleaner than hidden.

**Where excluding the subject empties the reader set, the write is refused.** See *Refusal when a reader set would be empty* below.

| Privacy Class | Owner | HR Admin | Finance Admin | Manager | Team Member |
|---|---|---|---|---|---|
| Standard | Full | Full | Read | Full (direct reports) | Read (own + team) |
| Finance-restricted | Full | Full | Full | None | Read (own only) |
| HR-restricted | Full | Full | Read | None | Read (own only) |
| Manager-restricted | Full | Full | None | Read (direct reports) | None |
| Owner and HR Admin only | Full | Full | None | None | None |
| HR Admin only | Read | Full | None | None | None |
| Owner only | Full | None | None | None | None |
| Sensitive | Full (aggregate only) | Full (aggregate only) | None | None | Full (own only) |
| Self and Finance-restricted | Full | Full | Full | None | Read (own only) |
| Self only | None | None | None | None | Full (own only) |
| Self-only, absolute | **None, no exceptions** | None | None | None | Full (own only) |
| Recipient-only | Own only | Own only | Own only | Own only | Own only |
| Inherited | Follows the referenced or parent node's Privacy Class | | | | |

**Three recurring override patterns** account for nearly every row in the matrix below, and are named here so that a new feature applies them on sight rather than rediscovering them:

**The self-service pattern.** Standard's `Read (own + team)` for Team Member is wrong for any record an employee creates about themselves. TimesheetEntry, LeaveRequest, Expense, DevelopmentGoal, TrainingRecord and Invoice all grant Team Member `Full (own only)`. A new node type an employee submits takes this grant automatically.

**The workspace-configuration pattern.** Standard's person-scoped framing is wrong for workspace-wide definitions. LeavePolicy, Entity, OnboardingTemplate, CareerPath, Certification, CustomFieldDefinition, WorkingCalendar and Policy all grant every role `Read` and restrict write to Owner and HR Admin. Everyone should see the rules that govern them; only two roles set them.

**The signal-clearing pattern.** Manager-restricted's `Read` default is wrong for a signal a Manager is expected to act on. BurnoutAlert, TimesheetAnomalyFlag and ProbationCheckIn grant Manager `Full (direct reports)`, because reviewing a flag and clearing it is the entire point of routing it to them. In each case the subject of the signal gets `None`: the person a system-generated signal is about is not automatically its audience.

---

## Permission matrix by node type

Only node types whose behavior differs from their Privacy Class default, or whose nuance is worth stating explicitly.

| Node Type | Owner | HR Admin | Finance Admin | Manager | Team Member |
|---|---|---|---|---|---|
| Workspace (billing) | Full | **Restricted** — "Visible to Owner" | **Restricted** — "Visible to Owner" | **Restricted** — "Visible to Owner" | **Restricted** — "Visible to Owner" |
| Employee (operational) | Full | Full | Read | Full (direct reports) | Read (own + team) |
| Employee (compensation) | Full | Full | Full | **Restricted** — "Visible to Finance Admin" | Read (own only) |
| WellnessTriggerEvent | None | None | None | None | Full (own only) |
| PulseEntry, CoffeePulseEntry | Aggregate only | Aggregate only | None | None | Full (own only) |
| BurnoutAlert | Full | Full | None | Full (direct reports) | None |
| TimesheetAnomalyFlag | Full | Full | None | Full (direct reports) | None |
| FlightRiskSignal | Full | Full | None | None | None |
| ProbationCheckIn | Full | Full | None | Full (direct reports) | None |
| Assignment | Full | Full | Read | Full | Read |
| TimesheetEntry | Full | Full | Read | Read (direct reports) | Full (own only) |
| LeaveRequest | Full | Full | Read | Full (direct reports, for approval) | Full (own only) |
| Expense | Full | Full | Full | Read (direct reports) | Full (own only) |
| Invoice | Full | Read | Full | None | Full (own only) |
| PayRun | Full | Full | Full | None | None |
| PaySlip | Full | Full | Full | None | Read (own only) |
| Contract (identifying) | Full | Full | Read | **Restricted** — "Visible to HR Admin" | Read (own only) |
| Contract (content) | Full | Full | Full | **Restricted** — "Visible to Finance Admin" | Read (own only) |
| HRCase, CaseEvent (identifying) | Full | Full | None | None | None |
| HRCase, CaseEvent (content) | Full | Full | None | None | None |
| WorkAuthorization | Full | Full | None | None | Read (own only) |
| OrgScenario | Full | Full | None | None | None |
| Document (Tier 0 default) | Full | Full | Read | Read (project-scoped) | Read (own only) |
| Document (provenance-elevated) | Full | Full | Follows source | None | Read (own only) |
| Candidate, DraftHiringRecord | Full | Full | None | Read (pipeline) | None |
| InterviewRound | Full | Full | None | Read (pipeline) | None, plus participant grant |
| FeedbackEntry | Full | Full | None | Read (pipeline) | None, plus own-entry Full |
| Offer (identifying) | Full | Full | Read | None | None |
| Offer (terms) | Full | Full | Full | None | None |
| Requisition (identifying) | Full | Full | Read | Read | None |
| Requisition (budget) | Full | Read | Full | **Restricted** — "Visible to Finance Admin" | None |
| HeadcountPlan | Full | Read | Full | None | None |
| CompensationBand | Full | Read | Full | None | Read (own band only) |
| CompensationChange | Full | Full | Full | None | Read (own only) |
| Referral | Full | Full | None | Read | Full (own submissions) |
| TalentPool | Full | Full | None | Read | None |
| ReviewEntry | Full | Full | None | Full (direct reports) | Full (own self-assessment) |
| OnboardingTask | Full | Full | Read | Read (direct reports' plans) | Read (own plan), plus assignee Full |
| DevelopmentGoal, TrainingRecord | Full | Full | Read | Full (direct reports) | Full (own only) |
| SubVendor | Full | Full | Full | Read | None |
| HeadcountSnapshot | Full | Full | Read | None | None |
| AuditEntry | Full | Full | None | None | None |
| ImportBatch | Full | Full | None | None | None |
| ErasureRequest, RetentionPolicy | Full | Full | None | None | None |
| ApplicationActivation | Full | Read | Read | Read | Read |
| Notification | Recipient-only, absolute. No role sees another user's | | | | |
| GraphReference | Visible only where the user has Read on both source and target, per [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]] | | | | |
| ApprovalStage | Inherits the grant of the record it gates | | | | |

**Five cells above are marked `Restricted` under the rule stated earlier**, each because the node type guarantees the field for every instance: Workspace always has a billing state; every Employee node has a compensation half; every active employee has at least one employment Contract, both halves; a Requisition a Manager can already read (its identifying half) always has a budget half too. Every other `None` in this matrix was checked against the same rule and kept, because the node type's existence is contingent on the individual rather than guaranteed by the schema — an HRCase, a FlightRiskSignal, a Document in the vault, an ErasureRequest. The reasoning for each is recorded in `docs/Foundations_Findings.md`, not repeated per cell here, per this document's own note that the previous matrix read as a changelog when it carried reasoning inline.

**Three cells did not sort and were left `None` rather than guessed at**, per this rule's own instruction to default conservative on ambiguity: PayRun and HeadcountPlan (Manager, Team Member) and HeadcountSnapshot (Manager). Each is a workspace-scoped operational or analytics object rather than a record *about* a specific person, so the "does everyone in this position have one" test does not cleanly apply — and HeadcountPlan is not a split node at all, so there is no partially-visible sibling half for a lock to sit next to. Recorded as open findings rather than resolved.

**Participant-scoped grants** appear three times above and are a distinct mechanism from role-based access: an Employee with a `participating_in` edge to an InterviewRound reads that round regardless of organizational role; the interviewer on a FeedbackEntry has Full on that entry only; the assignee on an OnboardingTask has Full on that task only. A Team Member asked to sit on a panel needs to see the panel they are on, which the role columns alone cannot express.

**Field-level write authority within a granted node** — who may write the self-assessment versus the manager assessment on a ReviewEntry, for example — is enforced at the application layer rather than as a permission row per field. A graph permission row per field would be unmaintainable at this schema's size.

---

## Graph traversal rules

A query traversing from Node A to Node B via an edge operates under these rules:

1. The traversal is permitted if and only if the requesting role has at minimum `Read` on Node A, on Node B, **and on the edge type** connecting them.
2. Where `Read` on Node B is absent, the traversal stops at Node A. Node B is **not** included in the result.
3. The result does not indicate that Node B or the edge exists. The node is absent — not hidden, not redacted, not replaced with a placeholder or a count.
4. This applies recursively at every hop. A boundary at hop 2 does not expose the existence of nodes at hop 3.

**Relationship to the tier model.** For Tiers 1 and 3 an unauthorized device never receives the document, so these rules never encounter it — the node was never locally present. For Tiers 0 and 2, which sync broadly, these rules are the only enforcement. Both produce the same observable result; only the second depends on this document working correctly.

**Three kinds of absence must never be conflated.** A node absent through permission is absent permanently for that user and presents as though it never existed. A Tier 1 record absent through [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s retention window is absent only from local materialization, for an authorized user, and is one fetch away. A record absent mid-sync is absent transiently and resolves without user action.

Conflating them means telling a user that a forbidden record can be requested, that a retrievable one cannot, or that a loading one needs action. All three are distinguishable through the query or subscription availability outcome required by [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]], carried separately from rows, and each has a defined visual treatment in [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]].

---

## Aggregate disclosure control

**This section replaces four separate mechanisms with one.** The previous specification set reached the same answer independently in [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]], [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]], [[VRS-F060_Hiring_Quality_Analytics|VRS-F060]] and [[VRS-F059_Retention_Analytics|VRS-F059]] — four configuration keys, four defaults, four implementations of one idea — and applied it in none of the places it was not explicitly written, most notably the Bench Forecast's filtered utilization percentage, which can identify an individual in a small workspace as readily as any survey result.

Every aggregate in this product passes through one mechanism.

### The rule

An aggregate is displayed only where the cohort contributing to it meets the minimum size configured in [[VPS-F005_Workspace_Configuration_Console|VPS-F005]]:

- `k_anonymity_minimum`, default 5, for aggregates over Tier 0 and Tier 2 data.
- `k_anonymity_minimum_sensitive`, default 8, for aggregates derived from Tier 3 data, set higher because those contributions describe personal distress rather than general sentiment.

Below the threshold, the aggregate is **suppressed, not approximated**. It renders as the restricted state per [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]], with copy naming the reason plainly — *not enough responses to show this without identifying someone* — rather than a rounded or noised figure, which invites a reader to treat an unreliable number as a real one.

### Differencing protection

Threshold checking alone is insufficient, and this is the failure mode that makes a per-feature implementation unsafe. A user who can request *utilization for the design team*, twelve people, and *utilization for the design team excluding contractors*, eleven people, has learned the twelfth person's figure by subtraction, with both queries passing the threshold individually.

Three requirements follow:

1. **Aggregates are computed over the filtered cohort, never derived by subtracting one displayed aggregate from another.**
2. **A filter that reduces a cohort by fewer than `k` members returns the unfiltered aggregate** rather than a new one, and says so.
3. **Sequences of aggregate queries against overlapping cohorts are recorded in [[VPS-F004_Silent_Audit_Log|VPS-F004]]**, so a deliberate differencing attempt is visible after the fact even though it cannot always be prevented in the moment.

### Where it applies

Every aggregate without exception, including: filtered utilization on [[VRS-F005_The_Bench_Forecast|VRS-F005]]; agency-wide utilization on [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]]; team sentiment on [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] and [[VRS-F077_Monthly_Coffee_Pulse|VRS-F077]]; wellness trends on [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]]; hiring correlations on [[VRS-F060_Hiring_Quality_Analytics|VRS-F060]]; turnover cohorts on [[VRS-F059_Retention_Analytics|VRS-F059]]; workforce composition on [[VRS-F058_People_Analytics_Dashboard|VRS-F058]]; and cross-tenant benchmarks on [[VRS-F071_Salary_Benchmarking|VRS-F071]] and [[VRS-F072_Agency_Benchmarking|VRS-F072]].

A new feature displaying an aggregate does not define a threshold. It calls this mechanism.

### Structural anonymization is separate and stronger

Where a contribution must never be linkable to a person at all, [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] registers a contribution node carrying **no edge to Employee whatsoever** — `PulseAggregateContribution` and `WellnessAggregateContribution`. That is anonymization by structural absence of a link, and it survives a role change, a permission bug and a compelled disclosure. Aggregate disclosure control above is the additional layer applied on top of it, not a substitute for it.

---

## Wellness privacy partitioning

WellnessTriggerEvent carries the most sensitive data in the graph. Its rule is absolute: only the employee to whom it belongs may traverse to it. No other role, including Owner and HR Admin, has any access to another employee's wellness records.

Three independent layers enforce this:

- **Sync** ([[VPS-A003_Unified_Sync_Architecture|VPS-A003]]): never synced to any device but the owning employee's own.
- **Cryptographic** ([[VPS-A003_Unified_Sync_Architecture|VPS-A003]]): end-to-end encrypted with a key that never leaves the owner's devices. No server-side or cross-device decryption is possible.
- **Query** (this document): even if such a node existed locally and were somehow decrypted, the interceptor strips it for every role but the owner.

The first two do not depend on this document functioning correctly. This is a structural guarantee, not a policy claim resting on query-layer discipline.

---

## Write-authority enforcement for bootstrap node types

Every rule above governs *who*, by role, may read or write. This section governs a separate question, orthogonal to role: *which application* currently holds write authority for a node type [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Cross-Suite Node Ownership table marks as a Roster bootstrap.

A Finance Admin with full role-based write permission on RateCard is correctly refused a write once [[Vulto Accounts]] is activated for that workspace — not because their role changed, but because the authoritative writer did.

This check runs inside the same interceptor, immediately after the role check and never in place of it. A write role-based permission already refuses is refused there; write-authority enforcement only narrows a write that would otherwise be allowed. Two sequential gates, not one combined rule. Full detail lives in [[VPS-F008_Vulto_Suite_Graph_Bridge|VPS-F008]].

---

## Refusal when a reader set would be empty

**A third gate, and a different kind from the two above.** Both existing write gates ask about the *actor* — what role holds, which application is authoritative. This one asks about the *resulting record*: would creating it produce a node that nobody can read.

That becomes possible once subject exclusion exists. A workspace whose only Owner and only HR Admin are the same person, or where the subject of a case is the sole remaining reader, resolves to a reader set of nobody.

**Where a write would produce a Tier 1 or Tier 3 node with an empty reader set, the interceptor refuses it.** The refusal states plainly that the workspace has no independent reader for a record concerning this person, and that the matter requires escalation outside the product.

**The product must not pretend it can hold a confidential record with no confidential reader.** Encrypting to nobody is theater: it produces a record that exists, consumes a key, appears in the audit log, and can never be opened by anyone — while presenting to the person who created it as though the matter has been handled. A firm in that position needs an external HR consultant or a non-executive director, and **software cannot manufacture independence that the organization does not have.** Refusing is the honest answer and the only one that leaves the firm looking for the right one.

This gate runs after role permission and write authority have both passed. It never widens a write; it only refuses one those two would have allowed.

---

## Technical specifications

| ID | Specification |
|---|---|
| A004-T01 | Permission checks MUST occur at the graph query layer as an interceptor before results are returned. Checks performed only in application code after retrieval are insufficient and prohibited |
| A004-T02 | The interceptor MUST be the single path all graph queries pass through. No bypass may exist from application code |
| A004-T03 | Permission rules MUST be defined in a configuration file in version control. Changes require a pull request with engineering leadership review once staffed; until then, recorded by the founder |
| A004-T04 | Every denial MUST be logged to [[VPS-F004_Silent_Audit_Log|VPS-F004]] with requesting user, node type, node ID, attempted traversal path and denial reason |
| A004-T05 | Role combinations MUST resolve as the union of permissions, computed correctly in every case |
| A004-T06 | Permission changes MUST take effect immediately. Active sessions MUST NOT require restart |
| A004-T07 | An automated test suite MUST cover every role and Privacy Class combination in the default mapping, and every role and node type combination in the matrix. No deployment may reduce this coverage |
| A004-T08 | A node type absent from the matrix MUST fall back to its Privacy Class default automatically. A node type reaching implementation with no defined behavior is a specification error, not something for application code to guess |
| A004-T09 | Role evaluation MUST be identical regardless of which application issued the query. No application-specific permission path may exist |
| A004-T10 | Permission absence, retention-window absence and mid-sync absence MUST be distinguishable through the query or subscription availability outcome from [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]], carried separately from rows, and MUST render per [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]]'s three defined states |
| A004-T11 | For any bootstrap node type, the interceptor MUST additionally check write authority per [[VPS-F008_Vulto_Suite_Graph_Bridge|VPS-F008]] after role permission has passed, never as a substitute for it |
| A004-T12 | Every aggregate MUST pass through the disclosure control mechanism defined here. A feature MUST NOT define its own threshold |
| A004-T13 | An aggregate below threshold MUST be suppressed entirely. Rounding, noising or approximating a sub-threshold aggregate is prohibited |
| A004-T14 | A filter reducing a cohort by fewer than `k` members MUST return the unfiltered aggregate and indicate that it has done so |
| A004-T15 | Aggregates MUST be computed over the filtered cohort directly. Deriving one aggregate by subtracting another is prohibited |
| A004-T16 | For a node type registering a subject exclusion, the resolved reader set MUST exclude the person that record concerns, at both the query layer and [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s key-wrapping layer, and MUST be re-resolved when the subject changes or a role changes. A person becoming a subject while already holding a wrapped key is a revocation event under A003-T16 |
| A004-T17 | The interceptor MUST refuse a write that would produce a Tier 1 or Tier 3 node with an empty reader set, after role permission and write authority have both passed. Creating a record no one can read is prohibited |
| A004-T18 | A denial MUST resolve to `None` or `Restricted`, and the two MUST render as [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]]'s structurally-absent and visibly-restricted treatments respectively. `Restricted` MUST be used only where a specification states it; every unqualified `None` in this document is structural absence |
| A004-T19 | A `Restricted` render for a Tier 1 or Tier 3 field MUST be derived from the node type's schema — that this node type always carries this field — and MUST NOT depend on any ciphertext, metadata or sync-status signal received for the specific instance, since [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] guarantees an unauthorized device holds none of those for such a field |

---

## Acceptance criteria

**GIVEN** a Manager constructs a query from a Project node
**WHEN** the traversal would reach a WellnessTriggerEvent via any sequence of edges
**THEN** it is absent from the result — no placeholder, no redaction marker, no count — and the result is identical to one where the node did not exist

---

**GIVEN** an Owner attempts to access Employee X's WellnessTriggerEvent
**WHEN** the query executes
**THEN** the nodes are absent. Owner does not override the absolute wellness rule

---

**GIVEN** a permission rule is updated and deployed
**WHEN** a user with an active session makes an affected query
**THEN** the updated permission applies immediately without re-authentication

---

**GIVEN** a new node type is registered in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] with a Privacy Class but no matrix entry
**WHEN** a query reaches it
**THEN** the default mapping for its Privacy Class applies, with no undefined behavior

---

**GIVEN** the same user queries once through Roster and once through [[Vulto Projects]]
**WHEN** both request the same node
**THEN** the permission result is identical

---

**GIVEN** a design team of four people
**WHEN** a user filters the Bench Forecast to that team and views utilization
**THEN** the aggregate is suppressed and renders the restricted state, because four is below `k_anonymity_minimum`

---

**GIVEN** a twelve-person cohort whose aggregate displays, and a filter that would reduce it to eleven
**WHEN** the filter is applied
**THEN** the unfiltered aggregate is returned with an indication that the filter was not applied to the figure, because the reduction is smaller than `k`

---

**GIVEN** a denial occurs
**WHEN** [[VPS-F004_Silent_Audit_Log|VPS-F004]] is queried
**THEN** an entry exists with requesting user, node type, node ID, attempted path and reason, timestamped to millisecond accuracy

---

## Out of scope

- UI-layer-only access control, prohibited as a sole mechanism
- Role management UI for end users; assignment is an Owner operation in workspace settings
- Field-level encryption as a substitute for permission enforcement; [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] and this document are complementary layers, not interchangeable
- The cryptographic mechanics of Tier 1 and Tier 3, fully specified in [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]
- Differential privacy with calibrated noise, deliberately rejected in favor of suppression — a noised figure invites a reader to treat an unreliable number as real

---

## Decisions recorded

**The k-anonymity mechanism is unified here.** Four features had independently reached the same answer with four configuration keys and four implementations, and no aggregate outside those four was protected at all. One mechanism, two thresholds, applied everywhere.

**Differencing protection is specified**, which none of the four previous implementations addressed. Threshold checking alone is defeated by two individually-compliant queries against overlapping cohorts.

**Suppression is chosen over noising.** An approximated figure below threshold looks like a real figure and will be acted on as one.

**The matrix is rewritten without correction archeology.** The previous version carried the reasoning for each historical fix inside the table cells, which made a reference table read as a changelog. The three recurring override patterns are named once above, so a new feature applies them on sight.

**Rows are added for twenty-four new node types** introduced in [[VRS-001_Feature_Register|VRS-001]], each classified against the same patterns rather than new ones.

**The `None`/`Restricted` split is founder-decided and revisable on user evidence.** Five cells moved to `Restricted` and three were left `None` as genuinely ambiguous, per the rule and the reasoning recorded above and in `docs/Foundations_Findings.md`. The direction to revise in matters more than the current assignment: moving a cell from `Restricted` to `None` only removes information a viewer had and is always safe to do without review. Moving a cell from `None` to `Restricted` adds information — even "this type of thing exists" is information — and needs the same scrutiny any other access widening gets. A future change tightening toward `None` is a bug fix; a future change loosening toward `Restricted` is a decision.

---

## Related Notes

- [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] — the node registry and privacy classes this layer enforces
- [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] — the tier model, and the reader sets derived from the classes here
- [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]] — the reference protocol, whose visibility rules depend on this document
- [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] — the visual treatment of the three kinds of absence
- [[VPS-F004_Silent_Audit_Log|VPS-F004]] — the audit log every denial writes to
- [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] — where the two k-anonymity thresholds are configured
