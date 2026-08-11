---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Architecture
Feature Type:
  - Platform
aliases:
  - VPS-A002
---

# VPS-A002 — Master Graph Schema Definition

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] (the CRDT library and storage engine must be settled facts, not open choices)
**Blocks:** [[VPS-A003_Unified_Sync_Architecture|VPS-A003]], [[VPS-A004_Graph_Permission_Layer|VPS-A004]], [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]], [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]], and every feature in every application without exception

This document is the single source of truth for the shape of the data behind [[Vulto for Professional Services]]: every node type, every edge type, every node's privacy class and sync tier, and the rules that govern how the graph may change.

**There is one graph.** Not one per application, not one per customer. Every application in the suite reads and writes the same `workspace_id`-scoped graph, which is what makes a Bench Forecast able to reflect a project deadline and a payslip able to reflect a billable hour without an integration existing between them.

It is a registry, not a schema dump — a node's full field-by-field properties live in the feature that operationalizes it, in whichever application owns that feature.

**Every application registers its node types here.** An application does not maintain a parallel schema document, per [[VPS-000_Documentation_Standard|VPS-000]]'s Standing Rule 7: *what node types exist* must have exactly one answer.

---

## Decision

All product data is modeled as a **property graph**: typed nodes connected by typed, directed, first-class edges. Every feature reads from and writes to this single shared graph. No feature defines its own isolated data model. No entity is defined twice.

The graph is implemented per [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] as Loro CRDT documents on the client, with a SQLite-WASM materialized index providing the query surface, and PostgreSQL as the durable server-side store.

---

## Context

Without a master schema decided before engineering begins, feature work defines entities independently. Within a year the codebase holds several incompatible definitions of the same entity, relationships exist as implicit foreign keys rather than traversable edges, and [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]] has no coherent graph to reason over.

Two naming decisions from this document's history remain load-bearing and are recorded so they are not reopened:

**`belongs_to` means Project to Client, and nothing else.** An earlier draft reused the same name for the multi-entity relationship. That relationship is now `scoped_to_entity`, and it connects Employee to Entity only. Which entity bills a client or signs a contract is a financial and legal attribution question belonging to [[Vulto Accounts]] and [[Vulto Legal]], not an employment-law one.

**SubVendor represents an external organization, never an individual.** An individual freelancer is an Employee node with `employment_type = Contractor`, per [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]]. [[VRS-F043_Contractor_and_Sub-Vendor_Management|VRS-F043]] governs both through these two node types rather than one merged concept.

---

## Universal node conventions

Every node type carries this base shape without exception.

```
node_id:           UUID v4, globally unique
workspace_id:      UUID, FK to Workspace
                     EXCEPTION: Workspace itself carries none
                     EXCEPTION: User carries none — a person may hold
                     WorkspaceMembership in more than one workspace;
                     scoping and role live on the membership, not the identity
node_type:         string
schema_version:    integer, incremented by the Schema Evolution Protocol below
lifecycle_status:  enum, specific to each node type
created_at:        ISO 8601 timestamp, UTC
updated_at:        ISO 8601 timestamp, UTC
created_by:        user_id UUID
updated_by:        user_id UUID
is_soft_deleted:   boolean, default false
soft_deleted_at:   ISO 8601 timestamp, null if not deleted
soft_deleted_by:   user_id UUID, null if not deleted
```

`updated_by` and `schema_version` are additions to the original convention. The first closes a genuine audit gap — the graph could previously say when a node changed but not who changed it, which is insufficient for an HR product whose records are read in disputes. The second makes the Schema Evolution Protocol enforceable per node rather than inferred from field presence.

All timestamps are stored UTC ISO-8601. Local time is a presentation concern resolved against the Workspace timezone and, where working hours matter, against [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]].

---

## Universal edge conventions

Every edge is a first-class object with its own UUID, never an implicit foreign key join.

```
edge_id:           UUID v4, globally unique
edge_type:         string
from_node_id:      UUID
to_node_id:        UUID
effective_from:    ISO 8601 timestamp, nullable
effective_to:      ISO 8601 timestamp, nullable
created_at:        ISO 8601 timestamp, UTC
created_by:        user_id UUID
metadata:          JSON, type-specific additional properties
is_soft_deleted:   boolean, default false
soft_deleted_at:   ISO 8601 timestamp, null if not deleted
soft_deleted_by:   user_id UUID, null if not deleted
```

`effective_from` and `effective_to` are promoted to first-class fields rather than living inside `metadata`. Temporal filtering is the single most common operation performed on this graph — every Bench Forecast render, every capacity check, every reporting-line traversal filters on it — and JSON extraction inside a SQLite `WHERE` clause cannot be indexed usefully. This is a performance decision, made once here, that [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]]'s latency budgets depend on.

## When a relationship is a node instead of an edge

Some relationships carry data of their own. An assignment has a billing rate and a status; a skill holding has a proficiency level; a membership has a role. Two shapes are available, and choosing between them per relationship produced three different patterns for the same idea.

**A relationship is a node when it carries its own lifecycle status, or when another node must point at it. Otherwise it is an edge carrying metadata.**

**Lifecycle is the test because this document already made it one.** Every node carries `lifecycle_status`; no edge does. A relationship that moves through states — Active, then Completed, then Canceled — is a thing with a life, and modeling it as an edge means inventing a status field the edge conventions do not have. The second clause is forced rather than chosen: A002-T03 requires an edge's endpoints to be nodes, so anything another node must reference has to be one.

Assignment and WorkspaceMembership are nodes: the first is Active, Completed or Canceled and is pointed at by TimesheetEntry; the second is Active or Revoked. `has_skill`, `contracted_with`, `allocated_to`, `holds_certification`, `managed_by` and `registered_on` are edges carrying metadata — none has a status of its own and nothing points at any of them.

**A relationship-node's endpoint edges are named for what they express, with the node as the `from`.** `assignment_of` runs Assignment → Employee and `assigned_to` runs Assignment → Project, following `incurred_by` and `attributed_to` on Expense. **The endpoint pair itself is not an edge.** *Which employees are on which projects* is a two-hop traversal through Assignment, and registering an Employee → Project edge alongside it would create a second answer to a question the graph can already answer — the denormalization Standing Rule 7 exists to prevent.

**The edge registry's key is the triple of `edge_type`, from-node type and to-node type — never `edge_type` alone.** `governed_by` is registered four times against four unrelated pairs; `part_of` twice; `supersedes`, `references`, `affects` and `has_custom_value` are polymorphic across many types. An implementation keyed on the edge type would collapse four distinct relationships into one, silently.

---

**The single-active-edge-with-history pattern** applies to any edge type representing a relationship that changes over time but whose history must remain traversable. `managed_by` is the canonical example. At most one edge of that type may be active between a given pair of nodes at any moment; changing it sets `effective_to` on the prior edge and creates a new one with `effective_from`. Full history remains traversable. Any future edge with this shape follows the same pattern rather than inventing a new one.

---

## Privacy classes and tiers

Two orthogonal properties govern every node. **Privacy Class** determines who may read it, evaluated by [[VPS-A004_Graph_Permission_Layer|VPS-A004]]. **Tier** determines how it is synced and encrypted, governed by [[VPS-A003_Unified_Sync_Architecture|VPS-A003]].

