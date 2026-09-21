import { Text } from "@vulto/ui";
import type { EmployeeProfile } from "../../lib/profile";

export function ActivityTab({ profile }: { profile: EmployeeProfile }) {
  if (profile.activity.length === 0) {
    return (
      <Text variant="body" className="text-text-secondary">
        Nothing recorded yet.
      </Text>
    );
  }

  return (
    <div className="flex flex-col">
      {profile.activity.map((entry, index) => (
        <div
          key={`${entry.date}-${index}`}
          className={
            index > 0
              ? "flex gap-4 border-t border-border-default py-3"
              : "flex gap-4 py-3"
          }
        >
          <Text variant="numeric" className="w-24 shrink-0 text-text-tertiary">
            {entry.date}
          </Text>
          <Text variant="body" className="text-text-primary">
            {entry.description}
          </Text>
        </div>
      ))}
    </div>
  );
}
