"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Inbox } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Content,
  InlineAlert,
  PageHeader,
  Stat,
  Table,
  Text,
  ToggleGroup,
  Icon,
  cx,
  useShortcuts,
  type TableColumn,
} from "@vulto/ui";
import { ASSIGNMENTS, EMPLOYEES, PROJECT_BY_ID } from "../../../fixtures/roster";
import { profileFor } from "../../../fixtures/profiles";
import { buildForecast, formatMoney } from "../../../lib/bench";
import {
  MANAGER_QUEUE,
  type ManagerQueueItem,
  type ManagerQueueKind,
} from "../../../fixtures/manager-dashboard";

/*
 * VPS-D004 — Home, the role-aware starting surface.
 *
 * FDN-41. This screen used to be titled "Manager Dashboard", sit at
 * `/dashboard`, and be reached from a sidebar item called Home: three names for
 * one destination, and a title naming a role most viewers do not hold.
 *
 * The naming was the symptom. VPS-D004 describes Home as "the action queue for
 * Managers, and the relevant operational overview for administrative roles" —
 * two compositions, not one list filtered differently. Only the Manager one had
 * been built, so an Owner landed on a manager's screen.
 *
 * Both now exist and the difference is structural rather than cosmetic:
 *
 *   Manager   the queue leads, because a manager's morning is a list of things
 *             waiting on them. Team at a Glance supports it from the side.
 *   Owner     the firm's figures lead, because an owner's first question is
 *             how the business stands, not which approvals are outstanding.
 *             The queue is below them, workspace-wide.
 *
 * VRS-F049 specifies the Manager variant and says so; VPS-D004 owns what the
 * Owner variant differs in. Team Member self-service remains unbuilt and is
 * named in VPS-D004 rather than stubbed here.
 *
 * Every figure is computed from the viewer's own cohort rather than filtered
 * after aggregation, which is the same rule FDN-38 settled for the Bench
 * Forecast — and the Owner figures come from `buildForecast` itself, so Home
 * and the Bench Forecast cannot disagree about a number they both state.
 */

type QueueMode = "active" | "clear";

/** Prototype furniture, exactly as on the Bench Forecast: the only way to see
 * the variant the current viewer does not hold. Not a product control. */
type ViewerRole = "owner" | "manager" | "member";

/*
 * The Manager and Member variants are the same person deliberately.
 *
 * Omar Farooq manages six people and is himself managed by Tom Beckett, which
 * is the ordinary case in a firm this size — almost everyone is both. Using one
 * identity for both variants makes the distinction the screen is actually
 * testing visible: not who you are, but which of your two relationships to the
 * workspace Home is answering. He is also the person the timesheet renders, so
 * the Member view and Timesheets agree about whose week it is.
 */
const VIEWER_NAME = "Omar Farooq";

/*
 * FDN-44: each kind's mark is a filled chip, not a bare outline glyph.
 *
 * Three 16px stroked icons in three different colors, floating on the card at
 * the same weight as the text beside them, read as decoration — which VPS-D002
 * does not permit an icon to be. Seated in a tinted disc of its own hue, the
 * mark reads as the category it names, and the group reads as a legend.
 *
 * The tint is Badge's, so a kind's mark and its own tag are the same color at
 * the same strength rather than two independent decisions about one hue.
 */
const KIND_META = {
  Approval: { icon: CheckCircle2, chip: "bg-tag-success text-tag-success-ink" },
  Alert: { icon: AlertTriangle, chip: "bg-tag-attention text-tag-attention-ink" },
  Request: { icon: Inbox, chip: "bg-tag-neutral text-tag-neutral-ink" },
};

const SOURCE_TONE: Record<string, "success" | "attention" | "danger" | "neutral"> = {
  "Workload strain": "attention",
  Performance: "success",
  Leave: "success",
  Onboarding: "neutral",
  Timesheets: "attention",
  Capacity: "danger",
  Recruiting: "neutral",
};

