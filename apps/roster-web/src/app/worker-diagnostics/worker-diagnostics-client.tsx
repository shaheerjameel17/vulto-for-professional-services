"use client";

import type { DeltaBatchResult } from "@vulto/graph";
import {
  createUncheckedLocalGraphClient,
  type UncheckedLocalGraphClient,
} from "@vulto/graph/testing/unchecked-mutation";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LockedShellGate } from "../../components/device-store/LockedShellGate";
import { apiOrigin } from "../../lib/auth-client";

interface ResponsivenessResult {
  batch: DeltaBatchResult;
  animationFrames: number;
  maxFrameGapMs: number;
}

interface WorkerDiagnosticsApi {
  runBacklog(base64Deltas: readonly string[]): Promise<ResponsivenessResult>;
  runMaterializationProof(): Promise<MaterializationProofResult>;
  runProtectedDocumentProof(
    subjectUserId: string,
  ): Promise<ProtectedDocumentProofResult>;
  runAdversarialDurabilityProof(
    subjectUserId: string,
    workspaceId?: string,
  ): Promise<AdversarialDurabilityProofResult>;
  prepareIdentityTransferSource(
    workspaceId: string,
    subjectUserId: string,
  ): Promise<{ sessionId: string; deviceId: string }>;
  prepareIdentityTransferTarget(
    workspaceId: string,
    subjectUserId: string,
    sourceDeviceId: string,
    transferId: string,
  ): Promise<{
    sessionId: string;
    targetDeviceId: string;
    targetTransferPublicKey: string;
  }>;
  createIdentityTransfer(
    sessionId: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  acceptIdentityTransfer(
    sessionId: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  runFailedSecurityTransitionProof(
    workspaceId: string,
    subjectUserId: string,
  ): Promise<Record<string, unknown>>;
  runConcurrentSecurityRaceProof(
    workspaceIds: readonly [string, string, string],
    subjectUserId: string,
  ): Promise<Record<string, unknown>>;
}

interface AdversarialDurabilityProofResult {
  createdPartitions: number;
  privateKeyExtractable: boolean;
  durableManifestPresentAfterTermination: boolean;
  materializedPartitionsAfterTermination: number;
  identityRestoredAfterTermination: boolean;
  restoredPrivateKeyExtractable: boolean;
  failedPersistRejected: boolean;
  failedPersistMutatedMemory: boolean;
  failedPersistLeftDurableStateUnchanged: boolean;
  concurrentWritesBothSucceeded: boolean;
  concurrentExactlyOneSucceeded: boolean;
  generationAfterTwoConcurrentWrites: number | null;
  coldRollbackAcceptedAfterWorkerRestart: boolean;
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

interface ProtectedDocumentProofResult {
  readerSetId: string;
  canonicalHeader: string;
  tier1RoundTrip: boolean;
  tier1SharedVectorMatches: boolean;
  stage3PartitionsAfterReopen: number;
  stage3EpochAfterReopen: number;
  stage3RemovedReaderDenied: boolean;
  stage3OldKeyDenied: boolean;
  stage3DocumentBUnaffected: boolean;
  stage3WorkspaceUnaffected: boolean;
  stage3WorkspaceDocumentStayedTier02: boolean;
  stage3AddressMappingRestored: boolean;
  stage3PostReopenWriteSurvived: boolean;
  stage3HistoryStayedLazy: boolean;
  stage3ManifestStayedSealed: boolean;
  stage3UnauthorizedOnlyMaterializationDenied: boolean;
  stage3UnauthorizedOnlyOpenDenied: boolean;
  stage3WrongWorkspaceDenied: boolean;
  stage6ImmediateReaderGrant: boolean;
  stage6RetentionLifecycle: boolean;
  stage6CryptographicErasure: boolean;
  stage6IntegratedColdReopen: boolean;
  tier3EnrollmentSubjectOnly: boolean;
  tier3PrfPersistentReopen: boolean;
  tier3MandatoryRecoveryConfirmed: boolean;
  tier3RecoverySubjectOnly: boolean;
  tier3WrongRecoveryCodeDenied: boolean;
  tier3OldRecoveryPathDenied: boolean;
  tier3RetiredCredentialDenied: boolean;
  tier3PostRecoveryEpoch: number;
  tier3PostRecoveryWriteSurvived: boolean;
  tier3UnrelatedDocumentSurvived: boolean;
  tier3WorkspaceStateSurvived: boolean;
  tier3GenerationHistoryValidated: boolean;
  tier3RootRotated: boolean;
  tier3KeysStayedWorkerPrivate: boolean;
  tier3WindowCeremonyBuffersDetached: boolean;
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
  client: UncheckedLocalGraphClient,
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

function durabilityProofWorker(): Worker {
  return new Worker(
    new URL(
      "../../../../../packages/graph/src/worker/testing/adversarial-durability-proof.worker.ts",
      import.meta.url,
    ),
    { type: "module", name: "vulto-fdn52-adversarial-durability-proof" },
  );
}

function durabilityRequest(
  worker: Worker,
  request: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const listener = (event: MessageEvent<unknown>) => {
      const response = event.data as {
        requestId?: string;
        ok?: boolean;
        result?: Record<string, unknown>;
        error?: string;
      };
      if (response.requestId !== requestId) return;
      worker.removeEventListener("message", listener);
      if (response.ok && response.result) resolve(response.result);
      else reject(new Error(response.error ?? "Durability proof failed"));
    };
    worker.addEventListener("message", listener);
    worker.postMessage({ ...request, requestId });
  });
}

const identityTransferWorkers = new Map<string, Worker>();

async function prepareIdentityTransferSource(
  workspaceId: string,
  subjectUserId: string,
): Promise<{ sessionId: string; deviceId: string }> {
  const worker = durabilityProofWorker();
  const sessionId = crypto.randomUUID();
  try {
    const result = await durabilityRequest(worker, {
      workspaceId,
      apiOrigin,
      subjectUserId,
      type: "prepare-transfer-source",
    });
    identityTransferWorkers.set(sessionId, worker);
    return { sessionId, deviceId: result.deviceId as string };
  } catch (error) {
    worker.terminate();
    throw error;
  }
}

async function prepareIdentityTransferTarget(
  workspaceId: string,
  subjectUserId: string,
  sourceDeviceId: string,
  transferId: string,
) {
  const worker = durabilityProofWorker();
  const sessionId = crypto.randomUUID();
  try {
    const result = await durabilityRequest(worker, {
      workspaceId,
      apiOrigin,
      subjectUserId,
      sourceDeviceId,
      transferId,
      type: "prepare-transfer-target",
    });
    identityTransferWorkers.set(sessionId, worker);
    return {
      sessionId,
      targetDeviceId: result.targetDeviceId as string,
      targetTransferPublicKey: result.targetTransferPublicKey as string,
    };
  } catch (error) {
    worker.terminate();
    throw error;
  }
}

async function identityTransferRequest(
  sessionId: string,
  input: Record<string, unknown>,
  terminateAfter: boolean,
): Promise<Record<string, unknown>> {
  const worker = identityTransferWorkers.get(sessionId);
  if (!worker) throw new Error("Identity transfer session does not exist");
  try {
    return await durabilityRequest(worker, input);
  } finally {
    if (terminateAfter) {
      worker.terminate();
      identityTransferWorkers.delete(sessionId);
    }
  }
}

async function runFailedSecurityTransitionProof(
  workspaceId: string,
  subjectUserId: string,
): Promise<Record<string, unknown>> {
  const worker = durabilityProofWorker();
  try {
    return await durabilityRequest(worker, {
      workspaceId,
      apiOrigin,
      subjectUserId,
      type: "prove-failed-security-transitions",
    });
  } finally {
    worker.terminate();
  }
}

async function oneShotDurabilityRequest(
  request: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const worker = durabilityProofWorker();
  try {
    return await durabilityRequest(worker, request);
  } finally {
    worker.terminate();
  }
}

async function runProtectedRace(
  workspaceId: string,
  subjectUserId: string,
  operations: readonly ["write" | "grant", "remove"],
) {
  const common = { workspaceId, apiOrigin, subjectUserId };
  const setup = await oneShotDurabilityRequest({
    ...common,
    type: "setup-protected-race",
  });
  const preCommitCrash = durabilityProofWorker();
  await durabilityRequest(preCommitCrash, {
    ...common,
    ...setup,
    type: "prepare-protected-race",
  });
  preCommitCrash.terminate();
  const afterPreCommitTermination = await oneShotDurabilityRequest({
    ...common,
    type: "inspect-protected-race",
  });
  const left = durabilityProofWorker();
  const right = durabilityProofWorker();
  try {
    await Promise.all([
      durabilityRequest(left, {
        ...common,
        ...setup,
        type: "prepare-protected-race",
      }),
      durabilityRequest(right, {
        ...common,
        ...setup,
        type: "prepare-protected-race",
      }),
    ]);
    const outcomes = await Promise.allSettled([
      durabilityRequest(left, {
        ...common,
        type: "commit-protected-race",
        operation: operations[0],
      }),
      durabilityRequest(right, {
        ...common,
        type: "commit-protected-race",
        operation: operations[1],
      }),
    ]);
    const winner = outcomes.find(
      (outcome): outcome is PromiseFulfilledResult<Record<string, unknown>> =>
        outcome.status === "fulfilled",
    )?.value.committed;
    left.terminate();
    right.terminate();
    const inspected = await oneShotDurabilityRequest({
      ...common,
      type: "inspect-protected-race",
    });
    return {
      exactlyOneSucceeded:
        outcomes.filter((outcome) => outcome.status === "fulfilled").length === 1,
      preCommitTerminationPreserved:
        afterPreCommitTermination.partitionCount === 1 &&
        afterPreCommitTermination.activeReaders === 2,
      winner,
      ...inspected,
    };
  } finally {
    left.terminate();
    right.terminate();
  }
}

async function runConcurrentTier3RecoveryRace(
  workspaceId: string,
  subjectUserId: string,
) {
  const common = { workspaceId, apiOrigin, subjectUserId };
  const setup = await oneShotDurabilityRequest({ ...common, type: "setup-tier3-race" });
  const preCommitCrash = durabilityProofWorker();
  await durabilityRequest(preCommitCrash, {
    ...common,
    type: "prepare-tier3-recovery-race",
    oldRecoveryCode: setup.oldRecoveryCode,
    credentialId: "credential-crashed",
    prfInput: new Uint8Array(32).fill(96),
    prfResult: new Uint8Array(32).fill(97),
  });
  preCommitCrash.terminate();
  const afterPreCommitTermination = await oneShotDurabilityRequest({
    ...common,
    type: "inspect-tier3-race",
    credentialId: "credential-old",
    prfResult: setup.oldPrfResult,
  });
  const left = durabilityProofWorker();
  const right = durabilityProofWorker();
  const leftPrf = new Uint8Array(32).fill(92);
  const rightPrf = new Uint8Array(32).fill(93);
  try {
    await Promise.all([
      durabilityRequest(left, {
        ...common,
        type: "prepare-tier3-recovery-race",
        oldRecoveryCode: setup.oldRecoveryCode,
        credentialId: "credential-left",
        prfInput: new Uint8Array(32).fill(94),
        prfResult: leftPrf,
      }),
      durabilityRequest(right, {
        ...common,
        type: "prepare-tier3-recovery-race",
        oldRecoveryCode: setup.oldRecoveryCode,
        credentialId: "credential-right",
        prfInput: new Uint8Array(32).fill(95),
        prfResult: rightPrf,
      }),
    ]);
    const outcomes = await Promise.allSettled([
      durabilityRequest(left, { ...common, type: "commit-tier3-recovery-race" }),
      durabilityRequest(right, { ...common, type: "commit-tier3-recovery-race" }),
    ]);
    const leftWon = outcomes[0]!.status === "fulfilled";
    left.terminate();
    right.terminate();
    const inspected = await oneShotDurabilityRequest({
      ...common,
      type: "inspect-tier3-race",
      credentialId: leftWon ? "credential-left" : "credential-right",
      prfResult: leftWon ? leftPrf : rightPrf,
    });
    return {
      exactlyOneSucceeded:
        outcomes.filter((outcome) => outcome.status === "fulfilled").length === 1,
      preCommitTerminationPreserved:
        afterPreCommitTermination.generation === 0 &&
        afterPreCommitTermination.documents === 1,
      ...inspected,
    };
  } finally {
    left.terminate();
    right.terminate();
  }
}

async function runConcurrentSecurityRaceProof(
  workspaceIds: readonly [string, string, string],
  subjectUserId: string,
) {
  return {
    writeVsRemoval: await runProtectedRace(workspaceIds[0], subjectUserId, [
      "write",
      "remove",
    ]),
    grantVsRemoval: await runProtectedRace(workspaceIds[1], subjectUserId, [
      "grant",
      "remove",
    ]),
    twoTier3Recoveries: await runConcurrentTier3RecoveryRace(
      workspaceIds[2],
      subjectUserId,
    ),
  };
}

async function runAdversarialDurabilityProof(
  workspaceId: string,
  subjectUserId: string,
): Promise<AdversarialDurabilityProofResult> {
  const common = { workspaceId, apiOrigin, subjectUserId };
  const first = durabilityProofWorker();
  const created = await durabilityRequest(first, { ...common, type: "create-tier1" });
  first.terminate();

  const reopenedWorker = durabilityProofWorker();
  const reopened = await durabilityRequest(reopenedWorker, {
    ...common,
    type: "reopen-tier1",
  });
  reopenedWorker.terminate();

  const failedPersistWorker = durabilityProofWorker();
  const failedPersist = await durabilityRequest(failedPersistWorker, {
    ...common,
    type: "prove-failed-persist",
  });
  failedPersistWorker.terminate();

  const left = durabilityProofWorker();
  const right = durabilityProofWorker();
  const storeKey = `protected-partition-manifest:${workspaceId}`;
  try {
    await Promise.all([
      durabilityRequest(left, { ...common, type: "prepare-race" }),
      durabilityRequest(right, { ...common, type: "prepare-race" }),
    ]);
    const writes = await Promise.allSettled([
      durabilityRequest(left, {
        ...common,
        type: "write-race",
        storeKey,
        value: "left",
      }),
      durabilityRequest(right, {
        ...common,
        type: "write-race",
        storeKey,
        value: "right",
      }),
    ]);
    left.terminate();
    right.terminate();
    const inspector = durabilityProofWorker();
    const inspected = await durabilityRequest(inspector, {
      ...common,
      type: "inspect-race",
      storeKey,
    });
    inspector.terminate();
    const rollbackKey = `fdn52-cold-rollback-${crypto.randomUUID()}`;
    const rollbackWriter = durabilityProofWorker();
    await durabilityRequest(rollbackWriter, {
      ...common,
      type: "prepare-cold-rollback",
      storeKey: rollbackKey,
    });
    rollbackWriter.terminate();
    const rollbackReader = durabilityProofWorker();
    const rollback = await durabilityRequest(rollbackReader, {
      ...common,
      type: "open-cold-rollback",
      storeKey: rollbackKey,
    });
    rollbackReader.terminate();
    return {
      createdPartitions: created.createdPartitions as number,
      privateKeyExtractable: created.privateKeyExtractable as boolean,
      durableManifestPresentAfterTermination:
        reopened.durableManifestPresent as boolean,
      materializedPartitionsAfterTermination: reopened.materializedPartitions as number,
      failedPersistRejected: failedPersist.callRejected as boolean,
      failedPersistMutatedMemory: failedPersist.memoryMutated as boolean,
      failedPersistLeftDurableStateUnchanged: failedPersist.durableUnchanged as boolean,
      concurrentWritesBothSucceeded: writes.every(
        (write) => write.status === "fulfilled" && write.value.wrote === true,
      ),
      concurrentExactlyOneSucceeded:
        writes.filter((write) => write.status === "fulfilled").length === 1,
      generationAfterTwoConcurrentWrites: inspected.generation as number | null,
      coldRollbackAcceptedAfterWorkerRestart:
        rollback.value === "old" && rollback.generation === 0,
      identityRestoredAfterTermination: reopened.reopenedContinuity as boolean,
      restoredPrivateKeyExtractable: reopened.restoredPrivateKeyExtractable as boolean,
    };
  } finally {
    left.terminate();
    right.terminate();
  }
}

function runProtectedDocumentProof(
  workspaceId: string,
  subjectUserId: string,
): Promise<ProtectedDocumentProofResult> {
  return new Promise((resolve, reject) => {
    // FDN-52's integrated lifecycle proof runs in a real module Worker. This is
    // opt-in diagnostics only and does not add a production protocol route.
    const worker = new Worker(
      new URL(
        "../../../../../packages/graph/src/worker/testing/protected-document-proof.worker.ts",
        import.meta.url,
      ),
      { type: "module", name: "vulto-fdn52-protected-document-proof" },
    );
    const credentials = new Map<string, Uint8Array>();
    let ceremonyBuffersDetached = true;
    worker.onmessage = (event: MessageEvent<unknown>) => {
      const response = event.data as
        | {
            ok: true;
            result: Omit<
              ProtectedDocumentProofResult,
              "tier3WindowCeremonyBuffersDetached"
            >;
          }
        | { ok: false; error: string }
        | {
            type: "tier3-prf-request";
            requestId: string;
            credentialSlot: string;
            create: boolean;
            prfInput: ArrayBuffer;
          };
      if ("type" in response && response.type === "tier3-prf-request") {
        void evaluateWebAuthnPrf(credentials, response)
          .then(({ credentialId, prfResult }) => {
            const transferred = prfResult.buffer;
            worker.postMessage(
              {
                type: "tier3-prf-response",
                requestId: response.requestId,
                credentialId,
                prfResult: transferred,
              },
              [transferred],
            );
            ceremonyBuffersDetached &&=
              transferred.byteLength === 0 && prfResult.byteLength === 0;
          })
          .catch((error: unknown) => {
            worker.terminate();
            reject(error);
          });
        return;
      }
      worker.terminate();
      if (!("ok" in response)) {
        reject(new Error("Unexpected Tier 3 proof response"));
      } else if (response.ok) {
        resolve({
          ...response.result,
          tier3WindowCeremonyBuffersDetached: ceremonyBuffersDetached,
        });
      } else reject(new Error(response.error));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "Protected document proof Worker failed"));
    };
    worker.postMessage({ workspaceId, apiOrigin, subjectUserId });
  });
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function evaluateWebAuthnPrf(
  credentials: Map<string, Uint8Array>,
  request: {
    readonly credentialSlot: string;
    readonly create: boolean;
    readonly prfInput: ArrayBuffer;
  },
): Promise<{ credentialId: string; prfResult: Uint8Array<ArrayBuffer> }> {
  let rawId = credentials.get(request.credentialSlot);
  if (request.create) {
    if (rawId) throw new Error("WebAuthn credential slot already exists");
    const created = (await navigator.credentials.create({
      publicKey: {
        rp: { id: "localhost", name: "Vulto Stage 5 Proof" },
        user: {
          id: randomBytes(16),
          name: `${request.credentialSlot}@vulto.test`,
          displayName: request.credentialSlot,
        },
        challenge: randomBytes(32),
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "required",
          userVerification: "required",
        },
        extensions: { prf: {} },
      } as PublicKeyCredentialCreationOptions,
    })) as PublicKeyCredential | null;
    if (!created) throw new Error("WebAuthn PRF credential creation failed");
    const creationExtensions = created.getClientExtensionResults() as unknown as {
      prf?: { enabled?: boolean };
    };
    if (creationExtensions.prf?.enabled !== true) {
      throw new Error("WebAuthn authenticator did not enable PRF");
    }
    rawId = new Uint8Array(created.rawId.slice(0));
    credentials.set(request.credentialSlot, rawId);
  }
  if (!rawId) throw new Error("WebAuthn credential slot does not exist");
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      rpId: "localhost",
      allowCredentials: [{ type: "public-key", id: rawId }],
      userVerification: "required",
      extensions: { prf: { eval: { first: request.prfInput } } },
    } as PublicKeyCredentialRequestOptions,
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error("WebAuthn PRF assertion failed");
  const extensions = assertion.getClientExtensionResults() as unknown as {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  const first = extensions.prf?.results?.first;
  if (!(first instanceof ArrayBuffer) || first.byteLength !== 32) {
    throw new Error("WebAuthn PRF did not return a 32-byte result");
  }
  return {
    credentialId: base64Url(rawId),
    // Transfer the browser-returned buffer itself to the crypto Worker. The
    // transfer detaches it on this Window instead of leaving an additional
    // live PRF-result copy behind in the credential response object.
    prfResult: new Uint8Array(first),
  };
}

