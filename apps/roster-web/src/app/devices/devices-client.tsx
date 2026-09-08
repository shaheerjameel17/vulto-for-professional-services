"use client";

import {
  Badge,
  Button,
  Dialog,
  InlineAlert,
  PageHeader,
  Skeleton,
  Table,
  Text,
  type TableColumn,
} from "@vulto/ui";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiOrigin, authClient } from "../../lib/auth-client";

/**
 * `VPS-F001`'s Devices screen (FDN-63 Stage 6).
 *
 * Built as a standalone session-gated route rather than inside the
 * application shell, which is still the fixture prototype — recorded as F190
 * so the deviation reads as the founder's call rather than drift.
 *
 * **Two revoking actions, not one, and the distinction is the whole point
 * (F191).** A workspace Owner's *Revoke* removes this device's access to
 * THIS workspace. A person's *Retire* removes their own device's access
 * everywhere. They are separately authorized, they have different blast
 * radii, and each carries Modal copy naming its own consequence — because
 * the one thing a confirmation must never do is make two different actions
 * look like the same one.
 */

interface DeviceRow {
  deviceId: string;
  userId: string;
  deviceName: string;
  platform: string;
  application: string;
  registeredAt: string;
  lastActiveAt: string;
  revokedInWorkspace: boolean;
  retiredByOwner: boolean;
  isStale: boolean;
}

