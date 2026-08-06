"use client";

import { useState } from "react";
import { Input, Section, Text } from "@vulto/ui";
import type { EmployeeProfile } from "../../lib/profile";

/*
 * VRS-F002: "Overview is a two-column Section layout. Employment fields
 * left, reporting line and working pattern right. Every field is an
 * inline-editable Input that commits on blur, with no explicit save
 * button."
 *
 * Editing commits to local state only — there is nowhere else for it to
 * go in a static prototype, and CLAUDE.md forbids persisting it anywhere
 * that would survive a reload. The point being tested is the interaction,
 * not the storage.
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
  });

  function set(key: keyof FieldState) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setFields((prev) => ({ ...prev, [key]: e.target.value }));
  }

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        <Section title="Employment">
          <div className="flex flex-col gap-4">
            <Input label="Job title" value={fields.jobTitle} onChange={set("jobTitle")} />
            <Input label="Department" value={fields.department} onChange={set("department")} />
            <div className="grid grid-cols-2 gap-4">
              <Input label="Employment type" value={fields.employmentType} onChange={set("employmentType")} />
              <Input label="Seniority" value={fields.seniorityLevel} onChange={set("seniorityLevel")} />
            </div>
            <Input label="Start date" type="date" value={fields.startDate} onChange={set("startDate")} />
            {profile.probationStatus ? (
              <Input
                label="Probation"
                value={`${profile.probationStatus}${profile.probationEndDate ? ` · ${profile.probationEndDate}` : ""}`}
                readOnly
                helperText="Status transitions happen from the actions menu, never here."
              />
            ) : null}
            {profile.contractEndDate ? (
              <Input label="Contract end date" type="date" value={profile.contractEndDate} readOnly />
            ) : null}
            <Input label="Email" type="email" value={fields.email} onChange={set("email")} />
            <Input label="Phone" value={fields.phone} onChange={set("phone")} />
            <div className="grid grid-cols-2 gap-4">
              <Input label="Timezone" value={fields.timezone} onChange={set("timezone")} />
              <Input label="Location" value={fields.location} onChange={set("location")} />
            </div>
            <Input label="Notes" value={fields.notes} onChange={set("notes")} />
          </div>
        </Section>

        <Section title="Reporting & schedule">
          <div className="flex flex-col gap-4">
            <Input
              label="Reports to"
              value={fields.managerName || "—"}
              readOnly={!fields.managerName}
              onChange={set("managerName")}
            />
            <Input
              label="Working pattern"
              value={profile.workingPatternNote}
              readOnly
              helperText="Resolved through VRS-F004. Never computed here."
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Contracted hours"
                type="number"
                value={fields.contractedHours}
                onChange={set("contractedHours")}
                suffix="hrs/wk"
              />
              <Input
                label="Billing rate"
                type="number"
                value={fields.billingRateDefault}
                onChange={set("billingRateDefault")}
                suffix="GBP/day"
                helperText="Tier 0 — what the agency charges."
              />
            </div>
            {profile.billabilityTargetOverride !== undefined ? (
              <Input
                label="Billability target override"
                type="number"
                value={fields.billabilityTargetOverride}
                onChange={set("billabilityTargetOverride")}
                suffix="%"
              />
            ) : null}
          </div>
        </Section>
      </div>

      {profile.compensation ? (
        <Section title="Compensation">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Input
              label="Base amount"
              type="number"
              defaultValue={profile.compensation.baseAmount}
              suffix={profile.compensation.currency}
            />
            <Input label="Frequency" defaultValue={profile.compensation.frequency} />
            <Input label="Currency" defaultValue={profile.compensation.currency} />
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
