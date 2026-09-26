import type { SyncDatabase } from "../sync-client/database";
import { localNodes } from "./cache-data";

/** The cache is this principal's audience. No second recipient/user filter is applied. */
export async function notificationListForUser(database: SyncDatabase) {
  const rows = (await localNodes(database, ["Notification"]))
    .filter((node) => node.record["dismissed_at"] === null)
    .sort(
      (a, b) =>
        String(b.record["created_at"]).localeCompare(String(a.record["created_at"])) ||
        a.nodeId.localeCompare(b.nodeId),
    );
  const needsYou: typeof rows = [],
    today: typeof rows = [],
    earlier: typeof rows = [];
  const now = new Date();
  for (const row of rows) {
    if (row.record["category"] === "ActionNeeded") {
      needsYou.push(row);
      continue;
    }
    const created = new Date(String(row.record["created_at"]));
    const sameDay =
      created.getFullYear() === now.getFullYear() &&
      created.getMonth() === now.getMonth() &&
      created.getDate() === now.getDate();
    (sameDay ? today : earlier).push(row);
  }
  return { needsYou, today, earlier };
}

export async function notificationUnreadActionCount(
  database: SyncDatabase,
): Promise<number> {
  return (await localNodes(database, ["Notification"])).filter(
    (node) =>
      node.record["category"] === "ActionNeeded" &&
      node.record["read_at"] === null &&
      node.record["dismissed_at"] === null,
  ).length;
}
