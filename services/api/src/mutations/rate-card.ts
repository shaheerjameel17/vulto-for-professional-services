import {
  mutationDerivedId,
  stampNewEdge,
  stampNewNode,
  updateStamp,
  type JsonValue,
  type MutationArgs,
  type SeniorityLevel,
} from "@vulto/schema";
import { getKeyServices } from "../crypto/keys.js";
import {
  getNode,
  GraphNotFoundError,
  GraphValidationError,
  insertEdge,
  insertNode,
  StaleVersionError,
  updateNodeFields,
  type StoredNode,
} from "../graph/store.js";
import {
  rateCardLineId,
  readRateCard,
  type RateCardRecord,
  type RateCardLineRecord,
} from "../permission/rate-card-queries.js";
import { writeProtected } from "../protected/write.js";
import {
  MutationRejection,
  type MutationContext,
  type ServerMutation,
  type WriteCheck,
} from "./types.js";

const provenance = (ctx: MutationContext<unknown>) => ({
  workspaceId: ctx.principal.workspaceId,
  userId: ctx.principal.userId,
  now: ctx.now,
});

const translate = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StaleVersionError) throw new MutationRejection("stale-state");
    if (error instanceof GraphNotFoundError) throw new MutationRejection("not-found");
    if (error instanceof GraphValidationError)
      throw new MutationRejection("invalid-args");
    throw error;
  }
};

const nodeTarget = (
  ctx: MutationContext<unknown>,
  nodeType: "RateCard" | "RateCardLine",
  nodeId: string,
) =>
  ({
    kind: "node",
    workspaceId: ctx.principal.workspaceId,
    nodeType,
    nodeId,
    partitionKey: "record",
  }) as const;

const edgeTarget = (ctx: MutationContext<unknown>, edgeId: string) =>
  ({
    kind: "edge",
    workspaceId: ctx.principal.workspaceId,
    edgeType: "supersedes",
    fromNodeType: "RateCard",
    toNodeType: "RateCard",
    edgeId,
  }) as const;

async function requireRateCard(
  ctx: MutationContext<unknown>,
  id: string,
): Promise<StoredNode> {
  const node = await getNode(ctx.tx, ctx.principal.workspaceId, id);
  if (!node) throw new MutationRejection("not-found");
  if (node.isSoftDeleted) throw new MutationRejection("target-deleted");
  if (node.nodeType !== "RateCard") throw new MutationRejection("invalid-args");
  return node;
}

type InputLine = MutationArgs<"rateCard.create">["lines"][number];

function linesFor(rateCardId: string, lines: readonly InputLine[]) {
  const byId = new Map<
    string,
    { readonly id: string; readonly value: RateCardLineRecord }
  >();
  for (const line of lines) {
    const id = rateCardLineId(rateCardId, line.seniority_level as SeniorityLevel);
    byId.set(id, {
      id,
      value: {
        rate_card_id: rateCardId,
        seniority_level: line.seniority_level as SeniorityLevel,
        hourly_rate: line.hourly_rate,
        daily_rate: line.hourly_rate * 8,
        monthly_rate: line.hourly_rate * 8 * 22,
      },
    });
  }
  return [...byId.values()];
}

async function writeCard(
  ctx: MutationContext<unknown>,
  rateCardId: string,
  value: RateCardRecord,
  lines: ReturnType<typeof linesFor>,
): Promise<string[]> {
  await translate(() =>
    insertNode(
      ctx.tx,
      stampNewNode(
        {
          node_id: rateCardId,
          node_type: "RateCard",
          schema_version: 1,
          lifecycle_status: "Active",
          ...value,
        },
        "RateCard",
        provenance(ctx),
      ),
    ),
  );
  await writeProtected(
    ctx.tx,
    getKeyServices(),
    {
      workspaceId: ctx.principal.workspaceId,
      nodeId: rateCardId,
      nodeType: "RateCard",
    },
    "record",
    value as unknown as JsonValue,
    ctx.principal.userId,
  );
  const changed = [rateCardId];
  for (const line of lines) {
    await translate(() =>
      insertNode(
        ctx.tx,
        stampNewNode(
          {
            node_id: line.id,
            node_type: "RateCardLine",
            schema_version: 1,
            lifecycle_status: "Active",
            ...line.value,
          },
          "RateCardLine",
          provenance(ctx),
        ),
      ),
    );
    await writeProtected(
      ctx.tx,
      getKeyServices(),
      {
        workspaceId: ctx.principal.workspaceId,
        nodeId: line.id,
        nodeType: "RateCardLine",
      },
      "record",
      line.value as unknown as JsonValue,
      ctx.principal.userId,
    );
    changed.push(line.id);
  }
  return changed;
}

