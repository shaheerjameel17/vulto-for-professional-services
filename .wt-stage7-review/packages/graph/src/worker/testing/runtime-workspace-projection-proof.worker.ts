import type { WorkspaceRole } from "@vulto/schema";
import { LoroDoc, LoroMap } from "loro-crdt/web";
import initializeLoro from "loro-crdt/web/loro_wasm.js";
import { parseGraphQuery } from "../../query";
import { LocalGraphWorkerRuntime } from "../runtime";
import { acceptProjectionGrant, acceptTransitionGrant } from "../workspace-projection";
import {
  buildWorkspaceAdmissionDelta,
  projectMembershipRevocation,
  projectMembershipRoleChange,
} from "../workspace-projection-delta";
import { runWorkspaceProjection } from "../workspace-projection-runner";

/**
 * FDN-85 Stage 4 — the workspace/membership projection, proven end to end in
 * real Chromium against the real `LocalGraphWorkerRuntime`, the real FDN-84
 * sealed store, real Loro + SQLite WASM. The server flow (register device,
 * create workspace, consume grant, confirm) is driven from the spec with real
 * cookies; this Worker runs the sealed-store side.
 *
 * Test-only, same status as the FDN-92 proof Workers: it constructs the
 * runtime directly rather than going through the production protocol, so the
 * application surface gains nothing.
 */

interface WorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
}
const scope = self as unknown as WorkerScope;

interface ConsumedGrant {
  workspaceId: string;
  membershipId: string;
  userId: string;
  deviceId: string;
  roles: WorkspaceRole[];
  membershipOfEdgeId: string;
  membershipInEdgeId: string;
}

type Request =
  | { kind: "device-id" }
  | {
      kind: "run-founding";
      consumed: ConsumedGrant;
      serverHalf: string;
      keyEpoch: number;
      workspaceName: string;
      occurredAt: string;
    }
  | {
      kind: "founding-then-ordinary-mutate";
      consumed: ConsumedGrant;
      serverHalf: string;
      keyEpoch: number;
      workspaceName: string;
      occurredAt: string;
    }
  | {
      kind: "run-transition";
      transitionKind: "revocation" | "role-change";
      workspaceId: string;
      membershipId: string;
      roles: WorkspaceRole[];
      actorUserId: string;
      apiOrigin: string;
      occurredAt: string;
    }
  | { kind: "query-membership"; workspaceId: string; apiOrigin: string };

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

async function deviceId(): Promise<string> {
  const runtime = new LocalGraphWorkerRuntime();
  try {
    return await runtime.deviceIdForDiagnostics();
  } finally {
    await runtime.dispose().catch(() => undefined);
  }
}

/** After the founding projection, an ordinary mutate through the SAME
 * projection-only instance must be denied exactly as for a no-grant caller. */
async function foundingThenOrdinaryMutate(
  request: Extract<Request, { kind: "founding-then-ordinary-mutate" }>,
): Promise<{ projectionCommitted: boolean; ordinaryMutateStatus: string }> {
  await initializeLoro();
  const runtime = new LocalGraphWorkerRuntime();
  try {
    await runtime.unlockSealedStoreForProjection({
      workspaceId: request.consumed.workspaceId,
      deviceId: request.consumed.deviceId,
      serverHalf: request.serverHalf,
      keyEpoch: request.keyEpoch,
      membershipId: request.consumed.membershipId,
      roles: request.consumed.roles,
    });
    await runtime.initialize(request.consumed.workspaceId);

    const delta = buildWorkspaceAdmissionDelta(
      acceptProjectionGrant({
        workspaceId: request.consumed.workspaceId,
        membershipId: request.consumed.membershipId,
        userId: request.consumed.userId,
        roles: request.consumed.roles,
        membershipOfEdgeId: request.consumed.membershipOfEdgeId,
        membershipInEdgeId: request.consumed.membershipInEdgeId,
      }),
      {
        workspaceName: request.workspaceName,
        actorUserId: request.consumed.userId,
        occurredAt: request.occurredAt,
      },
    );
    await runtime.commitPrivilegedProjection(bufferOf(delta));

    // Now try an ordinary node-fragment mutate through the surviving handle.
    const scratchNode = buildScratchEmployeeNode(request.consumed.workspaceId);
    const outcome = await runtime.mutate([bufferOf(scratchNode)]);
    return {
      projectionCommitted: true,
      ordinaryMutateStatus: outcome.status,
    };
  } finally {
    await runtime.dispose();
  }
}

function buildScratchEmployeeNode(workspaceId: string): Uint8Array {
  // A minimal, well-formed Employee/operational node-fragment delta — the kind
  // an ordinary mutate would carry. Its content does not matter; the point is
  // the projection-only instance refuses it before looking.
  const empId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const document = new LoroDoc();
  const fragment = document
    .getMap("__vulto_node_fragments")
    .setContainer(`${empId}:operational`, new LoroMap());
  for (const [k, v] of Object.entries({
    node_id: empId,
    node_type: "Employee",
    schema_version: 1,
    lifecycle_status: "Active",
    workspace_id: workspaceId,
    created_at: "2026-02-01T00:00:00.000Z",
    created_by: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    updated_at: "2026-02-01T00:00:00.000Z",
    updated_by: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
  })) {
    fragment.set(k, v);
  }
  document.commit();
  const bytes = document.export({ mode: "snapshot" });
  document.free();
  return bytes;
}

