import { createHash } from "node:crypto";
import {
  getMutationDefinition,
  type JsonValue,
  type MutationName,
} from "@vulto/schema";
import { and, eq } from "drizzle-orm";
import type { AudienceMaterializer } from "../audience/index.js";
import { audienceMaterializer } from "../audience/materializer.js";
import { db } from "../db.js";
import { graphMutations } from "../graph/schema.js";
import type { GraphTx } from "../graph/tx.js";
import { authorizeWrite, type InterceptorContext } from "../permission/interceptor.js";
import type { MemberPrincipal } from "../permission/principal.js";
import {
  closeEdgeMutation,
  createEdgeMutation,
  createNode,
  moveEmployee,
  softDeleteNodeMutation,
  transitionLifecycle,
  updateNodeFieldsMutation,
} from "./foundation.js";
import {
  employeeCreate,
  employeeLinkUser,
  employeeSetCompensation,
  employeeTransitionStatus,
  employeeUpdate,
} from "./employee.js";
import {
  employeeSetEntity,
  entityCreate,
  entityDeactivate,
  entityUpdate,
} from "./entity.js";
import { MutationRejection, type ServerMutation } from "./types.js";
import {
  calendarUpdate,
  holidayAdd,
  holidayCancel,
  holidayConfirm,
  patternClear,
  patternSet,
} from "./calendar.js";
import {
  assignmentCancel,
  assignmentClearRateOverride,
  assignmentCreate,
  assignmentSetRateCard,
  assignmentSetRateOverride,
  assignmentUpdate,
} from "./assignment.js";
import { rateCardCreate, rateCardUpdate } from "./rate-card.js";
import {
  ghostResourceCancel,
  ghostResourceCreate,
  ghostResourceLinkOpenRole,
  ghostResourcePromote,
} from "./ghost-resource.js";
import { conflictResolutionOverrideAndProceed } from "./conflict-resolution.js";

/**
 * The named-mutation pipeline (A003-T53, T54, T69, T71). Every write to the
 * graph goes through here. For each mutation, in one transaction:
 *
 *   1. idempotency — the same `mutation_id` and arguments return the stored
 *      outcome; the same id with different arguments is refused;
 *   2. authorize — the interceptor's write gates, before anything is written;
 *   3. validate — the input schema, the registry, the Tier 0 rule;
 *   4. the mutation's domain rule and writes;
 *   5. the audit entries the interceptor wrote along the way;
 *   6. `audience.onRowsChanged` for every row touched;
 *   7. the row in `graph_mutations`;
 *   8. commit.
 *
 * Any failure rolls the whole transaction back, and a rejection is then
 * recorded in its own small transaction. A denial is the exception: it
 * commits, because the interceptor's audit entry must survive the refusal, and
 * nothing else has been written by then.
 */

const IMPLEMENTATIONS: Record<MutationName, ServerMutation<never>> = {
  "graph.createNode": createNode as ServerMutation<never>,
  "graph.updateNodeFields": updateNodeFieldsMutation as ServerMutation<never>,
  "graph.softDeleteNode": softDeleteNodeMutation as ServerMutation<never>,
  "graph.createEdge": createEdgeMutation as ServerMutation<never>,
  "graph.closeEdge": closeEdgeMutation as ServerMutation<never>,
  "graph.transitionLifecycle": transitionLifecycle as ServerMutation<never>,
  "org.moveEmployee": moveEmployee as ServerMutation<never>,
  "employee.create": employeeCreate as ServerMutation<never>,
  "employee.update": employeeUpdate as ServerMutation<never>,
  "employee.transitionStatus": employeeTransitionStatus as ServerMutation<never>,
  "employee.linkUser": employeeLinkUser as ServerMutation<never>,
  "employee.setCompensation": employeeSetCompensation as ServerMutation<never>,
  "entity.create": entityCreate as ServerMutation<never>,
  "entity.update": entityUpdate as ServerMutation<never>,
  "entity.deactivate": entityDeactivate as ServerMutation<never>,
  "employee.setEntity": employeeSetEntity as ServerMutation<never>,
  "calendar.update": calendarUpdate as ServerMutation<never>,
  "holiday.add": holidayAdd as ServerMutation<never>,
  "holiday.confirm": holidayConfirm as ServerMutation<never>,
  "holiday.cancel": holidayCancel as ServerMutation<never>,
  "pattern.set": patternSet as ServerMutation<never>,
  "pattern.clear": patternClear as ServerMutation<never>,
  "assignment.create": assignmentCreate as ServerMutation<never>,
  "assignment.update": assignmentUpdate as ServerMutation<never>,
  "assignment.cancel": assignmentCancel as ServerMutation<never>,
  "assignment.setRateCard": assignmentSetRateCard as ServerMutation<never>,
  "assignment.setRateOverride": assignmentSetRateOverride as ServerMutation<never>,
  "assignment.clearRateOverride": assignmentClearRateOverride as ServerMutation<never>,
  "rateCard.create": rateCardCreate as ServerMutation<never>,
  "rateCard.update": rateCardUpdate as ServerMutation<never>,
  "ghostResource.create": ghostResourceCreate as ServerMutation<never>,
  "ghostResource.cancel": ghostResourceCancel as ServerMutation<never>,
  "ghostResource.linkOpenRole": ghostResourceLinkOpenRole as ServerMutation<never>,
  "ghostResource.promote": ghostResourcePromote as ServerMutation<never>,
  "conflictResolution.overrideAndProceed":
    conflictResolutionOverrideAndProceed as ServerMutation<never>,
};

