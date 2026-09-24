import { addIsoDays, isoDatesInclusive } from "@vulto/schema";
import { hoursOn, type WorkingDaysReadGuard } from "./working-days.js";
import type { GraphTx } from "./tx.js";

/** F277: one F004-backed weekly denominator for getWeek and snapshots. */
export async function expectedWeek(
  tx: GraphTx,
  workspaceId: string,
  employeeId: string,
  weekStart: string,
  mayRead: WorkingDaysReadGuard,
) {
  const columns: { date: string; expectedHours: number }[] = [];
  for (const date of isoDatesInclusive(weekStart, addIsoDays(weekStart, 6))) {
    const expectedHours = await hoursOn(tx, workspaceId, employeeId, date, mayRead);
    if (expectedHours > 0) columns.push({ date, expectedHours });
  }
  return {
    columns,
    expectedWeeklyHours: columns.reduce((sum, column) => sum + column.expectedHours, 0),
  };
}
