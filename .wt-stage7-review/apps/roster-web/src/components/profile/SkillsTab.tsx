import { Badge, Section, Text } from "@vulto/ui";
import type { EmployeeProfile } from "../../lib/profile";

/*
 * Skills and certifications. Both are Tier 0 per VRS-F002 — visible to any
 * role with Read on the Employee, which every role has — so there is no
 * authorization branch on this tab at all.
 */
export function SkillsTab({ profile }: { profile: EmployeeProfile }) {
  return (
    <div className="flex flex-col gap-8">
      <Section title="Skills">
        {profile.skills.length === 0 ? (
          <Text variant="body" className="text-text-secondary">
            No skills recorded yet.
          </Text>
        ) : (
          <div className="flex flex-col gap-2">
            {profile.skills.map((skill) => (
              <div
                key={skill.name}
                className="flex items-center justify-between rounded-md border border-border-default px-3 py-2"
              >
                <Text variant="body-medium" className="text-text-primary">
                  {skill.name}
                </Text>
                <div className="flex items-center gap-2">
                  <Text variant="small" className="text-text-secondary">
                    {skill.proficiency}
                  </Text>
                  {skill.verified ? (
                    <Badge tone="success">Verified</Badge>
                  ) : (
                    <Badge tone="neutral">Self-reported</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Certifications">
        {profile.certifications.length === 0 ? (
          <Text variant="body" className="text-text-secondary">
            No certifications on file.
          </Text>
        ) : (
          <div className="flex flex-col gap-2">
            {profile.certifications.map((cert) => (
              <div
                key={cert.name}
                className="flex items-center justify-between rounded-md border border-border-default px-3 py-2"
              >
                <div>
                  <Text variant="body-medium" className="text-text-primary">
                    {cert.name}
                  </Text>
                  <Text variant="small" className="text-text-secondary">
                    {cert.issuingBody} · issued {cert.issueDate}
                  </Text>
                </div>
                {cert.expiryDate ? (
                  <Text variant="small" className="text-text-tertiary">
                    Expires {cert.expiryDate}
                  </Text>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
