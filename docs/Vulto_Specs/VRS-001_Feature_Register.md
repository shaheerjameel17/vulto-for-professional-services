---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Architecture
Feature Type:
  - Platform
aliases:
  - VRS-001
---

# VRS-001 — Feature Register

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.

This document is the authoritative index of **Vulto Roster's own features**: each one's identifier, its position in the build order, its Product Phase, its Feature Type, and where it came from.

**It does not index the suite foundations.** [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] through [[VPS-A007_Build_Test_and_Deployment_Pipeline|VPS-A007]], [[VPS-D001_Design_Foundations|VPS-D001]] through [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] and the eleven `VPS-F` platform features are inherited by Roster rather than owned by it, and are governed by [[VPS-000_Documentation_Standard|VPS-000]]. Roster consumes them; this register does not restate them.

It replaces `Vulto_Roster_Features_List.md`, which is retired.

The crosswalk below records the renumbering as executed. Every code in the Was column is retired and never reissued, per [[VPS-000_Documentation_Standard|VPS-000]].

---

## What changed, in summary

The original 66 documents became 94 across three prefixes.

| Prefix | Contents | Count |
|---|---|---|
| **`VPS-`** Vulto Professional Services | [[VPS-000_Documentation_Standard|VPS-000]], [[VPS-002_Implementation_Handoff|VPS-002]], [[VPS-003_Commercial_Model|VPS-003]] · A001–A007 · D001–D004 · F001–F011 | 25 |
| **`VRS-`** Vulto Roster | This register + 67 features | 68 |
| **`VPJ-`** Vulto Projects | [[VPJ-001_Feature_Register|VPJ-001]] | 1 |

Roster's 61 original features became 78, of which **eleven were subsequently promoted to the suite** when the foundations were separated — leaving 67 here.

- **Seventeen features are new.** Eleven close genuine gaps found by reading the existing set against itself; six deepen the recruitment cluster, which was correctly identified as thin.
- **Nothing is cut.** Every one of the 61 existing features survives, though four are renamed and one is meaningfully rescoped.
- **The order changes substantially.** The previous numbering was assigned by theme and then partially corrected; this one is assigned by dependency. Fourteen features move phase.
- **The numbering defects are resolved.** The retired list duplicated F22, F30, F41, F54 and F61, omitted F19 entirely, and claimed sixty features while listing sixty-one. The Master Doc's own numbering was clean and has been treated as the source of truth for the "Was" column throughout.

---

## The ordering principles

The build order is derived from four rules, applied in this priority:

1. **A feature is never numbered before something it depends on.** The previous set violated this in three places, all of which the documents themselves had already noticed and worked around in prose. [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] is built after [[VRS-F018_Leave_Policy_Engine|VRS-F018]], not before it. Jurisdiction exists before contracts require it. Rate cards exist before bench cost is calculated from them.
2. **A feature that other features write settings into is built before they need to.** The Workspace node had accumulated twenty-one configuration keys, each added ad hoc by whichever feature first needed one, with no document owning the surface where any of them is edited.
3. **Security and audit infrastructure ships with the thing it protects, not after it.** The Silent Audit Log is referenced throughout [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] and [[VPS-A004_Graph_Permission_Layer|VPS-A004]] as though it exists, and was scheduled thirty features later.
4. **Where the first three are satisfied, cluster by domain,** so that a batch of work is coherent and a reviewer holds one mental model at a time.

---

## Architecture series — inherited from the suite

| Code | Document | Was | Phase | Type |
|---|---|---|---|---|
| [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] | Technology Stack and Engineering Foundations | A00 | Architecture | Platform |
| [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] | Master Graph Schema Definition | A01 | Architecture | Platform |
| [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] | Unified Sync Architecture | A02 | Architecture | Platform |
| [[VPS-A004_Graph_Permission_Layer|VPS-A004]] | Graph Permission Layer | A03 | Architecture | Compliance |
| [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]] | Cross-App Reference Protocol | A04 | Architecture | Platform |
| [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] | Platform Services and Infrastructure | **new** | Architecture | Platform |
| [[VPS-A007_Build_Test_and_Deployment_Pipeline|VPS-A007]] | Build, Test and Deployment Pipeline | **new** | Architecture | Platform |

