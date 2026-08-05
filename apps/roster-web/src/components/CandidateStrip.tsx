"use client";

import { BAR_FILLS, BENCH_FILLS } from "@vulto/tokens";
import { Text } from "@vulto/ui";
import { useAppearance } from "../app/appearance";

/*
 * FDN-12's candidates, all at once.
 *
 * The switcher at the sidebar foot is the better way to judge these — a fill
 * is judged in context, across a whole screen, not in a swatch. This strip
 * exists for the direct comparison the switcher cannot give.
 *
 * Each panel scopes the candidate to itself by carrying both data-theme and
 * data-bench, so no hex value is restated here. TEMPORARY, with the candidates.
 */

const NOTES: Record<string, string> = {
  restrained: "Closest to the original 12% composite, but opaque",
  present: "Reads as a warning without becoming a block of color",
  assertive: "Unmissable. Possibly too much at fifteen rows",
  hairline: "No hue in the fill. The edge carries the project",
  wash: "A low tint, still legibly the project's color",
  tint: "The loudest of the three, still far below the old bar",
};

export function CandidateStrip() {
  const { resolvedTheme } = useAppearance();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Text variant="micro" className="text-text-tertiary">
          Bench region — solid, chosen per theme
        </Text>
        <div className="mt-2 grid grid-cols-3 gap-4">
          {BENCH_FILLS.map((candidate, index) => (
            <div
              key={candidate}
              data-theme={resolvedTheme}
              data-bench={candidate}
              className="flex flex-col gap-1"
            >
              <div className="flex h-timeline-row items-center rounded-md bg-bench px-2">
                <Text variant="mono-lg" className="text-text-primary">
                  £4,201
                </Text>
              </div>
              <Text variant="label" className="text-text-primary">
                {index + 1} · {candidate}
              </Text>
              <Text variant="small" className="text-text-secondary">
                {NOTES[candidate]}
              </Text>
            </div>
          ))}
        </div>
      </div>

      <div>
        <Text variant="micro" className="text-text-tertiary">
          Assignment bar — 2px cat-n left edge, quiet opaque fill
        </Text>
        <div className="mt-2 grid grid-cols-3 gap-4">
          {BAR_FILLS.map((candidate, index) => (
            <div
              key={candidate}
              data-theme={resolvedTheme}
              data-bar={candidate}
              className="flex flex-col gap-1"
            >
              <div className="flex flex-col gap-1 rounded-md border border-border-default bg-bg-surface p-2">
                {(["bar-cat-1 border-cat-1", "bar-cat-4 border-cat-4", "bar-cat-7 border-cat-7"] as const).map(
                  (classes, barIndex) => (
                    <div
                      key={classes}
                      className={`flex h-bar items-center overflow-hidden rounded-md border-l-2 px-2 ${classes}`}
                    >
                      <Text variant="small" className="truncate text-text-primary">
                        {["Acme Rebrand", "Halo Phase 2", "Tandem Discovery"][barIndex]}
                      </Text>
                    </div>
                  ),
                )}
              </div>
              <Text variant="label" className="text-text-primary">
                {index + 1} · {candidate}
              </Text>
              <Text variant="small" className="text-text-secondary">
                {NOTES[candidate]}
              </Text>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
