"use client";

import { useRouter } from "next/navigation";
import { Avatar, Content, PageHeader, Text } from "@vulto/ui";
import { EMPLOYEES } from "../../../fixtures/roster";

/*
 * Minimal scaffolding to reach a profile — not VRS-F002's People directory.
 * That screen is a full VPS-D002 Table with filters, sort and row selection
 * into a Panel summary, and isn't in this pass's scope. This is just enough
 * clickable surface to open a profile from navigation.
 */
export default function PeoplePage() {
  const router = useRouter();
  const employees = EMPLOYEES.filter((e) => e.employeeType === "Employee");

  return (
    <>
      <PageHeader title="People" />
      <Content>
        <div className="mt-6 flex flex-col overflow-hidden rounded-md border border-border-default">
          {employees.map((employee, index) => (
            <button
              key={employee.employeeId}
              type="button"
              onClick={() => router.push(`/people/${employee.employeeId}`)}
              className={
                (index > 0 ? "border-t border-border-default " : "") +
                "flex items-center gap-3 px-4 py-3 text-left hover:bg-bg-hover"
              }
            >
              <Avatar name={employee.fullName} size="md" />
              <div>
                <Text variant="body-medium" className="text-text-primary">
                  {employee.fullName}
                </Text>
                <Text variant="small" className="text-text-secondary">
                  {employee.jobTitle}
                </Text>
              </div>
            </button>
          ))}
        </div>
      </Content>
    </>
  );
}
