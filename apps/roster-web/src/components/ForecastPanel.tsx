"use client";

import { Badge, Button, InlineAlert, Text } from "@vulto/ui";
import { COST_HORIZON_DAYS, formatMoney, type ForecastRow } from "../lib/bench";
import { ENTITY_NAMES } from "../fixtures/calendar";

/*
 * VRS-F005's Contextual Intelligence Panel.
 *
 * In the real build this is a single two-hop traversal from the selected
 * Employee, entirely local, and what appears depends on the viewer's role and
 * the tier of what is traversed to — governed by VPS-A004, never by conditional
 * logic written here.
 *
 * The prototype has no permission interceptor, so the tier behavior is
 * mocked. Two rules are honored because they are what the screen is for:
 *
 *  - Compensation-derived figures are absent, not zeroed, for a viewer without
 *    access (VRS-F005's security rules, and the founder's provisional F6).
 *  - Wellness data is structurally absent for every role including Owner. There
 *    is no branch for it below, and there is no field to render — an
 *    unauthorized device never holds the data to suppress.
 */

const SKILLS: Record<string, string[]> = {
  "emp-01": ["Brand systems", "Figma", "Art direction"],
  "emp-02": ["TypeScript", "Node", "Postgres", "Team lead"],
  "emp-04": ["Go", "Postgres", "Kubernetes"],
  "emp-05": ["React", "TypeScript", "Accessibility"],
  "emp-07": ["User research", "Interviewing", "Synthesis"],
  "emp-10": ["dbt", "BigQuery", "Airflow"],
  "ghost-01": ["Go", "Postgres"],
  "ghost-02": ["Go", "Postgres"],
  "ghost-03": ["Design systems", "Team lead"],
};

/** Tier 2, Manager-restricted. Visible to Owner, HR Admin and the employee's own manager. */
const BURNOUT: Record<string, string> = {
  "emp-02": "Committed above 100% for six of the last eight weeks.",
};

export function ForecastPanel({
  row,
  canSeeCompensation,
}: {
  row: ForecastRow;
  canSeeCompensation: boolean;
}) {
  const skills = SKILLS[row.employee.employeeId] ?? [];
  const burnout = BURNOUT[row.employee.employeeId];

  return (
    <div className="flex flex-col gap-6">
      {row.ghost ? (
        <InlineAlert tone="attention">
          A planned hire, not a person. Assignments are held against the role
          and carry over on promotion.
        </InlineAlert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Text variant="micro" className="text-text-tertiary">
          Availability
        </Text>
        {row.benchWorkingDays === 0 ? (
          <Text variant="body" className="text-text-primary">
            Covered across the whole window.
          </Text>
        ) : (
          <div className="flex flex-col gap-1">
            <Text variant="body" className="text-text-primary">
              {row.benchWorkingDays} working days on the bench
            </Text>
            {/* Structurally absent for a viewer without compensation access —
              * not zeroed, not redacted, not a lock icon.
              * F36: the figure covers the cost horizon, and says so. */}
            {canSeeCompensation && row.costedBenchWorkingDays > 0 ? (
              <>
                <Text variant="numeric-lg" className="text-text-primary">
                  {formatMoney(row.benchCost)}
                </Text>
                {/* Only worth saying where the two differ. "22 of those 22
                  * days" is noise. */}
                {row.costedBenchWorkingDays < row.benchWorkingDays ? (
                  <Text variant="small" className="text-text-secondary">
                    {row.costedBenchWorkingDays} of those days fall within the
                    next {COST_HORIZON_DAYS}
                  </Text>
                ) : null}
              </>
            ) : null}
          </div>
        )}
        {row.nextRolloff ? (
          <Text variant="small" className="text-text-secondary">
            Next rolloff {row.nextRolloff}
          </Text>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Text variant="micro" className="text-text-tertiary">
          Entity
        </Text>
        <Text variant="body" className="text-text-primary">
          {ENTITY_NAMES[row.employee.entityId]}
        </Text>
      </div>

      {skills.length > 0 ? (
        <div className="flex flex-col gap-2">
          <Text variant="micro" className="text-text-tertiary">
            Skills
          </Text>
          <div className="flex flex-wrap gap-1">
            {skills.map((skill) => (
              <Badge key={skill} tone="neutral">
                {skill}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Text variant="micro" className="text-text-tertiary">
          Assignments
        </Text>
        {row.bars.length === 0 ? (
          <Text variant="body" className="text-text-secondary">
            None in this window.
          </Text>
        ) : (
          <ul className="flex flex-col gap-1">
            {row.bars.map((bar) => (
              <li key={bar.id}>
                <Text variant="body" className="text-text-primary">
                  {bar.label}
                </Text>
              </li>
            ))}
          </ul>
        )}
      </div>

      {burnout && canSeeCompensation ? (
        <InlineAlert tone="attention">{burnout}</InlineAlert>
      ) : null}

      <div className="flex gap-2">
        {row.ghost ? (
          <Button variant="primary">Promote to employee</Button>
        ) : (
          <Button variant="primary">Assign</Button>
        )}
        <Button variant="secondary">Open profile</Button>
      </div>
    </div>
  );
}
