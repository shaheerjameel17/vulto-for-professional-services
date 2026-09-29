"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  contextualIntelligenceQuery,
  conflictCheckQuery,
  type ConflictCheckResult,
  type GraphClient,
} from "@vulto/graph";
import { Badge, Button, InlineAlert, Input, Select, Text } from "@vulto/ui";
import { COST_HORIZON_DAYS, formatMoney, type ForecastRow } from "../lib/bench";
import {
  fetchProtectedContext,
  type ProtectedContextAnswer,
} from "../lib/forecast-server";
import { notificationRefusalMessage } from "../lib/notification-refusal";

const SKILL_COLORS = [
  "bg-cat-1/10 text-cat-1",
  "bg-cat-2/10 text-cat-2",
  "bg-cat-3/10 text-cat-3",
  "bg-cat-4/10 text-cat-4",
  "bg-cat-5/10 text-cat-5",
  "bg-cat-6/10 text-cat-6",
  "bg-cat-7/10 text-cat-7",
  "bg-cat-8/10 text-cat-8",
];
const today = () => new Date().toISOString().slice(0, 10);
function skillColor(skill: string) {
  return SKILL_COLORS[
    Array.from(skill).reduce((n, c) => n + c.charCodeAt(0), 0) % SKILL_COLORS.length
  ]!;
}
function protectedSummary(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value)
        .map(([key, entry]) => `${key}: ${String(entry)}`)
        .join(" · ")
    : String(value);
}

