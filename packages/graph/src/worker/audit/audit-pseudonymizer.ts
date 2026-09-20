import { uuidV4Schema } from "@vulto/schema";
import { z } from "zod";

import type { SealedStore } from "../storage/sealed-store";

const responseSchema = z
  .object({ pseudonymizedEntryIds: z.array(uuidV4Schema) })
  .strict();

export interface AuditPseudonymizationInput {
  readonly workspaceId: string;
  readonly currentActorUserId: string;
  readonly opaqueActorToken: string;
}

/**
 * FDN-68's device-side narrow execution seam. It drains already-created
 * evidence before replacing the retained server identity, then applies the
 * same in-place replacement to this device's sealed projections. A retry
 * repairs either side because both server and local operations are idempotent.
 *
 * VPS-F007's erasure orchestrator and device fan-out do not exist yet. That
 * future subsystem must invoke this seam for each reachable unlocked device;
 * this class does not invent an approval, legal-hold, or fan-out mechanism.
 */
export class AuditPseudonymizer {
  constructor(
    private readonly sealedStore: SealedStore,
    private readonly apiOrigin: () => string,
    private readonly flushOutbox: () => Promise<void>,
  ) {}

  async execute(input: AuditPseudonymizationInput): Promise<{
    readonly serverEntryIds: readonly string[];
    readonly localEntryIds: readonly string[];
  }> {
    const workspaceId = uuidV4Schema.parse(input.workspaceId);
    const currentActorUserId = uuidV4Schema.parse(input.currentActorUserId);
    const opaqueActorToken = uuidV4Schema.parse(input.opaqueActorToken);
    const context = this.sealedStore.authenticatedContext;
    if (context.workspaceId !== workspaceId) {
      throw new Error("Audit pseudonymization workspace is unavailable");
    }
    if (currentActorUserId === opaqueActorToken) {
      throw new Error("The opaque actor token must replace the current identifier");
    }

    await this.flushOutbox();
    const response = await fetch(`${this.apiOrigin()}/audit/pseudonymize-actor`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        deviceId: await this.sealedStore.deviceId(),
        currentActorUserId,
        opaqueActorToken,
      }),
    });
    if (!response.ok) throw new Error("Audit pseudonymization is unavailable");
    const server = responseSchema.parse(await response.json());
    const localEntryIds = await this.sealedStore.pseudonymizeAuditActor(
      currentActorUserId,
      opaqueActorToken,
    );
    return { serverEntryIds: server.pseudonymizedEntryIds, localEntryIds };
  }
}