**[[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] is new and closes four gaps the existing set explicitly flagged and left open:** transactional email delivery and sender-domain mechanism (needed by at least six features), object storage for encrypted file blobs, webhook delivery with retry and dead-lettering, and server-side PDF rendering. Each was flagged independently by the feature that first hit it, each was correctly identified as an architecture-level decision, and none had a home.

---

## Promoted to the suite

Eleven features moved from `VRS-` to `VPS-` when the suite foundations were separated. **Roster consumes all eleven and owns none of them.** Their Roster numbers are permanently vacant, per [[VPS-000_Documentation_Standard|VPS-000]].

| Was | Now | Why |
|---|---|---|
| `VRS-F001` | [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]] Authentication and Workspace Foundation | One identity across every application |
| `VRS-F015` | [[VPS-F002_Local-First_Search|VPS-F002]] Local-First Search | `Cmd+K` belongs to the shell; each application registers node types |
| `VRS-F016` | [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] Notification and Alert Center | The Inbox is [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]]'s shell; the subscription registry is open |
| `VRS-F017` | [[VPS-F004_Silent_Audit_Log|VPS-F004]] Silent Audit Log | It audits the suite interceptor, and already carried `actor_application` |
| `VRS-F025` | [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] Workspace Configuration Console | It surfaces [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s registry, which is suite-level |
| `VRS-F026` | [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]] Workspace Setup and Data Import | The four questions and vocabulary profile configure the suite |
| `VRS-F047` | [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] Data Governance, Retention and Erasure | It erases the graph, not Roster's slice of it |
| `VRS-F073` | [[VPS-F008_Vulto_Suite_Graph_Bridge|VPS-F008]] Vulto Suite Graph Bridge | Self-evidently |
| `VRS-F074` | [[VPS-F009_Vulto_Sync_API|VPS-F009]] Vulto Sync API | A Vulto API, never a Roster API |
| `VRS-F075` | [[VPS-F010_Custom_Fields_and_Workspace_Extensibility|VPS-F010]] Custom Fields | The cap was already per workspace across applications |
| `VRS-F076` | [[VPS-F011_Mobile-Native_Experience|VPS-F011]] Mobile-Native Experience | The app shell is the suite's; each application's surfaces are its own |

**The test applied**, per [[VPS-000_Documentation_Standard|VPS-000]]: would this feature exist, unchanged, if Roster had never been built? For all eleven, yes.

---

## Design series — inherited from the suite

Four new documents. Written for Roster, authored to be inherited unchanged by every subsequent suite application, because an operating system for professional services firms that looks like nine different products is not an operating system.

| Code | Document | Phase | Type |
|---|---|---|---|
| [[VPS-D001_Design_Foundations|VPS-D001]] | Design Foundations | Architecture | Experience |
| [[VPS-D002_Component_Library|VPS-D002]] | Component Library | Architecture | Experience |
| [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]] | Interaction, Motion and Keyboard Model | Architecture | Experience |
| [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] | Application Shell, Navigation and System States | Architecture | Experience |

Recorded direction, per founder decision and prototype validation: flat, executed with precision. No glassmorphism, liquid glass or decorative depth. Neutral-led light and dark themes use amber as both the restrained brand signal and the signature cost signal. Inter Variable is the single product face, with tabular numerals rather than a separate monospace family. There is one information-preserving product density. The reference point is Linear's discipline — keyboard primacy, restraint and speed presented as an aesthetic — not Linear's identity.