| Tier | Protection | Contains |
|---|---|---|
| **Tier 0** | Standard encryption at rest, broad sync | Most operational data |
| **Tier 1** | True end-to-end encryption. Vulto's servers cannot read it | Salary, payroll, rate cards, commercial terms, compensation |
| **Tier 2** | Standard encryption, narrow distribution | HR-sensitive records, contracts, signals about individuals |
| **Tier 3** | Single-reader end-to-end encryption. Not even Owner reads another person's | Wellness, individual pulse responses |

**Field-level tier splitting is an established pattern, not an exception.** Employee, Pitch, Contract, Requisition, Offer and HRCase each carry a Tier 0 or Tier 2 identifying half and a Tier 1 protected half. The rule that produces the split is consistent: *if a field states a compensation figure or a commercial term, it is Tier 1, regardless of what node it sits on.* A signed contract that states a salary receives the same protection as the salary field itself, because the protection followed the figure rather than the container.

**A tier split and a class split are different operations, and a node may have one without the other.** Employee, Pitch, Contract, Requisition and Offer split both: each half carries its own Privacy Class *and* its own tier. HRCase and CaseEvent split only the tier — both halves are readable by the same two roles, and the content half is Tier 1 because it holds allegations about named individuals rather than because a different set of people may read it. Reading the `Split:` notation as implying both is the mistake that put a tier fact in the Privacy Class column and left it there.

---

## How the Privacy Class column is written

The Privacy Class column is **closed**. Every value is exactly one member of the set [[VPS-A004_Graph_Permission_Layer|VPS-A004]] defines, spelled identically. A class is a key into that document's default permission mapping, not a description.

Three separately-enforced facts were previously written into this column and each now lives where it is enforced:

| Fact | Where it lives | Enforced by |
|---|---|---|
| Which roles get which grant | this column, plus [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s matrix where a node departs from its class default | [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s query interceptor |
| Which *instances* a grant covers — own, direct reports, team, recipient | the parentheticals in [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s matrix | the same interceptor |
| Which *application* may write | the Cross-Suite Node Ownership table below | [[VPS-F008_Vulto_Suite_Graph_Bridge|VPS-F008]] |

**A departure from a class's default grants is recorded in [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s matrix, never as an adjective here.** `Manager-restricted, Manager gets Full` said in a registry cell what [[VPS-A004_Graph_Permission_Layer|VPS-A004]] already said in a matrix row and named as a recurring pattern, and a fact stated twice is a fact that can disagree with itself.

**Two notations appear in this column.**

`Class A (half) / Class B (half)` — a node whose halves carry different classes. The order matches the `Split:` order in the Tier column.

`Class †` — the recorded tier is a deliberate departure from the default [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] maps this class to. The departure and its reason are stated beneath the table. Without the marker a considered decision is indistinguishable from an error, and a reader checking the registry against [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] has no way to tell which they are looking at.

**On a split row, the identifying half carries its class's default tier and the protected half is the declared split.** `Split:` is itself the declaration, so the protected half needs no `†` — the notation already says a departure is intended. Nine node types split. Every one of them has an identifying half whose tier matches its class default, which is what makes the split legible as a split rather than as two unexplained assignments.

**"HR-restricted" is a class, not a description.** It grants Finance Admin `Read` and grants the subject `Read (own only)`. Four documents used it to mean *restricted to HR*, which is a different and much narrower grant — `Owner and HR Admin only`. Where a document's own behavioral statement said one thing and its class label said another, the behavioral statement was authoritative and the label was corrected.

---

## Node type registry

Nodes marked **A002-owned** have their lifecycle statuses, privacy class and tier fixed here and unvarying by feature. All nodes list the feature that owns their full field-level schema, per Standing Rule 6.

### Identity and workspace — A002-owned

| Node Type | Lifecycle Statuses | Owner | Privacy Class | Tier |
|---|---|---|---|---|
| **User** | Active, Suspended, Deleted | [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]] | Standard | 0 |
| **Workspace** | Active, Suspended, Canceled | [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]] | Standard (display) / Owner only (billing) | Split: 0 / 2 |
| **WorkspaceMembership** | Active, Revoked | [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]] | Standard | 0 |
| **Device** | Active, Revoked | [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]] | Standard | 0 |
| **Entity** | Active, Dissolved | [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] | Standard | 0 |

Entity is permanently Roster-owned and scoped specifically to employment jurisdiction: which entity's employment law, leave policy and payroll applies to a person. Consolidated financial reporting remains [[Vulto Accounts]]' territory; intercompany contract structuring remains [[Vulto Legal]]'s.

### Calendar and time — [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]

| Node Type | Lifecycle Statuses | Privacy Class | Tier |
|---|---|---|---|
| WorkingCalendar | Active, Superseded | Standard | 0 |
| Holiday | Active, Canceled | Standard | 0 |
| WorkingPattern | Active, Superseded | Standard | 0 |

New. WorkingCalendar defines the working week and holiday set for an Entity; Holiday is a dated non-working day within one; WorkingPattern is a per-employee override for part-time, compressed or non-standard schedules. Every working-day computation in this product resolves through these three, per Standing Rule 9.

### Core people and capacity — A002-owned

| Node Type | Lifecycle Statuses | Owner | Privacy Class | Tier |
|---|---|---|---|---|
| **Employee** | Active, Inactive, Converted | [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] | Standard (operational) / Finance-restricted (compensation) | Split: 0 / 1 |
| **Candidate** | Active, Hired, Rejected, Withdrawn, Converted | [[VRS-F028_Recruitment_Pipeline|VRS-F028]] | Standard | 0 |
| **GhostResource** | Active, Promoted, Canceled | [[VRS-F007_Ghost_Resources|VRS-F007]] | Standard | 0 |
| **Assignment** | Active, Completed, Canceled | [[VRS-F005_The_Bench_Forecast|VRS-F005]] | Standard | 0 |
| **Project** | Pitch, Active, Completed, Archived | [[VRS-F005_The_Bench_Forecast|VRS-F005]] bootstrap | Standard | 0 |
| **Pitch** | Active, Won, Lost, Converted | [[VRS-F009_Time_Classification_Taxonomy|VRS-F009]] | Standard (identifying) / Finance-restricted (commercial) | Split: 0 / 1 |
| **Client** | Active, Inactive | [[Vulto Sales]] permanent; [[VPJ-F001]] bootstrap | Standard | 0 |
| **OpenRole** | Open, Filled, Canceled | [[VRS-F028_Recruitment_Pipeline|VRS-F028]] | Standard | 0 |
| **Skill** | Active, Deprecated | [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] | Standard | 0 |

Employee's Tier 0 half includes `billing_rate_default` — what the agency charges for this person's time, which is operational. The Tier 1 half is actual salary, bonus and deductions. The distinction is the difference between what a client pays and what a person earns, and conflating them would have made the Bench Forecast unreadable to anyone without finance access.

Assignment's `effective_billing_rate`, added by [[VRS-F006_Rate_Card_Engine|VRS-F006]], is Tier 0 throughout despite being resolved partly from Finance-restricted RateCard data, mirroring `billing_rate_default`.

### Wellness — A002-owned, privacy-critical

| Node Type | Lifecycle Statuses | Owner | Privacy Class | Tier |
|---|---|---|---|---|
| **WellnessTriggerEvent** | Active, Resolved | [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]] | Self-only, absolute | 3 |

