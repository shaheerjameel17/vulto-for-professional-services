"use client";

import { useState, type FormEvent } from "react";
import { Button, Dialog, InlineAlert, Input, Select } from "@vulto/ui";
import type { EmploymentType } from "@vulto/graph";

export type NewPersonDraft = {
  fullName: string;
  email: string;
  jobTitle: string;
  department: string;
  entityId: string;
  employeeCode: string;
  startDate: string;
  employmentType: EmploymentType;
};

export function AddPersonDialog({
  open,
  onOpenChange,
  onCreate,
  entities,
  refusal,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (person: NewPersonDraft) => Promise<boolean>;
  entities: { value: string; label: string }[];
  refusal: string | null;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [entityId, setEntityId] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [startDate, setStartDate] = useState("");
  const [pending, setPending] = useState(false);
  const [employmentType, setEmploymentType] = useState<EmploymentType>("FullTime");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const saved = await onCreate({
      fullName: fullName.trim(),
      email: email.trim(),
      jobTitle: jobTitle.trim(),
      department: department.trim(),
      entityId: entityId || entities[0]?.value || "",
      employeeCode: employeeCode.trim(),
      startDate,
      employmentType,
    });
    setPending(false);
    if (saved) {
      onOpenChange(false);
      // Keep the draft in memory for a later server refusal; a new dialog key resets it.
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add person"
      description="Required employment details. Changes sync to your workspace."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            type="submit"
            form="add-person-form"
            disabled={pending || entities.length === 0}
          >
            Add person
          </Button>
        </>
      }
    >
      <form id="add-person-form" onSubmit={submit} className="grid grid-cols-2 gap-4">
        {refusal ? <InlineAlert tone="danger">{refusal}</InlineAlert> : null}
        <Input
          label="Employee code"
          value={employeeCode}
          onChange={(event) => setEmployeeCode(event.target.value)}
          required
        />
        <Input
          label="Start date"
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
          required
        />
        <Input
          label="Full name"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          required
          autoFocus
        />
        <Input
          label="Work email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <Input
          label="Job title"
          value={jobTitle}
          onChange={(event) => setJobTitle(event.target.value)}
          required
        />
        <Input
          label="Department"
          value={department}
          onChange={(event) => setDepartment(event.target.value)}
          required
        />
        <Select<string>
          label="Entity"
          value={entityId || entities[0]?.value || ""}
          onChange={setEntityId}
          options={entities}
        />
        <Select<EmploymentType>
          label="Employment type"
          value={employmentType}
          onChange={setEmploymentType}
          options={[
            { value: "FullTime", label: "Full time" },
            { value: "PartTime", label: "Part time" },
            { value: "Contractor", label: "Contractor" },
            { value: "Intern", label: "Intern" },
          ]}
        />
      </form>
    </Dialog>
  );
}
