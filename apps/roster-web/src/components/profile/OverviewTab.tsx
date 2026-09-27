"use client";

import { useEffect, useState } from "react";
import { InlineAlert, Section, Text } from "@vulto/ui";
import type { EmployeeProfile, EmployeeAnswer } from "../../lib/employee-profile";
import { useShellBootstrap } from "../shell-bootstrap";
import { notificationRefusalMessage } from "../../lib/notification-refusal";
import type { DirectoryEmployee } from "@vulto/graph";
import { EditableField } from "./EditableField";

/*
 * VRS-F002, corrected by FDN-24: fields render as text, not as permanent
 * Inputs. `E` on a focused field, or a click, opens it; blur or `Cmd+Enter`
 * commits; `Escape` discards. See EditableField for the mechanics.
 *
 * Operational edits use named mutations and replicated values. Reporting
 * edits change the edge, not a field. Compensation follows the server's
 * available/restricted/absent answer and uses the memory-only write path.
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

export function OverviewTab({
  profile,
  compensation,
  employees,
  onProtectedSaved,
}: {
  profile: EmployeeProfile;
  compensation: NonNullable<EmployeeAnswer>["compensation"][number] | undefined;
  employees: readonly DirectoryEmployee[];
  onProtectedSaved: () => void;
}) {
  const { client } = useShellBootstrap();
  const [refusal, setRefusal] = useState<string | null>(null);
  const value =
    compensation?.state === "available" &&
    typeof compensation.value === "object" &&
    compensation.value !== null
      ? (compensation.value as Record<string, unknown>)
      : null;
  const initial: FieldState = {
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
    contractedHours:
      profile.contractedHours === null ? "" : String(profile.contractedHours),
    billingRateDefault:
      profile.billingRateDefault === null ? "" : String(profile.billingRateDefault),
    billabilityTargetOverride:
      profile.billabilityTargetOverride !== null
        ? String(profile.billabilityTargetOverride * 100)
        : "",
    compensationBaseAmount:
      value?.["base_compensation_amount"] != null
        ? String(value["base_compensation_amount"])
        : "",
    compensationFrequency: String(value?.["compensation_frequency"] ?? ""),
    compensationCurrency: String(value?.["compensation_currency"] ?? ""),
  };
  const [fields, setFields] = useState<FieldState>(initial);
  // Incoming replicated fields win; protected values stay only in component memory.
  useEffect(() => {
    setFields(initial);
  }, [profile, compensation]);

  function commit(key: keyof FieldState) {
    return (next: string) => {
      void save(key, next);
    };
  }

  async function save(key: keyof FieldState, next: string) {
    setRefusal(null);
    let outcome;
    if (key === "managerName") {
      const matches = employees.filter(
        (employee) => employee.operational["full_name"] === next,
      );
      if (next !== "" && matches.length !== 1) {
        setRefusal("Choose one uniquely named person from the directory");
        return;
      }
      outcome = await client.mutate("org.moveEmployee", {
        employee_id: profile.employeeId,
        new_manager_id: matches[0]?.employeeId ?? null,
        effective_from: new Date().toISOString(),
      });
    } else if (key.startsWith("compensation")) {
      const updated = { ...fields, [key]: next };
      outcome = await client.protectedMutate("employee.setCompensation", {
        employee_id: profile.employeeId,
        compensation: {
          base_compensation_amount:
            updated.compensationBaseAmount === ""
              ? null
              : Number(updated.compensationBaseAmount),
          compensation_frequency: updated.compensationFrequency || null,
          compensation_currency: updated.compensationCurrency || null,
        },
      });
      if (outcome.accepted) onProtectedSaved();
    } else {
      const names: Record<string, string> = {
        email: "email",
        phone: "phone",
        jobTitle: "job_title",
        department: "department",
        employmentType: "employment_type",
        seniorityLevel: "seniority_level",
        startDate: "start_date",
        timezone: "timezone",
        location: "location",
        notes: "notes",
        contractedHours: "contracted_hours",
        billingRateDefault: "billing_rate_default",
        billabilityTargetOverride: "billability_target_override",
      };
      const numeric = [
        "contractedHours",
        "billingRateDefault",
        "billabilityTargetOverride",
      ].includes(key);
      const parsed = numeric
        ? next === ""
          ? null
          : Number(next) / (key === "billabilityTargetOverride" ? 100 : 1)
        : next || null;
      outcome = await client.mutate("employee.update", {
        employee_id: profile.employeeId,
        expected_version: profile.version,
        patch: { [names[key]!]: parsed },
      });
    }
    if (!outcome.accepted) setRefusal(notificationRefusalMessage(outcome.reason));
  }

  return (
    <div className="flex flex-col">
      {refusal ? <InlineAlert tone="danger">{refusal}</InlineAlert> : null}
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        <Section title="Employment">
          <div className="flex flex-col gap-4">
            <EditableField
              label="Job title"
              value={fields.jobTitle}
              onCommit={commit("jobTitle")}
            />
            <EditableField
              label="Department"
              value={fields.department}
              onCommit={commit("department")}
            />
            <div className="grid grid-cols-2 gap-4">
              <EditableField
                label="Employment type"
                value={fields.employmentType}
                onCommit={commit("employmentType")}
              />
              <EditableField
                label="Seniority"
                value={fields.seniorityLevel}
                onCommit={commit("seniorityLevel")}
              />
            </div>
            <EditableField
              label="Start date"
              type="date"
              value={fields.startDate}
              onCommit={commit("startDate")}
            />
            {profile.probationStatus ? (
              <EditableField
                label="Probation"
                value={`${profile.probationStatus}${profile.probationEndDate ? ` · ${profile.probationEndDate}` : ""}`}
                readOnly
                helperText="Status transitions happen from the actions menu, never here."
              />
            ) : null}
            {profile.contractEndDate ? (
              <EditableField
                label="Contract end date"
                type="date"
                value={profile.contractEndDate}
                readOnly
              />
            ) : null}
            <EditableField
              label="Email"
              type="email"
              value={fields.email}
              onCommit={commit("email")}
            />
            <EditableField
              label="Phone"
              type="phone"
              value={fields.phone}
              onCommit={commit("phone")}
            />
            <div className="grid grid-cols-2 gap-4">
              <EditableField
                label="Timezone"
                value={fields.timezone}
                onCommit={commit("timezone")}
              />
              <EditableField
                label="Location"
                value={fields.location}
                onCommit={commit("location")}
              />
            </div>
            <EditableField
              label="Notes"
              value={fields.notes}
              onCommit={commit("notes")}
            />
          </div>
        </Section>

        <Section title="Reporting & schedule">
          <div className="flex flex-col gap-4">
            <EditableField
              label="Reports to"
              value={fields.managerName}
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
                min={0}
                max={168}
                step={1}
              />
              <EditableField
                label="Billing rate"
                type="number"
                value={fields.billingRateDefault}
                onCommit={commit("billingRateDefault")}
                suffix="/day"
                min={0}
                step={10}
                helperText="Tier 0 — what the agency charges."
              />
            </div>
            {profile.billabilityTargetOverride !== null ? (
              <EditableField
                label="Billability target override"
                type="number"
                value={fields.billabilityTargetOverride}
                onCommit={commit("billabilityTargetOverride")}
                suffix="%"
                min={0}
                max={100}
                step={5}
              />
            ) : null}
          </div>
        </Section>
      </div>

      {compensation && compensation.state !== "erased" ? (
        <Section title="Compensation" className="mt-12">
          {compensation.state === "restricted" ? (
            <Text variant="body" className="text-text-secondary">
              {compensation.label}
            </Text>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <EditableField
                  label="Base amount"
                  type="number"
                  value={fields.compensationBaseAmount}
                  onCommit={commit("compensationBaseAmount")}
                  suffix={fields.compensationCurrency}
                  min={0}
                  step={1000}
                />
                <EditableField
                  label="Frequency"
                  value={fields.compensationFrequency}
                  onCommit={commit("compensationFrequency")}
                />
                <EditableField
                  label="Currency"
                  type="currency"
                  value={fields.compensationCurrency}
                  onCommit={commit("compensationCurrency")}
                />
              </div>
              <Text variant="small" className="mt-2 text-text-tertiary">
                Tier 1, field-encrypted on the server. Never stored on this device.
              </Text>
            </>
          )}
        </Section>
      ) : null}
    </div>
  );
}