[[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] carries one obligation worth naming here: [[VPS-A004_Graph_Permission_Layer|VPS-A004]] requires that permission-denied, retention-window-aged-out and mid-sync are three visually distinct states that are never conflated. No document currently says what any of the three looks like. That is a specification gap sitting directly on top of a security requirement.

---

## Feature series — Roster's own

### MVP — the product a firm can actually run on

Twenty-six features. The test applied throughout: could a twenty-person professional services firm replace their existing arrangement with this and be better off on day one. Not "is this valuable" — everything here is valuable — but "is its absence disqualifying".

| Code | Feature | Was | Type | Position rationale |
|---|---|---|---|---|
| [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]] | Authentication and Workspace Foundation | F01 | Platform | Nothing exists before identity |
| [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] | Atomic Employee Profiles | F02 | Core | The node every other feature references |
| [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] | Multi-Entity and Jurisdiction Foundation | F34 | Compliance | **Moved from Post-MVP.** Contracts, leave policy and payroll all resolve jurisdiction through Entity; F11 already declared a dependency on it while it sat twenty-three features later |
| [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] | Working Calendar and Working Patterns | **new** | Core | Blocks all bench, leave and payroll arithmetic. See rationale below |
| [[VRS-F005_The_Bench_Forecast|VRS-F005]] | The Bench Forecast | F03 | Core | Owns the Assignment schema; the product's centerpiece |
| [[VRS-F006_Rate_Card_Engine|VRS-F006]] | Rate Card Engine | F09 | Financial | Bench cost cannot be calculated before rates exist |
| [[VRS-F007_Ghost_Resources|VRS-F007]] | Ghost Resources | F04 | Core | Extends the Assignment model F005 owns |
| [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]] | Conflict Resolution Engine | F10 | Core | Extends F005's capacity constraint with a deliberate override |
| [[VRS-F009_Time_Classification_Taxonomy|VRS-F009]] | Time Classification Taxonomy | F18 | Core | The category enum every timesheet entry carries; renamed from "Non-Billable and Pitch Time Tracking" |
| [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] | Timesheet Speed-Run | F08 | Core | Owns TimesheetEntry; consumes F009's taxonomy |
| [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]] | Billable vs Non-Billable Pulse | F06 | Intelligence | Computed entirely from F010's entries |
| [[VRS-F012_Revenue_Gap_Alert|VRS-F012]] | Revenue Gap Alert | F07 | Intelligence | Needs Assignment, rate and calendar all present |
| [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] | Skill-to-Project Matcher | F05 | Core | Owns SkillGap; needs Skill's schema complete |
| [[VRS-F014_Skill_Matrix|VRS-F014]] | Skill Matrix | F23 | Core | **Moved from Post-MVP.** It completes Skill's own schema, which the existing set admits was never finished — that cannot sit behind the feature that queries it |
| [[VPS-F002_Local-First_Search|VPS-F002]] | Local-First Search | F14 | Platform | Indexes everything above it |
| [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] | Notification and Alert Center | F36 | Platform | **Moved from Scale.** Twelve MVP features fire alerts; building their common surface last means building twelve bespoke ones first |
| [[VPS-F004_Silent_Audit_Log|VPS-F004]] | Silent Audit Log | F46 | Compliance | **Moved from Scale.** [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] and [[VPS-A004_Graph_Permission_Layer|VPS-A004]] both reference it as an existing guarantee. Tier 1 and Tier 3 data exists from MVP; unlogged access to it is not acceptable for a quarter |
| [[VRS-F018_Leave_Policy_Engine|VRS-F018]] | Leave Policy Engine | F16 | Compliance | **Order corrected.** The existing document already carried a note explaining it must be built before F15 despite its number |
| [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] | Self-Service Leave Portal | F15 | Experience | Reads F018's policy; now correctly after it |
| [[VRS-F020_Universal_Contract_Builder|VRS-F020]] | Universal Contract Builder | F11 | Compliance | Needs F003's Entity for jurisdiction |
| [[VRS-F021_E-Signature_Native|VRS-F021]] | E-Signature Native | F12 | Compliance | Signs what F020 generates |
| [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] | Encrypted Document Vault | F13 | Compliance | Files what F021 produces |
| [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] | Probation and Notice Period Tracker | F20 | Core | **Moved from Post-MVP.** A firm cannot run HR without offboarding; departure drives final settlement, access revocation and bench recalculation |
| [[VRS-F024_Structured_Onboarding_Workflow|VRS-F024]] | Structured Onboarding Workflow | F27 | Experience | **Moved from Post-MVP.** The counterpart to F023, and the first impression every new hire forms of the product |
| [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] | Workspace Configuration Console | **new** | Platform | Owns the twenty-one Workspace settings keys no document currently owns |
| [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]] | Workspace Setup and Data Import | **new** | Platform | How a customer's existing data gets in. Currently nothing owns this and F02 excludes it explicitly |

