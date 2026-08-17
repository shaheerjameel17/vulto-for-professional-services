"use client";

import { createLocalGraphClient, type LocalGraphClient } from "@vulto/graph";
import { Button, Card, Icon, Text } from "@vulto/ui";
import { Lock } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { apiOrigin } from "../../lib/auth-client";

type GateState = "checking" | "locked" | "unlocked" | "denied";

/**
 * VPS-D004's locked shell: renders full-bleed and centered, before any
 * other shell content mounts, whenever this Worker instance has not
 * completed a sealed-store unlock. A fresh page load always starts here —
 * there is no carry-over from a previous tab or a previous Worker
 * instance, by design (A003-T04 / F106).
 */
export function LockedShellGate({
  workspaceId,
  client: providedClient,
  children,
}: {
  workspaceId: string;
  /** Injects an existing client (e.g. one a diagnostics harness also drives directly) instead of creating a private one. */
  client?: LocalGraphClient;
  children: ReactNode;
}) {
  const [state, setState] = useState<GateState>("checking");
  const [offline, setOffline] = useState(
    () => typeof navigator !== "undefined" && !navigator.onLine,
  );
  const clientRef = useRef<LocalGraphClient | null>(null);

  useEffect(() => {
    const client = providedClient ?? createLocalGraphClient(workspaceId);
    clientRef.current = client;
    let mounted = true;

    void client
      .getSealedStoreStatus()
      .then(({ locked }) => {
        if (mounted) setState(locked ? "locked" : "unlocked");
      })
      .catch(() => {
        if (mounted) setState("locked");
      });

    return () => {
      mounted = false;
      if (!providedClient) void client.dispose();
    };
  }, [workspaceId, providedClient]);

  useEffect(() => {
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  async function retry() {
    const client = clientRef.current;
    if (!client) return;
    setState("checking");
    try {
      await client.unlockSealedStore(apiOrigin);
      setState("unlocked");
    } catch {
      setState(navigator.onLine ? "denied" : "locked");
    }
  }

  if (state === "unlocked") return <>{children}</>;

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-bg-subtle px-4 py-8"
      data-testid="locked-shell"
    >
      <Card className="w-full max-w-md text-center">
        <div className="flex flex-col items-center gap-4">
          <Icon icon={Lock} size={24} label="Locked" className="text-text-secondary" />
          <Text variant="h3" className="text-text-primary">
            Vulto is locked
          </Text>
          <Text variant="body" className="text-text-secondary">
            {state === "denied"
              ? "The server did not authorize this device. Sign in again to continue."
              : "Every restart requires the server to confirm your session before your local data can open."}
          </Text>
          {offline ? (
            <Text
              variant="small"
              className="text-text-secondary"
              data-testid="locked-shell-offline"
            >
              You appear to be offline. Reconnect to unlock.
            </Text>
          ) : null}
          <Button onClick={() => void retry()} loading={state === "checking"}>
            Retry
          </Button>
        </div>
      </Card>
    </main>
  );
}
