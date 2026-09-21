import type { MutateOutcome, ProtectedReadOutcome, QueryOutcome } from "./engine";
import type { SyncState } from "./status";

/**
 * The message protocol between a tab and the sync worker. Requests carry an id
 * and get one reply; the worker pushes `state` and `query` events. Nothing here
 * carries a token: the session cookie travels with the worker's own `fetch`.
 */
export interface InitPayload {
  readonly workspaceId: string;
  readonly userId: string;
  readonly apiOrigin: string;
}

export type WorkerRequest =
  | { readonly id: number; readonly op: "init"; readonly payload: InitPayload }
  | { readonly id: number; readonly op: "query"; readonly payload: unknown }
  | {
      readonly id: number;
      readonly op: "subscribe";
      readonly payload: { subscriptionId: number; query: unknown };
    }
  | {
      readonly id: number;
      readonly op: "unsubscribe";
      readonly payload: { subscriptionId: number };
    }
  | {
      readonly id: number;
      readonly op: "mutate";
      readonly payload: { name: string; args: unknown };
    }
  | {
      readonly id: number;
      readonly op: "protectedRead";
      readonly payload: { nodeIds: string[] };
    }
  | {
      readonly id: number;
      readonly op: "prefetchProtected";
      readonly payload: { nodeIds: string[] };
    }
  | {
      readonly id: number;
      readonly op: "dismissRejected";
      readonly payload: { mutationId: string };
    }
  | { readonly id: number; readonly op: "notifyOnline" }
  | { readonly id: number; readonly op: "signOut" }
  | { readonly id: number; readonly op: "dump" };

export type WorkerResponse =
  | { readonly id: number; readonly ok: true; readonly data: unknown }
  | { readonly id: number; readonly ok: false; readonly error: string };

export type WorkerEvent =
  | { readonly event: "state"; readonly state: SyncState }
  | {
      readonly event: "query";
      readonly subscriptionId: number;
      readonly outcome: QueryOutcome;
    };

export type WorkerMessage = WorkerResponse | WorkerEvent;

export interface ResponseTypes {
  query: QueryOutcome;
  mutate: MutateOutcome;
  protectedRead: ProtectedReadOutcome;
}
