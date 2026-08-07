"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Info, SlidersHorizontal } from "lucide-react";
import {
  Button,
  Content,
  Icon,
  PageHeader,
  Panel,
  Stat,
  Text,
  Timeline,
  ToggleGroup,
  Tooltip,
  TooltipProvider,
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
          avatarName={selected.primaryLabel}
          referenceLabel={selected.referenceLabel}
          dashedAvatar={selected.ghost}
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

  // F36: the total counts only bench regions beginning inside the cost horizon,
  // and says so, because a figure that silently means something narrower than
  // the window on screen is the kind of number this product cannot afford.
  return (
    <TooltipProvider>
      {/* FDN-17: the subtitle is gone. The figures it carried are the band's
        * job now, and at `small` in a header they were the smallest statement of
        * the most important fact on the screen. */}
      <PageHeader
        title="Bench Forecast"
        titleAccessory={
          <Tooltip
            side="bottom"
            content={
              <div className="flex max-w-tooltip flex-col gap-2">
                <Text variant="body-medium">Bench Forecast</Text>
                <Text variant="small" className="text-text-secondary">
                  Amber shows periods without an active assignment. Cost is counted from each person&apos;s working calendar for the next {forecast.costHorizonDays} days.
                </Text>
              </div>
            }
          >
            <button type="button" aria-label="About the Bench Forecast" className="flex size-icon items-center justify-center rounded-full text-text-tertiary motion-fast transition-colors hover:bg-bg-hover hover:text-text-secondary">
              <Icon icon={Info} />
            </button>
          </Tooltip>
        }
      />

      <Content fullBleed>
        {/*
          * The summary row, sticky at the top. Two bands rather than one:
          * VPS-D004's page header is 56px and a `display` figure with a `micro`
          * denominator does not fit inside it — the arithmetic decided this.
          */}
        <div className="flex shrink-0 items-center justify-between gap-8 px-4 pb-3 pt-2">
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
              trackClassName="bg-bg-raised"
              activeClassName="bg-bg-active"
            />
            {/* VPS-D003: single-letter shortcuts are documented on hover of the
              * control they trigger, which is how they are discovered without a
              * manual. Now through VPS-D002's Tooltip rather than the browser's
              * own box. */}
            <Tooltip content="Filter the cohort" shortcut="F">
              <Button ref={filtersRef} size="sm" variant="secondary" icon={SlidersHorizontal} aria-label="Filter the cohort" />
            </Tooltip>
            <Tooltip content="Scroll today into view" shortcut="T">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTodayNonce((value) => value + 1)}
              >
                Today
              </Button>
            </Tooltip>
          </div>

          <div className="flex items-center gap-8">
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

            {/*
              * FDN-17. Three compact figures at one size; money leads by hue.
              *
              * The hierarchy was inverted: utilization held a 32px `display`
              * figure while the unrecovered total sat at 13px in a subtitle, on
              * a screen whose entire thesis is that money is what matters.
              *
              * The three values share geometry so the group scans as one row.
              * The unrecovered total takes the now-amber brand treatment,
              * connecting the summary to the bench regions it totals.
              */}
            <div className="flex items-end gap-10">
              {canSeeCompensation ? (
                <Stat
                  label={`Unrecovered · next ${forecast.costHorizonDays} days`}
                  value={formatMoney(forecast.totalBenchCost)}
                  scale="numeric-md"
                  labelPlacement="below"
                  className="items-end text-right"
                  valueClassName="text-text-brand"
                />
              ) : null}
              <Stat
                label="People with bench time"
                value={`${forecast.benchedCount} of ${forecast.cohortSize}`}
                scale="numeric-md"
                labelPlacement="below"
                className="items-end text-right"
              />
              <Stat
                label={`Utilization${forecast.ghostContribution > 0 ? ` · +${forecast.ghostContribution}% planned` : ""}`}
                value={`${forecast.utilization}%`}
                scale="numeric-md"
                labelPlacement="below"
                className="items-end text-right"
              />
            </div>
          </div>
        </div>

        {forecast.rows.length === 0 ? (
          <div className="p-6">
            <Text variant="body" className="text-text-secondary">
              No one is assigned in this window.
            </Text>
          </div>
        ) : (
          /* FDN-17: the two-line legend is gone, which returns its height to
            * rows. On a screen where vertical space is people visible, that was
            * the worst trade in the layout. */
          <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
            <Timeline
              days={forecast.days}
              rows={forecast.rows}
              todayIndex={forecast.todayIndex}
              dayWidth={DAY_WIDTH[horizon]}
              selectedRowId={selectedId}
              onSelectRow={setSelectedId}
              scrollToTodayNonce={todayNonce}
            />
          </div>
        )}
      </Content>
    </TooltipProvider>
  );
}
