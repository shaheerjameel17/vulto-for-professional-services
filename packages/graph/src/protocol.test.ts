import { describe, expect, it } from "vitest";
import {
  GRAPH_WORKER_PROTOCOL_VERSION,
  graphAvailabilitySchema,
  graphWorkerRequestSchema,
  graphWorkerResponseSchema,
} from "./protocol";

const sentAt = "2026-08-17T12:00:00.000Z";

describe("graph Worker protocol", () => {
  it.each([
    "mid-sync",
    "retention-window-absence",
    "permission-absence",
    "ready",
  ] as const)("accepts the %s availability outcome", (state) => {
    expect(graphAvailabilitySchema.parse({ state })).toEqual({ state });
  });

  it("does not permit a permission absence to carry instance metadata", () => {
    expect(() =>
      graphAvailabilitySchema.parse({
        state: "permission-absence",
        nodeId: "existence-leak",
      }),
    ).toThrow();
  });

  it("accepts transferable ArrayBuffers and rejects a Date on the wire", () => {
    const request = {
      protocolVersion: GRAPH_WORKER_PROTOCOL_VERSION,
      requestId: "request-1",
      sentAt,
      type: "apply-delta-batch",
      deltas: [new Uint8Array([1, 2, 3]).buffer],
    };

    expect(graphWorkerRequestSchema.parse(request)).toEqual(request);
    expect(() =>
      graphWorkerRequestSchema.parse({ ...request, sentAt: new Date(sentAt) }),
    ).toThrow();
  });

  it("rejects a protocol version mismatch", () => {
    expect(() =>
      graphWorkerResponseSchema.parse({
        protocolVersion: 2,
        requestId: "request-1",
        sentAt,
        type: "success",
        availability: { state: "ready" },
        result: { kind: "availability" },
      }),
    ).toThrow();
  });
});