### Post-MVP — depth on a working product

Twenty-four features. The recruitment cluster is rebuilt properly here; it was correctly identified as thin.

| Code | Feature | Was | Type | Note |
|---|---|---|---|---|
| [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]] | Headcount Plan and Requisition Approval | **new** | Core | Budgeted headcount, approval-gated requisitions; connects Ghost Resource to a real open role |
| [[VRS-F028_Recruitment_Pipeline|VRS-F028]] | Recruitment Pipeline | F17 | Core | Renamed from "Basic ATS Pipeline" and substantially expanded |
| [[VRS-F029_Careers_Site_and_Job_Distribution|VRS-F029]] | Careers Site and Job Distribution | **new** | Experience | Hosted careers page, application form, [[Vulto Jobs]] syndication |
| [[VRS-F030_Candidate_Portal|VRS-F030]] | Candidate Portal | F24 | Experience | |
| [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]] | Interview Scheduling and Scorecards | F25 | Core | |
| [[VRS-F032_Offer_Management|VRS-F032]] | Offer Management | **new** | Compliance | Approval chain, offer generation via F020, versioning, acceptance |
| [[VRS-F033_Talent_Pool_and_Candidate_CRM|VRS-F033]] | Talent Pool and Candidate CRM | **new** | Core | Silver medallists and re-engagement; agencies rehire constantly |
| [[VRS-F034_Employee_Referral_Program|VRS-F034]] | Employee Referral Program | **new** | Experience | Referral tracking through to bonus payment |
| [[VRS-F035_Background_Check_Integration|VRS-F035]] | Background Check Integration | F60 | Compliance | **Moved from Mature** into the recruitment cluster where it belongs |
| [[VRS-F036_Opportunity-to-Draft_Hiring_Trigger|VRS-F036]] | Opportunity-to-Draft Hiring Trigger | F21 | Intelligence | Now sits after the pipeline it feeds |
| [[VRS-F037_Dynamic_Org_Chart|VRS-F037]] | Dynamic Org Chart | **new** | Core | The capability [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] already pays for and no feature used |
| [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]] | Promotion and Compensation Change Workflow | **new** | Compliance | Named in [[Vulto Roster]]'s own product note; absent from the feature set |
| [[VRS-F039_Performance_Review_Cycle|VRS-F039]] | Performance Review Cycle | F28 | Core | |
| [[VRS-F040_Career_Pathing_and_Development_Tracker|VRS-F040]] | Career Pathing and Development Tracker | F29 | Core | |
| [[VRS-F041_Certification_and_Training_Tracker|VRS-F041]] | Certification and Training Tracker | F35 | Compliance | |
| [[VRS-F042_Asset_and_Gear_Tracker|VRS-F042]] | Asset and Gear Tracker | F19 | Core | |
| [[VRS-F043_Contractor_and_Sub-Vendor_Management|VRS-F043]] | Contractor and Sub-Vendor Management | F33 | Core | |
| [[VRS-F044_Policy_Library_and_Acknowledgement|VRS-F044]] | Policy Library and Acknowledgment | **new** | Compliance | Versioned handbook with an acknowledgment audit trail |
| [[VRS-F045_Right_to_Work_and_Immigration_Compliance|VRS-F045]] | Right to Work and Immigration Compliance | **new** | Compliance | Work authorization and visa expiry for genuinely distributed teams |
| [[VRS-F046_Case_Management_Disciplinary_and_Grievance|VRS-F046]] | Case Management: Disciplinary and Grievance | **new** | Compliance | Tier 2, HR-restricted, deliberately narrow |
| [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] | Data Governance, Retention and Erasure | **new** | Compliance | Resolves the standing tension between never-hard-delete and statutory erasure rights |
| [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] | Employee Pulse Surveys | F26 | Intelligence | |
| [[VRS-F049_Manager_Dashboard|VRS-F049]] | Manager Dashboard | F32 | Experience | |
| [[VRS-F050_Employee_Self-Service_Portal|VRS-F050]] | Employee Self-Service Portal | F57 | Experience | **Moved from Mature.** It composes MVP features and needs nothing from the ecosystem layer |

