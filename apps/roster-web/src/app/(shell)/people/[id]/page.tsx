"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Content, Tabs, TabPanel, Text, ToggleGroup, useShortcuts } from "@vulto/ui";
import { buildEmployeeProfile } from "../../../../lib/profile";
import { PROFILED_EMPLOYEE_IDS } from "../../../../fixtures/profiles";
import { ProfileHeader } from "../../../../components/profile/ProfileHeader";
import { OverviewTab } from "../../../../components/profile/OverviewTab";
import { SkillsTab } from "../../../../components/profile/SkillsTab";
import { DocumentsTab } from "../../../../components/profile/DocumentsTab";
import { ActivityTab } from "../../../../components/profile/ActivityTab";

/*
 * VRS-F002 — Atomic Employee Profiles.
 *
 * Tabs — Overview, Skills, Documents, Activity — with identity fixed above
 * them. `J`/`K` move between profiles without returning to the directory,
 * per VPS-D003, which is what makes reviewing a team a scan rather than a
 * navigation exercise.
 *
 * This screen uses Content only. VRS-F002's own screens table lists
 * "Content + Panel" for the profile, but names nothing the Panel would
 * show — nothing here is a list a Panel opens on selection from — so no
 * Panel is used. Logged as a specification gap rather than resolved by
 * inventing a use for it.
 */

/** Prototype furniture only, exactly like the Bench Forecast's Owner/Manager
  * toggle: the only way to compare the authorized and unauthorized render of
  * the compensation Section side by side. Not a real permission system. */
type ViewerRole = "hr-admin" | "team-member";

export default function EmployeeProfilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [tab, setTab] = useState("overview");
  const [role, setRole] = useState<ViewerRole>("hr-admin");

  const canSeeCompensation = role === "hr-admin";
  const profile = buildEmployeeProfile(params.id, canSeeCompensation);

  const index = PROFILED_EMPLOYEE_IDS.indexOf(params.id);

  function goTo(delta: number) {
    if (index === -1) return;
    const next = Math.min(
      PROFILED_EMPLOYEE_IDS.length - 1,
      Math.max(0, index + delta),
    );
    const nextId = PROFILED_EMPLOYEE_IDS[next];
    if (nextId) router.push(`/people/${nextId}`);
  }

  useShortcuts({
    keys: {
      j: () => goTo(1),
      k: () => goTo(-1),
    },
  });

  if (!profile) {
    return (
      <Content>
        <div className="mt-6">
          <Text variant="body" className="text-text-secondary">
            No profile found for this person.
          </Text>
        </div>
      </Content>
    );
  }

  return (
    <Content>
      {/* Prototype furniture, on its own row above the real header so
        * ProfileHeader itself stays exactly what VRS-F002 specifies — this
        * control has no equivalent in the spec. Not a real permission
        * system; see the type above. */}
      <div className="flex justify-end pt-4">
        <ToggleGroup<ViewerRole>
          label="Viewing as"
          value={role}
          onChange={setRole}
          options={[
            { value: "hr-admin", label: "HR Admin" },
            { value: "team-member", label: "Team Member" },
          ]}
        />
      </div>

      <ProfileHeader profile={profile} />

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
          <OverviewTab profile={profile} />
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