type PendingAction =
  | { kind: "revoke"; device: DeviceRow; stale: boolean }
  | { kind: "retire"; device: DeviceRow }
  | { kind: "re-approve"; device: DeviceRow };

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${apiOrigin}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Relative, because "22 days ago" is the fact an Owner is scanning for. */
function sinceLabel(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (Number.isNaN(days)) return "—";
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

function absoluteLabel(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

export function DevicesClient() {
  const params = useSearchParams();
  const workspaceId = params.get("workspaceId") ?? "";
  const { data: session, isPending: sessionPending } = authClient.useSession();

  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [viewerIsOwner, setViewerIsOwner] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setLoadError("This page needs a workspace. Add ?workspaceId= to the address.");
      return;
    }
    setLoadError(null);
    try {
      const response = await post("/devices/list", { workspaceId });
      if (!response.ok) {
        // Non-enumerating, exactly like the endpoint: this covers "no session",
        // "not a member" and "no such workspace" with one sentence.
        setLoadError("This workspace's devices are not available to you.");
        setDevices(null);
        return;
      }
      const body = (await response.json()) as {
        devices: DeviceRow[];
        viewerIsOwner: boolean;
      };
      setDevices(body.devices);
      // A rendering capability, not an authorization decision — every action
      // below is re-gated server-side regardless of what this says.
      setViewerIsOwner(body.viewerIsOwner);
    } catch {
      setLoadError("The device list could not be reached. Try again.");
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!sessionPending && session) void load();
  }, [sessionPending, session, load]);

  async function confirmPending() {
    if (!pending) return;
    setBusy(true);
    setActionError(null);
    try {
      const response =
        pending.kind === "revoke"
          ? await post("/device-store/revoke", {
              workspaceId,
              deviceId: pending.device.deviceId,
              ...(pending.stale ? { reason: "stale" } : {}),
            })
          : pending.kind === "retire"
            ? await post("/devices/retire", { deviceId: pending.device.deviceId })
            : await post("/devices/re-approve", {
                workspaceId,
                deviceId: pending.device.deviceId,
              });

      if (!response.ok) {
        setActionError(
          response.status === 409
            ? "This device's revocation is not reversible."
            : "That action was not permitted.",
        );
      } else {
        setPending(null);
      }
      await load();
    } catch {
      setActionError("The request could not be sent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sessionPending) {
    return <Skeleton className="h-32 w-full" />;
  }

  if (!session) {
    return (
      <InlineAlert
        tone="danger"
        action={
          <Button onClick={() => window.location.assign("/sign-in")}>Sign in</Button>
        }
      >
        Your session is not available.
      </InlineAlert>
    );
  }

  const columns: TableColumn<DeviceRow>[] = [
    {
      key: "deviceName",
      header: "Device",
      pinned: true,
      sortable: true,
      sortValue: (row) => row.deviceName,
      render: (row) => (
        <div className="flex items-center gap-2">
          <Text variant="body" className="text-text-primary">
            {row.deviceName}
          </Text>
          {row.userId === session.user.id ? <Badge tone="neutral">You</Badge> : null}
          {row.retiredByOwner ? (
            <Badge tone="danger">Retired</Badge>
          ) : row.revokedInWorkspace ? (
            <Badge tone="danger">Revoked here</Badge>
          ) : row.isStale ? (
            <Badge tone="attention">Inactive</Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: "platform",
      header: "Platform",
      // VPS-F001's responsive rule: Devices drops `registered`, then `platform`.
      hideBelow: "lg",
      render: (row) => (
        <Text variant="body" className="text-text-secondary">
          {row.platform}
        </Text>
      ),
    },
    {
      key: "application",
      header: "Application",
      render: (row) => (
        <Text variant="body" className="text-text-secondary">
          {row.application}
        </Text>
      ),
    },
    {
      key: "lastActiveAt",
      header: "Last active",
      sortable: true,
      sortValue: (row) => row.lastActiveAt,
      render: (row) => (
        <Text
          variant="body"
          className={row.isStale ? "text-attention" : "text-text-secondary"}
        >
          {sinceLabel(row.lastActiveAt)}
        </Text>
      ),
    },
    {
      key: "registeredAt",
      header: "Registered",
      hideBelow: "xl",
      render: (row) => (
        <Text variant="body" className="text-text-secondary">
          {absoluteLabel(row.registeredAt)}
        </Text>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "260px",
      render: (row) => (
        <div className="flex justify-end gap-2">
          {viewerIsOwner &&
          row.revokedInWorkspace &&
          !row.retiredByOwner &&
          row.isStale ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPending({ kind: "re-approve", device: row })}
            >
              Re-approve
            </Button>
          ) : null}
          {row.userId === session.user.id && !row.retiredByOwner ? (
            <Button
              size="sm"
              variant="danger"
              onClick={() => setPending({ kind: "retire", device: row })}
            >
              Retire everywhere
            </Button>
          ) : null}
          {viewerIsOwner && !row.revokedInWorkspace && !row.retiredByOwner ? (
            <Button
              size="sm"
              variant="danger"
              onClick={() =>
                setPending({ kind: "revoke", device: row, stale: row.isStale })
              }
            >
              Revoke
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Devices"
        subtitle="Every device that has opened this workspace."
      />

      {loadError ? <InlineAlert tone="danger">{loadError}</InlineAlert> : null}

      {devices === null && !loadError ? <Skeleton className="h-32 w-full" /> : null}

      {devices !== null ? (
        <div data-testid="devices-table" className="overflow-x-auto">
          {/*
           * `VPS-F001`: "Devices with one entry shows that entry, never an
           * empty state." No `emptyState` is passed, deliberately — a person
           * reading this page is on a device, so the list cannot be empty for
           * them, and a zero-row render here means something is wrong rather
           * than that there is nothing to show.
           */}
          <Table columns={columns} rows={devices} rowKey={(row) => row.deviceId} />
        </div>
      ) : null}

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setPending(null);
            setActionError(null);
          }
        }}
        title={
          pending?.kind === "retire"
            ? "Retire this device everywhere?"
            : pending?.kind === "re-approve"
              ? "Restore this device's access?"
              : "Revoke this device from this workspace?"
        }
        description={pending ? pending.device.deviceName : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setPending(null);
                setActionError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant={pending?.kind === "re-approve" ? "primary" : "danger"}
              confirming={pending?.kind !== "re-approve"}
              loading={busy}
              onClick={() => void confirmPending()}
            >
              {pending?.kind === "retire"
                ? "Retire everywhere"
                : pending?.kind === "re-approve"
                  ? "Restore access"
                  : "Revoke"}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          {/*
           * The two destructive actions get different copy because they do
           * different things (F191). Saying "this cannot be undone" for both
           * and leaving the reader to work out the scope is exactly how one
           * tenant ends up destroying another tenant's data by accident.
           */}
          {pending?.kind === "revoke" ? (
            <>
              <Text variant="body" className="text-text-primary">
                This removes the device&apos;s access to <strong>this workspace</strong>{" "}
                and erases its local copy of this workspace&apos;s data, within 60
                seconds of the device next reaching the server.
              </Text>
              <Text variant="small" className="text-text-secondary">
                Any other workspace this device holds is unaffected — you are not
                revoking the device itself, only its access here.
                {pending.stale
                  ? " This device has been inactive, so this revocation can be reversed here later."
                  : " This cannot be undone from this screen."}
              </Text>
            </>
          ) : null}

          {pending?.kind === "retire" ? (
            <>
              <Text variant="body" className="text-text-primary">
                This retires your device <strong>everywhere</strong> — every workspace
                it holds, not just this one — and erases its local data in all of them.
              </Text>
              <Text variant="small" className="text-text-secondary">
                Use this for a device you have lost or no longer trust. It cannot be
                undone: the device must register again from scratch.
              </Text>
            </>
          ) : null}

          {pending?.kind === "re-approve" ? (
            <Text variant="body" className="text-text-primary">
              This device was revoked for inactivity. Restoring access lets it unlock
              this workspace again the next time it connects.
            </Text>
          ) : null}

          {actionError ? <InlineAlert tone="danger">{actionError}</InlineAlert> : null}
        </div>
      </Dialog>
    </div>
  );
}
