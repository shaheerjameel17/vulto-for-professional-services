import type { SeniorityLevel } from "@vulto/schema";
import { authorizeRead, type InterceptorContext } from "./interceptor.js";
import type { Principal } from "./principal.js";
import { deterministicUuid } from "../auth/membership-edge-ids.js";
import type { KeyServices } from "../crypto/keys.js";
import { getNode, getNodes, incoming } from "../graph/store.js";
import type { GraphTx } from "../graph/tx.js";
import { readProtected } from "../protected/read.js";

export interface RateCardRecord {
  readonly name: string;
  readonly currency: string;
  readonly version: number;
  readonly supersedes_id: string | null;
  readonly is_active: boolean;
}

export interface RateCardLineRecord {
  readonly rate_card_id: string;
  readonly seniority_level: SeniorityLevel;
  readonly hourly_rate: number;
  readonly daily_rate: number;
  readonly monthly_rate: number;
}

export class RateCardAccessDenied extends Error {
  constructor() {
    super("rate-card-access-denied");
    this.name = "RateCardAccessDenied";
  }
}

export const rateCardLineId = (rateCardId: string, seniority: SeniorityLevel): string =>
  deterministicUuid(`rate_card_line:${rateCardId}:${seniority}`);

async function requireRateCardRead(
  tx: GraphTx,
  principal: Principal,
  nodeId: string,
  context: InterceptorContext,
): Promise<void> {
  const decision = await authorizeRead(
    tx,
    principal,
    {
      workspaceId: principal.workspaceId,
      nodeType: "RateCard",
      nodeId,
      partitionKey: "record",
    },
    context,
  );
  if (decision.access !== "read" && decision.access !== "full") {
    throw new RateCardAccessDenied();
  }
}

async function availableRecord<T>(
  tx: GraphTx,
  services: KeyServices,
  principal: Principal,
  nodeId: string,
  context: InterceptorContext,
): Promise<T | null> {
  const [item] = await readProtected(
    tx,
    services,
    principal,
    { nodeIds: [nodeId], partitions: ["record"] },
    context,
  );
  return item?.state === "available" ? (item.value as T) : null;
}

export async function readRateCard(
  tx: GraphTx,
  services: KeyServices,
  principal: Principal,
  rateCardId: string,
  context: InterceptorContext = {},
): Promise<RateCardRecord | null> {
  return availableRecord<RateCardRecord>(tx, services, principal, rateCardId, context);
}

export async function readRateCardLine(
  tx: GraphTx,
  services: KeyServices,
  principal: Principal,
  rateCardId: string,
  seniority: SeniorityLevel,
  context: InterceptorContext = {},
): Promise<RateCardLineRecord | null> {
  return availableRecord<RateCardLineRecord>(
    tx,
    services,
    principal,
    rateCardLineId(rateCardId, seniority),
    context,
  );
}

export async function listRateCards(
  tx: GraphTx,
  services: KeyServices,
  principal: Principal,
  context: InterceptorContext = {},
) {
  await requireRateCardRead(tx, principal, principal.workspaceId, context);
  const nodes = await getNodes(tx, principal.workspaceId, { nodeType: "RateCard" });
  const records = await readProtected(
    tx,
    services,
    principal,
    { nodeIds: nodes.map((node) => node.nodeId), partitions: ["record"] },
    context,
  );
  const byId = new Map(
    records.flatMap((item) =>
      item.state === "available"
        ? [[item.node_id, item.value as RateCardRecord] as const]
        : [],
    ),
  );
  return nodes.flatMap((node) => {
    const record = byId.get(node.nodeId);
    return record ? [{ rateCardId: node.nodeId, ...record }] : [];
  });
}

export async function getRateCardPreview(
  tx: GraphTx,
  services: KeyServices,
  principal: Principal,
  rateCardId: string,
  seniority: SeniorityLevel,
  context: InterceptorContext = {},
) {
  await requireRateCardRead(tx, principal, rateCardId, context);
  const line = await readRateCardLine(
    tx,
    services,
    principal,
    rateCardId,
    seniority,
    context,
  );
  return line
    ? {
        hourlyRate: line.hourly_rate,
        dailyRate: line.daily_rate,
        monthlyRate: line.monthly_rate,
      }
    : null;
}

export async function getRateCardUsageCount(
  tx: GraphTx,
  principal: Principal,
  rateCardId: string,
  context: InterceptorContext = {},
) {
  const card = await getNode(tx, principal.workspaceId, rateCardId);
  if (!card || card.nodeType !== "RateCard" || card.isSoftDeleted) return null;
  await requireRateCardRead(tx, principal, rateCardId, context);
  const edges = await incoming(tx, principal.workspaceId, rateCardId, "governed_by");
  return {
    activeAssignments: edges.filter((edge) => edge.effectiveTo === null).length,
  };
}
