import { ShapeStream, isChangeMessage, isControlMessage } from "@electric-sql/client";
import { apiHeaders } from "./api";
import type { ShapeChange, ShapeCursor, ShapeTemplateName } from "./cache";

/**
 * One replicated shape, as the engine sees it. The real one wraps Electric's
 * `ShapeStream` against the API's shape proxy; tests use a fake. A device
 * subscribes to exactly two shapes, `nodes` and `edges`, and never names a
 * table or a where clause: the proxy decides both (A003-T72).
 */
export type ShapeEvent =
  | {
      readonly type: "changes";
      readonly changes: readonly ShapeChange[];
      readonly cursor: ShapeCursor;
    }
  | { readonly type: "must-refetch" }
  | { readonly type: "up-to-date"; readonly cursor: ShapeCursor };

export type ShapeFailure =
  | { readonly kind: "access-revoked" }
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "client-outdated" }
  | { readonly kind: "network" };

export interface ShapeSource {
  start(handlers: {
    onEvents(events: readonly ShapeEvent[]): Promise<void>;
    onFailure(failure: ShapeFailure): void;
  }): void;
  stop(): void;
}

export interface ElectricSourceOptions {
  readonly apiOrigin: string;
  readonly workspaceId: string;
  readonly deviceId: string;
  readonly template: ShapeTemplateName;
  readonly resume: ShapeCursor;
  readonly fetch?: typeof fetch;
}

/** A failed shape request, classified. `access-revoked` carries the erase instruction. */
async function classify(response: Response): Promise<ShapeFailure | null> {
  if (response.status === 401) {
    const body = (await response
      .clone()
      .json()
      .catch(() => null)) as { code?: string } | null;
    return body?.code === "access-revoked"
      ? { kind: "access-revoked" }
      : { kind: "unauthenticated" };
  }
  if (response.status === 412) return { kind: "client-outdated" };
  return null;
}

export function createElectricSource(options: ElectricSourceOptions): ShapeSource {
  let stream: ShapeStream | null = null;
  let unsubscribe: (() => void) | null = null;
  let controller: AbortController | null = null;

  return {
    start(handlers) {
      controller = new AbortController();
      const realFetch = options.fetch ?? fetch;
      let failed = false;
      const fail = (failure: ShapeFailure) => {
        if (failed) return;
        failed = true;
        handlers.onFailure(failure);
        controller?.abort();
      };

      const fetchClient: typeof fetch = async (input, init) => {
        let response: Response;
        try {
          response = await realFetch(input, { ...init, credentials: "include" });
        } catch (error) {
          fail({ kind: "network" });
          throw error;
        }
        const failure = await classify(response);
        if (failure) {
          fail(failure);
          throw new Error(failure.kind);
        }
        return response;
      };

      stream = new ShapeStream({
        url: `${options.apiOrigin}/v1/shape/${options.template}`,
        headers: {
          ...apiHeaders(),
          "x-vulto-workspace-id": options.workspaceId,
          "x-vulto-device-id": options.deviceId,
        },
        ...(options.resume.handle && options.resume.offset
          ? { handle: options.resume.handle, offset: options.resume.offset as never }
          : {}),
        fetchClient,
        signal: controller.signal,
        onError: () => undefined,
      });
      unsubscribe = stream.subscribe(
        async (messages) => {
          const events: ShapeEvent[] = [];
          const changes: ShapeChange[] = [];
          const flush = () => {
            if (changes.length === 0) return;
            events.push({
              type: "changes",
              changes: [...changes],
              cursor: {
                handle: stream?.shapeHandle ?? null,
                offset: stream?.lastOffset ?? null,
              },
            });
            changes.length = 0;
          };
          for (const message of messages) {
            if (isChangeMessage(message)) {
              const operation = message.headers.operation;
              changes.push({
                operation,
                value: message.value as Record<string, unknown>,
                ...(message.headers.tags ? { tags: message.headers.tags } : {}),
                ...(message.headers.removed_tags
                  ? { removedTags: message.headers.removed_tags }
                  : {}),
              });
            } else if ("event" in message.headers) {
              // A subquery move-out: rows admitted only by these audience entries are gone.
              const event = message.headers as {
                event: string;
                patterns?: { pos: number; value: string }[];
              };
              if (event.event === "move-out" && event.patterns) {
                changes.push({ operation: "move-out", patterns: event.patterns });
              }
            } else if (isControlMessage(message)) {
              if (message.headers.control === "must-refetch") {
                changes.length = 0;
                events.push({ type: "must-refetch" });
              } else if (message.headers.control === "up-to-date") {
                flush();
                events.push({
                  type: "up-to-date",
                  cursor: {
                    handle: stream?.shapeHandle ?? null,
                    offset: stream?.lastOffset ?? null,
                  },
                });
              }
            }
          }
          flush();
          await handlers.onEvents(events);
        },
        () => fail({ kind: "network" }),
      );
    },
    stop() {
      unsubscribe?.();
      controller?.abort();
      stream = null;
    },
  };
}
