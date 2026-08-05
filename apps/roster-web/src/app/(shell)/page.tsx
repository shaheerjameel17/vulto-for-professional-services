"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import {
  Badge,
  Button,
  Content,
  PageHeader,
  Panel,
  Stat,
  Text,
  Timeline,
  ToggleGroup,
  useShortcuts,
} from "@vulto/ui";
import { buildForecast, DAY_WIDTH, formatMoney, type Horizon } from "../../lib/bench";
import { usePanel } from "../../components/panel-context";
import { ForecastPanel } from "../../components/ForecastPanel";

/*
 * VRS-F005 — The Bench Forecast.
 *
 * The centerpiece, and the reason this prototype exists before the sync engine.
 * Everything on this screen is derived from the graph at render: every bar is an
 * Assignment, every gap between bars is bench time, and bench time is never
 * stored.
 *
 * The screen occupies Content and Panel, and is exempt from VPS-D004's 1440px
 * content maximum — horizontal space here is time, and time is what the user
 * came for.
 *
 * There is no primary button on this screen. The Bench Forecast is a place you
 * look, not a place you do things, and the actions it leads to belong to the
 * Panel.
 */

/** Prototype furniture. The only way to see the restricted state (F5, F6). */
type ViewerRole = "owner" | "manager";

export default function BenchForecastPage() {
  const [horizon, setHorizon] = useState<Horizon>(90);
  const [role, setRole] = useState<ViewerRole>("owner");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [todayNonce, setTodayNonce] = useState(0);

  const filtersRef = useRef<HTMLButtonElement>(null);
  const { setPanel } = usePanel();

  const canSeeCompensation = role === "owner";

  const forecast = useMemo(
    () => buildForecast(horizon, canSeeCompensation),
    [horizon, canSeeCompensation],
  );

  const selected = forecast.rows.find((row) => row.id === selectedId);

  // The Panel is owned by the shell, so the screen pushes content into it.
  useEffect(() => {
    setPanel(
      selected ? (
        <Panel
          open
          title={selected.primaryLabel}
          subtitle={selected.secondaryLabel}
          onClose={() => setSelectedId(undefined)}
        >
          <ForecastPanel row={selected} canSeeCompensation={canSeeCompensation} />
        </Panel>
      ) : null,
    );
  }, [selected, canSeeCompensation, setPanel]);

  // Clear the panel when leaving the screen.
  useEffect(() => () => setPanel(null), [setPanel]);

  function moveSelection(delta: number) {
    const rows = forecast.rows;
    if (rows.length === 0) return;
    const current = rows.findIndex((row) => row.id === selectedId);
    const next = current === -1 ? 0 : Math.min(rows.length - 1, Math.max(0, current + delta));
    setSelectedId(rows[next]!.id);
  }

  useShortcuts({
    keys: {
      j: () => moveSelection(1),
      k: () => moveSelection(-1),
      "1": () => setHorizon(30),
      "2": () => setHorizon(90),
      "3": () => setHorizon(180),
      f: () => filtersRef.current?.focus(),
      t: () => setTodayNonce((value) => value + 1),
    },
    onEscape: () => setSelectedId(undefined),
  });

  const benchedCopy =
    forecast.benchedCount === 0
      ? `Nobody is on the bench in the next ${horizon} days`
      : `${forecast.benchedCount} of ${forecast.cohortSize} people have bench time · ${formatMoney(forecast.totalBenchCost)} unrecovered`;

  return (
    <>
      <PageHeader
        title="Bench Forecast"
        subtitle={canSeeCompensation ? benchedCopy : `${forecast.benchedCount} of ${forecast.cohortSize} people have bench time`}
      />

      <Content fullBleed>
        {/*
          * The summary row, sticky at the top. Two bands rather than one:
          * VPS-D004's page header is 56px and a `display` figure with a `micro`
          * denominator does not fit inside it — the arithmetic decided this.
          */}
        <div className="flex shrink-0 items-center justify-between gap-6 border-b border-border-default px-6 py-3">
          <div className="flex items-center gap-2">
            <ToggleGroup<string>
              label="Horizon"
              value={String(horizon)}
              onChange={(value) => setHorizon(Number(value) as Horizon)}
              options={[
                { value: "30", label: "30", shortcut: "1" },
                { value: "90", label: "90", shortcut: "2" },
                { value: "180", label: "180", shortcut: "3" },
              ]}
            />
            <Button
              ref={filtersRef}
              variant="ghost"
              icon={SlidersHorizontal}
              title="Filters · F"
            >
              Filters
            </Button>
            <Button
              variant="ghost"
              onClick={() => setTodayNonce((value) => value + 1)}
              title="Scroll today into view · T"
            >
              Today
            </Button>
          </div>

          <div className="flex items-center gap-6">
            {/* Prototype furniture: VRS-F005's restricted state is one of the
              * things worth looking at, and this is the only way to see it. */}
            <ToggleGroup<ViewerRole>
              label="Viewing as"
              value={role}
              onChange={setRole}
              options={[
                { value: "owner", label: "Owner" },
                { value: "manager", label: "Manager" },
              ]}
            />
            <Stat
              label="Utilization"
              value={`${forecast.utilization}%`}
              denominator={`${forecast.cohortSize} people${forecast.ghostContribution > 0 ? ` · +${forecast.ghostContribution}% planned` : ""}`}
              className="items-end text-right"
            />
          </div>
        </div>

        {forecast.rows.length === 0 ? (
          <div className="p-6">
            <Text variant="body" className="text-text-secondary">
              No one is assigned in this window.
            </Text>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col p-6 pt-4">
            <Timeline
              days={forecast.days}
              rows={forecast.rows}
              todayIndex={forecast.todayIndex}
              dayWidth={DAY_WIDTH[horizon]}
              selectedRowId={selectedId}
              onSelectRow={setSelectedId}
              scrollToTodayNonce={todayNonce}
            />
            <div className="mt-2 flex items-center gap-2">
              <Badge tone="attention">Amber</Badge>
              <Text variant="small" className="text-text-secondary">
                Bench time. The figure is unrecovered salary cost across the
                gap, counted in working days from each person&rsquo;s own
                calendar — a Karachi Saturday counts as half a day, a London
                Saturday not at all.
              </Text>
            </div>
          </div>
        )}
      </Content>
    </>
  );
}
