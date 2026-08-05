/**
 * Class name joining. Deliberately not `clsx` or `tailwind-merge`:
 * VPS-A001 did not choose either, and a merge utility exists to resolve
 * conflicting Tailwind classes, which in this design system means two
 * components disagreed about a token. That should be visible, not silently
 * resolved in the last one's favor.
 */
export type ClassValue = string | false | null | undefined;

export function cx(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
