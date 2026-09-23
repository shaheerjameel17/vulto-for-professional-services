import type { JsonValue } from "@vulto/schema";
import type { GraphTx } from "../graph/tx.js";
import type {
  InterceptorContext,
  WriteChange,
  WriteTarget,
} from "../permission/interceptor.js";
import type { MemberPrincipal } from "../permission/principal.js";

/** A refusal with a stable reason the client shows and the log records. */
export class MutationRejection extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "MutationRejection";
  }
}

/** VRS-F005's capacity refusal, retaining both figures in its stable reason. */
export class ConflictError extends MutationRejection {
  constructor(
    readonly currentTotal: number,
    readonly attemptedAddition: number,
  ) {
    super(`capacity-conflict:current=${currentTotal}:attempted=${attemptedAddition}`);
    this.name = "ConflictError";
  }
}

export interface MutationContext<Args> {
  readonly tx: GraphTx;
  readonly principal: MemberPrincipal;
  readonly args: Args;
  readonly mutationId: string;
  /** UTC ISO-8601 server time, for provenance stamps only. */
  readonly now: string;
}

export interface WriteCheck {
  readonly target: WriteTarget;
  readonly change: WriteChange;
}

export interface Applied {
  readonly result: JsonValue;
  /** Every node and edge id the mutation touched, for the audience seam. */
  readonly changedRowIds: readonly string[];
}

/**
 * What a mutation does, in the order the pipeline runs it. `plan` only reads;
 * the pipeline authorizes every check before `validate` and `apply` run, so a
 * denied mutation has written nothing but its audit entry.
 */
export interface Plan {
  readonly checks: readonly WriteCheck[];
  validate(): Promise<void>;
  apply(): Promise<Applied>;
}

export type ServerMutation<Args> = (ctx: MutationContext<Args>) => Promise<Plan>;

export type { InterceptorContext };
