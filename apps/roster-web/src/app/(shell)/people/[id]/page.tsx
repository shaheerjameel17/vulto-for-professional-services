"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Content, Tabs, TabPanel, Text, useShortcuts } from "@vulto/ui";
import {
  employeeGetQuery,
  employeeListForDirectoryQuery,
  type DirectoryEmployee,
} from "@vulto/graph";
import {
  fetchEmployee,
  profileFromLocal,
  type EmployeeAnswer,
  type LocalEmployeeProfile,
} from "../../../../lib/employee-profile";
import { peopleOrder } from "../../../../lib/people-order";
import { useShellBootstrap } from "../../../../components/shell-bootstrap";
import { ProfileHeader } from "../../../../components/profile/ProfileHeader";
import { OverviewTab } from "../../../../components/profile/OverviewTab";
import { SkillsTab } from "../../../../components/profile/SkillsTab";
import { DocumentsTab } from "../../../../components/profile/DocumentsTab";
import { ActivityTab } from "../../../../components/profile/ActivityTab";

export default function EmployeeProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { client, workspaceId, reportUnauthorized } = useShellBootstrap();
  const [tab, setTab] = useState("overview");
  const [local, setLocal] = useState<LocalEmployeeProfile | null>(null);
  const [employees, setEmployees] = useState<DirectoryEmployee[]>([]);
  const [answer, setAnswer] = useState<EmployeeAnswer>(null);
  const [protectedError, setProtectedError] = useState(false);
  const [readRevision, setReadRevision] = useState(0);
  const protectedSaved = useCallback(
    () => setReadRevision((version) => version + 1),
    [],
  );
  useEffect(() => {
    setLocal(null);
    return client.subscribe(employeeGetQuery(id), ({ result }) => {
      if (result.kind === "device-query" && result.name === "employee.get")
        setLocal(result.data);
    });
  }, [client, id]);
  useEffect(
    () =>
      client.subscribe(employeeListForDirectoryQuery(), ({ result }) => {
        if (
          result.kind === "device-query" &&
          result.name === "employee.listForDirectory"
        )
          setEmployees(result.data);
      }),
    [client],
  );
  useEffect(() => {
    const controller = new AbortController();
    setAnswer(null);
    setProtectedError(false);
    void fetchEmployee(id, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setAnswer(data);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (
          typeof error === "object" &&
          error !== null &&
          "status" in error &&
          error.status === 401
        )
          reportUnauthorized();
        setProtectedError(true);
      });
    return () => controller.abort();
  }, [id, readRevision, reportUnauthorized]);
  const remembered = peopleOrder(workspaceId);
  const order = remembered.length
    ? remembered
    : employees
        .filter((employee) => employee.operational["employee_type"] !== "Ghost")
        .map((employee) => employee.employeeId);
  function goTo(delta: number) {
    const index = order.indexOf(id);
    if (index < 0) return;
    const next = order[Math.min(order.length - 1, Math.max(0, index + delta))];
    if (next) router.push(`/people/${next}`);
  }
  useShortcuts({ keys: { j: () => goTo(1), k: () => goTo(-1) } });
  if (!local)
    return (
      <Content>
        <Text variant="body" className="text-text-secondary">
          No profile found for this person.
        </Text>
      </Content>
    );
  const profile = profileFromLocal(local);
  const compensation = answer?.compensation.find(
    (item) =>
      item.node_id === id &&
      item.partition === "compensation" &&
      item.state !== "erased",
  );
  return (
    <Content>
      <ProfileHeader profile={profile} />
      {protectedError ? (
        <Text variant="small" className="text-text-secondary">
          Reconnect to load protected fields.
        </Text>
      ) : null}
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "overview", label: "Overview" },
          { value: "skills", label: "Skills" },
          { value: "documents", label: "Documents" },
          { value: "activity", label: "Activity" },
        ]}
      >
        <TabPanel value="overview">
          <OverviewTab
            profile={profile}
            compensation={compensation}
            employees={employees}
            onProtectedSaved={protectedSaved}
          />
        </TabPanel>
        <TabPanel value="skills">
          <SkillsTab profile={profile} />
        </TabPanel>
        <TabPanel value="documents">
          <DocumentsTab profile={profile} />
        </TabPanel>
        <TabPanel value="activity">
          <ActivityTab profile={profile} />
        </TabPanel>
      </Tabs>
    </Content>
  );
}
