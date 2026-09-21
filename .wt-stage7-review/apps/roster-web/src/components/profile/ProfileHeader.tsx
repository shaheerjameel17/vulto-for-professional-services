import { MoreHorizontal } from "lucide-react";
import { Avatar, Badge, Button, Text } from "@vulto/ui";
import type { EmployeeProfile } from "../../lib/profile";

/*
 * VRS-F002: "identity fixed above [the tabs]: avatar at 40px, name at h1,
 * job title and department at small in text-secondary, status Badge, and
 * the actions menu right-aligned."
 *
 * This stands in for VPS-D004's generic PageHeader on this one screen. A
 * profile's name already is the page's title, and the fields the generic
 * header can't carry — the avatar, the status badge — are exactly what
 * belongs here instead: the person should be the first thing the eye
 * meets, not a title band repeating what the identity block says a second
 * time beneath it.
 *
 * The actions menu is a placeholder. VPS-D002 has no dropdown-menu
 * component yet, and building one is out of scope for this pass — the
 * button is present and inert rather than absent, so the layout is honest
 * about what this screen will eventually need.
 */
export function ProfileHeader({ profile }: { profile: EmployeeProfile }) {
  return (
    <div className="flex items-start justify-between gap-4 pb-6">
      <div className="flex items-start gap-4">
        <Avatar name={profile.fullName} size="identity" />
        <div className="flex min-h-12 flex-col justify-center">
          <div className="flex items-center gap-2">
            <Text variant="h1" className="text-text-primary">
              {profile.preferredName ?? profile.fullName}
            </Text>
            <Badge tone="success">Active</Badge>
          </div>
          <Text variant="small" className="text-text-secondary">
            {profile.jobTitle} · {profile.department}
          </Text>
        </div>
      </div>
      <Button variant="ghost" icon={MoreHorizontal} aria-label="More actions" />
    </div>
  );
}