export function ForecastPanel({
  row,
  client,
  callerUserId,
  projects,
}: {
  row: ForecastRow;
  client: GraphClient;
  callerUserId: string;
  projects: readonly { id: string; name: string }[];
}) {
  const router = useRouter();
  const [local, setLocal] = useState<{
    skills: Record<string, unknown>[];
    openRoles: Record<string, unknown>[];
    references: Record<string, unknown>[];
  } | null>(null);
  const [protectedFields, setProtectedFields] = useState<ProtectedContextAnswer | null>(
    null,
  );
  const [mode, setMode] = useState<"view" | "assign" | "promote">("view");
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [fromDate, setFromDate] = useState(today());
  const [toDate, setToDate] = useState(today());
  const [percentage, setPercentage] = useState("100");
  const [conflict, setConflict] = useState<ConflictCheckResult | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [employmentType, setEmploymentType] = useState("FullTime");
  const [startDate, setStartDate] = useState(today());

  useEffect(
    () =>
      client.subscribe(contextualIntelligenceQuery(row.id), ({ result }) => {
        if (
          result.kind === "device-query" &&
          result.name === "contextualIntelligence.get"
        )
          setLocal(result.data);
      }),
    [client, row.id],
  );
  useEffect(() => {
    const controller = new AbortController();
    setProtectedFields(null);
    void fetchProtectedContext(row.id, controller.signal)
      .then(setProtectedFields)
      .catch(() => {});
    return () => controller.abort();
  }, [row.id]);
  const proposed = useMemo(
    () => ({
      employee_id: row.id,
      project_id: projectId,
      start_date: fromDate,
      end_date: toDate,
      billable_percentage: Number(percentage),
    }),
    [row.id, projectId, fromDate, toDate, percentage],
  );
  useEffect(() => {
    if (mode !== "assign" || !projectId || fromDate > toDate) return;
    let active = true;
    void client
      .query(
        conflictCheckQuery({
          employeeId: row.id,
          startDate: fromDate,
          endDate: toDate,
          billablePercentage: Number(percentage),
          nearCapacityWarningThreshold: 90,
          callerUserId,
          ...(editingAssignmentId ? { excludeAssignmentId: editingAssignmentId } : {}),
        }),
      )
      .then(({ result }) => {
        if (
          active &&
          result.kind === "device-query" &&
          result.name === "conflictCheck.evaluate"
        )
          setConflict(result.data);
      })
      .catch(() => {
        if (active) setConflict(null);
      });
    return () => {
      active = false;
    };
  }, [
    client,
    callerUserId,
    row.id,
    mode,
    projectId,
    fromDate,
    toDate,
    percentage,
    editingAssignmentId,
  ]);

  async function assign(override = false) {
    setRefusal(null);
    const name = override
      ? "conflictResolution.overrideAndProceed"
      : editingAssignmentId
        ? "assignment.update"
        : "assignment.create";
    const args = override
      ? { proposed, reason: overrideReason }
      : editingAssignmentId
        ? {
            assignment_id: editingAssignmentId,
            fields: {
              start_date: fromDate,
              end_date: toDate,
              billable_percentage: Number(percentage),
            },
          }
        : proposed;
    const outcome = await client.mutate(name, args);
    if (!outcome.accepted) setRefusal(notificationRefusalMessage(outcome.reason));
    else {
      setConflict(null);
      setMode("view");
      setEditingAssignmentId(null);
    }
  }
  async function promote() {
    if (!row.source.ghostResourceId || !row.source.ghostResourceVersion) return;
    setRefusal(null);
    const outcome = await client.protectedMutate("ghostResource.promote", {
      ghost_id: row.source.ghostResourceId,
      expected_version: row.source.ghostResourceVersion,
      details: {
        employee_code: employeeCode,
        full_name: fullName,
        email,
        employment_type: employmentType,
        start_date: startDate,
      },
    });
    if (!outcome.accepted) setRefusal(notificationRefusalMessage(outcome.reason));
    else setMode("view");
  }
  async function cancelAssignment(assignmentId: string, expectedVersion: number) {
    const outcome = await client.mutate("assignment.cancel", {
      assignment_id: assignmentId,
      expected_version: expectedVersion,
    });
    if (!outcome.accepted) setRefusal(notificationRefusalMessage(outcome.reason));
  }
  function editAssignment(assignment: ForecastRow["source"]["assignments"][number]) {
    setEditingAssignmentId(assignment.assignmentId);
    setProjectId(assignment.projectId);
    setFromDate(assignment.startDate);
    setToDate(assignment.endDate);
    setPercentage(String(assignment.billablePercentage));
    setMode("assign");
  }
  async function dismissAlert() {
    if (!row.source.revenueGapAlertId) return;
    const outcome = await client.mutate("revenueGapAlert.dismiss", {
      alert_id: row.source.revenueGapAlertId,
    });
    if (!outcome.accepted) setRefusal(notificationRefusalMessage(outcome.reason));
  }

  return (
    <div className="flex flex-col gap-6">
      {row.ghost ? (
        <InlineAlert tone="attention">
          A planned hire, not a person. Assignments carry over on promotion.
        </InlineAlert>
      ) : null}
      {refusal ? <InlineAlert tone="attention">{refusal}</InlineAlert> : null}
      <div className="flex flex-col gap-1">
        <Text variant="micro" className="text-text-tertiary">
          Availability
        </Text>
        <Text variant="body">
          {row.benchWorkingDays === 0
            ? "Covered across the whole window."
            : `${row.benchWorkingDays} working days on the bench`}
        </Text>
        {row.benchCost !== null && row.costedBenchWorkingDays > 0 ? (
          <>
            <Text variant="numeric-lg">
              {formatMoney(row.benchCost, row.benchCurrency ?? "GBP")}
            </Text>
            {row.costedBenchWorkingDays < row.benchWorkingDays ? (
              <Text variant="small" className="text-text-secondary">
                {row.costedBenchWorkingDays} of those days begin within the next{" "}
                {COST_HORIZON_DAYS}
              </Text>
            ) : null}
          </>
        ) : null}
        {row.nextRolloff ? (
          <Text variant="small" className="text-text-secondary">
            Next rolloff: {row.nextRolloff}
          </Text>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <Text variant="micro" className="text-text-tertiary">
          Entity
        </Text>
        <Text variant="body">{row.source.entityName ?? "—"}</Text>
      </div>
      {local?.skills.length ? (
        <div className="flex flex-col gap-2">
          <Text variant="micro" className="text-text-tertiary">
            Skills
          </Text>
          <div className="flex flex-wrap gap-1">
            {local.skills.map((skill, index) => {
              const name = String(skill["name"] ?? "Skill");
              return (
                <Badge
                  key={`${name}-${index}`}
                  tone="neutral"
                  shape="pill"
                  className={skillColor(name)}
                >
                  {name}
                </Badge>
              );
            })}
          </div>
        </div>
      ) : null}
      {local?.openRoles.length ? (
        <Text variant="small">
          Open roles:{" "}
          {local.openRoles
            .map((role) => String(role["role_title"] ?? role["name"] ?? "Role"))
            .join(", ")}
        </Text>
      ) : null}
      {local?.references.length ? (
        <Text variant="small">Referenced in {local.references.length} records</Text>
      ) : null}
      <div className="flex flex-col gap-2">
        <Text variant="micro" className="text-text-tertiary">
          Assignments
        </Text>
        {row.source.assignments.length === 0 ? (
          <Text variant="body">None in this window.</Text>
        ) : (
          row.source.assignments.map((assignment) => (
            <div key={assignment.assignmentId} className="flex items-center gap-2">
              <Text variant="body">{assignment.projectName ?? "Assignment"}</Text>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => editAssignment(assignment)}
              >
                Edit
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  void cancelAssignment(assignment.assignmentId, assignment.version)
                }
              >
                Cancel
              </Button>
            </div>
          ))
        )}
      </div>
      {protectedFields?.burnoutAlert !== undefined ? (
        <InlineAlert tone="attention">
          Burnout alert · {protectedSummary(protectedFields.burnoutAlert)}
        </InlineAlert>
      ) : null}
      {protectedFields?.flightRiskSignal !== undefined ? (
        <InlineAlert tone="attention">
          Flight risk · {protectedSummary(protectedFields.flightRiskSignal)}
        </InlineAlert>
      ) : null}
      {row.source.revenueGapAlertId ? (
        <Button variant="secondary" onClick={() => void dismissAlert()}>
          Dismiss revenue gap alert
        </Button>
      ) : null}
      {mode === "assign" ? (
        <div className="flex flex-col gap-2">
          {projects.length > 0 ? (
            <Select
              label="Project"
              value={projectId}
              options={projects.map((project) => ({
                value: project.id,
                label: project.name,
              }))}
              onChange={setProjectId}
            />
          ) : (
            <Text variant="small">No projects available.</Text>
          )}
          <Input
            label="Start date"
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
          <Input
            label="End date"
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
          />
          <Input
            label="Billable percentage"
            type="number"
            min={0}
            max={100}
            value={percentage}
            onChange={(event) => setPercentage(event.target.value)}
          />
          {conflict?.wouldConflict ? (
            <InlineAlert tone="attention">
              Capacity would exceed 100%. Review overlapping assignments before saving.
            </InlineAlert>
          ) : null}
          <Button
            variant="primary"
            disabled={!projectId || conflict?.wouldConflict}
            onClick={() => void assign()}
          >
            {editingAssignmentId ? "Update assignment" : "Create assignment"}
          </Button>
          {conflict?.wouldConflict && !editingAssignmentId ? (
            <>
              <Input
                label="Override reason"
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
              />
              <Button
                variant="secondary"
                disabled={!overrideReason.trim()}
                onClick={() => void assign(true)}
              >
                Override and proceed
              </Button>
            </>
          ) : null}
          <Button
            variant="secondary"
            onClick={() => {
              setMode("view");
              setEditingAssignmentId(null);
            }}
          >
            Cancel
          </Button>
        </div>
      ) : mode === "promote" ? (
        <div className="flex flex-col gap-2">
          <Input
            label="Employee code"
            value={employeeCode}
            onChange={(event) => setEmployeeCode(event.target.value)}
          />
          <Input
            label="Full name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Select
            label="Employment type"
            value={employmentType}
            options={["FullTime", "PartTime", "Contractor", "Intern"].map((value) => ({
              value,
              label: value,
            }))}
            onChange={setEmploymentType}
          />
          <Input
            label="Start date"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
          <Button
            variant="primary"
            disabled={!employeeCode || !fullName || !email}
            onClick={() => void promote()}
          >
            Promote to employee
          </Button>
          <Button variant="secondary" onClick={() => setMode("view")}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          {row.ghost ? (
            <Button
              variant="primary"
              onClick={() => setMode("promote")}
              disabled={!row.source.ghostResourceId}
            >
              Promote to employee
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setMode("assign")}>
              Assign
            </Button>
          )}
          {!row.ghost ? (
            <Button
              variant="secondary"
              onClick={() => router.push(`/people/${row.id}`)}
            >
              Open profile
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