### HR operations

| Node Type | Owner | Privacy Class | Tier |
|---|---|---|---|
| Contract | [[VRS-F020_Universal_Contract_Builder|VRS-F020]] | HR-restricted (identifying) / Finance-restricted (content) | Split: 2 / 1 |
| SignatureRequest | [[VRS-F021_E-Signature_Native|VRS-F021]] | HR-restricted | 2 |
| Document | [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] | Inherited | Inherited |
| LeavePolicy | [[VRS-F018_Leave_Policy_Engine|VRS-F018]] | Standard | 0 |
| LeaveRequest | [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] | Standard | 0 |
| Departure | [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] | HR-restricted | 2 |
| Asset | [[VRS-F042_Asset_and_Gear_Tracker|VRS-F042]] | Standard | 0 |
| Certification | [[VRS-F041_Certification_and_Training_Tracker|VRS-F041]] | Standard | 0 |
| TrainingRecord | [[VRS-F041_Certification_and_Training_Tracker|VRS-F041]] | Standard | 0 |
| SubVendor | [[VRS-F043_Contractor_and_Sub-Vendor_Management|VRS-F043]] | Standard | 0 |
| Policy | [[VRS-F044_Policy_Library_and_Acknowledgement|VRS-F044]] | Standard | 0 |
| PolicyAcknowledgment | [[VRS-F044_Policy_Library_and_Acknowledgement|VRS-F044]] | Standard | 0 |
| WorkAuthorization | [[VRS-F045_Right_to_Work_and_Immigration_Compliance|VRS-F045]] | HR-restricted | 2 |
| HRCase | [[VRS-F046_Case_Management_Disciplinary_and_Grievance|VRS-F046]] | Owner and HR Admin only | Split: 2 / 1 |
| CaseEvent | [[VRS-F046_Case_Management_Disciplinary_and_Grievance|VRS-F046]] | Owner and HR Admin only | Split: 2 / 1 |
| OrgScenario | [[VRS-F037_Dynamic_Org_Chart|VRS-F037]] | Owner and HR Admin only | 2 |

Contract's content half is Tier 1 rather than Tier 2 because a generated employment contract states the exact salary figure, which cannot sit at weaker, server-readable protection when that same figure enjoys full end-to-end encryption on the Employee node.

HRCase and CaseEvent follow the identical pattern for a different reason: a disciplinary or grievance narrative contains allegations about named individuals, and is among the most consequential text this product will ever hold.

OrgScenario is Owner and HR Admin only rather than Standard because a draft restructure showing a role removed reveals a planned departure before the person concerned has been told.

### Recruitment

| Node Type | Owner | Privacy Class | Tier |
|---|---|---|---|
| HeadcountPlan | [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]] | Finance-restricted | 1 |
| Requisition | [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]] | Standard (identifying) / Finance-restricted (budget) | Split: 0 / 1 |
| JobPosting | [[VRS-F029_Careers_Site_and_Job_Distribution|VRS-F029]] | Standard | 0 |
| TalentPool | [[VRS-F033_Talent_Pool_and_Candidate_CRM|VRS-F033]] | HR-restricted | 2 |
| Referral | [[VRS-F034_Employee_Referral_Program|VRS-F034]] | Standard | 0 |
| InterviewRound | [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]] | HR-restricted | 2 |
| FeedbackEntry | [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]] | HR-restricted | 2 |
| Offer | [[VRS-F032_Offer_Management|VRS-F032]] | HR-restricted (identifying) / Finance-restricted (terms) | Split: 2 / 1 |
| BackgroundCheckProvider | [[VRS-F035_Background_Check_Integration|VRS-F035]] | HR Admin only | 2 |
| BackgroundCheckRecord | [[VRS-F035_Background_Check_Integration|VRS-F035]] | HR Admin only | 2 |
| DraftHiringRecord | [[VRS-F036_Opportunity-to-Draft_Hiring_Trigger|VRS-F036]] | Standard | 0 |

Referral carries no bonus amount. The amount is a compensation adjustment recorded against the referrer's payroll, which keeps a Tier 1 figure out of a node that recruiters need to read.

### Signals and sentiment

| Node Type | Owner | Privacy Class | Tier |
|---|---|---|---|
| TimesheetEntry | [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] | Standard | 0 |
| TimesheetAnomalyFlag | [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] | Manager-restricted | 2 |
| UtilizationSnapshot | [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]] | Standard | 0 |
| RevenueGapAlert | [[VRS-F012_Revenue_Gap_Alert|VRS-F012]] | Standard | 0 |
| SkillGap | [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] | Standard | 0 |
| PulseCycle | [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] | Standard | 0 |
| PulseEntry | [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] | Sensitive | 3 |
| PulseAggregateContribution | [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] | Standard | 0 |
| CoffeePulseEntry | [[VRS-F077_Monthly_Coffee_Pulse|VRS-F077]] | Sensitive | 3 |
| SharedCoffeeMoment | [[VRS-F077_Monthly_Coffee_Pulse|VRS-F077]] | Standard | 0 |
| WellnessAggregateContribution | [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]] | Standard | 0 |
| BurnoutAlert | [[VRS-F052_Workload_Strain_Signal|VRS-F052]] | Manager-restricted | 2 |
| FlightRiskSignal | [[VRS-F053_Retention_Risk_Indicator|VRS-F053]] | Owner and HR Admin only | 2 |
| ProbationCheckIn | [[VRS-F057_Probation_Review_Intelligence|VRS-F057]] | Manager-restricted | 2 |
| HeadcountSnapshot | [[VRS-F058_People_Analytics_Dashboard|VRS-F058]] | HR-restricted | 0 † |

**† HeadcountSnapshot is Tier 0 against a class that maps to Tier 2, and this is deliberate.** The node holds an aggregate headcount count and nothing else. Who may open the analytics view is a permission question, answered by the Privacy Class; how strongly the number is encrypted is a protection question, and a count of employees does not need end-to-end treatment or narrow distribution. This is the only tier departure in the registry.

`PulseAggregateContribution` and `WellnessAggregateContribution` each carry a value with **deliberately no edge to Employee at all**. This is anonymization by structural absence of an identifying link, not by permission rule alone, and it is the mechanism that makes team-level sentiment reporting possible without ever putting a Tier 3 record within reach of a role change.

The earlier registry listed a `WellnessAggregate` node. It is removed: the aggregate is a computed view over `WellnessAggregateContribution`, not a stored node, and registering a node type that is never written would have obliged an implementer to build one.

### Finance