async function runTransition(
  request: Extract<Request, { kind: "run-transition" }>,
): Promise<{ committed: boolean }> {
  await initializeLoro();
  const runtime = new LocalGraphWorkerRuntime();
  try {
    await runtime.unlockSealedStore(request.workspaceId, request.apiOrigin);
    await runtime.initialize(request.workspaceId);
    const grant = acceptTransitionGrant({
      kind: request.transitionKind,
      workspaceId: request.workspaceId,
      membershipId: request.membershipId,
      roles: request.roles,
    });
    const details = {
      workspaceName: "",
      actorUserId: request.actorUserId,
      occurredAt: request.occurredAt,
    };
    const projection =
      request.transitionKind === "revocation"
        ? projectMembershipRevocation(grant, details)
        : projectMembershipRoleChange(grant, details);
    await runtime.commitPrivilegedProjection(bufferOf(projection.delta));
    return { committed: true };
  } finally {
    await runtime.dispose();
  }
}

async function queryMembership(
  request: Extract<Request, { kind: "query-membership" }>,
): Promise<{
  membershipLifecycle: string | null;
  membershipRole: string | null;
  membershipOfTo: string | null;
  membershipInTo: string | null;
}> {
  await initializeLoro();
  const runtime = new LocalGraphWorkerRuntime();
  try {
    await runtime.unlockSealedStore(request.workspaceId, request.apiOrigin);
    await runtime.initialize(request.workspaceId);
    const index = runtime.materializedIndexForDiagnostics;
    if (index === null) throw new Error("no index");
    const nodes = await index.execute(
      parseGraphQuery({
        kind: "node-list",
        nodeType: "WorkspaceMembership",
        limit: 50,
      }),
    );
    if (nodes.kind !== "node-list") throw new Error("unexpected");
    const wm = nodes.nodes[0];
    const record =
      wm?.fragments.find((f) => f.partitionKey === "record")?.record ?? null;

    const asOf = "2026-06-01T00:00:00.000Z";
    async function edgeTo(
      edgeType: string,
      fromType: string,
      toType: string,
      start: string,
    ): Promise<string | null> {
      const result = await index!.execute(
        parseGraphQuery({
          kind: "edge-neighbors",
          startNodeId: start,
          direction: "outgoing",
          asOf,
          edgeType,
          fromNodeType: fromType,
          toNodeType: toType,
          limit: 5,
        }),
      );
      return result.kind === "edge-neighbors"
        ? (result.neighbors[0]?.node.nodeId ?? null)
        : null;
    }
    const wmId = (record as { node_id?: string } | null)?.node_id ?? "";
    return {
      membershipLifecycle:
        (record as { lifecycle_status?: string } | null)?.lifecycle_status ?? null,
      membershipRole: (record as { role?: string } | null)?.role ?? null,
      membershipOfTo: wmId
        ? await edgeTo("membership_of", "WorkspaceMembership", "User", wmId)
        : null,
      membershipInTo: wmId
        ? await edgeTo("membership_in", "WorkspaceMembership", "Workspace", wmId)
        : null,
    };
  } finally {
    await runtime.dispose();
  }
}

async function dispatch(request: Request): Promise<unknown> {
  switch (request.kind) {
    case "device-id":
      return { deviceId: await deviceId() };
    case "run-founding":
      return runWorkspaceProjection(
        {
          kind: "admission",
          workspaceId: request.consumed.workspaceId,
          membershipId: request.consumed.membershipId,
          deviceId: request.consumed.deviceId,
          roles: request.consumed.roles,
          userId: request.consumed.userId,
          membershipOfEdgeId: request.consumed.membershipOfEdgeId,
          membershipInEdgeId: request.consumed.membershipInEdgeId,
          serverHalf: request.serverHalf,
          keyEpoch: request.keyEpoch,
        },
        {
          workspaceName: request.workspaceName,
          actorUserId: request.consumed.userId,
          occurredAt: request.occurredAt,
        },
      );
    case "founding-then-ordinary-mutate":
      return foundingThenOrdinaryMutate(request);
    case "run-transition":
      return runTransition(request);
    case "query-membership":
      return queryMembership(request);
  }
}

scope.onmessage = (event: MessageEvent<unknown>) => {
  void dispatch(event.data as Request)
    .then((result) => scope.postMessage({ ok: true, result }))
    .catch((error: unknown) =>
      scope.postMessage({
        ok: false,
        error:
          error instanceof Error ? error.message : "Unknown projection proof failure",
      }),
    );
};