### Scale — intelligence and the financial layer

Twenty-two features.

| Code | Feature | Was | Type | Note |
|---|---|---|---|---|
| [[VRS-F051_Team_Capacity_Planner|VRS-F051]] | Team Capacity Planner | F31 | Intelligence | Redundancy question resolved; see Decisions below |
| [[VRS-F052_Workload_Strain_Signal|VRS-F052]] | Burnout Predictor | F22 | Intelligence | |
| [[VRS-F053_Retention_Risk_Indicator|VRS-F053]] | Flight Risk Indicator | F30 | Intelligence | |
| [[VRS-F054_Skill_Gap_Trend_Analysis|VRS-F054]] | Skill Gap Forecaster | F38 | Intelligence | |
| [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]] | Vulto Roster Intelligence Engine | F37 | Intelligence | |
| [[VRS-F056_Proactive_Daily_Briefing|VRS-F056]] | Proactive Daily Intelligence Briefing | F44 | Experience | |
| [[VRS-F057_Probation_Review_Intelligence|VRS-F057]] | Probation Review Intelligence | F45 | Intelligence | |
| [[VRS-F058_People_Analytics_Dashboard|VRS-F058]] | People Analytics Dashboard | F39 | Intelligence | |
| [[VRS-F059_Retention_Analytics|VRS-F059]] | Retention Analytics | F43 | Intelligence | |
| [[VRS-F060_Hiring_Quality_Analytics|VRS-F060]] | Hiring Quality Analytics | F42 | Intelligence | |
| [[VRS-F061_Reporting_and_Export_Engine|VRS-F061]] | Reporting and Export Engine | **new** | Platform | The board-pack PDF and CSV export [[Vulto Roster]] promises and no feature delivers |
| [[VRS-F062_Payroll_Engine_Core|VRS-F062]] | Payroll Engine Core | F48 | Financial | |
| [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]] | Tax and Compliance Configuration | F55 | Compliance | **Moved ahead of currency.** F48 shipped a placeholder deduction mechanism it always said F55 would supersede; building the real one first avoids writing that placeholder at all |
| [[VRS-F064_Multi-Currency_Payroll|VRS-F064]] | Multi-Currency Payroll | F49 | Financial | |
| [[VRS-F065_Payroll_Approval_Workflow|VRS-F065]] | Payroll Approval Workflow | F52 | Financial | |
| [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]] | Disbursement and Payment Adapter | **new** | Financial | Replaces the [[Vulto Pay]] dependency; see Decisions below |
| [[VRS-F067_Contractor_Invoice_Management|VRS-F067]] | Contractor Invoice Management | F50 | Financial | |
| [[VRS-F068_Expense_Management|VRS-F068]] | Expense Management | F51 | Financial | |
| [[VRS-F069_Payroll_and_HR_Cost_Dashboard|VRS-F069]] | Payroll and HR Cost Dashboard | F53 | Financial | |
| [[VRS-F070_Compensation_Bands_and_Pay_Equity|VRS-F070]] | Compensation Bands and Pay Equity | **new** | Financial | Internal bands and equity analysis; the internal counterpart to F071's external benchmark |
| [[VRS-F071_Salary_Benchmarking|VRS-F071]] | Salary Benchmarking | F40 | Intelligence | |
| [[VRS-F072_Agency_Benchmarking|VRS-F072]] | Agency Benchmarking | F47 | Intelligence | Aggregation-over-encrypted-data question resolved; see Decisions below |

