import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { GraphTx } from "../graph/tx.js";
import { protectedDataKeys } from "../protected/schema.js";
import { openCombined, randomKey, sealCombined } from "./aes.js";
import { dekAad } from "./envelope.js";
import { KeyCache } from "./key-cache.js";
import type { KeyProvider } from "./key-provider.js";
import { createKeyProvider, keyProviderConfigFromEnv } from "./provider.js";

/**
 * The key lifecycle: one KEK per workspace, wrapped by the root provider; one
 * data key per Tier 1 erasure domain and one per workspace for Tier 2, wrapped
 * by the KEK. Unwrapped keys live only in `KeyCache` (A003-T61).
 */
export interface KeyServices {
  readonly provider: KeyProvider;
  readonly cache: KeyCache;
}

export class ErasedDomainError extends Error {
  constructor() {
    super("The erasure domain's data key has been destroyed");
    this.name = "ErasedDomainError";
  }
}

let shared: KeyServices | undefined;

/** The process-wide services. Building them is where production refuses the local provider. */
export function getKeyServices(): KeyServices {
  shared ??= {
    provider: createKeyProvider(keyProviderConfigFromEnv()),
    cache: new KeyCache(),
  };
  return shared;
}

/** Fails startup, not the first request, if the configured provider is not allowed. */
export function assertKeyProviderConfigured(): void {
  getKeyServices();
}

/** For tests: replaces the process-wide services. */
export function setKeyServicesForTesting(services: KeyServices | undefined): void {
  shared = services;
}

async function findLiveKek(tx: GraphTx, workspaceId: string) {
  const [row] = await tx
    .select()
    .from(protectedDataKeys)
    .where(
      and(
        eq(protectedDataKeys.workspaceId, workspaceId),
        eq(protectedDataKeys.kind, "kek"),
        isNull(protectedDataKeys.destroyedAt),
      ),
    );
  return row;
}

/** Creates the workspace KEK if it does not exist. Shows nobody anything. */
export async function ensureWorkspaceKek(
  tx: GraphTx,
  services: KeyServices,
  workspaceId: string,
): Promise<string> {
  const existing = await findLiveKek(tx, workspaceId);
  if (existing) return existing.keyId;
  const kek = randomKey();
  const { wrapped, rootKeyRef } = await services.provider.wrapKek(kek, { workspaceId });
  const keyId = randomUUID();
  await tx.insert(protectedDataKeys).values({
    keyId,
    workspaceId,
    kind: "kek",
    rootKeyRef,
    wrappedKey: Buffer.from(wrapped),
  });
  services.cache.set(keyId, kek);
  return keyId;
}

async function unwrappedKek(
  tx: GraphTx,
  services: KeyServices,
  workspaceId: string,
  kekId?: string,
): Promise<{ keyId: string; key: Uint8Array }> {
  const row = kekId
    ? (
        await tx
          .select()
          .from(protectedDataKeys)
          .where(
            and(
              eq(protectedDataKeys.keyId, kekId),
              eq(protectedDataKeys.workspaceId, workspaceId),
            ),
          )
      )[0]
    : await findLiveKek(tx, workspaceId);
  if (!row || row.wrappedKey === null || row.rootKeyRef === null) {
    throw new Error("The workspace key is not available");
  }
  const cached = services.cache.get(row.keyId);
  if (cached) return { keyId: row.keyId, key: cached };
  const key = await services.provider.unwrapKek(row.wrappedKey, row.rootKeyRef, {
    workspaceId,
  });
  services.cache.set(row.keyId, key);
  return { keyId: row.keyId, key };
}

export interface DataKeyScope {
  readonly workspaceId: string;
  readonly tier: 1 | 2;
  /** Tier 1 only; a Tier 2 key is per workspace. */
  readonly erasureDomainId: string | null;
}

/**
 * The live data key for a scope, created on first use. A Tier 1 domain whose
 * key was destroyed stays erased: it is never re-created (A003-T62).
 */
export async function ensureDataKey(
  tx: GraphTx,
  services: KeyServices,
  scope: DataKeyScope,
): Promise<{ keyId: string; key: Uint8Array }> {
  const conditions = [
    eq(protectedDataKeys.workspaceId, scope.workspaceId),
    eq(protectedDataKeys.kind, "dek"),
    eq(protectedDataKeys.tier, scope.tier),
    ...(scope.tier === 1
      ? [eq(protectedDataKeys.erasureDomainId, scope.erasureDomainId!)]
      : []),
  ];
  const rows = await tx
    .select()
    .from(protectedDataKeys)
    .where(and(...conditions));
  const live = rows.find((row) => row.destroyedAt === null);
  if (live) return openDataKey(tx, services, live);
  if (rows.length > 0) throw new ErasedDomainError();

  const kek = await unwrappedKek(tx, services, scope.workspaceId).catch(async () => {
    await ensureWorkspaceKek(tx, services, scope.workspaceId);
    return unwrappedKek(tx, services, scope.workspaceId);
  });
  const dek = randomKey();
  const keyId = randomUUID();
  const erasureDomainId = scope.tier === 1 ? scope.erasureDomainId : null;
  const wrapped = sealCombined(
    kek.key,
    dek,
    dekAad({
      format: "vulto:dek:v1",
      key_id: keyId,
      workspace_id: scope.workspaceId,
      tier: scope.tier,
      erasure_domain_id: erasureDomainId,
    }),
  );
  await tx.insert(protectedDataKeys).values({
    keyId,
    workspaceId: scope.workspaceId,
    kind: "dek",
    tier: scope.tier,
    erasureDomainId,
    parentKeyId: kek.keyId,
    wrappedKey: Buffer.from(wrapped),
  });
  services.cache.set(keyId, dek);
  return { keyId, key: dek };
}

async function openDataKey(
  tx: GraphTx,
  services: KeyServices,
  row: typeof protectedDataKeys.$inferSelect,
): Promise<{ keyId: string; key: Uint8Array }> {
  if (
    row.wrappedKey === null ||
    row.parentKeyId === null ||
    (row.tier !== 1 && row.tier !== 2)
  ) {
    throw new ErasedDomainError();
  }
  const cached = services.cache.get(row.keyId);
  if (cached) return { keyId: row.keyId, key: cached };
  const kek = await unwrappedKek(tx, services, row.workspaceId, row.parentKeyId);
  const key = openCombined(
    kek.key,
    row.wrappedKey,
    dekAad({
      format: "vulto:dek:v1",
      key_id: row.keyId,
      workspace_id: row.workspaceId,
      tier: row.tier,
      erasure_domain_id: row.erasureDomainId,
    }),
  );
  services.cache.set(row.keyId, key);
  return { keyId: row.keyId, key };
}

/** A data key by id, or `null` if it has been destroyed. Used by the read path. */
export async function loadDataKey(
  tx: GraphTx,
  services: KeyServices,
  workspaceId: string,
  keyId: string,
): Promise<Uint8Array | null> {
  const [row] = await tx
    .select()
    .from(protectedDataKeys)
    .where(
      and(
        eq(protectedDataKeys.keyId, keyId),
        eq(protectedDataKeys.workspaceId, workspaceId),
      ),
    );
  if (!row || row.wrappedKey === null) return null;
  return (await openDataKey(tx, services, row)).key;
}