| Node Type | Owner | Privacy Class | Tier |
|---|---|---|---|
| RateCard | [[VRS-F006_Rate_Card_Engine|VRS-F006]] bootstrap | Finance-restricted | 1 |
| RateCardLine | [[VRS-F006_Rate_Card_Engine|VRS-F006]] | Finance-restricted | 1 |
| CompensationBand | [[VRS-F070_Compensation_Bands_and_Pay_Equity|VRS-F070]] | Finance-restricted | 1 |
| CompensationChange | [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]] | Finance-restricted | 1 |
| PayrollPolicy | [[VRS-F062_Payroll_Engine_Core|VRS-F062]] | Finance-restricted | 1 |
| PayRun | [[VRS-F062_Payroll_Engine_Core|VRS-F062]] bootstrap | Finance-restricted | 1 |
| PaySlip | [[VRS-F062_Payroll_Engine_Core|VRS-F062]] | Self and Finance-restricted | 1 |
| TaxConfig | [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]] | Finance-restricted | 1 |
| ExchangeRate | [[VRS-F064_Multi-Currency_Payroll|VRS-F064]] | Finance-restricted | 1 |
| ApprovalStage | [[VRS-F065_Payroll_Approval_Workflow|VRS-F065]] | Inherited | Inherited |
| DisbursementBatch | [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]] | Finance-restricted | 1 |
| DisbursementInstruction | [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]] | Finance-restricted | 1 |
| Invoice | [[VRS-F067_Contractor_Invoice_Management|VRS-F067]] bootstrap | Finance-restricted | 1 |
| Expense | [[VRS-F068_Expense_Management|VRS-F068]] | Standard | 0 |

Expense is Standard and Tier 0 deliberately. An amount spent on travel or a client dinner is operational financial data, not compensation, and a Manager needs to see their direct reports' expenses to approve them. Classifying it Finance-restricted would have made the approval workflow impossible for the person who actually performs it.

ApprovalStage is generalized beyond payroll. It gates PayRun ([[VRS-F065_Payroll_Approval_Workflow|VRS-F065]]), CompensationChange ([[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]]), Requisition ([[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]]) and Offer ([[VRS-F032_Offer_Management|VRS-F032]]), inheriting the tier of whatever it gates. Four approval workflows sharing one node type is four fewer implementations of the same idea.

### Development and review

| Node Type | Owner | Privacy Class | Tier |
|---|---|---|---|
| OnboardingTemplate | [[VRS-F024_Structured_Onboarding_Workflow|VRS-F024]] | Standard | 0 |
| OnboardingPlan | [[VRS-F024_Structured_Onboarding_Workflow|VRS-F024]] | Standard | 0 |
| OnboardingTask | [[VRS-F024_Structured_Onboarding_Workflow|VRS-F024]] | Standard | 0 |
| ReviewCycle | [[VRS-F039_Performance_Review_Cycle|VRS-F039]] | Standard | 0 |
| ReviewEntry | [[VRS-F039_Performance_Review_Cycle|VRS-F039]] | HR-restricted | 2 |
| CareerPath | [[VRS-F040_Career_Pathing_and_Development_Tracker|VRS-F040]] | Standard | 0 |
| CareerMilestone | [[VRS-F040_Career_Pathing_and_Development_Tracker|VRS-F040]] | Standard | 0 |
| DevelopmentGoal | [[VRS-F040_Career_Pathing_and_Development_Tracker|VRS-F040]] | Standard | 0 |

### Platform, intelligence and ecosystem

| Node Type | Owner | Privacy Class | Tier |
|---|---|---|---|
| Notification | [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] | Recipient-only | 0 |
| AuditEntry | [[VPS-F004_Silent_Audit_Log|VPS-F004]] | Owner and HR Admin only | 2 |
| ImportBatch | [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]] | Owner and HR Admin only | 2 |
| RetentionPolicy | [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] | Owner and HR Admin only | 2 |
| ErasureRequest | [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] | Owner and HR Admin only | 2 |
| Insight | [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]] | Inherited | Inherited |
| BriefingNode | [[VRS-F056_Proactive_Daily_Briefing|VRS-F056]] | Self only | 0 |
| ReportDefinition | [[VRS-F061_Reporting_and_Export_Engine|VRS-F061]] | Standard | 0 |
| ReportRun | [[VRS-F061_Reporting_and_Export_Engine|VRS-F061]] | Inherited | Inherited |
| BenchmarkRange | [[VRS-F071_Salary_Benchmarking|VRS-F071]] | Finance-restricted | 1 |
| BenchmarkReference | [[VRS-F072_Agency_Benchmarking|VRS-F072]] | Standard | 0 |
| ApplicationActivation | [[VPS-F008_Vulto_Suite_Graph_Bridge|VPS-F008]] | Standard | 0 |
| IntegrationConfig | [[VPS-F009_Vulto_Sync_API|VPS-F009]] | Owner only | 2 |
| CustomFieldDefinition | [[VPS-F010_Custom_Fields_and_Workspace_Extensibility|VPS-F010]] | Standard | 0 |
| CustomFieldValue | [[VPS-F010_Custom_Fields_and_Workspace_Extensibility|VPS-F010]] | Inherited | Inherited |
| GraphReference | [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]] | Inherited | Inherited |
| ClientPortalAccess | [[Vulto Comms]] | HR Admin only | 2 |

Notification's recipient-only class is an access shape distinct from every other privacy class: no role, including Owner, reads another user's notifications.

AuditEntry is Tier 2 rather than Tier 1 or 3 despite referencing both, because it holds only metadata about access — who, what kind of record, when — and never the payload.

ImportBatch is Tier 2 and carries a hard constraint from [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]]: it records row counts, outcomes and errors, never the imported payload itself. An import of salary data that retained its source rows would have created a Tier 1 leak inside a Tier 2 node.

---

## Workspace configuration registry

The Workspace node accumulates configuration keys, each added by whichever feature first needed one. The previous draft carried all of them inside a single table cell, which was unreadable and had no owning surface. They are registered properly here, and [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] owns the console where they are edited.

| Key | Type | Default | Added by | Purpose |
|---|---|---|---|---|
| `name`, `logo`, `timezone` | — | — | [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]] | Workspace display. Tier 0, readable by every member |
| `primary_currency` | ISO 4217 | required | [[VRS-F064_Multi-Currency_Payroll|VRS-F064]] | Base currency for normalized reporting |
| `billability_target` | decimal | 0.75 | [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]] | Target billable fraction |
| `overtime_flag_threshold` | decimal | 1.3 | [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] | Multiplier over contracted hours flagging a week for review |
| `near_capacity_warning_threshold` | decimal % | 90 | [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]] | Combined allocation above which a non-blocking warning surfaces |
| `bench_alert_threshold_days` | integer | 5 | [[VRS-F012_Revenue_Gap_Alert|VRS-F012]] | Unassigned working days before the first alert |
| `transition_warning_days` | integer | 14 | [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] | Lead time on probation and notice completion |
| `signature_link_expiry_days` | integer | 30 | [[VRS-F021_E-Signature_Native|VRS-F021]] | Signing link validity |
| `certification_expiry_warning_days` | integer | 60 | [[VRS-F041_Certification_and_Training_Tracker|VRS-F041]] | Renewal lead time |
| `burnout_no_leave_threshold_days` | integer | 90 | [[VRS-F052_Workload_Strain_Signal|VRS-F052]] | Days since approved leave counting as a burnout signal |
| `flight_risk_stagnation_months` | integer | 18 | [[VRS-F053_Retention_Risk_Indicator|VRS-F053]] | Months at a milestone without progression |
| `capacity_planner_horizon_quarters` | integer | 4 | [[VRS-F051_Team_Capacity_Planner|VRS-F051]] | Forecast horizon |
| `k_anonymity_minimum` | integer | 5 | [[VPS-A004_Graph_Permission_Layer|VPS-A004]] | **Global** minimum cohort for any aggregate |
| `k_anonymity_minimum_sensitive` | integer | 8 | [[VPS-A004_Graph_Permission_Layer|VPS-A004]] | Elevated minimum for Tier 3-derived aggregates |
| `category_guideline_amounts` | JSON map | — | [[VRS-F068_Expense_Management|VRS-F068]] | Per-category expense guideline producing a soft warning |
| `receipt_required_above_amount` | decimal | — | [[VRS-F068_Expense_Management|VRS-F068]] | The one hard validation in expense submission |
| `wellness_resource_text` | string | null | [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]] | Configured confidential resource, shown alongside the baseline crisis reference, never instead of it |
| `wellness_resource_contact` | string | null | [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]] | As above |
| `max_file_size_mb` | integer | 25 | [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] | Upload limit |
| `tier1_retention_window_months` | integer | 12 | [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] | Rolling window for closed Tier 1 records held on device. Configurable 6 to 24 |
| `payroll_variance_flag_threshold` | decimal % | 15 | [[VRS-F065_Payroll_Approval_Workflow|VRS-F065]] | Net-pay change against the prior period that flags a payslip for review |
| `vocabulary_profile` | enum | Agency | [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]] | One of four fixed profiles: Agency, Consultancy, Engineering, Studio. Never free text |
| Billing status, subscription tier, deletion controls | — | — | [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]] | **Tier 2, Owner-only** |

