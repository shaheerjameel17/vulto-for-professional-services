"use client";

import {
  createLocalGraphClient,
  type DeltaBatchResult,
  type LocalGraphClient,
} from "@vulto/graph";
import { useEffect, useState } from "react";

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

export function WorkerDiagnosticsClient() {
  const [status, setStatus] = useState("initializing");

  useEffect(() => {
    const client = createLocalGraphClient("fdn-77-browser-proof");
    let mounted = true;

    void client
      .initialize()
      .then(() => {
        if (!mounted) return;
        window.__vultoWorkerDiagnostics = {
          runBacklog: (base64Deltas) =>
            runWithHeartbeat(client, base64Deltas.map(decodeBase64)),
          runMaterializationProof,
        };
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (mounted) {
          setStatus(error instanceof Error ? error.message : "initialization failed");
        }
      });

    return () => {
      mounted = false;
      delete window.__vultoWorkerDiagnostics;
      void client.dispose();
    };
  }, []);

  return <p data-testid="worker-status">{status}</p>;
}
