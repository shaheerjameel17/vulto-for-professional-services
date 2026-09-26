import { isNodeType, getNodeRegistration } from "./registry/nodes";
import { fieldsAreTier0 } from "./search";

export const RECIPIENT_RESOLVERS = ["employee-manager", "employee-self"] as const;
export interface NotificationRule {
  readonly ruleId: string;
  readonly sourceNodeType: string;
  readonly category: "ActionNeeded" | "Informational";
  readonly recipient: (typeof RECIPIENT_RESOLVERS)[number];
  readonly discriminatorField?: string;
  readonly messageFields: readonly {
    readonly from: "subject" | "source";
    readonly field: string;
  }[];
  readonly messageTemplate: string;
}

/** Message text is a disclosure surface: reject unsafe registrations at startup. */
export function validateNotificationRules(rules: readonly NotificationRule[]): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    if (!isNodeType(rule.sourceNodeType))
      throw new Error(`Unregistered notification source: ${rule.sourceNodeType}`);
    if (!rule.ruleId || seen.has(rule.ruleId))
      throw new Error(`Duplicate or empty notification rule: ${rule.ruleId}`);
    seen.add(rule.ruleId);
    if (!RECIPIENT_RESOLVERS.includes(rule.recipient))
      throw new Error("Unknown recipient resolver");
    const protection = getNodeRegistration(rule.sourceNodeType).protection;
    const sourceIsTier0 = protection.kind === "fixed" && protection.tier === 0;
    for (const field of rule.messageFields) {
      if (
        !/^[a-z_]+$/.test(field.field) ||
        (field.from === "source"
          ? !sourceIsTier0 || !fieldsAreTier0(rule.sourceNodeType, [field.field])
          : field.from !== "subject" || !fieldsAreTier0("Employee", [field.field]))
      ) {
        throw new Error(
          `Notification message field is not Tier 0: ${field.from}.${field.field}`,
        );
      }
    }
    if (
      rule.discriminatorField !== undefined &&
      (!/^[a-z_]+$/.test(rule.discriminatorField) ||
        !sourceIsTier0 ||
        !fieldsAreTier0(rule.sourceNodeType, [rule.discriminatorField]))
    ) {
      throw new Error("Notification discriminator is not Tier 0");
    }
    const declared = new Set(
      rule.messageFields.map((field) => `${field.from}.${field.field}`),
    );
    for (const match of rule.messageTemplate.matchAll(/\{([^{}]+)\}/g)) {
      if (!declared.has(match[1]!))
        throw new Error(`Undeclared notification template field: ${match[1]}`);
    }
  }
}

export const NOTIFICATION_RULES = [
  {
    ruleId: "revenue-gap-alert",
    sourceNodeType: "RevenueGapAlert",
    category: "ActionNeeded",
    recipient: "employee-manager",
    discriminatorField: "severity",
    messageFields: [
      { from: "subject", field: "full_name" },
      { from: "source", field: "bench_days" },
    ],
    messageTemplate:
      "{subject.full_name} has been on the bench for {source.bench_days} working days.",
  },
  {
    ruleId: "timesheet-anomaly-flag",
    sourceNodeType: "TimesheetAnomalyFlag",
    category: "ActionNeeded",
    recipient: "employee-manager",
    messageFields: [{ from: "subject", field: "full_name" }],
    messageTemplate: "{subject.full_name}'s timesheet needs review.",
  },
] as const satisfies readonly NotificationRule[];

validateNotificationRules(NOTIFICATION_RULES);
