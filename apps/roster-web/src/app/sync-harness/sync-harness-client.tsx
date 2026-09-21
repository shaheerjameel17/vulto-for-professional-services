"use client";

import { createGraphClient, type GraphClient, type SyncState } from "@vulto/graph";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

declare global {
  interface Window {
    __vultoSync?: { client: GraphClient };
  }
}

/** Creates the client and shows its status; Playwright drives `window.__vultoSync`. */
export function SyncHarnessClient() {
  const params = useSearchParams();
  const workspaceId = params.get("workspaceId");
  const userId = params.get("userId");
  const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? "https://localhost:3121";
  const [state, setState] = useState<SyncState | null>(null);
  const [workerKind, setWorkerKind] = useState<string>("starting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId || !userId) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    createGraphClient({ workspaceId, userId, apiOrigin })
      .then((client) => {
        if (cancelled) return;
        window.__vultoSync = { client };
        setWorkerKind(client.workerKind);
        unsubscribe = client.syncStatus.subscribe(setState);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [workspaceId, userId, apiOrigin]);

  return (
    <div>
      <p data-testid="worker-kind">{workerKind}</p>
      <p data-testid="sync-status">
        {state
          ? state.signedOut
            ? `signed-out:${state.reason}`
            : state.status
          : "starting"}
      </p>
      <p data-testid="sync-attention">
        {state ? JSON.stringify(state.attention) : "[]"}
      </p>
      {error ? <p data-testid="sync-error">{error}</p> : null}
    </div>
  );
}
