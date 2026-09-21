"use client";

import { useState, type FormEvent } from "react";
import { Button, Dialog, Input, Select } from "@vulto/ui";
import { ENTITY_NAMES, type EntityId } from "../../fixtures/calendar";
import type { EmploymentType } from "../../fixtures/profiles";

export type NewPersonDraft = {
  fullName: string;
  email: string;
  jobTitle: string;
  department: string;
  entityId: EntityId;
  employmentType: EmploymentType;
};

export function AddPersonDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (person: NewPersonDraft) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [entityId, setEntityId] = useState<EntityId>("uk");
  const [employmentType, setEmploymentType] = useState<EmploymentType>("FullTime");

  function reset() {
    setFullName("");
    setEmail("");
    setJobTitle("");
    setDepartment("");
    setEntityId("uk");
    setEmploymentType("FullTime");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onCreate({
      fullName: fullName.trim(),
      email: email.trim(),
      jobTitle: jobTitle.trim(),
      department: department.trim(),
      entityId,
      employmentType,
    });
    onOpenChange(false);
    reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add person"
      description="Required employment details only. Prototype changes last for this session."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="add-person-form">
            Add person
          </Button>
        </>
      }
    >
      <form id="add-person-form" onSubmit={submit} className="grid grid-cols-2 gap-4">
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
        <Select<EntityId>
          label="Entity"
          value={entityId}
          onChange={setEntityId}
          options={(Object.entries(ENTITY_NAMES) as Array<[EntityId, string]>).map(
            ([value, label]) => ({ value, label }),
          )}
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
