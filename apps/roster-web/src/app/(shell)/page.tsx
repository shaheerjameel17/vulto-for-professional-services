"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Info, SlidersHorizontal } from "lucide-react";
import { benchForecastGetQuery, type BenchForecastRow } from "@vulto/graph";
import {
  Button,
  Content,
  Icon,
  MultiSelect,
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
import {
  adaptForecast,
  DAY_WIDTH,
  forecastWindow,
  formatMoney,
  regionKey,
  type BenchCost,
  type Horizon,
} from "../../lib/bench";
import {
  fetchBenchAggregate,
  fetchBenchCosts,
  type AggregateAnswer,
} from "../../lib/forecast-server";
import { useShellBootstrap } from "../../components/shell-bootstrap";
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

export default function BenchForecastPage() {
  const { client, workspaceId, userId } = useShellBootstrap();
  const [horizon, setHorizon] = useState<Horizon>(90);
  const [sourceRows, setSourceRows] = useState<readonly BenchForecastRow[]>([]);
  const [projects, setProjects] = useState<readonly { id: string; name: string }[]>([]);
  const [costs, setCosts] = useState<Map<string, BenchCost | null>>(new Map());
  const [aggregate, setAggregate] = useState<AggregateAnswer | null>(null);
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [seniorityLevels, setSeniorityLevels] = useState<string[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [entityIds, setEntityIds] = useState<string[]>([]);
  const [availability, setAvailability] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [todayNonce, setTodayNonce] = useState(0);

  const filtersRef = useRef<HTMLButtonElement>(null);
  const { setPanel } = usePanel();

  const today = new Date().toISOString().slice(0, 10);
  const window = useMemo(() => forecastWindow(horizon, today), [horizon, today]);
  const filters = useMemo(
    () => ({
      ...(skillIds.length ? { skillIds } : {}),
      ...(seniorityLevels.length
        ? {
            seniorityLevels: seniorityLevels as (
              "Junior" | "Mid" | "Senior" | "Lead" | "Principal" | "Director" | "CLevel"
            )[],
          }
        : {}),
      ...(departments.length ? { departments } : {}),
      ...(entityIds.length ? { entityIds } : {}),
      ...(availability
        ? { availability: { fromDate: today, toDate: window.to_date } }
        : {}),
    }),
    [
      skillIds,
      seniorityLevels,
      departments,
      entityIds,
      availability,
      today,
      window.to_date,
    ],
  );
  useEffect(
    () =>
      client.subscribe(benchForecastGetQuery(window, filters), ({ result }) => {
        if (result.kind === "device-query" && result.name === "benchForecast.get") {
          setSourceRows(result.data.rows);
          setProjects(result.data.projects);
        }
      }),
    [client, window, filters],
  );
  useEffect(() => {
    const controller = new AbortController();
    setAggregate(null);
    void fetchBenchAggregate(
      { workspace_id: workspaceId, window, filters },
      controller.signal,
    )
      .then(setAggregate)
      .catch(() => {});
    return () => controller.abort();
  }, [workspaceId, window, filters]);
  useEffect(() => {
    const controller = new AbortController();
    const regions = sourceRows.flatMap((row) =>
      row.benchPeriods.map((period) => ({
        employeeId: row.employeeId,
        fromDate: period.fromDate,
        toDate: period.toDate,
      })),
    );
    setCosts(new Map());
    if (regions.length > 0)
      void fetchBenchCosts({ regions }, controller.signal)
        .then((answer) =>
          setCosts(
            new Map(
              answer.costs.map((item) => [
                regionKey(item.employeeId, item.fromDate, item.toDate),
                item.cost,
              ]),
            ),
          ),
        )
        .catch(() => {});
    return () => controller.abort();
  }, [sourceRows]);
  const forecast = useMemo(
    () => adaptForecast(sourceRows, horizon, today, costs),
    [sourceRows, horizon, today, costs],
  );
  const filterOptions = useMemo(
    () => ({
      skills: [
        ...new Map(
          sourceRows.flatMap((row) =>
            row.skills.map(
              (skill) => [skill.id, { value: skill.id, label: skill.name }] as const,
            ),
          ),
        ).values(),
      ],
      seniority: [
        ...new Set(
          sourceRows
            .map((row) => row.employee["seniority_level"])
            .filter((value): value is string => typeof value === "string"),
        ),
      ].map((value) => ({ value, label: value })),
      departments: [
        ...new Set(
          sourceRows
            .map((row) => row.employee["department"])
            .filter((value): value is string => typeof value === "string"),
        ),
      ].map((value) => ({ value, label: value })),
      entities: [
        ...new Map(
          sourceRows
            .filter((row) => row.entityId !== null)
            .map(
              (row) =>
                [
                  row.entityId!,
                  { value: row.entityId!, label: row.entityName ?? row.entityId! },
                ] as const,
            ),
        ).values(),
      ],
    }),
    [sourceRows],
  );

  const selected = forecast.rows.find((row) => row.id === selectedId);
  const visibleCosts = forecast.rows
    .filter((row) => !row.ghost)
    .flatMap((row) =>
      row.source.benchPeriods.map((period) =>
        costs.get(regionKey(row.id, period.fromDate, period.toDate)),
      ),
    )
    .filter((value): value is BenchCost => value !== null && value !== undefined);
  const totalsByCurrency = new Map<string, number>();
  for (const value of visibleCosts) {
    const currency = value.currency ?? "GBP";
    totalsByCurrency.set(
      currency,
      (totalsByCurrency.get(currency) ?? 0) + value.amount,
    );
  }
  const totalCostLabel = [...totalsByCurrency]
    .map(([currency, amount]) => formatMoney(amount, currency))
    .join(" · ");
  const utilization = aggregate?.aggregateUtilization;
  const ghostContribution = aggregate?.ghostContribution;

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
          <ForecastPanel
            row={selected}
            client={client}
            callerUserId={userId}
            projects={projects}
          />
        </Panel>
      ) : null,
    );
  }, [selected, client, userId, projects, setPanel]);

  // Clear the panel when leaving the screen.
  useEffect(() => () => setPanel(null), [setPanel]);

  function moveSelection(delta: number) {
    const rows = forecast.rows;
    if (rows.length === 0) return;
    const current = rows.findIndex((row) => row.id === selectedId);
    const next =
      current === -1 ? 0 : Math.min(rows.length - 1, Math.max(0, current + delta));
    setSelectedId(rows[next]!.id);
  }

  useShortcuts({
    keys: {
      j: () => moveSelection(1),
      k: () => moveSelection(-1),
      Enter: () => {
        if (!selectedId && forecast.rows[0]) setSelectedId(forecast.rows[0].id);
      },
      "1": () => setHorizon(30),
      "2": () => setHorizon(90),
      "3": () => setHorizon(180),
      f: () => {
        setFiltersOpen(true);
        filtersRef.current?.focus();
      },
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
                  Amber shows periods without an active assignment. Cost is counted from
                  each person&apos;s working calendar for the next{" "}
                  {forecast.costHorizonDays} days.
                </Text>
              </div>
            }
          >
            <button
              type="button"
              aria-label="About the Bench Forecast"
              className="flex size-button-md items-center justify-center rounded-full text-text-tertiary motion-fast transition-colors hover:text-text-secondary"
            >
              <Icon icon={Info} size={14} />
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
        {/* FDN-44: symmetric padding. `pt-2 pb-4` put every control eight
         * pixels closer to the rule above than the one below — `items-center`
         * centers within the content box, and an asymmetric box centers
         * asymmetrically. Measured 8px top against 17px bottom before, equal
         * after, at the same overall row height. */}
        <div className="flex shrink-0 items-center justify-between gap-8 border-b border-border-default px-4 py-3">
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
              <Button
                ref={filtersRef}
                size="md"
                variant="secondary"
                icon={SlidersHorizontal}
                iconSize={14}
                aria-label="Filter the cohort"
                onClick={() => setFiltersOpen((open) => !open)}
              />
            </Tooltip>
            {/* FDN-44: `md`, matching the filter button beside it. At `sm` the
             * hover fill was 24px tall with 8px of horizontal padding — a
             * label in a fill barely larger than the label — and it also sat
             * four pixels shorter than every other control in the row. */}
            <Tooltip content="Scroll today into view" shortcut="T">
              <Button
                variant="ghost"
                size="md"
                onClick={() => setTodayNonce((value) => value + 1)}
              >
                Today
              </Button>
            </Tooltip>
          </div>

          {filtersOpen ? (
            <div className="flex items-center gap-2" aria-label="Forecast filters">
              <MultiSelect
                label="Skill"
                allLabel="All skills"
                value={skillIds}
                options={filterOptions.skills}
                onChange={setSkillIds}
                searchable
              />
              <MultiSelect
                label="Seniority"
                allLabel="All levels"
                value={seniorityLevels}
                options={filterOptions.seniority}
                onChange={setSeniorityLevels}
              />
              <MultiSelect
                label="Department"
                allLabel="All departments"
                value={departments}
                options={filterOptions.departments}
                onChange={setDepartments}
              />
              <MultiSelect
                label="Entity"
                allLabel="All entities"
                value={entityIds}
                options={filterOptions.entities}
                onChange={setEntityIds}
              />
              <Button
                variant="secondary"
                size="md"
                onClick={() => setAvailability((value) => !value)}
                aria-pressed={availability}
              >
                Available
              </Button>
            </div>
          ) : null}

          <div className="flex items-center">
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
            {/* FDN-44: `items-center`. The three figures are one visual block
             * and are centered in the row as one, rather than hung from a
             * shared baseline that ignores the row they sit in. */}
            <div className="flex items-center gap-10">
              <Stat
                label={`Utilization${typeof ghostContribution === "number" && ghostContribution > 0 ? ` · +${Math.round(ghostContribution * 100)}% planned` : ""}`}
                value={
                  typeof utilization === "number"
                    ? `${Math.round(utilization * 100)}%`
                    : utilization?.state === "suppressed"
                      ? "Restricted"
                      : "—"
                }
                scale="numeric-md"
                labelPlacement="below"
                className="items-end text-right"
              />
              <Stat
                label="People with bench time"
                value={`${forecast.benchedCount} of ${forecast.cohortSize}`}
                scale="numeric-md"
                labelPlacement="below"
                className="items-end text-right"
              />
              {visibleCosts.length > 0 ? (
                <Stat
                  label={`Unrecovered · next ${forecast.costHorizonDays} days`}
                  value={totalCostLabel}
                  scale="numeric-md"
                  labelPlacement="below"
                  className="items-end text-right"
                  valueClassName="font-semibold text-text-brand"
                />
              ) : null}
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
          <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2">
            <Timeline
              days={forecast.days}
              rows={forecast.rows}
              todayIndex={forecast.todayIndex}
              dayWidth={DAY_WIDTH[horizon]}
              selectedRowId={selectedId}
              onSelectRow={setSelectedId}
              panelOpen={selectedId !== undefined}
              scrollToTodayNonce={todayNonce}
            />
          </div>
        )}
      </Content>
    </TooltipProvider>
  );
}
