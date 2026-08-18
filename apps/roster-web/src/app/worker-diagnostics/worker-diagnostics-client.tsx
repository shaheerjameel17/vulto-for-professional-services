"use client";

import {
  createLocalGraphClient,
  type DeltaBatchResult,
  type LocalGraphClient,
} from "@vulto/graph";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LockedShellGate } from "../../components/device-store/LockedShellGate";

interface ResponsivenessResult {
  batch: DeltaBatchResult;
  animationFrames: number;
  maxFrameGapMs: number;
}

interface WorkerDiagnosticsApi {
  runBacklog(base64Deltas: readonly string[]): Promise<ResponsivenessResult>;
  runMaterializationProof(): Promise<MaterializationProofResult>;
}

interface MaterializationProofResult {
  generation: number;
  nodeCount: number;
  twoHopCount: number;
  historicalHandoffTarget: string | null;
  subscriptionObservedCommit: boolean;
  indexedPlan: boolean;
  deterministicRebuild: boolean;
  failedBatchPreservedGeneration: boolean;
  durationMs: number;
}

declare global {
  interface Window {
    __vultoWorkerDiagnostics?: WorkerDiagnosticsApi;
  }
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function runWithHeartbeat(
  client: LocalGraphClient,
  deltas: readonly Uint8Array[],
): Promise<ResponsivenessResult> {
  let animationFrames = 0;
  let maxFrameGapMs = 0;
  let previousFrame = performance.now();
  let frameHandle = 0;

  const heartbeat = (timestamp: number) => {
    animationFrames += 1;
    maxFrameGapMs = Math.max(maxFrameGapMs, timestamp - previousFrame);
    previousFrame = timestamp;
    frameHandle = requestAnimationFrame(heartbeat);
  };
  frameHandle = requestAnimationFrame(heartbeat);

  try {
    const batch = await client.applyDeltaBatch(deltas);
    return { batch, animationFrames, maxFrameGapMs };
  } finally {
    cancelAnimationFrame(frameHandle);
  }
}

function runMaterializationProof(): Promise<MaterializationProofResult> {
  return new Promise((resolve, reject) => {
    // This Worker is reachable only from the opt-in Playwright route. It is a
    // test seam, not a production graph message or public package API.
    const worker = new Worker(
      new URL(
        "../../../../../packages/graph/src/worker/testing/browser-proof.worker.ts",
        import.meta.url,
      ),
      { type: "module", name: "vulto-fdn48-browser-proof" },
    );
    worker.onmessage = (event: MessageEvent<unknown>) => {
      worker.terminate();
      const response = event.data as
        { ok: true; result: MaterializationProofResult } | { ok: false; error: string };
      if (response.ok) resolve(response.result);
      else reject(new Error(response.error));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "Materialization proof Worker failed"));
    };
    worker.postMessage({ type: "run" });
  });
}

/**
 * Rendered only once LockedShellGate has confirmed the sealed store is
 * unlocked. Runs the same client.initialize() this harness always ran, now
 * safe to call because a FDN-84 unlock has already completed on this Worker
 * instance (FDN-50 stage 1 makes initialize() reject while locked).
 */
function WorkerDiagnosticsReady({ client }: { client: LocalGraphClient }) {
  const [status, setStatus] = useState("initializing");
  // A local graph Worker serves exactly one workspace for its whole
  // lifetime, so client.initialize() must fire exactly once for this
  // client instance. Unlike the client itself (recreated fresh on every
  // mount by the parent), this component is only ever mounted once, after
  // a real unlock — so StrictMode's dev-only double-invoke of this effect
  // would otherwise call initialize() twice on the same already-live
  // client and hit "already-initialized". The ref guards against that
  // without masking a genuine double-initialize elsewhere.
  const startedRef = useRef(false);

  useEffect(() => {
    // Deliberately no "mounted" gate on the resolution below: StrictMode's
    // dev-only synthetic cleanup (which runs immediately after this very
    // setup, before the real initialize() call above has resolved) would
    // otherwise mark the still-in-flight call as stale and silently drop
    // its result, leaving status stuck on "initializing" forever. The
    // startedRef guard above is what prevents a genuine double call; once
    // it has let the one real initialize() call through, that call's
    // resolution is always the one this component should reflect.
    if (startedRef.current) return;
    startedRef.current = true;

    void client
      .initialize()
      .then(() => {
        window.__vultoWorkerDiagnostics = {
          runBacklog: (base64Deltas) =>
            runWithHeartbeat(client, base64Deltas.map(decodeBase64)),
          runMaterializationProof,
        };
        setStatus("ready");
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : "initialization failed");
      });

    return () => {
      delete window.__vultoWorkerDiagnostics;
    };
  }, [client]);

  return <p data-testid="worker-status">{status}</p>;
}

export function WorkerDiagnosticsClient() {
  const params = useSearchParams();
  const workspaceId = params.get("workspaceId") ?? "fdn-77-browser-proof";
  const clientRef = useRef<LocalGraphClient | null>(null);
  const [client, setClient] = useState<LocalGraphClient | null>(null);

  useEffect(() => {
    const created = createLocalGraphClient(workspaceId);
    clientRef.current = created;
    setClient(created);

    return () => {
      void created.dispose();
    };
  }, [workspaceId]);

  if (!client) return null;

  return (
    <LockedShellGate workspaceId={workspaceId} client={client}>
      <WorkerDiagnosticsReady client={client} />
    </LockedShellGate>
  );
}