export const rateCardCreate: ServerMutation<MutationArgs<"rateCard.create">> = async (
  ctx,
) => {
  const rateCardId = ctx.mutationId;
  const lines = linesFor(rateCardId, ctx.args.lines);
  const checks: WriteCheck[] = [
    {
      target: nodeTarget(ctx, "RateCard", rateCardId),
      change: { operation: "create" },
    },
    ...lines.map((line) => ({
      target: nodeTarget(ctx, "RateCardLine", line.id),
      change: { operation: "create" as const },
    })),
  ];
  return {
    checks,
    async validate() {},
    async apply() {
      const changed = await writeCard(
        ctx,
        rateCardId,
        {
          name: ctx.args.name,
          currency: ctx.args.currency,
          version: 1,
          supersedes_id: null,
          is_active: true,
        },
        lines,
      );
      return { result: { rate_card_id: rateCardId }, changedRowIds: changed };
    },
  };
};

export const rateCardUpdate: ServerMutation<MutationArgs<"rateCard.update">> = async (
  ctx,
) => {
  const prior = await requireRateCard(ctx, ctx.args.rate_card_id);
  const nextId = ctx.mutationId;
  const lines = linesFor(nextId, ctx.args.lines);
  const edgeId = mutationDerivedId(ctx.mutationId, 1);
  const checks: WriteCheck[] = [
    {
      target: nodeTarget(ctx, "RateCard", prior.nodeId),
      change: { operation: "update" },
    },
    { target: nodeTarget(ctx, "RateCard", nextId), change: { operation: "create" } },
    { target: edgeTarget(ctx, edgeId), change: { operation: "create" } },
    ...lines.map((line) => ({
      target: nodeTarget(ctx, "RateCardLine", line.id),
      change: { operation: "create" as const },
    })),
  ];
  let priorRecord: RateCardRecord | null = null;
  return {
    checks,
    async validate() {
      if (ctx.args.expected_version !== prior.version)
        throw new MutationRejection("stale-state");
      priorRecord = await readRateCard(
        ctx.tx,
        getKeyServices(),
        ctx.principal,
        prior.nodeId,
      );
      if (!priorRecord || !priorRecord.is_active)
        throw new MutationRejection("not-found");
    },
    async apply() {
      const content = priorRecord!;
      await translate(() =>
        updateNodeFields(
          ctx.tx,
          ctx.principal.workspaceId,
          prior.nodeId,
          ctx.args.expected_version,
          updateStamp("RateCard", provenance(ctx)),
        ),
      );
      await writeProtected(
        ctx.tx,
        getKeyServices(),
        {
          workspaceId: ctx.principal.workspaceId,
          nodeId: prior.nodeId,
          nodeType: "RateCard",
        },
        "record",
        { ...content, is_active: false } as unknown as JsonValue,
        ctx.principal.userId,
      );
      const changed = await writeCard(
        ctx,
        nextId,
        {
          name: content.name,
          currency: content.currency,
          version: content.version + 1,
          supersedes_id: prior.nodeId,
          is_active: true,
        },
        lines,
      );
      await translate(() =>
        insertEdge(
          ctx.tx,
          ctx.principal.workspaceId,
          stampNewEdge(
            {
              edge_id: edgeId,
              edge_type: "supersedes",
              from_node_id: nextId,
              to_node_id: prior.nodeId,
              effective_from: ctx.now,
              effective_to: null,
            },
            provenance(ctx),
          ),
        ),
      );
      return {
        result: { new_rate_card_id: nextId },
        changedRowIds: [prior.nodeId, ...changed, edgeId],
      };
    },
  };
};
