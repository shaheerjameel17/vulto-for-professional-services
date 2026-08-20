import { workspaceRoleSchema, type WorkspaceRole } from "@vulto/schema";
import { z } from "zod";

/**
 * FDN-53 stage 1 (F127). The Worker-side client for the lightweight
 * `POST /device-store/roles` checkpoint (`services/api/src/auth/device-unlock.ts`'s
 * `requestDeviceRoleRefresh`), which revalidates the current session via
 * `requireCurrentWorkspaceSession` and returns the caller's current roles
 * without releasing a server-half or deriving a key. Used both by the
 * explicit `refresh-role` protocol message and by the placeholder polling
 * loop in `runtime.ts`.
 */

const roleRefreshResponseSchema = z
  .object({
    roles: z.array(workspaceRoleSchema).min(1),
    membershipId: z.string().min(1),
  })
  .strict();

export interface RoleRefreshResult {
  readonly roles: WorkspaceRole[];
  readonly membershipId: string;
}

/**
 * F151. The two, and only two, positive revocation events this project's
 * specs name — see `services/api/src/auth/device-unlock.ts`'s
 * `DeviceRoleRefreshDenialReason`, which this mirrors exactly. Anything the
 * server did not explicitly classify arrives as `undefined`, which
 * `LocalGraphWorkerRuntime#endLocalSession` treats as lock-only, never
 * erase-eligible — the same conservative default F148 proved correct.
 */
export type RoleRefreshDenialReason = "device-revoked" | "membership-revoked";

/** Non-enumerating, matching the unlock endpoint's own denial shape. */
export class RoleRefreshDeniedError extends Error {
  constructor(readonly reason?: RoleRefreshDenialReason) {
    super("The server denied this device's role refresh request");
  }
}

/**
 * F148. The checkpoint could not be reached or could not answer — offline,
 * a 5xx, a rate limit, a gateway timeout, a malformed body.
 *
 * Deliberately NOT a subclass of `RoleRefreshDeniedError`, because the whole
 * defect this closes was the two being the same thing. `refreshRoleOnline`
 * locks the sealed store on a denial; this must never reach that branch.
 */
export class RoleRefreshUnavailableError extends Error {
  constructor(readonly detail: string) {
    super(`The role refresh checkpoint is unavailable: ${detail}`);
  }
}

/**
 * F148 (S4). Only an authoritative denial is a denial.
 *
 * The founder ruling this encodes: a server error must not lock the device.
 * Timeouts, 500-series responses, rate limits and network failures are
 * "temporarily unable to reach the server, try again," never a security
 * event. Only `401` and `403` — the server explicitly answering about THIS
 * device's authorization — may lock the local store.
 *
 * Before this, one line (`if (!response.ok) throw new RoleRefreshDeniedError()`)
 * turned every non-2xx into a revocation: a 502 locked a fully authorized
 * user out of their own local data for the session, silently discarded any
 * write still inside the flush window (F144), and could not recover on its
 * own, because locking stops the very poll that would notice the server had
 * come back.
 *
 * The accepted consequence, stated rather than discovered later: while the
 * server is erroring, this device's roles go stale and stay stale. That is
 * the same position an offline device is already in, bounded the same way —
 * resolved on the next answer the server is actually able to give.
 */
/**
 * F151. Reads the classified `revocation.kind` field a 401/403 body may
 * carry — see `services/api/src/auth/device-unlock.ts`'s
 * `DeviceRoleRefreshDenialReason`, which this mirrors exactly. A malformed,
 * empty, or unreadable body must never throw here: it just means no reason
 * was recovered, which is `undefined`, the same conservative default an
 * unclassified denial already used before this existed.
 */
function parseRevocationReason(body: unknown): RoleRefreshDenialReason | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const revocation = (body as { revocation?: unknown }).revocation;
  if (typeof revocation !== "object" || revocation === null) return undefined;
  const kind = (revocation as { kind?: unknown }).kind;
  return kind === "device-revoked" || kind === "membership-revoked" ? kind : undefined;
}

/**
 * F151. `deviceId` is optional only for backward compatibility;
 * `LocalGraphWorkerRuntime` always supplies it. Without it the server can
 * still classify a `membership-revoked` denial, but never `device-revoked`
 * — it has no device to check against.
 */
export async function fetchCurrentRoles(
  apiOrigin: string,
  workspaceId: string,
  deviceId?: string,
): Promise<RoleRefreshResult> {
  let response: Response;
  try {
    response = await fetch(`${apiOrigin}/device-store/roles`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        ...(deviceId !== undefined ? { deviceId } : {}),
      }),
    });
  } catch (error: unknown) {
    // Transport failure: offline, DNS, TLS, connection reset. The server
    // said nothing, so nothing about this device's authorization is known.
    throw new RoleRefreshUnavailableError(
      error instanceof Error ? error.message : "the request could not be sent",
    );
  }

  // The only two answers that are ABOUT this device's authorization.
  if (response.status === 401 || response.status === 403) {
    const reason = parseRevocationReason(await response.json().catch(() => undefined));
    throw new RoleRefreshDeniedError(reason);
  }
  if (!response.ok) {
    throw new RoleRefreshUnavailableError(`the server answered ${response.status}`);
  }

  try {
    const parsed = roleRefreshResponseSchema.parse(await response.json());
    return { roles: parsed.roles, membershipId: parsed.membershipId };
  } catch (error: unknown) {
    // A 2xx this build cannot read is a broken checkpoint, not a ruling on
    // this device. Failing it closed would lock a user out over a response
    // shape, which is exactly the confusion this function now avoids.
    throw new RoleRefreshUnavailableError(
      error instanceof Error ? error.message : "the response could not be read",
    );
  }
}
