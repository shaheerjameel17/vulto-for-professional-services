# Linear operating rules

Binding on **everyone who touches Linear**: the reviewer, Codex, and any other agent. A rule marked **MUST** is not a preference. Breaking one is a defect to fix at once, and it is reported in the stage report.

The founder is **Shaheer Jameel**. Where a rule says "assign to the founder", the Linear user is `Shaheer Jameel` (`assignee: "me"` in the Linear tool).

## 1. Teams: an issue MUST be created in the right team

Create every issue and project in the team that owns the feature. Get this right at creation; moving an issue changes its identifier and breaks references.

| Work | Team | Key |
|---|---|---|
| Platform features and foundations: every `VPS-*` spec (search, notifications, audit, console, import, auth, sync, permissions, design system, infrastructure, trust program) | Vulto Foundation | `FDN` |
| Roster features: every `VRS-*` spec, and Roster-only stages and UI | Vulto Roster | `RST` |

- The `team` field MUST be passed explicitly on every create. Never rely on a default.
- After creating, read the issue back and check the identifier prefix matches the table. If it does not, move it at once and correct every reference to the old identifier.
- A stage that builds a platform feature (`VPS-F###`) is a Foundation issue even though Roster is the first consumer. Stages 23, 25 and 26 were wrongly created in Roster and had to be moved.
- A project belongs to the team that leads it. An issue can only sit in a project its own team belongs to.

## 2. People: nothing is left unassigned

Assign to the founder, always, in every place Linear has a person field:

- **Issues:** `assignee` MUST be set on creation. No unassigned issue exists, in any status.
- **Projects:** `lead` MUST be set.
- **Initiatives:** `owner` MUST be set.
- **Any other field that takes a person** (a status update author, a milestone owner if one exists): the founder, never empty.

## 3. Priority: nothing is left at "No priority"

Every issue, project and initiative MUST carry a priority.

| Priority | Use it for |
|---|---|
| Urgent | Blocks the stage being built now, or a live risk (security, data loss, a red CI on `main`) |
| High | In the current phase and scheduled to be built next: the active stage, pilot-slice UI, MVP-critical work |
| Medium | Planned for the phase after the current one, or a founder decision awaited |
| Low | Deferred, optional, or waiting for a trigger (a customer, a feature) |

Set the priority when the issue is created. When work finishes, leave the priority as it was.

## 4. Labels: every issue is fully labeled

- **One Domain label** (single-select group, MUST): `Back-End`, `Front-End`, `Full-Stack`, `Infrastructure`, or `Docs & Spec`. A feature with both halves is `Full-Stack`; a spec or finding with no product code is `Docs & Spec`.
- **One Feature Type label** (single-select group, MUST on every feature, stage and design issue): `Core`, `Experience`, `Platform`, `Compliance`, `Financial`, or `Intelligence`, taken from the feature's own spec.
- **Modifier labels** where they apply: `Bug` (cite the spec clause), `Design Decision`, `Spec Correction`, `Blocked On Founder`.
- **Every project MUST carry one phase label:** `MVP`, `Post-MVP`, `Scale`, `Mature` or `Architecture` (`Handoff Candidate` is additional).

## 5. Projects: broken down before they exist

A project MUST NOT be left as a bare container. Before it is considered created, it has all of:

1. A **lead** (the founder) and a **priority**.
2. A **status** that matches reality: Backlog if unscheduled, In Development once work starts, Done or Canceled when finished.
3. A **phase label**.
4. **At least one initiative** it rolls up to. A project without an initiative MUST be attached to one, or the initiative created.
5. A **start date and target date** once scheduled. A Backlog project may leave dates open until scheduled.
6. **Milestones:** at least two, each with an outcome, a scope and an exit condition in its description, and a target date once scheduled.
7. **Issues:** every milestone has issues, and every issue in the project sits in a milestone. An issue with a project and no milestone is a defect.
8. **Dependencies** between issues (`blockedBy`, `relatedTo`) wherever there is a real sequence.

A retired or canceled project keeps its history and is left alone, but says where the work continues.

## 6. Initiatives

Every initiative MUST have an owner, a priority, a status, and its projects listed in its description. An active initiative also has a target date and a health value. An initiative with no projects is a defect: either populate it or cancel it with a note saying what replaced it.

## 7. Issues: content and hygiene

- A description states the source spec, the scope, and the done criteria. A stage issue links the brief (`docs/Claude_Code_Build_Prompt.md` Part 3) and the reviewer state (`docs/Reviewer_Handoff.md` section).
- A stage issue is **In Progress** only while the builder is actually working on it, **Done** when merged (with a comment naming the merge commit), **Canceled** only with a comment saying why.
- Findings, rulings and the founder decisions they wait on are linked from the issue that is blocked by them.
- Never delete an issue. Cancel it with a reason.

## 8. Audit: how this is verified

At every stage boundary, and after any bulk creation, run these Linear queries and fix every hit before reporting the stage done:

- Issues with `assignee` null (expect none).
- Issues with priority 0 (expect none).
- Every project: a lead, a priority, a phase label, at least one initiative, at least two milestones.
- Every issue in a project has a milestone.
- Every new identifier has the prefix of the team that owns its feature (section 1).

The reviewer runs this audit; Codex runs it for any issue it creates itself.