export interface MutationEnvelope {
  readonly mutation_id: string;
  readonly name: string;
  readonly args: unknown;
}

export type MutationStatus = "applied" | "duplicate" | "rejected";

export interface MutationResult {
  readonly mutation_id: string;
  readonly status: MutationStatus;
  readonly reason?: string;
  readonly result?: JsonValue;
}

export interface PipelineDependencies {
  readonly audience?: AudienceMaterializer;
  readonly now?: () => string;
  readonly interceptor?: InterceptorContext;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const argsDigest = (args: unknown): string =>
  createHash("sha256").update(canonicalJson(args), "utf8").digest("hex");

const pgCode = (error: unknown): string | undefined => {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.cause?.code ?? e?.code;
};

/** The outcome stored for a mutation, and what replaying it returns. */
type Outcome =
  { status: "applied"; result: JsonValue } | { status: "rejected"; reason: string };

function replay(mutationId: string, outcome: Outcome): MutationResult {
  return outcome.status === "applied"
    ? { mutation_id: mutationId, status: "duplicate", result: outcome.result }
    : { mutation_id: mutationId, status: "rejected", reason: outcome.reason };
}

class RetryRequested extends Error {}

async function recordOutcome(
  tx: GraphTx,
  principal: MemberPrincipal,
  envelope: MutationEnvelope,
  digest: string,
  outcome: Outcome,
): Promise<void> {
  await tx
    .insert(graphMutations)
    .values({
      mutationId: envelope.mutation_id,
      workspaceId: principal.workspaceId,
      actorUserId: principal.userId,
      name: envelope.name,
      argsSha256: digest,
      outcome,
    })
    .onConflictDoNothing();
}

const MAX_ATTEMPTS = 5;

export async function applyMutation(
  principal: MemberPrincipal,
  envelope: MutationEnvelope,
  dependencies: PipelineDependencies = {},
): Promise<MutationResult> {
  const audience = dependencies.audience ?? audienceMaterializer;
  const clock = dependencies.now ?? (() => new Date().toISOString());
  const digest = argsDigest(envelope.args);
  const definition = getMutationDefinition(envelope.name);
  const mutationId = envelope.mutation_id;

  const transaction = async (tx: GraphTx): Promise<MutationResult> => {
    // 1. Idempotency.
    const [existing] = await tx
      .select()
      .from(graphMutations)
      .where(eq(graphMutations.mutationId, mutationId));
    if (existing) {
      if (
        existing.workspaceId !== principal.workspaceId ||
        existing.argsSha256 !== digest
      ) {
        return {
          mutation_id: mutationId,
          status: "rejected",
          reason: "mutation-id-conflict",
        };
      }
      return replay(mutationId, existing.outcome as Outcome);
    }
    if (!definition) throw new MutationRejection("unknown-mutation");
    const parsed = definition.input.safeParse(envelope.args);
    if (!parsed.success) throw new MutationRejection("invalid-args");

    const plan = await IMPLEMENTATIONS[definition.name as MutationName]({
      tx,
      principal,
      args: parsed.data as never,
      mutationId,
      now: clock(),
    });

    // 2. Authorize, before anything is written.
    for (const check of plan.checks) {
      const decision = await authorizeWrite(
        tx,
        principal,
        check.target,
        check.change,
        dependencies.interceptor,
      );
      if (!decision.allowed) {
        await recordOutcome(tx, principal, envelope, digest, {
          status: "rejected",
          reason: decision.reason,
        });
        return { mutation_id: mutationId, status: "rejected", reason: decision.reason };
      }
    }

    // 3-4. Validate, then apply.
    await plan.validate();
    const applied = await plan.apply();

    // 6-7. The audience seam and the mutation log.
    await audience.onRowsChanged(tx, applied.changedRowIds);
    const inserted = await tx
      .insert(graphMutations)
      .values({
        mutationId,
        workspaceId: principal.workspaceId,
        actorUserId: principal.userId,
        name: envelope.name,
        argsSha256: digest,
        outcome: { status: "applied", result: applied.result } satisfies Outcome,
      })
      .onConflictDoNothing()
      .returning({ id: graphMutations.mutationId });
    // A concurrent attempt with the same id won: start over and replay it.
    if (inserted.length === 0) throw new RetryRequested();
    return { mutation_id: mutationId, status: "applied", result: applied.result };
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await db.transaction(
        transaction,
        definition?.name === "org.moveEmployee" ||
          definition?.name === "entity.deactivate" ||
          definition?.name === "calendar.update" ||
          definition?.name === "pattern.set" ||
          definition?.name === "pattern.clear" ||
          definition?.name === "assignment.create" ||
          definition?.name === "assignment.update" ||
          definition?.name === "assignment.cancel" ||
          definition?.name === "assignment.setRateCard" ||
          definition?.name === "rateCard.update" ||
          definition?.name === "ghostResource.promote"
          ? { isolationLevel: "serializable" }
          : undefined,
      );
    } catch (error) {
      // A serialization failure or a lost race is retried against fresh state.
      if (
        (error instanceof RetryRequested || pgCode(error) === "40001") &&
        attempt < MAX_ATTEMPTS
      ) {
        continue;
      }
      // A unique violation may be the losing side of a concurrent attempt at the
      // SAME mutation (both wrote the same new row). Only if the winner has
      // recorded this exact mutation id for this workspace do we start over and
      // replay it as a duplicate; any other violation is a real one and is
      // handled below, never swallowed.
      if (pgCode(error)?.startsWith("23") && attempt < MAX_ATTEMPTS) {
        const [recorded] = await db
          .select({ id: graphMutations.mutationId })
          .from(graphMutations)
          .where(
            and(
              eq(graphMutations.mutationId, mutationId),
              eq(graphMutations.workspaceId, principal.workspaceId),
            ),
          );
        if (recorded) continue;
      }
      const reason =
        error instanceof MutationRejection
          ? error.reason
          : pgCode(error)?.startsWith("23")
            ? "constraint-violation"
            : undefined;
      if (reason === undefined) throw error;
      // Its own small transaction: the failed one rolled back.
      await db.transaction((tx) =>
        recordOutcome(tx, principal, envelope, digest, { status: "rejected", reason }),
      );
      return { mutation_id: mutationId, status: "rejected", reason };
    }
  }
  throw new Error("unreachable");
}

/**
 * Applies mutations in order, each in its own transaction. Processing stops at
 * the first rejection; the rest are returned as rejected without being run, so
 * the client's ordering is preserved.
 */
export async function applyMutations(
  principal: MemberPrincipal,
  envelopes: readonly MutationEnvelope[],
  dependencies: PipelineDependencies = {},
): Promise<MutationResult[]> {
  const results: MutationResult[] = [];
  let blocked = false;
  for (const envelope of envelopes) {
    if (blocked) {
      results.push({
        mutation_id: envelope.mutation_id,
        status: "rejected",
        reason: "blocked-by-earlier-rejection",
      });
      continue;
    }
    const result = await applyMutation(principal, envelope, dependencies);
    results.push(result);
    if (result.status === "rejected") blocked = true;
  }
  return results;
}