### Mature — ecosystem and reach

Six features.

| Code | Feature | Was | Type |
|---|---|---|---|
| [[VPS-F008_Vulto_Suite_Graph_Bridge|VPS-F008]] | Vulto Suite Graph Bridge | F56 | Platform |
| [[VPS-F009_Vulto_Sync_API|VPS-F009]] | Vulto Sync API | F54 | Platform |
| [[VPS-F010_Custom_Fields_and_Workspace_Extensibility|VPS-F010]] | Custom Fields and Workspace Extensibility | F59 | Platform |
| [[VPS-F011_Mobile-Native_Experience|VPS-F011]] | Mobile-Native Experience | F58 | Experience |
| [[VRS-F077_Monthly_Coffee_Pulse|VRS-F077]] | Monthly Coffee Pulse | F41 | Experience |
| [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]] | Mental Health and Wellness Layer | F61 | Experience |

---

## The seventeen new features, with reasoning

### Closing real gaps

**[[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] Working Calendar and Working Patterns.** This is the most consequential omission in the existing set, and it is a defect rather than a missing nice-to-have. Bench day counts, leave day counts and payroll proration are all computed by excluding *Saturday and Sunday* as hardcoded constants, in at least four separate documents. Vulto's primary market is Pakistan, with the UAE and the UK named alongside it. A Gulf agency's working week is not Monday to Friday. A Pakistani agency running a six-day week, or a half-day Friday, is entirely ordinary. As currently specified, the Bench Forecast would overstate bench cost, leave requests would deduct the wrong number of days, and final settlements would be wrong — silently, in the customer's own currency. This feature owns the working-week definition per Entity, the public holiday calendar per jurisdiction, and per-employee working patterns for part-time, compressed and non-standard schedules. Everything downstream calls it instead of assuming.

**[[VPS-F005_Workspace_Configuration_Console|VPS-F005]] Workspace Configuration Console.** The Workspace node has accumulated twenty-one configuration keys — overtime thresholds, capacity warnings, signature expiry, k-anonymity minimums, currency, expense guidelines, wellness resources — each added by whichever feature first needed it. No document owns the surface where an Owner edits any of them. Without this, they are either hardcoded or exposed through twenty-one different screens.

**[[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]] Workspace Setup and Data Import.** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] explicitly excludes bulk import, and [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]] separately reasons about data arriving "through a bulk import that bypassed the interactive check" — a path no feature builds. Meanwhile [[Vulto for Professional Services]] describes a four-question onboarding that configures the platform's vocabulary per firm type, and no Roster feature implements it. A resource intelligence product whose first screen requires manual entry of every employee, assignment and leave balance will not survive its own trial period.

**[[VRS-F037_Dynamic_Org_Chart|VRS-F037]] Dynamic Org Chart.** [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] selects Loro specifically over Automerge and Yjs, and the stated reason is its native Movable Tree primitive, chosen for organizational hierarchy. No feature in the set uses it. The architecture is paying a real cost for a capability the product never exercises. Beyond correcting that, an org chart in a professional services firm is an operational instrument rather than a poster: reporting lines, span of control, and a scenario mode for modeling a restructure against real cost before committing to it.

**[[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]] Promotion and Compensation Change Workflow.** [[Vulto Roster]]'s own product note lists it — "structured multi-stakeholder approval for salary and role changes, ensuring that finance, the relevant project manager, and HR admin all sign off before changes take effect" — and [[VRS-F062_Payroll_Engine_Core|VRS-F062]] reads promotion-driven salary changes as an input that it assumes already exists. Nothing writes them.

**[[VRS-F044_Policy_Library_and_Acknowledgement|VRS-F044]] Policy Library and Acknowledgment.** Versioned policy documents with a per-employee acknowledgment record. Unglamorous, and the first thing asked for in any employment dispute or client security review.

