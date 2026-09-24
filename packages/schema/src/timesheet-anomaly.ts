/** Pure inputs for the three VRS-F010 review heuristics. */
export interface AnomalyEntry {
  readonly date: string;
  readonly hours: number;
  readonly time_category: "Billable" | "NonBillable" | "Pitch";
  readonly assignment_id: string | null;
  readonly pitch_id: string | null;
}

/** An entry belongs to an assignment but is dated after that assignment ends. */
export function detectPostEndDateAssignment(
  entries: readonly AnomalyEntry[],
  assignmentEndDates: Readonly<Record<string, string>>,
): boolean {
  return entries.some(
    (entry) =>
      entry.time_category === "Billable" &&
      entry.assignment_id !== null &&
      assignmentEndDates[entry.assignment_id] !== undefined &&
      entry.date > assignmentEndDates[entry.assignment_id]!,
  );
}

/** A one-row week is intentionally not evaluated. */
export function detectZeroVarianceWeek(entries: readonly AnomalyEntry[]): boolean {
  const rows = new Set(
    entries.map((entry) =>
      entry.time_category === "Billable"
        ? `assignment:${entry.assignment_id}`
        : entry.time_category === "Pitch"
          ? `pitch:${entry.pitch_id}`
          : "non-billable",
    ),
  );
  return (
    rows.size >= 2 &&
    entries.length > 0 &&
    entries.every((entry) => entry.hours === entries[0]!.hours)
  );
}

/** Pitch work excludes the entire week, not just those hours, from this rule. */
export function detectHoursExceedExpected(
  entries: readonly AnomalyEntry[],
  expectedWeeklyHours: number,
  threshold = 1.3,
): boolean {
  if (entries.some((entry) => entry.time_category === "Pitch")) return false;
  const hours = entries.reduce(
    (sum, entry) => sum + (entry.time_category === "Pitch" ? 0 : entry.hours),
    0,
  );
  return hours > expectedWeeklyHours * threshold;
}
