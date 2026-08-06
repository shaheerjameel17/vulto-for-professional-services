"use client";

import { useState } from "react";
import { Section, Text } from "@vulto/ui";
import type { EmployeeProfile } from "../../lib/profile";
import { EditableField } from "./EditableField";

/*
 * VRS-F002, corrected by FDN-24: fields render as text, not as permanent
 * Inputs. `E` on a focused field, or a click, opens it; blur or `Cmd+Enter`
 * commits; `Escape` discards. See EditableField for the mechanics.
 *
 * Editing commits to local state only — there is nowhere else for it to go
 * in a static prototype, and CLAUDE.md forbids persisting it anywhere that
 * would survive a reload. The point being tested is the interaction, not
 * the storage.
 *
 * Compensation renders as its own Section, present only when
 * `profile.compensation` exists. There is no branch here for the
 * unauthorized case — the key is either on the object or it isn't, per
 * lib/profile.ts, so there is nothing to hide and nothing to check.
 */

type FieldState = {
  email: string;
  phone: string;
  jobTitle: string;
  department: string;
  employmentType: string;
  seniorityLevel: string;
  startDate: string;
  timezone: string;
  location: string;
  notes: string;
  managerName: string;
  contractedHours: string;
  billingRateDefault: string;
  billabilityTargetOverride: string;
  compensationBaseAmount: string;
  compensationFrequency: string;
  compensationCurrency: string;
};

export function OverviewTab({ profile }: { profile: EmployeeProfile }) {
  const [fields, setFields] = useState<FieldState>({
    email: profile.email,
    phone: profile.phone,
    jobTitle: profile.jobTitle,
    department: profile.department,
    employmentType: profile.employmentType,
    seniorityLevel: profile.seniorityLevel ?? "",
    startDate: profile.startDate,
    timezone: profile.timezone,
    location: profile.location,
    notes: profile.notes ?? "",
    managerName: profile.managerName ?? "",
    contractedHours: String(profile.contractedHours),
    billingRateDefault: String(profile.billingRateDefault),
    billabilityTargetOverride:
      profile.billabilityTargetOverride !== undefined
        ? String(profile.billabilityTargetOverride)
        : "",
    compensationBaseAmount: profile.compensation
      ? String(profile.compensation.baseAmount)
      : "",
    compensationFrequency: profile.compensation?.frequency ?? "",
    compensationCurrency: profile.compensation?.currency ?? "",
  });

  function commit(key: keyof FieldState) {
    return (value: string) =>
      setFields((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        <Section title="Employment">
          <div className="flex flex-col gap-4">
            <EditableField label="Job title" value={fields.jobTitle} onCommit={commit("jobTitle")} />
            <EditableField label="Department" value={fields.department} onCommit={commit("department")} />
            <div className="grid grid-cols-2 gap-4">
              <EditableField label="Employment type" value={fields.employmentType} onCommit={commit("employmentType")} />
              <EditableField label="Seniority" value={fields.seniorityLevel} onCommit={commit("seniorityLevel")} />
            </div>
            <EditableField label="Start date" type="date" value={fields.startDate} onCommit={commit("startDate")} />
            {profile.probationStatus ? (
              <EditableField
                label="Probation"
                value={`${profile.probationStatus}${profile.probationEndDate ? ` · ${profile.probationEndDate}` : ""}`}
                readOnly
                helperText="Status transitions happen from the actions menu, never here."
              />
            ) : null}
            {profile.contractEndDate ? (
              <EditableField label="Contract end date" type="date" value={profile.contractEndDate} readOnly />
            ) : null}
            <EditableField label="Email" type="email" value={fields.email} onCommit={commit("email")} />
            <EditableField label="Phone" value={fields.phone} onCommit={commit("phone")} />
            <div className="grid grid-cols-2 gap-4">
              <EditableField label="Timezone" value={fields.timezone} onCommit={commit("timezone")} />
              <EditableField label="Location" value={fields.location} onCommit={commit("location")} />
            </div>
            <EditableField label="Notes" value={fields.notes} onCommit={commit("notes")} />
          </div>
        </Section>

        <Section title="Reporting & schedule">
          <div className="flex flex-col gap-4">
            <EditableField
              label="Reports to"
              value={fields.managerName}
              readOnly={!fields.managerName}
              onCommit={commit("managerName")}
            />
            <EditableField
              label="Working pattern"
              value={profile.workingPatternNote}
              readOnly
              helperText="Resolved through VRS-F004. Never computed here."
            />
            <div className="grid grid-cols-2 gap-4">
              <EditableField
                label="Contracted hours"
                type="number"
                value={fields.contractedHours}
                onCommit={commit("contractedHours")}
                suffix="hrs/wk"
              />
              <EditableField
                label="Billing rate"
                type="number"
                value={fields.billingRateDefault}
                onCommit={commit("billingRateDefault")}
                suffix="GBP/day"
                helperText="Tier 0 — what the agency charges."
              />
            </div>
            {profile.billabilityTargetOverride !== undefined ? (
              <EditableField
                label="Billability target override"
                type="number"
                value={fields.billabilityTargetOverride}
                onCommit={commit("billabilityTargetOverride")}
                suffix="%"
              />
            ) : null}
          </div>
        </Section>
      </div>

      {profile.compensation ? (
        <Section title="Compensation">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <EditableField
              label="Base amount"
              type="number"
              value={fields.compensationBaseAmount}
              onCommit={commit("compensationBaseAmount")}
              suffix={fields.compensationCurrency}
            />
            <EditableField
              label="Frequency"
              value={fields.compensationFrequency}
              onCommit={commit("compensationFrequency")}
            />
            <EditableField
              label="Currency"
              value={fields.compensationCurrency}
              onCommit={commit("compensationCurrency")}
            />
          </div>
          <Text variant="small" className="mt-2 text-text-tertiary">
            Tier 1, end-to-end encrypted. Visible to Owner, Finance Admin, HR
            Admin and this employee only.
          </Text>
        </Section>
      ) : null}
    </div>
  );
}