**The k-anonymity keys replace four separate thresholds.** The previous set carried `pulse_minimum_responses_threshold`, `wellness_minimum_responses_threshold`, `hiring_quality_minimum_sample_size` and `retention_analytics_minimum_sample_size` — four keys, four defaults, four independent implementations of one idea, and no protection at all on the Bench Forecast's filtered utilization percentage, which is equally capable of identifying an individual in a small workspace. There is now one mechanism, defined in [[VPS-A004_Graph_Permission_Layer|VPS-A004]], applied by every aggregate in the product.

Workspace display fields are Tier 0 and readable by every member. A blanket Owner-only class would have meant no team member could read the workspace's own name.

---

## Edge type registry

Where an edge connects several node type pairs, each pair is listed explicitly. Ambiguous multi-value rows were a defect in the previous draft — a row reading `From: A, B, C` and `To: X, Y, Z` does not say which connects to which, and an implementer would have had to guess.

### Identity and structure

| Edge | From → To | Owner | Notes |
|---|---|---|---|
| `membership_of` | WorkspaceMembership → User | [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] | |
| `membership_in` | WorkspaceMembership → Workspace | [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] | A user's workspaces are the two-hop traversal, not an edge |
| `registered_on` | Device → User | [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] | Carries platform, registered_at, last_active_at |
| `managed_by` | Employee → Employee | [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] | Single-active-edge-with-history. Backed by Loro's Movable Tree per [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] |
| `scoped_to_entity` | Employee → Entity | [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] | Employment jurisdiction only |
| `governed_by_calendar` | Entity → WorkingCalendar | [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] | |
| `pattern_for` | WorkingPattern → Employee | [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] | Overrides the Entity calendar |
| `holiday_in` | Holiday → WorkingCalendar | [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] | |
| `delivered_to` | Notification → User | [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] | |

### Capacity and delivery

| Edge | From → To | Owner | Notes |
|---|---|---|---|
| `assignment_of` | Assignment → Employee | [[VRS-F005_The_Bench_Forecast|VRS-F005]] | |
| `assigned_to` | Assignment → Project | [[VRS-F005_The_Bench_Forecast|VRS-F005]] | Who is on what is the two-hop traversal through Assignment, not an edge |
| `belongs_to` | Project → Client | [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] | |
| `originated_from` | Project → Pitch | [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] | Preserved on conversion |
| `placeholder_for` | GhostResource → OpenRole | [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] | Links capacity planning to recruitment |
| `promoted_to` | GhostResource → Employee | [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] | Preserved on hire |
| `logged_against` | TimesheetEntry → Assignment \| Pitch | [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] | |
| `processed_in` | TimesheetEntry → PayRun \| Invoice | [[VRS-F062_Payroll_Engine_Core|VRS-F062]], [[VRS-F067_Contractor_Invoice_Management|VRS-F067]] | Double-billing safeguard |
| `contracted_with` | SubVendor → Project | [[VRS-F043_Contractor_and_Sub-Vendor_Management|VRS-F043]] | Carries start_date, end_date, capacity_units |

### Skills

| Edge | From → To | Owner | Notes |
|---|---|---|---|
| `has_skill` | Employee → Skill | [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] | Carries proficiency_level, verified, verified_by, verified_at |
| `requires_skill` | Project \| OpenRole \| Pitch \| CareerMilestone \| Requisition → Skill | [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] | Carries proficiency_level_required |
| `holds_certification` | Employee → Certification | [[VRS-F041_Certification_and_Training_Tracker|VRS-F041]] | Carries issue_date, expiry_date, issuing_body |
| `resulted_in` | TrainingRecord → Skill | [[VRS-F041_Certification_and_Training_Tracker|VRS-F041]] | Carries proficiency_level_granted |
| `gap_for` | SkillGap → Skill | [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] | |

### Recruitment

| Edge | From → To | Owner | Notes |
|---|---|---|---|
| `converted_from` | Employee → Candidate | [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] | Preserved on conversion |
| `filled_by` | OpenRole → Candidate | [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] | Winning candidate only |
| `requisition_for` | Requisition → HeadcountPlan | [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]] | |
| `opened_from` | OpenRole → Requisition | [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]] | An approved requisition becomes a role |
| `posted_as` | OpenRole → JobPosting | [[VRS-F029_Careers_Site_and_Job_Distribution|VRS-F029]] | |
| `pooled_in` | Candidate → TalentPool | [[VRS-F033_Talent_Pool_and_Candidate_CRM|VRS-F033]] | |
| `referred_by` | Referral → Employee | [[VRS-F034_Employee_Referral_Program|VRS-F034]] | The referring employee |
| `referral_for` | Referral → Candidate | [[VRS-F034_Employee_Referral_Program|VRS-F034]] | |
| `interview_for` | InterviewRound → Candidate | [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]] | |
| `participating_in` | Employee → InterviewRound | [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]] | |
| `has_feedback` | InterviewRound → FeedbackEntry | [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]] | |
| `offer_for` | Offer → Candidate | [[VRS-F032_Offer_Management|VRS-F032]] | |
| `check_for` | BackgroundCheckRecord → Candidate | [[VRS-F035_Background_Check_Integration|VRS-F035]] | |

### HR operations

