"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Clock, TrendingDown, UserRound } from "lucide-react";
import { notificationListForUserQuery, type CacheQueryResult } from "@vulto/graph";
import {
  Button,
  InboxRow,
  InlineAlert,
  PageHeader,
  Section,
  Skeleton,
  Text,
  useShortcuts,
} from "@vulto/ui";
import { useShellBootstrap } from "../../../components/shell-bootstrap";
import { usePanel } from "../../../components/panel-context";

type Groups = Extract<CacheQueryResult, { name: "notification.listForUser" }>["data"];
const relativeTime = (date: string) => {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(date).getTime()) / 60000),
  );
  return minutes < 1
    ? "Just now"
    : minutes < 60
      ? `${minutes}m ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : `${Math.floor(minutes / 1440)}d ago`;
};

export default function Page() {
  const { client, state } = useShellBootstrap();
  const { panel, paletteOpen } = usePanel();
  const router = useRouter();
  const [groups, setGroups] = useState<Groups | null>(null);
  const [selected, setSelected] = useState(0);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const pending = useRef(new Map<string, string>());
  useEffect(
    () =>
      client.subscribe(notificationListForUserQuery(), ({ result }) => {
        if (
          result.kind === "device-query" &&
          result.name === "notification.listForUser"
        )
          setGroups(result.data);
      }),
    [client],
  );
  useEffect(() => {
    for (const rejected of state.attention) {
      const id = pending.current.get(rejected.mutationId);
      if (id) {
        setFailures((previous) => ({ ...previous, [id]: rejected.reason }));
        pending.current.delete(rejected.mutationId);
      }
    }
  }, [state.attention]);
  const rows = groups ? [...groups.needsYou, ...groups.today, ...groups.earlier] : [];
  async function act(name: string, id = "all") {
    setFailures((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
    try {
      const outcome = await client.mutate(
        name,
        id === "all" ? {} : { notification_id: id },
      );
      if (outcome.accepted) pending.current.set(outcome.mutationId, id);
      else setFailures((previous) => ({ ...previous, [id]: outcome.reason }));
    } catch {
      setFailures((previous) => ({
        ...previous,
        [id]: "The action could not be queued. Try again.",
      }));
    }
  }
  const current = rows[Math.min(selected, rows.length - 1)];
  function openCurrent() {
    if (!current) return;
    if (current.record["source_node_type"] === "Employee")
      router.push(`/people/${String(current.record["source_node_id"])}`);
    else void act("notification.markRead", current.nodeId);
  }
  useShortcuts({
    enabled: !paletteOpen && !panel && !state.refusal,
    keys: {
      j: () => setSelected((value) => Math.min(value + 1, rows.length - 1)),
      k: () => setSelected((value) => Math.max(0, value - 1)),
      enter: openCurrent,
      e: () => {
        if (current) void act("notification.dismiss", current.nodeId);
      },
    },
    onEscape: () => router.back(),
  });
  return (
    <>
      <PageHeader
        title="Inbox"
        headingLevel={1}
        actions={
          <Button variant="ghost" onClick={() => void act("notification.markAllRead")}>
            Mark all read
          </Button>
        }
      />
      <main
        className="scrollbar-slim flex-1 overflow-y-auto px-4 pb-6"
        aria-label="Inbox"
      >
        {state.status === "Offline" ? (
          <InlineAlert tone="attention">
            Offline. Actions are queued and will sync when you reconnect.
          </InlineAlert>
        ) : null}
        {failures["all"] ? (
          <InlineAlert tone="danger">{failures["all"]}</InlineAlert>
        ) : null}
        {!groups || (state.status === "Syncing" && rows.length === 0) ? (
          <div className="space-y-4 py-6">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : rows.length === 0 ? (
          <Text variant="body" className="block py-8 text-text-secondary">
            Nothing needs you right now.
          </Text>
        ) : (
          (
            [
              ["Needs you", groups.needsYou],
              ["Today", groups.today],
              ["Earlier", groups.earlier],
            ] as const
          ).map(([title, items]) =>
            items.length ? (
              <Section key={title} title={title}>
                {items.map((row) => (
                  <InboxRow
                    key={row.nodeId}
                    id={row.nodeId}
                    message={String(row.record["message"])}
                    time={relativeTime(String(row.record["created_at"]))}
                    unread={row.record["read_at"] === null}
                    selected={rows.indexOf(row) === selected}
                    onFocus={() => setSelected(rows.indexOf(row))}
                    icon={
                      row.record["source_node_type"] === "Employee"
                        ? UserRound
                        : row.record["source_node_type"] === "TimesheetAnomalyFlag"
                          ? Clock
                          : row.record["source_node_type"] === "RevenueGapAlert"
                            ? TrendingDown
                            : Bell
                    }
                    failure={failures[row.nodeId]}
                    onRead={() => void act("notification.markRead", row.nodeId)}
                    onDismiss={() => void act("notification.dismiss", row.nodeId)}
                    {...(row.record["source_node_type"] === "Employee"
                      ? {
                          onOpen: () =>
                            router.push(
                              `/people/${String(row.record["source_node_id"])}`,
                            ),
                        }
                      : {})}
                  />
                ))}
              </Section>
            ) : null,
          )
        )}
      </main>
    </>
  );
}
