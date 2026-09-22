"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  createGraphClient,
  listCachedWorkspaces,
  type GraphClient,
  type SyncState,
} from "@vulto/graph";
import { authClient, apiOrigin } from "../lib/auth-client";

type Ready = {
  client: GraphClient;
  workspaceId: string;
  userId: string;
};

export type ShellBootstrap = Ready & {
  state: SyncState;
  workspaceName: string;
  /** Repeats the entire session and workspace resolution, including a fresh client. */
  retry(): void;
};

const ShellBootstrapContext = createContext<ShellBootstrap | null>(null);

export function useShellBootstrap(): ShellBootstrap {
  const value = useContext(ShellBootstrapContext);
  if (!value) throw new Error("Shell bootstrap is not ready");
  return value;
}

function hasServerAnswer(error: unknown): boolean {
  return (
    error == null ||
    (typeof error === "object" && "status" in error && typeof error.status === "number")
  );
}

async function soleActiveWorkspace(): Promise<string | null> {
  const response = await fetch(`${apiOrigin}/workspace/list-active-memberships`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok)
    throw Object.assign(new Error("Workspace list unavailable"), {
      status: response.status,
    });
  const memberships = (await response.json()) as {
    workspaceId: string;
    workspaceName: string;
  }[];
  return memberships.length === 1 ? memberships[0]!.workspaceId : null;
}

async function activateSoleWorkspace(workspaceId: string): Promise<boolean> {
  const response = await fetch(`${apiOrigin}/workspace/activate-sole-membership`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok)
    throw Object.assign(new Error("Workspace activation unavailable"), {
      status: response.status,
    });
  const result = (await response.json()) as { workspaceId: string | null };
  return result.workspaceId === workspaceId;
}

export function ShellBootstrapProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data, error, isPending, refetch } = authClient.useSession();
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState<Ready | null>(null);
  const [state, setState] = useState<SyncState | null>(null);
  const refused = useRef(false);
  const retryPhase = useRef<"idle" | "refreshing" | "boot">("idle");
  const [workspaceName, setWorkspaceName] = useState("Workspace");
  const [holding, setHolding] = useState(false);
  const userId = data?.user.id;
  const activeOrganizationId = (
    data?.session as { activeOrganizationId?: string | null } | undefined
  )?.activeOrganizationId;
  const sessionDecision = userId
    ? "session"
    : hasServerAnswer(error)
      ? "confirmed-no-session"
      : "network-unanswered";

  useEffect(() => {
    if (isPending) return;
    // A session accepted earlier can be refused after Better Auth refreshes its
    // own snapshot. Keep the refused shell mounted until the person retries.
    if (retryPhase.current === "refreshing") return;
    if (refused.current && retryPhase.current !== "boot") return;
    retryPhase.current = "idle";
    let cancelled = false;
    let unsubscribeState: (() => void) | undefined;
    let unsubscribeWorkspace: (() => void) | undefined;
    setReady(null);
    setState(null);
    setHolding(false);
    setWorkspaceName("Workspace");

    async function boot() {
      try {
        let selected: { workspaceId: string; userId: string } | null = null;
        if (!userId) {
          if (sessionDecision === "confirmed-no-session") {
            router.replace("/sign-in");
            return;
          }
          const cached = await listCachedWorkspaces();
          if (cached.length === 1) selected = cached[0]!;
        } else if (activeOrganizationId) {
          selected = { workspaceId: activeOrganizationId, userId };
        } else {
          try {
            const workspaceId = await soleActiveWorkspace();
            if (workspaceId && (await activateSoleWorkspace(workspaceId)))
              selected = { workspaceId, userId };
          } catch (cause) {
            if (hasServerAnswer(cause)) throw cause;
            const cached = await listCachedWorkspaces(userId);
            if (cached.length === 1) selected = cached[0]!;
          }
        }
        if (!selected) {
          if (!cancelled) setHolding(true);
          return;
        }
        const { workspaceId, userId: selectedUserId } = selected;
        const client = await createGraphClient({
          workspaceId,
          userId: selectedUserId,
          apiOrigin,
        });
        if (cancelled) return;
        unsubscribeState = client.syncStatus.subscribe((next) => {
          refused.current = Boolean(next.refusal);
          setState(next);
        });
        unsubscribeWorkspace = client.subscribe(
          {
            kind: "node-get",
            nodeId: workspaceId,
            nodeType: "Workspace",
            includeSoftDeleted: false,
          },
          (outcome) => {
            if (outcome.result.kind !== "node-get") return;
            const name = outcome.result.node?.record["name"];
            if (typeof name === "string") setWorkspaceName(name);
          },
        );
        setReady({ client, workspaceId, userId: selectedUserId });
      } catch {
        if (!cancelled) setHolding(true);
      }
    }
    void boot();
    return () => {
      cancelled = true;
      unsubscribeState?.();
      unsubscribeWorkspace?.();
    };
  }, [activeOrganizationId, attempt, isPending, router, sessionDecision, userId]);

  if (ready && state) {
    return (
      <ShellBootstrapContext.Provider
        value={{
          ...ready,
          state,
          workspaceName,
          retry: () => {
            retryPhase.current = "refreshing";
            void refetch().then(
              () => {
                retryPhase.current = "boot";
                setAttempt((value) => value + 1);
              },
              () => {
                retryPhase.current = "boot";
                setAttempt((value) => value + 1);
              },
            );
          },
        }}
      >
        {children}
      </ShellBootstrapContext.Provider>
    );
  }
  if (holding) return <p>Connect to select a workspace.</p>;
  return <p>Opening your workspace…</p>;
}