| Edge | From → To | Owner | Notes |
|---|---|---|---|
| `employed_under` | Employee → Contract | [[VRS-F020_Universal_Contract_Builder|VRS-F020]] | |
| `signature_for` | SignatureRequest → Contract | [[VRS-F021_E-Signature_Native|VRS-F021]] | |
| `has_document` | Contract \| Offer \| HRCase \| WorkAuthorization \| BackgroundCheckRecord \| PaySlip → Document | [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] | Target inherits source tier, per Standing Rule 8 |
| `requested_by` | LeaveRequest → Employee | [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] | |
| `approved_by` | LeaveRequest → Employee | [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] | The approving manager |
| `allocated_to` | Asset → Employee | [[VRS-F042_Asset_and_Gear_Tracker|VRS-F042]] | Carries allocation_date, expected_return_date, actual_return_date |
| `departing` | Departure → Employee | [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] | |
| `enrolled_in` | Employee → OnboardingPlan | [[VRS-F024_Structured_Onboarding_Workflow|VRS-F024]] | |
| `acknowledged_by` | PolicyAcknowledgment → Employee | [[VRS-F044_Policy_Library_and_Acknowledgement|VRS-F044]] | |
| `acknowledgment_of` | PolicyAcknowledgment → Policy | [[VRS-F044_Policy_Library_and_Acknowledgement|VRS-F044]] | Points at the specific version |
| `authorization_for` | WorkAuthorization → Employee | [[VRS-F045_Right_to_Work_and_Immigration_Compliance|VRS-F045]] | |
| `case_concerns` | HRCase → Employee | [[VRS-F046_Case_Management_Disciplinary_and_Grievance|VRS-F046]] | |
| `event_in` | CaseEvent → HRCase | [[VRS-F046_Case_Management_Disciplinary_and_Grievance|VRS-F046]] | |
| `scenario_of` | OrgScenario → Workspace | [[VRS-F037_Dynamic_Org_Chart|VRS-F037]] | A proposed hierarchy, not the live one |

### Development and signals

| Edge | From → To | Owner | Notes |
|---|---|---|---|
| `reviewed_in` | Employee → ReviewEntry | [[VRS-F039_Performance_Review_Cycle|VRS-F039]] | |
| `part_of` | ReviewEntry → ReviewCycle | [[VRS-F039_Performance_Review_Cycle|VRS-F039]] | |
| `part_of` | PulseEntry \| PulseAggregateContribution → PulseCycle | [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] | |
| `at_milestone` | Employee → CareerMilestone | [[VRS-F040_Career_Pathing_and_Development_Tracker|VRS-F040]] | Current |
| `targeting` | Employee → CareerMilestone | [[VRS-F040_Career_Pathing_and_Development_Tracker|VRS-F040]] | Aspired |
| `working_towards` | Employee → DevelopmentGoal | [[VRS-F040_Career_Pathing_and_Development_Tracker|VRS-F040]] | |
| `submitted_by` | PulseEntry \| CoffeePulseEntry → Employee | [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]], [[VRS-F077_Monthly_Coffee_Pulse|VRS-F077]] | |
| `logged_by` | WellnessTriggerEvent → Employee | [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]] | Tier 3; no device but the owner's decrypts it |
| `checked_in_on` | ProbationCheckIn → Employee | [[VRS-F057_Probation_Review_Intelligence|VRS-F057]] | |
| `triggered_by` | BurnoutAlert \| FlightRiskSignal \| RevenueGapAlert \| TimesheetAnomalyFlag → Employee | [[VRS-F052_Workload_Strain_Signal|VRS-F052]], [[VRS-F053_Retention_Risk_Indicator|VRS-F053]], [[VRS-F012_Revenue_Gap_Alert|VRS-F012]], [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] | |
| `affects` | Insight → Any Node | [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]] | |

### Finance

| Edge | From → To | Owner | Notes |
|---|---|---|---|
| `governed_by` | Assignment → RateCard | [[VRS-F006_Rate_Card_Engine|VRS-F006]] | |
| `governed_by` | Employee → LeavePolicy | [[VRS-F018_Leave_Policy_Engine|VRS-F018]] | |
| `governed_by` | PayRun → PayrollPolicy | [[VRS-F062_Payroll_Engine_Core|VRS-F062]] | |
| `governed_by` | PayRun → TaxConfig | [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]] | |
| `banded_by` | Employee → CompensationBand | [[VRS-F070_Compensation_Bands_and_Pay_Equity|VRS-F070]] | |
| `changes_compensation_for` | CompensationChange → Employee | [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]] | |
| `gated_by` | PayRun \| CompensationChange \| Requisition \| Offer → ApprovalStage | [[VRS-F065_Payroll_Approval_Workflow|VRS-F065]] | One approval mechanism, four consumers |
| `contains` | PayRun → PaySlip | [[VRS-F062_Payroll_Engine_Core|VRS-F062]] | |
| `issued_to` | PaySlip → Employee | [[VRS-F062_Payroll_Engine_Core|VRS-F062]] | |
| `disbursed_in` | PaySlip \| Invoice → DisbursementBatch | [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]] | |
| `instruction_in` | DisbursementInstruction → DisbursementBatch | [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]] | |
| `billed_by` | Invoice → Employee \| SubVendor | [[VRS-F067_Contractor_Invoice_Management|VRS-F067]] | |
| `generated_from` | Invoice → Project | [[VRS-F067_Contractor_Invoice_Management|VRS-F067]] | |
| `incurred_by` | Expense → Employee | [[VRS-F068_Expense_Management|VRS-F068]] | |
| `attributed_to` | Expense → Project | [[VRS-F068_Expense_Management|VRS-F068]] | |

### Platform

| Edge | From → To | Owner | Notes |
|---|---|---|---|
| `supersedes` | RateCard \| LeavePolicy \| TaxConfig \| Policy \| WorkingCalendar \| CompensationBand → same type | [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] | **Consolidated.** The previous draft defined this edge twice with overlapping scope. Content-versioning: updating creates a new node rather than editing in place, so records already pointing at an older version keep their original figures |
| `references` | GraphReference → Any Node | [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]] | |
| `referenced_in` | Any Node → GraphReference | [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]] | Inverse, created automatically |
| `has_custom_value` | Any Node → CustomFieldValue | [[VPS-F010_Custom_Fields_and_Workspace_Extensibility|VPS-F010]] | |
| `defined_by` | CustomFieldValue → CustomFieldDefinition | [[VPS-F010_Custom_Fields_and_Workspace_Extensibility|VPS-F010]] | |
| `imported_in` | Any Node → ImportBatch | [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]] | Provenance for bulk-created records |
| `erasure_targets` | ErasureRequest → Employee \| Candidate | [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] | |

---

### Vulto Projects — [[VPJ-001_Feature_Register|VPJ-001]]