**[[VRS-F045_Right_to_Work_and_Immigration_Compliance|VRS-F045]] Right to Work and Immigration Compliance.** Work authorization status, visa type and expiry, and permit renewal windows, backed by [[VRS-F022_Encrypted_Document_Vault|VRS-F022]]'s document storage. For a product built explicitly for firms operating across Pakistan, the UAE and the UK, this is not an edge case.

**[[VRS-F046_Case_Management_Disciplinary_and_Grievance|VRS-F046]] Case Management: Disciplinary and Grievance.** Deliberately narrow: a structured, Tier 2, HR-restricted record of a formal process, its meetings, and its outcome. Not a general ticketing system. Included because its absence forces the most legally sensitive records in the business into email.

**[[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] Data Governance, Retention and Erasure.** [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Standing Rule 1 states that nodes are never hard-deleted. Statutory erasure rights state that sometimes they must be. Both cannot be true as written, and no document acknowledges the collision. This feature resolves it through cryptographic erasure — destroying key material rather than rows, preserving graph integrity while rendering content permanently unreadable — alongside retention schedules per record class and a full workspace data export.

**[[VRS-F061_Reporting_and_Export_Engine|VRS-F061]] Reporting and Export Engine.** [[Vulto Roster]] promises "one-click PDF generation of agency efficiency metrics for board and investor presentations". No feature produces it, and server-side PDF rendering has no home in the architecture until [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] gives it one.

**[[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]] Disbursement and Payment Adapter.** See Decisions below.

**[[VRS-F070_Compensation_Bands_and_Pay_Equity|VRS-F070]] Compensation Bands and Pay Equity.** [[VRS-F071_Salary_Benchmarking|VRS-F071]] benchmarks against the external market. Nothing establishes what the firm's own bands *are*, which is what [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]]'s approval workflow needs to evaluate a proposed raise against, and what a pay equity analysis requires as its baseline.

### Deepening the recruitment cluster

The existing set treats recruitment as a pipeline with a portal and a scheduler attached. That is an applicant tracker, and a thin one. A professional services firm's hiring problem is not tracking applicants; it is that hiring is triggered by capacity gaps the Bench Forecast can already see, budgeted against headcount plans, and judged afterwards by whether the hire actually billed. Roster is uniquely positioned to close that loop, and six features are what closing it takes.

**[[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]] Headcount Plan and Requisition Approval** gives an open role a budget and an approval before it becomes a job posting, and connects it to the Ghost Resource that predicted it. **[[VRS-F029_Careers_Site_and_Job_Distribution|VRS-F029]] Careers Site and Job Distribution** gives the firm a hosted careers presence rather than only a syndication feed. **[[VRS-F032_Offer_Management|VRS-F032]] Offer Management** handles the stage the existing set skips entirely — the offer itself, its approval, its versions, and its acceptance — which is currently an unresolved question passed between [[VRS-F020_Universal_Contract_Builder|VRS-F020]] and [[VRS-F028_Recruitment_Pipeline|VRS-F028]]. **[[VRS-F033_Talent_Pool_and_Candidate_CRM|VRS-F033]] Talent Pool and Candidate CRM** keeps the strong candidate who was second, which for an agency hiring the same five roles repeatedly is the highest-yield source it has. **[[VRS-F034_Employee_Referral_Program|VRS-F034]] Employee Referral Program** tracks referrals through to the bonus, which then has to reach payroll. **[[VRS-F028_Recruitment_Pipeline|VRS-F028]] Recruitment Pipeline** is expanded in place with configurable stages, source tracking, structured rejection reasons, duplicate detection and bulk actions.

---

## Decisions recorded in this pass

Every item previously carried as unresolved is now decided. Full reasoning lives in the document that owns each; recorded here so the trail is visible in one place.

**[[Vulto Pay]] is removed as a dependency entirely.** It is a payment service planned years out and is not a foundation anything may rest on today. [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]] replaces it: a provider-agnostic disbursement adapter whose default path is bank batch file generation in the formats each target jurisdiction actually uses, plus manual mark-as-paid reconciliation. The adapter interface is defined such that Vulto Pay, or Wise, or any local rail, becomes a registered provider later without a schema change. This is the correct architecture regardless of Vulto Pay's timeline — a payroll engine that can only pay through infrastructure that does not exist cannot pay anyone.

**Transactional email, object storage, webhook delivery and PDF rendering** move to [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] and are decided there rather than guessed at independently by the six features that need them.

**The minimum-cohort-size rule for aggregates is decided as a single global mechanism** rather than a per-feature threshold. The set had already reached this answer four separate times — pulse surveys, wellness, hiring quality, retention analytics — each inventing its own key with its own default. It becomes one k-anonymity policy in [[VPS-A004_Graph_Permission_Layer|VPS-A004]], configured once in [[VPS-F005_Workspace_Configuration_Console|VPS-F005]], applied by every aggregate in the product including the Bench Forecast's filtered utilization percentage, which currently has no protection at all.

**TOIL and overtime approval are decided in [[VRS-F018_Leave_Policy_Engine|VRS-F018]].** Overtime is approved through a request against the same policy engine that governs leave, and accrued TOIL becomes a leave type with its own accrual and expiry rules rather than a parallel mechanism. The two documents that each flagged this while pointing at the other are reconciled.

**[[VRS-F051_Team_Capacity_Planner|VRS-F051]] Team Capacity Planner is confirmed, not redundant.** The distinction is real and worth stating precisely: [[VRS-F005_The_Bench_Forecast|VRS-F005]] answers *who is free, by name, within ninety days*, and is an operational instrument. [[VRS-F051_Team_Capacity_Planner|VRS-F051]] answers *whether we will have enough people with the right skills over the next four quarters*, at skill-category rather than person granularity, incorporating probability-weighted pipeline demand that no named-person view can represent. Collapsing them would either burden the daily view with speculative demand or strip the strategic view of the only inputs that make it strategic.

**[[VRS-F072_Agency_Benchmarking|VRS-F072]] Agency Benchmarking's aggregation problem is resolved by scope reduction.** The four benchmarked metrics — utilization, turnover, average bench duration, time-to-fill — are all derivable from Tier 0 operational data. None requires Tier 1 decryption. The problem existed only because the feature was assumed to need compensation data; it does not, because [[VRS-F071_Salary_Benchmarking|VRS-F071]] already owns that separately under its own opt-in consent model. Cross-tenant aggregation therefore operates on server-readable data with k-anonymity applied, and no homomorphic scheme is required.

**Loro's version is pinned in [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]]** at the version current at implementation start, recorded explicitly rather than left as an instruction to a future reader.

**`services/cross-tenant-aggregation` is deliberately unscheduled until [[VRS-F071_Salary_Benchmarking|VRS-F071]].** [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] names it as the one deliberate exception to the per-workspace model and gives it the hardest isolation constraint in the document — A001-T08, quoted verbatim in VRS-F071's Technical Architecture section: *"`services/cross-tenant-aggregation` MUST NOT share a database, connection pool or process boundary with per-workspace data paths, and MUST receive only anonymized, pre-bucketed contributions."* No implementation issue owns building the service; it is built by whoever implements VRS-F071 (Scale phase), the first feature that needs it, and reused by [[VRS-F072_Agency_Benchmarking|VRS-F072]]. **FDN-82** (`docs/Foundations_Findings.md` F73) carries the standing question of whether to stand it up early as an empty isolated shell instead — recorded here so the isolation requirement has a visible home rather than surviving only in a spec section a Scale-phase implementer may not read first.

---

## Retired documents

`Vulto_Roster_Features_List.md` and `VRS_Handoff_Document.md` are both retired and superseded by this document. Neither should be synced into the vault alongside the completed set.

---

## Related Notes

- [[VPS-000_Documentation_Standard|VPS-000]] — the Documentation Standard governing every document indexed here
- [[Vulto Roster]] — the product this set specifies
- [[Vulto for Professional Services]] — the suite this product founds