export default function HomePage() {
  const [items, setItems] = useState(MANAGER_QUEUE);
  const [mode, setMode] = useState<QueueMode>("active");
  const [role, setRole] = useState<ViewerRole>("owner");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [showGlance, setShowGlance] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const owner = role === "owner";
  const member = role === "member";

  const viewer = useMemo(
    () => EMPLOYEES.find((employee) => employee.fullName === VIEWER_NAME),
    [],
  );

  /*
   * The cohort, resolved once. Everything below counts from it rather than
   * filtering a workspace-wide total after the fact — FDN-38's rule.
   *
   * A Team Member's cohort is themselves. That is not a special case bolted on:
   * it is the same rule at its smallest, and it means every figure on this
   * screen goes through one path regardless of who is looking.
   */
  const cohort = useMemo(() => {
    if (member) return viewer ? [viewer] : [];
    return EMPLOYEES.filter(
      (employee) =>
        employee.employeeType === "Employee" &&
        (owner || profileFor(employee.employeeId)?.managerName === VIEWER_NAME),
    );
  }, [owner, member, viewer]);

  const cohortNames = useMemo(
    () => new Set(cohort.map((employee) => employee.fullName)),
    [cohort],
  );

  /* VRS-F007: Ghost Resources are planned roles, not people. They are stated
   * separately rather than folded into headcount, for the same reason the
   * Bench Forecast reports their utilization contribution separately. */
  const ghostCount = EMPLOYEES.filter(
    (employee) => employee.employeeType === "Ghost",
  ).length;

  /*
   * FDN-41. Skill coverage read "7 / 9 roles" beside a cohort of six, because
   * it was a literal rather than a count. VRS-F014 owns the real definition of
   * a critical skill; the prototype's fixtures carry a `verified` flag and
   * nothing that ranks a skill as critical, so this counts the people who hold
   * at least one verified skill and labels itself as exactly that. A figure
   * that names a narrower fact than its label claims is the failure this
   * screen exists to avoid.
   */
  const verifiedSkillCoverage = useMemo(
    () =>
      cohort.filter((employee) =>
        profileFor(employee.employeeId)?.skills.some((skill) => skill.verified),
      ).length,
    [cohort],
  );

  /*
   * A manager's queue holds obligations about the people they manage; a team
   * member's holds the ones about them. Both fall out of the cohort rule
   * without a branch — the fixture carries a subject and no assignee, so that
   * is the only honest scoping available, and it is the same one the Bench
   * Forecast uses.
   */
  const scopedItems = useMemo(
    () => (owner ? items : items.filter((item) => cohortNames.has(item.subject))),
    [items, owner, cohortNames],
  );

  /* A team member's own active work, straight from the graph. */
  const myAssignments = useMemo(() => {
    if (!member || !viewer) return [];
    return ASSIGNMENTS.filter(
      (assignment) =>
        assignment.employeeId === viewer.employeeId && assignment.status === "Active",
    )
      .map((assignment) => ({
        assignment,
        project: PROJECT_BY_ID.get(assignment.projectId),
      }))
      .sort((a, b) => a.assignment.endDate.localeCompare(b.assignment.endDate));
  }, [member, viewer]);

  const viewerProfile = viewer ? profileFor(viewer.employeeId) : undefined;

  /*
   * The Owner overview's figures come from the Bench Forecast's own derivation
   * rather than a second one written here, so the two screens cannot state
   * different numbers for the same fact.
   */
  const forecast = useMemo(
    () =>
      buildForecast(
        90,
        // Compensation is structurally absent for a team member, not hidden
        // after the fact — the same boundary VRS-F005 draws. Nothing on the
        // Member view reads a cost figure, and this is what makes that true
        // rather than incidental.
        !member,
        owner ? undefined : new Set(cohort.map((employee) => employee.employeeId)),
      ),
    [owner, member, cohort],
  );

  const visibleItems = mode === "clear" ? [] : scopedItems;

  /* Derived rather than synchronized: switching viewer changes which items
   * exist, and a selection pointing at an item the new cohort does not contain
   * would leave the J/K cursor on nothing. Falling back to the first item keeps
   * the keyboard model always landed without an effect to keep in step. */
  const activeId = visibleItems.some((item) => item.id === selectedId)
    ? selectedId
    : visibleItems[0]?.id;
  const selected = visibleItems.find((item) => item.id === activeId);

  const counts = useMemo(
    () =>
      (["Approval", "Alert", "Request"] as ManagerQueueKind[]).map((kind) => ({
        kind,
        count: visibleItems.filter((item) => item.kind === kind).length,
      })),
    [visibleItems],
  );

  function moveSelection(delta: number) {
    if (visibleItems.length === 0) return;
    const current = visibleItems.findIndex((item) => item.id === activeId);
    const next = current === -1
      ? 0
      : Math.min(visibleItems.length - 1, Math.max(0, current + delta));
    setSelectedId(visibleItems[next]!.id);
  }

  function resolveItem(item: ManagerQueueItem, verb = item.actionLabel) {
    // The next selection is chosen from what the viewer can actually see, not
    // from the whole fixture — otherwise resolving a manager's last item lands
    // the cursor on somebody else's report.
    const index = visibleItems.findIndex((candidate) => candidate.id === item.id);
    const remaining = visibleItems.filter((candidate) => candidate.id !== item.id);
    setSelectedId(remaining[Math.min(Math.max(index, 0), remaining.length - 1)]?.id);
    setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    setAnnouncement(`${item.title} — ${verb.toLocaleLowerCase()} action complete.`);
  }

  useShortcuts({
    keys: {
      j: () => moveSelection(1),
      k: () => moveSelection(-1),
      e: () => {
        if (selected?.informational) resolveItem(selected, "Handle");
      },
      enter: () => {
        if (selected) resolveItem(selected);
      },
    },
  });

  type MyAssignment = (typeof myAssignments)[number];
  const assignmentColumns: TableColumn<MyAssignment>[] = [
    {
      key: "project",
      header: "Project",
      pinned: true,
      render: ({ project }) => (
        <div className="py-1">
          <Text variant="body-medium" className="text-text-primary">
            {project?.name ?? "Assignment"}
          </Text>
          <Text variant="small" className="block text-text-secondary">
            {project?.clientName ?? "Unassigned client"}
          </Text>
        </div>
      ),
    },
    {
      key: "allocation",
      header: "Allocation",
      align: "right",
      width: "112px",
      render: ({ assignment }) => (
        <Text variant="numeric" className="text-text-primary">
          {assignment.billablePercentage}%
        </Text>
      ),
    },
    {
      key: "ends",
      header: "Ends",
      align: "right",
      width: "128px",
      render: ({ assignment }) => (
        <Text variant="numeric" className="text-text-secondary">
          {assignment.endDate}
        </Text>
      ),
    },
  ];

  const columns: TableColumn<ManagerQueueItem>[] = [
    {
      key: "waiting",
      header: "Waiting",
      width: "104px",
      cellClassName: "align-top pt-3",
      render: (item) => (
        <div>
          <Text variant="numeric-medium" className="text-text-primary">
            {item.waitingDays} {item.waitingDays === 1 ? "day" : "days"}
          </Text>
          <Text variant="small" className="text-text-secondary">
            {item.waitingSince}
          </Text>
        </div>
      ),
    },
    {
      key: "item",
      header: "Needs your action",
      /*
       * FDN-44 restructures this cell.
       *
       * It used to run three stacked bands — tag and title, then a row of
       * person, then the context — so the person and what the item says about
       * them were separate horizontal strips with an avatar anchoring only the
       * first of them. The avatar sat beside a name and nothing else, which is
       * the one arrangement that makes a small avatar look stranded.
       *
       * Now the avatar anchors a two-row block: who this is on top, what is
       * being said about them underneath. The avatar is the block's left edge,
       * and both rows hang off it.
       */
      render: (item) => {
        const employee = EMPLOYEES.find(
          (candidate) => candidate.fullName === item.subject,
        );
        return (
          <div className="py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={SOURCE_TONE[item.source] ?? "neutral"} shape="pill">{item.source}</Badge>
              <Text variant="body-medium" className="text-text-primary">{item.title}</Text>
            </div>
            <div className="mt-2 flex items-start gap-2">
              <Avatar name={employee?.fullName ?? item.subject} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <Text variant="small" className="text-text-primary">
                    {employee?.fullName ?? item.subject}
                  </Text>
                  {employee ? (
                    <Text variant="micro" className="text-text-tertiary">
                      {employee.employeeCode}
                    </Text>
                  ) : null}
                </div>
                {item.escalated ? (
                  <div className="mt-1 rounded-md border-l-2 border-attention bg-bg-hover px-3 py-2">
                    <Text variant="small" className="text-text-secondary">Escalated · {item.context}</Text>
                  </div>
                ) : (
                  <Text variant="small" className="mt-1 block text-text-secondary">
                    {item.context}
                  </Text>
                )}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      key: "action",
      header: "Action",
      align: "right",
      width: "104px",
      cellClassName: "align-top pt-3",
      render: (item) => (
        <span onClick={(event) => event.stopPropagation()}>
          <Button size="sm" onClick={() => resolveItem(item)}>
            {item.actionLabel}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      {/* FDN-41: the destination is called Home in the sidebar, in the URL and
        * here. The subtitle carries what the viewer is actually looking at,
        * which is where the role belongs — a title should not name a role the
        * viewer does not hold. */}
      <PageHeader
        title="Home"
        subtitle={
          owner
            ? "Where the firm stands, and what needs you"
            : member
              ? "Your week, and anything waiting on you"
              : "Current obligations across your team"
        }
        actions={
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Text variant="micro" className="text-text-tertiary">Prototype viewer</Text>
              <ToggleGroup<ViewerRole>
                label="Viewing as"
                value={role}
                onChange={(next) => {
                  setRole(next);
                  setSelectedId(undefined);
                }}
                size="sm"
                options={[
                  { value: "owner", label: "Owner" },
                  { value: "manager", label: "Manager" },
                  { value: "member", label: "Member" },
                ]}
              />
            </div>
            <ToggleGroup<QueueMode>
              label="Prototype queue state"
              value={mode}
              onChange={(next) => {
                setMode(next);
                setSelectedId(undefined);
              }}
              size="sm"
              options={[
                { value: "active", label: "Queue" },
                { value: "clear", label: "Clear" },
              ]}
            />
          </div>
        }
      />
      <Content>
        {/*
          * The Owner variant. Figures first, queue beneath — VPS-D004's
          * "operational overview" for an administrative role. An owner's first
          * question is how the business stands; the approvals are real work but
          * they are not the headline, and putting them at the top was what made
          * this read as a manager's screen regardless of what it was called.
          */}
        {owner ? (
          <section aria-labelledby="firm-at-a-glance" className="pt-8">
            <div className="mb-3 flex items-center justify-between">
              <Text id="firm-at-a-glance" variant="h2" className="text-text-primary">
                Firm at a Glance
              </Text>
              <Badge>{forecast.cohortSize} people</Badge>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card title="Utilization">
                <Stat
                  label="Next 90 days"
                  value={`${forecast.utilization}%`}
                  denominator={`of ${forecast.cohortSize} people`}
                  scale="numeric-lg"
                  delta={
                    forecast.ghostContribution > 0
                      ? {
                          text: `+${forecast.ghostContribution}% planned, from roles not yet filled.`,
                          tone: "attention",
                        }
                      : undefined
                  }
                />
              </Card>
              <Card title="Bench exposure">
                <Stat
                  label="People with bench time"
                  value={`${forecast.benchedCount} of ${forecast.cohortSize}`}
                  denominator="in this window"
                  scale="numeric-lg"
                />
              </Card>
              {/* The one figure on this screen that is money, and the only one
                * that takes a hue — the same rationing the Bench Forecast's
                * summary band applies to the same number. */}
              <Card title="Unrecovered">
                <Stat
                  label={`Next ${forecast.costHorizonDays} days`}
                  value={formatMoney(forecast.totalBenchCost)}
                  denominator="bench cost"
                  scale="numeric-lg"
                  valueClassName="text-text-brand"
                />
              </Card>
              <Card title="Headcount">
                <Stat
                  label="Active people"
                  value={`${cohort.length}`}
                  denominator={
                    ghostCount > 0 ? `plus ${ghostCount} planned` : "on the roster"
                  }
                  scale="numeric-lg"
                />
              </Card>
            </div>
          </section>
        ) : null}

        {/*
          * The Team Member variant. VPS-D004 named it and no feature document
          * claims it, so this is derived rather than specified: what a person
          * needs on landing is their own week — what they are on, how much of
          * it is theirs to fill, and the small number of things actually
          * waiting on them. It is not a queue, because a team member's queue is
          * almost always empty and a screen built around an empty list is a
          * screen that says nothing; and it is not an overview, because the
          * figures an owner reads are none of their business.
          *
          * Everything here is their own record. Nothing on this screen states a
          * fact about anybody else, which is the substantive difference between
          * this variant and the other two rather than a matter of scope.
          */}
        {member ? (
          <section aria-labelledby="your-week" className="pt-8">
            <div className="mb-3 flex items-center justify-between">
              <Text id="your-week" variant="h2" className="text-text-primary">
                Your Week
              </Text>
              <Badge>{viewer?.jobTitle ?? "Team member"}</Badge>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <Card title="Contracted">
                <Stat
                  label="Hours per week"
                  value={`${viewerProfile?.contractedHours ?? "—"}`}
                  denominator={viewerProfile?.workingPatternNote ? undefined : "hours"}
                  scale="numeric-lg"
                />
                {viewerProfile?.workingPatternNote ? (
                  <Text variant="small" className="mt-2 block text-text-secondary">
                    {viewerProfile.workingPatternNote}
                  </Text>
                ) : null}
              </Card>
              <Card title="Assignments">
                <Stat
                  label="Active right now"
                  value={`${myAssignments.length}`}
                  denominator={myAssignments.length === 1 ? "project" : "projects"}
                  scale="numeric-lg"
                />
              </Card>
              {/* Their own bench time, not the firm's. A person is entitled to
                * know when they are about to be unassigned; the cost of it is
                * the firm's fact and stays on the Owner's Home. */}
              <Card title="Unassigned time">
                <Stat
                  label="Working days, next 90"
                  value={`${forecast.rows[0]?.benchWorkingDays ?? 0}`}
                  denominator="days"
                  scale="numeric-lg"
                />
                <Text variant="small" className="mt-2 block text-text-secondary">
                  {forecast.rows[0]?.nextRolloff
                    ? `Next assignment ends ${forecast.rows[0].nextRolloff}.`
                    : "No assignment ends in this window."}
                </Text>
              </Card>
            </div>

            <div className="mt-6">
              <Card title="Your assignments">
                {myAssignments.length > 0 ? (
                  <Table
                    columns={assignmentColumns}
                    rows={myAssignments}
                    rowKey={(entry) => entry.assignment.assignmentId}
                    appearance="queue"
                  />
                ) : (
                  <Text variant="body" className="text-text-secondary">
                    You are not assigned to a project in this window.
                  </Text>
                )}
              </Card>
            </div>
          </section>
        ) : null}

        <div
          className={cx(
            "grid gap-6 pb-6",
            owner || member ? "pt-6" : "pt-8 xl:grid-cols-3",
          )}
        >
          <Card
            title="Needs Your Action"
            action={<Badge intensity="solid" tone="attention" shape="circle">{visibleItems.length}</Badge>}
            className={cx(
              "min-w-0",
              // Owner: full width beneath the figures. Manager: two of three
              // columns, with Team at a Glance beside it — and ordered first on
              // narrow viewports, where the queue is what they came for.
              owner || member ? "order-none" : "order-2 xl:order-none xl:col-span-2",
            )}
          >
            <div className="mb-4 flex flex-wrap items-center gap-6">
              {counts.map(({ kind, count }) => (
                <div key={kind} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={cx(
                      "flex size-button-md items-center justify-center rounded-full",
                      KIND_META[kind].chip,
                    )}
                  >
                    <Icon icon={KIND_META[kind].icon} size={14} />
                  </span>
                  <Text variant="small" className="text-text-secondary">
                    {kind}s
                  </Text>
                  <Badge intensity="solid" tone="neutral" shape="circle">{count}</Badge>
                </div>
              ))}
            </div>

            {announcement ? (
              <InlineAlert tone="success" className="mb-4">
                {announcement}
              </InlineAlert>
            ) : null}

            <Table
              columns={columns}
              rows={visibleItems}
              rowKey={(item) => item.id}
              selectedRowKey={activeId}
              onRowClick={(item) => setSelectedId(item.id)}
              appearance="queue"
              emptyState={
                <div className="rounded-md border border-border-default bg-bg-subtle px-4 py-8 text-center">
                  <Text variant="h3" className="text-text-primary">
                    Nothing waiting on you.
                  </Text>
                  <Text variant="body" className="mt-1 text-text-secondary">
                    {owner
                      ? "The firm's figures above are still here when you need them."
                      : member
                        ? "Your week is above when you need it."
                        : "Your team overview is still here when you need it."}
                  </Text>
                </div>
              }
            />
          </Card>

          {/* Manager only. An owner has Firm at a Glance above; a team member
            * has no business reading aggregates about a team they do not
            * manage, which is a permission boundary rather than a layout
            * preference. */}
          {owner || member ? null : (
          <div className="order-1 min-w-0 xl:order-none">
            <div className="mb-3 lg:hidden">
              <Button
                variant="secondary"
                onClick={() => setShowGlance((current) => !current)}
                aria-expanded={showGlance}
              >
                {showGlance ? "Hide team overview" : "Show team overview"}
              </Button>
            </div>
            <section
              aria-labelledby="team-at-a-glance"
              className={cx(showGlance ? "block" : "hidden", "lg:block")}
            >
              <div className="mb-3 flex items-center justify-between">
                <Text id="team-at-a-glance" variant="h2" className="text-text-primary">
                  Team at a Glance
                </Text>
                {/* FDN-41: counted, not typed. This said "9 reports" beside a
                  * cohort of six. */}
                <Badge>{cohort.length} reports</Badge>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                <Card title="Utilization">
                  <Stat
                    label="Next 90 days"
                    value={`${forecast.utilization}%`}
                    denominator={`of ${forecast.cohortSize} reports`}
                    scale="numeric-lg"
                    delta={{ text: "1% below target. Target 75%.", tone: "attention" }}
                  />
                </Card>
                {/* VRS-F049's four glance cards, kept. Bench exposure is
                  * deliberately not among them: a manager reads their cohort's
                  * bench on the Bench Forecast, which FDN-38 already scopes to
                  * direct reports. It appears in the Owner overview because an
                  * owner has no other summary of it on this screen. */}
                <Card title="Skill coverage">
                  <Stat
                    label="Hold a verified skill"
                    value={`${verifiedSkillCoverage} of ${cohort.length}`}
                    denominator="reports"
                    scale="numeric-lg"
                  />
                </Card>
                <Card title="Pulse sentiment">
                  <Stat
                    label="Current pulse"
                    value=""
                    suppressedReason="Suppressed · 6 responses, threshold is 8"
                  />
                </Card>
                <Card title="Probation reviews">
                  <Stat
                    label="Due in the next 30 days"
                    value="2"
                    denominator="reviews"
                    scale="numeric-lg"
                  />
                  <Text variant="small" className="mt-2 text-text-secondary">
                    Zara Hussain · Aug 18<br />Mateo Silva · Sep 2
                  </Text>
                </Card>
              </div>
            </section>
          </div>
          )}
        </div>
      </Content>
    </>
  );
}