/**
 * Rendered only once LockedShellGate has confirmed the sealed store is
 * unlocked. Runs the same client.initialize() this harness always ran, now
 * safe to call because a FDN-84 unlock has already completed on this Worker
 * instance (FDN-50 stage 1 makes initialize() reject while locked).
 */
function WorkerDiagnosticsReady({
  client,
  workspaceId,
}: {
  client: UncheckedLocalGraphClient;
  workspaceId: string;
}) {
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
          runProtectedDocumentProof: (subjectUserId) =>
            runProtectedDocumentProof(workspaceId, subjectUserId),
          runAdversarialDurabilityProof: (
            subjectUserId,
            targetWorkspaceId = workspaceId,
          ) => runAdversarialDurabilityProof(targetWorkspaceId, subjectUserId),
          prepareIdentityTransferSource,
          prepareIdentityTransferTarget,
          createIdentityTransfer: (sessionId, input) =>
            identityTransferRequest(sessionId, input, true),
          acceptIdentityTransfer: (sessionId, input) =>
            identityTransferRequest(sessionId, input, true),
          runFailedSecurityTransitionProof,
          runConcurrentSecurityRaceProof,
        };
        setStatus("ready");
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : "initialization failed");
      });

    return () => {
      delete window.__vultoWorkerDiagnostics;
      for (const worker of identityTransferWorkers.values()) worker.terminate();
      identityTransferWorkers.clear();
    };
  }, [client, workspaceId]);

  return <p data-testid="worker-status">{status}</p>;
}

export function WorkerDiagnosticsClient() {
  const params = useSearchParams();
  const workspaceId = params.get("workspaceId") ?? "fdn-77-browser-proof";
  const clientRef = useRef<UncheckedLocalGraphClient | null>(null);
  const [client, setClient] = useState<UncheckedLocalGraphClient | null>(null);

  useEffect(() => {
    // FDN-53 stage 2 (F131): this harness measures main-thread
    // responsiveness during a raw applyDeltaBatch import, on the SAME
    // Worker instance client.initialize() below runs against — the
    // demoted, unchecked seam, not the gated mutate() path.
    const created = createUncheckedLocalGraphClient(workspaceId);
    clientRef.current = created;
    setClient(created);

    return () => {
      void created.dispose();
    };
  }, [workspaceId]);

  if (!client) return null;

  return (
    <LockedShellGate workspaceId={workspaceId} client={client}>
      <WorkerDiagnosticsReady client={client} workspaceId={workspaceId} />
    </LockedShellGate>
  );
}
