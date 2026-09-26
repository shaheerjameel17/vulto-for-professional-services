import { z } from "zod";
import { uuidV4Schema } from "../records";
import { defineMutation } from "./define";

const notificationInput = z.object({ notification_id: uuidV4Schema }).strict();
const options = { tier: 0, onlineOnly: false, stateTransition: false } as const;
export const notificationMarkRead = defineMutation({
  name: "notification.markRead",
  input: notificationInput,
  ...options,
});
export const notificationDismiss = defineMutation({
  name: "notification.dismiss",
  input: notificationInput,
  ...options,
});
export const notificationMarkAllRead = defineMutation({
  name: "notification.markAllRead",
  input: z.object({}).strict(),
  ...options,
});
export const hrComplianceSendReminder = defineMutation({
  name: "hrCompliance.sendReminder",
  input: z
    .object({
      week_start_date: z.iso.date(),
      employee_ids: z.array(uuidV4Schema).min(1),
    })
    .strict(),
  ...options,
});
export const NOTIFICATION_MUTATIONS = {
  "notification.markRead": notificationMarkRead,
  "notification.dismiss": notificationDismiss,
  "notification.markAllRead": notificationMarkAllRead,
  "hrCompliance.sendReminder": hrComplianceSendReminder,
} as const;
