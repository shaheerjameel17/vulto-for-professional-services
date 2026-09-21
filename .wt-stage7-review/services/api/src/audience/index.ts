import type { GraphTx } from "../graph/tx.js";

/**
 * The seam the mutation pipeline calls inside its transaction with the ids of
 * every node and edge a mutation touched. Stage 6 implements it: the
 * materializer that keeps each person's sync audience equal to what the
 * interceptor permits. Until then it does nothing.
 */
export interface AudienceMaterializer {
  onRowsChanged(tx: GraphTx, changedRowIds: readonly string[]): Promise<void>;
}

export const noopAudienceMaterializer: AudienceMaterializer = {
  async onRowsChanged() {},
};
