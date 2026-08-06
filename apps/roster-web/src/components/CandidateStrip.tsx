"use client";

import { CAT_PALETTES, type CatPalette } from "@vulto/tokens";
import { Text } from "@vulto/ui";
import { useAppearance } from "../app/appearance";
import { buildForecast } from "../lib/bench";

/*
 * FDN-20's categorical palette candidates, rendered as fields.
 *
 * A palette is judged as a field, not as a row of chips: what matters is whether
 * fifteen rows of bars stay distinguishable from each other and stay subordinate
 * to the amber, and a swatch row answers neither question.
 *
 * These are the real rows, with the real hash assignment from the real Project
 * UUIDs, so the color distribution is the one the Forecast actually produces.
 * Bench bars are included, because "does the amber still win" is half the test.
 *
 * Each field scopes its palette to itself by carrying both data-theme and
 * data-cat-palette, so no hex value is restated here. TEMPORARY, with the
 * candidates.
 */

const NOTES: Record<CatPalette, string> = {
  current: "As built. cat-2 and cat-6 sit in Indigo's own hue band",
  spread: "Four hues at two lightness steps. Leans on hue",
  ladder: "Two hues at three steps, one accent, one slate. Leans on lightness",
};

const FILL: Record<string, string> = {
  "cat-1": "bar-cat-1",
  "cat-2": "bar-cat-2",
  "cat-3": "bar-cat-3",
  "cat-4": "bar-cat-4",
  "cat-5": "bar-cat-5",
  "cat-6": "bar-cat-6",
  "cat-7": "bar-cat-7",
  "cat-8": "bar-cat-8",
};

const EDGE: Record<string, string> = {
  "cat-1": "border-cat-1",
  "cat-2": "border-cat-2",
  "cat-3": "border-cat-3",
  "cat-4": "border-cat-4",
  "cat-5": "border-cat-5",
  "cat-6": "border-cat-6",
  "cat-7": "border-cat-7",
  "cat-8": "border-cat-8",
};

export function CandidateStrip() {
  const { resolvedTheme } = useAppearance();
  const forecast = buildForecast(90, true);
  const total = forecast.days.length;
  const pct = (n: number) => `${(n / total) * 100}%`;

  return (
    <div>
      <Text variant="micro" className="text-text-secondary">
        Project palette — fifteen rows, real hash assignment
      </Text>
      <div className="mt-2 grid grid-cols-1 gap-4 xl:grid-cols-3">
        {CAT_PALETTES.map((candidate) => (
          <div
            key={candidate}
            data-theme={resolvedTheme}
            data-cat-palette={candidate}
            className="flex flex-col gap-2"
          >
            <div className="overflow-hidden rounded-md border border-border-default bg-bg-surface p-2">
              {forecast.rows.map((row) => (
                <div key={row.id} className="relative h-5">
                  {row.bench.map((region) => (
                    <div
                      key={region.id}
                      className="bg-bench absolute top-1/2 h-2 -translate-y-1/2 rounded-sm"
                      style={{
                        left: pct(region.start),
                        width: pct(region.span),
                      }}
                    />
                  ))}
                  {row.bars.map((bar) => (
                    <div
                      key={bar.id}
                      className={`absolute top-1/2 h-2 -translate-y-1/2 rounded-sm border-l-2 ${FILL[bar.colorToken]} ${EDGE[bar.colorToken]}`}
                      style={{ left: pct(bar.start), width: pct(bar.span) }}
                    />
                  ))}
                </div>
              ))}
            </div>
            <Text variant="label" className="text-text-primary">
              {candidate}
            </Text>
            <Text variant="small" className="text-text-secondary">
              {NOTES[candidate]}
            </Text>
          </div>
        ))}
      </div>
    </div>
  );
}