Registered ahead of implementation so that [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s Project stub and [[VRS-F009_Time_Classification_Taxonomy|VRS-F009]]'s Pitch conversion have a defined destination. Full field-level schemas live in each owning feature document.

| Node Type | Lifecycle Statuses | Owner | Privacy Class | Tier |
|---|---|---|---|---|
| **Deliverable** | Draft, InProgress, InReview, RevisionRequested, Approved, Canceled | [[VPJ-F003]] | Standard | 0 |
| **Task** | Todo, InProgress, Done, Canceled | [[VPJ-F004]] | Standard | 0 |
| **Brief** | Draft, Agreed, Superseded | [[VPJ-F005]] | Standard | 0 |
| **Approval** | Pending, Approved, RevisionRequested | [[VPJ-F010]] | Standard | 0 |
| **RevisionRound** | Open, Closed | [[VPJ-F012]] | Standard | 0 |
| **ChangeOrder** | Draft, Sent, Accepted, Rejected | [[VPJ-F013]] | Standard (identifying) / Finance-restricted (commercial) | Split: 0 / 1 |
| **ProjectBudget** | Active, Superseded | [[VPJ-F014]] | Finance-restricted | 1 |
| **ProjectTemplate** | Active, Archived | [[VPJ-F016]] | Standard | 0 |
| **ClientStakeholder** | Active, Inactive | [[VPJ-F018]] | Standard | 0 |
| **BillingMilestone** | Pending, Triggered, Invoiced | [[VPJ-F042]] bootstrap; [[Vulto Accounts]] permanent | Finance-restricted | 1 |

**Deliverable's status enum is fixed and permanent**, per [[VPJ-001_Feature_Register|VPJ-001]]'s third structural decision. It is registered here rather than left to the feature specifically so that a per-workspace custom status set is not merely discouraged but unregistrable.

**ChangeOrder follows the established split.** The scope description is Standard — the delivery team needs it. The additional cost is Tier 1, for the same reason every commercial term in this graph is.

---

## Cross-suite node ownership

Several node types are not exclusively one application's to own. This table states which application is authoritative for a node type's lifecycle. [[VPS-F008_Vulto_Suite_Graph_Bridge|VPS-F008]] reads it directly and extends [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s query interceptor to enforce it at write time.

**Scoping principle.** This document registers every node type in the graph, grouped by the application that introduces it. It does not pre-define the internal entities of applications with no specification set yet — Statement of Work belongs to [[Vulto Legal]], Opportunity to [[Vulto Sales]] — and those sections appear here when those applications are specified, not before.

**The Write-Ownership Handoff Principle.** Several node types are bootstraps: an earlier application builds the full workflow because the specialized application does not exist yet. The data lives in one graph permanently. What changes, per workspace, at the moment that workspace activates the specialized application — never at signup — is which application is the primary place someone creates new records. Historical records need no migration, because the graph never changes shape when a new application starts consuming it. A workspace that never activates [[Vulto Accounts]] keeps Roster's full payroll workflow indefinitely.

| Node Type | Authoritative Owner | Reads | Writes |
|---|---|---|---|
| Employee, Assignment, Entity | Vulto Roster, permanent | Projects, Accounts, Payroll, Legal, [[Vulto Network]] | Roster only |
| WorkingCalendar, Holiday, WorkingPattern | Vulto Roster, permanent | Projects, Payroll, Accounts | Roster only |
| Client | [[Vulto Sales]] permanent owner; **Projects bootstrap** | Roster, Projects, Accounts, Legal, Pitch | Projects until Sales activates; Sales thereafter |
| Project | [[Vulto Projects]] once activated. Roster creates stubs ahead of it | Roster, Accounts, Legal, Pitch | Projects owns status lifecycle once activated; Roster writes capacity fields only |
| TimesheetEntry | Roster, bootstrap | Projects, Accounts | Projects becomes primary entry surface once activated; Roster's Speed-Run remains available regardless |
| Contract | Roster bootstrap; [[Vulto Legal]] once activated | Legal | Roster until Legal activates; Legal owns signature and archival status from the start |
| RateCard, Invoice | [[Vulto Accounts]] permanent owner; Roster bootstrap | Roster, Accounts, Quotations, Pitch | Roster until Accounts activates; Accounts thereafter |
| PayRun, PaySlip, DisbursementBatch | Roster bootstrap; [[Vulto Payroll]] once activated | Roster, Accounts | Roster until Payroll activates; Payroll thereafter |
| Deliverable, Task, Brief, Approval, RevisionRound, ChangeOrder, ProjectTemplate, ClientStakeholder | [[Vulto Projects]], permanent | Roster, Accounts, Legal, Pitch, Reports | Projects only |
| BillingMilestone | [[Vulto Accounts]] permanent owner; Projects bootstrap | Projects, Accounts, Quotations | Projects until Accounts activates; Accounts thereafter |

**Contract generation is settled as a bootstrap, not a parallel system.** [[VRS-F020_Universal_Contract_Builder|VRS-F020]] generates employment and contractor agreements only. [[Vulto Legal]]'s broader builder — which also covers statements of work, NDAs, change orders and retainers, all outside Roster's scope — absorbs generation for new records once a workspace activates it. This was previously flagged as a possible duplication; it is the same handoff pattern as RateCard and requires no separate mechanism.

---

## Conversion Event Protocol

When any entity converts to another type — Candidate to Employee, GhostResource to Employee, Pitch to Project, and any future conversion — these rules apply without exception:

1. The source node is never deleted. Its `lifecycle_status` becomes `Converted`.
2. A directed conversion edge is created between source and destination.
3. All edges connected to the source are preserved and remain traversable via the conversion edge.
4. The graph must always be able to answer: *show me everything about this employee from before they were an employee.*

This is a reusable pattern. Any future node-type transition follows it rather than defining its own.

---

## Schema Evolution Protocol

Loro stores node properties as CRDT Maps, which are schema-flexible at the storage layer. Schema discipline therefore lives in the TypeScript type layer — `packages/schema` per [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] — that every application and the sync engine consume.

1. **Additive only.** New node types and new properties may be added freely. Existing properties are never removed or renamed, only deprecated with a `deprecated_at` timestamp.
2. **Clients tolerate unknown properties.** A device on an older build syncing a node written by a newer build ignores properties it does not recognize rather than failing. This is a hard requirement, not best-effort.
3. **The schema package is the enforcement point.** Feature code reads and writes only through generated types. Raw, untyped access to CRDT documents is prohibited outside the sync engine and the materialization worker.
4. **Registration precedes implementation.** A new node type is added here, or to a feature spec with a pointer added here, before any code is written against it.
5. **`schema_version` increments on every structural change** to a node type, allowing a client to reason about what it is looking at rather than inferring from field presence.

---

## Graph architecture standing rules

**Rule 1 — Nodes are never hard-deleted.** Removal is a lifecycle status change, never a row deletion. **The one exception is cryptographic erasure under [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]**, which destroys the key material rendering a record's content permanently unreadable while leaving the node, its edges and its graph position intact. This preserves referential integrity and the audit trail while satisfying statutory erasure rights. Erasure never deletes a row, and no other mechanism may.

**Rule 2 — Edges carry provenance.** Every edge carries `created_at`, `created_by` and `edge_type`. Edges representing point-in-time states carry `effective_from` and `effective_to`.

**Rule 3 — Conversion events create edges, not migrations.** Per the Conversion Event Protocol above.

**Rule 4 — Permission enforcement happens at the graph query layer.** [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s rules are enforced by a query interceptor before results are returned, never in the UI.

**Rule 5 — Privacy-partitioned nodes carry layered enforcement.** Tier 2 and Tier 3 nodes are protected at both the sync layer ([[VPS-A003_Unified_Sync_Architecture|VPS-A003]]) and the query layer ([[VPS-A004_Graph_Permission_Layer|VPS-A004]]) as a floor. Tier 1 and Tier 3 add a third: the data is cryptographically unreadable to Vulto's own servers. Two layers is the minimum; encryption is the layer that holds when the first two fail or Vulto itself is compelled.

**Rule 6 — All new node types are registered here before implementation.** Schema-first is non-negotiable.

**Rule 7 — [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]] is the only feature permitted multi-pattern graph reasoning.** Individual features surface Insight nodes; they do not implement their own reasoning layer.

**Rule 8 — Provenance-derived nodes inherit their source's tier.** Document, Insight, CustomFieldValue, GraphReference, ReportRun and ApprovalStage have no fixed tier: each takes the tier of what it derives from, and where it derives from several, the most restrictive of them. A signed contract's PDF inherits Contract's Tier 1 half. This rule previously existed as four separate notes on four registry rows, which meant a fifth such node would have been written without it.

**Rule 9 — No feature computes working days, weekends or holidays.** All such arithmetic resolves through [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]. The previous specification set hardcoded Saturday and Sunday in four documents, which is wrong for the UAE, wrong for a six-day Pakistani agency, and wrong for anyone on a compressed schedule.

**Rule 10 — Every application registers its node types here.** No application maintains a parallel schema document. A new application adds a section to the registry and rows to the ownership table, per [[VPS-000_Documentation_Standard|VPS-000]]'s Standing Rule 7. *What node types exist* has exactly one answer.

**Rule 11 — One k-anonymity mechanism.** No feature defines its own minimum cohort size. [[VPS-A004_Graph_Permission_Layer|VPS-A004]] owns the mechanism, [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] exposes the two thresholds, and every aggregate in the product applies it — including filtered utilization on the Bench Forecast, which previously had no protection at all.

---

## Technical specifications

| ID | Specification |
|---|---|
| A002-T01 | The graph MUST be Loro CRDT documents with a SQLite-WASM materialized index for querying, per [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] |
| A002-T02 | All node and edge IDs MUST be UUID v4. Auto-incrementing integers are prohibited |
| A002-T03 | All edges MUST be first-class objects with their own UUID. Implicit foreign key joins not materialized as edge records are prohibited |
| A002-T04 | The schema MUST evolve additively only. Properties are never removed or renamed, only deprecated |
| A002-T05 | Features MUST access the graph through the typed query interface against the materialized index. Raw SQL in feature code and direct Loro reads outside the sync engine and materialization worker are prohibited |
| A002-T06 | Every node MUST carry the Universal Node Conventions, including the Workspace and User scoping exceptions |
| A002-T07 | Clients MUST tolerate unknown node properties gracefully rather than failing |
| A002-T08 | `effective_from` and `effective_to` MUST be first-class indexed edge columns, never JSON metadata |
| A002-T09 | A node type MUST NOT be implemented before it appears in this registry |
| A002-T10 | Provenance-derived node types MUST resolve their tier at write time from their source and MUST NOT default to Tier 0 |
| A002-T11 | No node MUST be hard-deleted. Cryptographic erasure under [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] is the only permitted content removal, and it MUST preserve the node, its edges and its audit trail |
| A002-T12 | Any change to this document requires a pull request with engineering leadership review once that function is staffed; until then, changes are recorded by the founder |

---

## Acceptance criteria

**GIVEN** an engineer creates a new node type
**WHEN** the pull request is opened
**THEN** it includes a corresponding update to this registry, or it is rejected at review

---

**GIVEN** a Candidate is converted to an Employee
**WHEN** the conversion completes
**THEN** the Candidate exists with `lifecycle_status = Converted`, a `converted_from` edge exists, all prior edges remain traversable, and no data is absent from the graph

---

**GIVEN** an older client syncs a node written by a newer build with an additional property
**WHEN** the older client reads it
**THEN** the unrecognized property is ignored without error and the node's other properties render correctly

---

**GIVEN** [[VRS-F021_E-Signature_Native|VRS-F021]] files a signed employment contract as a Document
**WHEN** that Document's tier is resolved
**THEN** it inherits Contract's Tier 1 half rather than defaulting to Tier 0, and is unreadable to Vulto's servers

---

**GIVEN** an approved erasure request under [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]
**WHEN** erasure executes
**THEN** the node's content becomes permanently unreadable, the node and its edges remain present, referential integrity across the graph is unbroken, and [[VPS-F004_Silent_Audit_Log|VPS-F004]] holds a record that erasure occurred

---

**GIVEN** any feature computes a duration in working days
**WHEN** that code is reviewed
**THEN** it calls [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], and a hardcoded weekend or holiday assumption fails review

---

## Out of scope

- End-user configuration of the graph schema at runtime
- Real-time graph visualization for end users
- A bespoke graph database engine, explicitly ruled out by [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]]
- The sync protocol, document partitioning and encryption model — [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]
- The permission matrix and query interceptor implementation — [[VPS-A004_Graph_Permission_Layer|VPS-A004]]
- Field-level property schemas, which belong to the feature owning each node type

---

## Decisions recorded

**The reconciliation notes are retired.** They documented merging two superseded drafts and carried one item marked *needs CTO confirmation*, which is an open question in a document that may not contain one. The two outcomes that still matter — `belongs_to` versus `scoped_to_entity`, and SubVendor's scope — are stated as decisions in Context above.

**`supersedes` was defined twice** with overlapping scope. Consolidated into one row covering every content-versioned node type.

**The Identity and Workspace table was structurally broken**, mixing two different table shapes so that three rows carried a feature name in the column headed *Lifecycle Statuses*. Rebuilt, with the feature-owned rows moved to their correct sections.

**`WellnessAggregate` is removed from the registry.** It is a computed view, not a stored node, and registering it would have obliged an implementer to build one.

**Four k-anonymity thresholds become one mechanism**, per Rule 11.

**Twenty-four node types are added** for the features introduced in [[VRS-001_Feature_Register|VRS-001]], each classified against the same tier-splitting rule already established rather than a new one.

**ApprovalStage is generalized** from a payroll-only node to the single approval mechanism serving payroll, compensation change, requisition and offer.

**Rule 1's collision with statutory erasure is resolved.** The rule said nodes are never hard-deleted; erasure rights say content must sometimes be destroyed. Cryptographic erasure satisfies both, and the exception is now stated in the rule rather than contradicting it from another document.

**Three configuration keys were added in the final consistency pass**, each introduced by a feature written after this registry: `tier1_retention_window_months` from [[VPS-A003_Unified_Sync_Architecture|VPS-A003]], `payroll_variance_flag_threshold` from [[VRS-F065_Payroll_Approval_Workflow|VRS-F065]], and `vocabulary_profile` from [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]]. Each was described in prose by its own document and never registered here, which under Standing Rule 6 would have left three keys with no schema entry and, per [[VPS-F005_Workspace_Configuration_Console|VPS-F005]]'s own G02, no surface on which to edit them.

**Vulto Projects' node types are registered ahead of implementation.** [[VRS-F005_The_Bench_Forecast|VRS-F005]] creates Project stubs and [[VRS-F009_Time_Classification_Taxonomy|VRS-F009]] converts a Pitch into one, both of which need a defined destination. Registering early also means Deliverable's fixed status enum is unregistrable as a per-workspace custom set rather than merely discouraged.

**This document is suite-level and always was.** Its title, scoping principle and blocking statement now say so rather than describing Roster's data specifically.

**Skill's owner is corrected from [[VRS-F014_Skill_Matrix|VRS-F014]] to [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]].** The matcher owns Skill's schema and the proficiency ordering; the matrix consumes both. The previous attribution had the matcher depending on a schema defined by a document downstream of it.

---

## Related Notes

- [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] — the stack this graph is stored in
- [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] — sync, partitioning and the tier encryption model
- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — the permission layer and the k-anonymity mechanism
- [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]] — the cross-app reference protocol
- [[VRS-001_Feature_Register|VRS-001]] — the Feature Register naming every owner referenced here
- [[VPS-000_Documentation_Standard|VPS-000]] — the Documentation Standard
