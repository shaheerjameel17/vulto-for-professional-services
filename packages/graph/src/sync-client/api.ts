import {
  MIN_CLIENT_SCHEMA_VERSION,
  SCHEMA_VERSION_HEADER,
  WORKSPACE_HEADER,
} from "@vulto/schema";
import type { ProtectedItem } from "./protected-store";

/**
 * This client's schema version, sent as `x-vulto-schema-version` on EVERY
 * request to the API (A003-T71). A server that cannot tell a stale client from a
 * current one refuses the request, so no request may leave without it.
 */
export const CLIENT_SCHEMA_VERSION = Math.max(1, MIN_CLIENT_SCHEMA_VERSION);

export interface MutationEnvelope {
  readonly mutation_id: string;
  readonly name: string;
  readonly args: unknown;
}

export interface MutationOutcome {
  readonly mutation_id: string;
  readonly status: "applied" | "duplicate" | "rejected";
  readonly reason?: string;
  readonly result?: unknown;
}

export type ApiErrorKind =
  | "network"
  | "unauthenticated"
  | "client-outdated"
  /** The request named a workspace other than the session's active one; nothing was done. */
  | "workspace-mismatch"
  /** The server understood the request and refused it. */
  | "forbidden"
  /** The server said access is gone (`{ code: "access-revoked" }`). */
  | "access-revoked"
  | "server";

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClient {
  applyMutations(mutations: readonly MutationEnvelope[]): Promise<MutationOutcome[]>;
  protectedRead(nodeIds: readonly string[]): Promise<ProtectedItem[]>;
  registerDevice(deviceId: string, deviceName: string): Promise<void>;
}

export interface ApiClientOptions {
  readonly apiOrigin: string;
  /** Sent as `x-vulto-workspace-id` on every request: a claim the server checks, never authorization. */
  readonly workspaceId: string;
  readonly fetch?: typeof fetch;
}

/** The headers every API request carries. */
export function apiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    [SCHEMA_VERSION_HEADER]: String(CLIENT_SCHEMA_VERSION),
    ...extra,
  };
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const doFetch = options.fetch ?? fetch;

  async function call(path: string, body: unknown): Promise<Response> {
    try {
      return await doFetch(`${options.apiOrigin}${path}`, {
        method: "POST",
        headers: apiHeaders({ [WORKSPACE_HEADER]: options.workspaceId }),
        credentials: "include",
        body: JSON.stringify(body),
      });
    } catch {
      throw new ApiError("network", "The server could not be reached");
    }
  }

  async function trpc<T>(procedure: string, input: unknown): Promise<T> {
    const response = await call(`/trpc/${procedure}`, input);
    const payload = (await response.json().catch(() => null)) as {
      result?: { data: T };
      error?: { message?: string };
      code?: string;
    } | null;
    if (response.status === 401) {
      if (payload?.code === "access-revoked")
        throw new ApiError("access-revoked", "Access was revoked");
      throw new ApiError("unauthenticated", "The session is not valid");
    }
    if (response.status === 403) {
      if (payload?.error?.message === "workspace-mismatch")
        throw new ApiError(
          "workspace-mismatch",
          "This client is not in the session's workspace",
        );
      throw new ApiError("forbidden", "The server refused the request");
    }
    if (response.status === 412 && payload?.error?.message === "client-outdated") {
      throw new ApiError("client-outdated", "This client must reload");
    }
    if (!response.ok || !payload?.result)
      throw new ApiError("server", `The server answered ${response.status}`);
    return payload.result.data;
  }

  return {
    applyMutations: (mutations) =>
      trpc<MutationOutcome[]>("graph.applyMutations", { mutations }),
    protectedRead: (nodeIds) =>
      trpc<ProtectedItem[]>("protected.read", { node_ids: nodeIds }),
    async registerDevice(deviceId, deviceName) {
      const response = await call("/devices/register", {
        deviceId,
        deviceName,
        platform: "web",
      });
      if (response.status === 401)
        throw new ApiError("unauthenticated", "The session is not valid");
      if (response.status === 403)
        throw new ApiError(
          "workspace-mismatch",
          "This client is not in the session's workspace",
        );
      if (!response.ok)
        throw new ApiError("server", `Device registration answered ${response.status}`);
    },
  };
}
