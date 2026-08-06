import { FileText } from "lucide-react";
import { Badge, Icon, Text } from "@vulto/ui";
import type { EmployeeProfile } from "../../lib/profile";

export function DocumentsTab({ profile }: { profile: EmployeeProfile }) {
  if (profile.documents.length === 0) {
    return (
      <Text variant="body" className="text-text-secondary">
        No documents uploaded yet.
      </Text>
    );
  }

  return (
    <div className="flex flex-col">
      {profile.documents.map((doc, index) => (
        <div
          key={doc.name}
          className={
            index > 0
              ? "flex items-center gap-3 border-t border-border-default py-3"
              : "flex items-center gap-3 py-3"
          }
        >
          <Icon icon={FileText} className="text-text-tertiary" />
          <div className="min-w-0 flex-1">
            <Text variant="body-medium" className="truncate text-text-primary">
              {doc.name}
            </Text>
            <Text variant="small" className="text-text-secondary">
              Uploaded {doc.uploadedAt}
            </Text>
          </div>
          <Badge tone="neutral">{doc.category}</Badge>
        </div>
      ))}
    </div>
  );
}
