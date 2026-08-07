"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Content,
  InlineAlert,
  PageHeader,
  Stat,
  Table,
  Text,
  ToggleGroup,
  cx,
  useShortcuts,
  type TableColumn,
} from "@vulto/ui";
import {
  MANAGER_QUEUE,
  type ManagerQueueItem,
  type ManagerQueueKind,
} from "../../../fixtures/manager-dashboard";

type QueueMode = "active" | "clear";

export default function ManagerDashboardPage() {
  const [items, setItems] = useState(MANAGER_QUEUE);
  const [mode, setMode] = useState<QueueMode>("active");
  const [selectedId, setSelectedId] = useState(MANAGER_QUEUE[0]?.id);
  const [showGlance, setShowGlance] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const visibleItems = mode === "clear" ? [] : items;
  const selected = visibleItems.find((item) => item.id === selectedId);

  const counts = useMemo(
    () =>
      (["Approval", "Alert", "Request"] as ManagerQueueKind[]).map((kind) => ({
        kind,
        count: visibleItems.filter((item) => item.kind === kind).length,
      })),
    [visibleItems],
  );

  function moveSelection(delta: number) {
    if (visibleItems.length === 0) return;
    const current = visibleItems.findIndex((item) => item.id === selectedId);
    const next = current === -1
      ? 0
      : Math.min(visibleItems.length - 1, Math.max(0, current + delta));
    setSelectedId(visibleItems[next]!.id);
  }

  function resolveItem(item: ManagerQueueItem, verb = item.actionLabel) {
    setItems((current) => {
      const index = current.findIndex((candidate) => candidate.id === item.id);
      const next = current.filter((candidate) => candidate.id !== item.id);
      setSelectedId(next[Math.min(Math.max(index, 0), next.length - 1)]?.id);
      return next;
    });
    setAnnouncement(`${item.title} — ${verb.toLocaleLowerCase()} action complete.`);
  }

  useShortcuts({
    keys: {
      j: () => moveSelection(1),
      k: () => moveSelection(-1),
      e: () => {
        if (selected?.informational) resolveItem(selected, "Handle");
      },
      enter: () => {
        if (selected) resolveItem(selected);
      },
    },
  });

  const columns: TableColumn<ManagerQueueItem>[] = [
    {
      key: "waiting",
      header: "Waiting",
      width: "104px",
      render: (item) => (
        <div>
          <Text variant="numeric-medium" className="text-text-primary">
            {item.waitingDays} {item.waitingDays === 1 ? "day" : "days"}
          </Text>
          <Text variant="small" className="text-text-secondary">
            {item.waitingSince}
          </Text>
        </div>
      ),
    },
    {
      key: "item",
      header: "Needs your action",
      render: (item) => (
        <div className="py-2">
          <Text variant="body-medium" className="text-text-primary">
            {item.title}
          </Text>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge>{item.source}</Badge>
            <Text variant="small" className="text-text-secondary">
              {item.subject}
            </Text>
          </div>
          {item.escalated ? (
            <InlineAlert tone="attention" className="mt-2">
              Escalated · {item.context}
            </InlineAlert>
          ) : (
            <Text variant="small" className="mt-1 text-text-secondary">
              {item.context}
            </Text>
          )}
        </div>
      ),
    },
    {
      key: "action",
      header: "Action",
      align: "right",
      width: "104px",
      render: (item) => (
        <span onClick={(event) => event.stopPropagation()}>
          <Button size="sm" onClick={() => resolveItem(item)}>
            {item.actionLabel}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Manager Dashboard"
        subtitle="Current obligations across your team"
        actions={
          <ToggleGroup<QueueMode>
            label="Prototype queue state"
            value={mode}
            onChange={(next) => {
              setMode(next);
              if (next === "active") setSelectedId(items[0]?.id);
            }}
            options={[
              { value: "active", label: "Queue" },
              { value: "clear", label: "Clear" },
            ]}
          />
        }
      />
      <Content>
        <div className="grid gap-6 py-6 xl:grid-cols-3">
          <Card
            title="Needs Your Action"
            action={<Badge intensity="solid">{visibleItems.length}</Badge>}
            className="min-w-0 xl:col-span-2"
          >
            <div className="mb-4 flex flex-wrap items-center gap-3">
              {counts.map(({ kind, count }) => (
                <div key={kind} className="flex items-center gap-2">
                  <Text variant="small" className="text-text-secondary">
                    {kind}s
                  </Text>
                  <Badge intensity="solid">{count}</Badge>
                </div>
              ))}
              <Text variant="small" className="text-text-tertiary">
                Oldest first across every source
              </Text>
            </div>

            {announcement ? (
              <InlineAlert tone="success" className="mb-4">
                {announcement}
              </InlineAlert>
            ) : null}

            <Table
              columns={columns}
              rows={visibleItems}
              rowKey={(item) => item.id}
              selectedRowKey={selectedId}
              onRowClick={(item) => setSelectedId(item.id)}
              emptyState={
                <div className="rounded-md border border-border-default bg-bg-subtle px-4 py-8 text-center">
                  <Text variant="h3" className="text-text-primary">
                    Nothing waiting on you.
                  </Text>
                  <Text variant="body" className="mt-1 text-text-secondary">
                    Your team overview is still here when you need it.
                  </Text>
                </div>
              }
            />
          </Card>

          <div className="min-w-0">
            <div className="mb-3 lg:hidden">
              <Button
                variant="secondary"
                onClick={() => setShowGlance((current) => !current)}
                aria-expanded={showGlance}
              >
                {showGlance ? "Hide team overview" : "Show team overview"}
              </Button>
            </div>
            <section
              aria-labelledby="team-at-a-glance"
              className={cx(showGlance ? "block" : "hidden", "lg:block")}
            >
              <div className="mb-3 flex items-center justify-between">
                <Text id="team-at-a-glance" variant="h2" className="text-text-primary">
                  Team at a Glance
                </Text>
                <Badge>9 reports</Badge>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                <Card title="Utilization">
                  <Stat
                    label="Current week"
                    value="74%"
                    denominator="of 9 reports"
                    scale="numeric-lg"
                    delta={{ text: "1% below target 75%", tone: "attention" }}
                  />
                </Card>
                <Card title="Skill coverage">
                  <Stat
                    label="Critical skills covered"
                    value="7 / 9"
                    denominator="roles"
                    scale="numeric-lg"
                  />
                </Card>
                <Card title="Pulse sentiment">
                  <Stat
                    label="Current pulse"
                    value=""
                    suppressedReason="Suppressed · 6 responses, threshold is 8"
                  />
                </Card>
                <Card title="Probation reviews">
                  <Stat
                    label="Due in the next 30 days"
                    value="2"
                    denominator="reviews"
                    scale="numeric-lg"
                  />
                  <Text variant="small" className="mt-2 text-text-secondary">
                    Zara Hussain · Aug 18<br />Mateo Silva · Sep 2
                  </Text>
                </Card>
              </div>
            </section>
          </div>
        </div>
      </Content>
    </>
  );
}
