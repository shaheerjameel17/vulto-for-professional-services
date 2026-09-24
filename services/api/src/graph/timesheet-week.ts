import { resolveWeekStartDate } from "@vulto/schema";
import { resolveCalendarForEntity } from "./calendar-resolution.js";
import { resolveForEmployee } from "./entity-resolution.js";
import type { GraphTx } from "./tx.js";

/** F276: the versioned Entity calendar, not worked-day or holiday state, keys a week. */
export async function weekStartForEmployee(
  tx: GraphTx,
  workspaceId: string,
  employeeId: string,
  date: string,
): Promise<string | null> {
  const entity = await resolveForEmployee(tx, workspaceId, employeeId, date);
  if (entity === null) return null;
  const calendar = await resolveCalendarForEntity(tx, workspaceId, entity.nodeId, date);
  const weekStartDay = calendar?.record["week_start_day"];
  if (typeof weekStartDay !== "number") return null;
  return resolveWeekStartDate(date, weekStartDay);
}
