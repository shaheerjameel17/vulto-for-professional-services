import { LocalGraphWorkerRuntime } from "../runtime";
import {
  createProtectedDocumentAddress,
  createProtectedReaderSet,
} from "../protected-document";
import {
  generateTier1DocumentKeyBytes,
  generateTier1IdentityKeyPair,
  unwrapTier1DocumentKey,
  wrapTier1DocumentKey,
  type Tier1RecipientEnvelope,
} from "../tier1-envelope";
import {
  exportP256PublicKey,
  importP256PublicKey,
  type Tier1IdentityTransferPayload,
} from "../tier1-identity-transfer";
import { protectedPartitionManifestStoreKey } from "../storage/storage-keys";

interface WorkerScope {
  onmessage: ((event: MessageEvent<ProofRequest>) => void) | null;
  postMessage(message: ProofResponse): void;
}

type ProofRequest = {
  readonly requestId: string;
  readonly workspaceId: string;
  readonly apiOrigin: string;
  readonly subjectUserId: string;
} & (
  | { readonly type: "create-tier1" }
  | { readonly type: "reopen-tier1" }
  | { readonly type: "prove-failed-persist" }
  | { readonly type: "prepare-race" }
  | { readonly type: "write-race"; readonly storeKey: string; readonly value: string }
  | { readonly type: "inspect-race"; readonly storeKey: string }
  | { readonly type: "prepare-cold-rollback"; readonly storeKey: string }
  | { readonly type: "open-cold-rollback"; readonly storeKey: string }
  | { readonly type: "prove-failed-security-transitions" }
  | { readonly type: "setup-protected-race" }
  | {
      readonly type: "prepare-protected-race";
      readonly readerBPublicKey: string;
      readonly readerCPublicKey: string;
    }
  | {
      readonly type: "commit-protected-race";
      readonly operation: "write" | "remove" | "grant";
    }
  | { readonly type: "inspect-protected-race" }
  | { readonly type: "setup-tier3-race" }
  | {
      readonly type: "prepare-tier3-recovery-race";
      readonly oldRecoveryCode: string;
      readonly credentialId: string;
      readonly prfInput: Uint8Array;
      readonly prfResult: Uint8Array;
    }
  | { readonly type: "commit-tier3-recovery-race" }
  | {
      readonly type: "inspect-tier3-race";
      readonly credentialId: string;
      readonly prfResult: Uint8Array;
    }
  | { readonly type: "prepare-transfer-source" }
  | {
      readonly type: "prepare-transfer-target";
      readonly sourceDeviceId: string;
      readonly transferId: string;
    }
  | {
      readonly type: "create-transfer";
      readonly targetDeviceId: string;
      readonly targetTransferPublicKey: string;
      readonly transferId: string;
      readonly expiresAt: string;
    }
  | {
      readonly type: "accept-transfer";
      readonly transferId: string;
      readonly now: string;
      readonly payload: Tier1IdentityTransferPayload;
      readonly challenge: Tier1RecipientEnvelope;
      readonly expectedDocumentKey: Uint8Array;
    }
);

type ProofResponse =
  | {
      readonly requestId: string;
      readonly ok: true;
      readonly result: Record<string, unknown>;
    }
  | { readonly requestId: string; readonly ok: false; readonly error: string };

const scope = self as unknown as WorkerScope;
let preparedRuntime: LocalGraphWorkerRuntime | null = null;
let preparedReaderB: CryptoKey | null = null;
let preparedReaderC: CryptoKey | null = null;
let preparedTier3RecoveryCode: string | null = null;

async function createTier1(request: ProofRequest): Promise<Record<string, unknown>> {
  const runtime = new LocalGraphWorkerRuntime();
  try {
    await runtime.unlockSealedStore(request.workspaceId, request.apiOrigin);
    await runtime.initialize(request.workspaceId);
    const address = await tier1Address(request);
    const publicKey = await runtime.initializeTier1Identity(request.subjectUserId);
    await runtime.createProtectedPartition(address, [
      { userId: request.subjectUserId, publicKey },
    ]);
    runtime.protectedPartitionsForDiagnostics
      .get(address)!
      .document.getMap("compensation")
      .set("continuity", "survives-worker-termination");
    runtime.protectedPartitionsForDiagnostics.get(address)!.document.commit();
    await runtime.persistProtectedPartitions();
    return {
      createdPartitions: runtime.protectedPartitionsForDiagnostics.size,
      privateKeyExtractable:
        runtime.tier1IdentityCredentialForDiagnostics!.privateKey.extractable,
    };
  } finally {
    await runtime.dispose();
  }
}

async function reopenTier1(request: ProofRequest): Promise<Record<string, unknown>> {
  const runtime = new LocalGraphWorkerRuntime();
  try {
    await runtime.unlockSealedStore(request.workspaceId, request.apiOrigin);
    await runtime.initialize(request.workspaceId);
    const durableManifest = await runtime.openPayload(
      protectedPartitionManifestStoreKey(request.workspaceId),
    );
    await runtime.restoreTier1Identity(request.subjectUserId);
    const credential = runtime.tier1IdentityCredentialForDiagnostics!;
    await runtime.restoreProtectedPartitions([credential]);
    const address = await tier1Address(request);
    const openedKey = await runtime.protectedPartitionsForDiagnostics.openFor(
      address,
      credential.userId,
      credential.privateKey,
    );
    openedKey.fill(0);
    return {
      durableManifestPresent: durableManifest !== null,
      materializedPartitions: runtime.protectedPartitionsForDiagnostics.size,
      reopenedContinuity:
        runtime.protectedPartitionsForDiagnostics
          .get(address)!
          .document.getMap("compensation")
          .get("continuity") === "survives-worker-termination",
      restoredPrivateKeyExtractable: credential.privateKey.extractable,
    };
  } finally {
    await runtime.dispose();
  }
}

async function tier1Address(request: ProofRequest) {
  const readerSet = await createProtectedReaderSet([request.subjectUserId]);
  return createProtectedDocumentAddress({
    workspaceId: request.workspaceId,
    nodeType: "Employee",
    schemaPartition: "compensation",
    tier: 1,
    readerSet,
    timeBucket: "fdn52-worker-restart",
    erasureDomainId: `employee-${request.subjectUserId}`,
  });
}

async function raceAddresses(request: ProofRequest) {
  const base = {
    workspaceId: request.workspaceId,
    nodeType: "Employee",
    schemaPartition: "compensation",
    tier: 1 as const,
    timeBucket: "fdn52-concurrency",
    erasureDomainId: "concurrency-domain",
  };
  const addressAB = await createProtectedDocumentAddress({
    ...base,
    readerSet: await createProtectedReaderSet([request.subjectUserId, "reader-b"]),
  });
  const addressA = await createProtectedDocumentAddress({
    ...base,
    readerSet: await createProtectedReaderSet([request.subjectUserId]),
  });
  const addressABC = await createProtectedDocumentAddress({
    ...base,
    readerSet: await createProtectedReaderSet([
      request.subjectUserId,
      "reader-b",
      "reader-c",
    ]),
  });
  return { addressAB, addressA, addressABC };
}

async function raceTier3Address(request: ProofRequest) {
  return createProtectedDocumentAddress({
    workspaceId: request.workspaceId,
    nodeType: "WellnessTriggerEvent",
    schemaPartition: "private",
    tier: 3,
    readerSet: await createProtectedReaderSet([request.subjectUserId]),
    timeBucket: "current",
    erasureDomainId: "tier3-concurrency-domain",
  });
}

async function inspectGeneration(
  workspaceId: string,
  storeKey: string,
): Promise<number | null> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open("vulto-sealed-store", 1);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("Could not inspect store"));
  });
  try {
    return await new Promise<number | null>((resolve, reject) => {
      const get = database
        .transaction("payload", "readonly")
        .objectStore("payload")
        .get(`${workspaceId}:${storeKey}`);
      get.onsuccess = () => {
        const record = get.result as { generation?: unknown } | undefined;
        resolve(typeof record?.generation === "number" ? record.generation : null);
      };
      get.onerror = () =>
        reject(get.error ?? new Error("Could not inspect payload generation"));
    });
  } finally {
    database.close();
  }
}

async function payloadRecord(
  workspaceId: string,
  storeKey: string,
): Promise<Record<string, unknown>> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open("vulto-sealed-store", 1);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("Could not inspect store"));
  });
  try {
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const get = database
        .transaction("payload", "readonly")
        .objectStore("payload")
        .get(`${workspaceId}:${storeKey}`);
      get.onsuccess = () => resolve(get.result as Record<string, unknown>);
      get.onerror = () =>
        reject(get.error ?? new Error("Could not capture payload record"));
    });
  } finally {
    database.close();
  }
}

async function replacePayloadRecord(record: Record<string, unknown>): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open("vulto-sealed-store", 1);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("Could not inspect store"));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("payload", "readwrite");
      transaction.objectStore("payload").put(record);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Could not replace payload record"));
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Could not replace payload record"));
    });
  } finally {
    database.close();
  }
}

async function proveFailedPersist(
  request: ProofRequest,
): Promise<Record<string, unknown>> {
  const runtime = new LocalGraphWorkerRuntime();
  try {
    await runtime.unlockSealedStore(request.workspaceId, request.apiOrigin);
    await runtime.initialize(request.workspaceId);
    await runtime.restoreTier1Identity(request.subjectUserId);
    await runtime.restoreProtectedPartitions([
      runtime.tier1IdentityCredentialForDiagnostics!,
    ]);
    const storeKey = protectedPartitionManifestStoreKey(request.workspaceId);
    const before = await runtime.openPayload(storeKey);
    runtime.lockSealedStore();
    const address = await tier1Address(request);
    let callRejected = false;
    try {
      await runtime.configureProtectedRetention(address, {
        status: "closed",
        closedAt: "2025-01-01T00:00:00.000Z",
        windowMonths: 12,
        lastAccessedAt: null,
      });
    } catch {
      callRejected = true;
    }
    const memoryMutated =
      runtime.protectedPartitionsForDiagnostics.get(address)!.retention.status ===
      "closed";
    await runtime.unlockSealedStore(request.workspaceId, request.apiOrigin);
    const after = await runtime.openPayload(storeKey);
    const durableUnchanged =
      before !== null &&
      after !== null &&
      before.length === after.length &&
      before.every((byte, index) => byte === after[index]);
    return { callRejected, memoryMutated, durableUnchanged };
  } finally {
    await runtime.dispose();
  }
}

async function proveFailedSecurityTransitions(
  request: ProofRequest,
): Promise<Record<string, unknown>> {
  const readerB = await generateTier1IdentityKeyPair();
  const readerC = await generateTier1IdentityKeyPair();
  const readerSetAB = await createProtectedReaderSet([
    request.subjectUserId,
    "reader-b",
  ]);
  const readerSetA = await createProtectedReaderSet([request.subjectUserId]);
  const readerSetABC = await createProtectedReaderSet([
    request.subjectUserId,
    "reader-b",
    "reader-c",
  ]);
  const addressAB = await createProtectedDocumentAddress({
    workspaceId: request.workspaceId,
    nodeType: "Employee",
    schemaPartition: "compensation",
    tier: 1,
    readerSet: readerSetAB,
    timeBucket: "fdn52-faults",
    erasureDomainId: "fault-domain",
  });
  const addressA = await createProtectedDocumentAddress({
    ...addressAB,
    readerSet: readerSetA,
  });
  const addressABC = await createProtectedDocumentAddress({
    ...addressAB,
    readerSet: readerSetABC,
  });

  const setup = new LocalGraphWorkerRuntime();
  await setup.unlockSealedStore(request.workspaceId, request.apiOrigin);
  await setup.initialize(request.workspaceId);
  const publicA = await setup.initializeTier1Identity(request.subjectUserId);
  await setup.createProtectedPartition(addressAB, [
    { userId: request.subjectUserId, publicKey: publicA },
    { userId: "reader-b", publicKey: readerB.publicKey },
  ]);
  await setup.dispose();

  const openBase = async () => {
    const runtime = new LocalGraphWorkerRuntime();
    await runtime.unlockSealedStore(request.workspaceId, request.apiOrigin);
    await runtime.initialize(request.workspaceId);
    await runtime.restoreTier1Identity(request.subjectUserId);
    await runtime.restoreProtectedPartitions([
      runtime.tier1IdentityCredentialForDiagnostics!,
    ]);
    return runtime;
  };

  const removal = await openBase();
  removal.lockSealedStore();
  let removalRejected = false;
  try {
    await removal.removeProtectedReader({
      address: addressAB,
      nextAddress: addressA,
      removedUserId: "reader-b",
      remainingRecipients: [
        {
          userId: request.subjectUserId,
          publicKey: removal.tier1IdentityPublicKeyForDiagnostics!,
        },
      ],
    });
  } catch {
    removalRejected = true;
  }
  const removalPreservedLive =
    removal.protectedPartitionsForDiagnostics.get(addressAB) !== undefined &&
    removal.protectedPartitionsForDiagnostics.get(addressA) === undefined;
  await removal.unlockSealedStore(request.workspaceId, request.apiOrigin);
  await removal.dispose();

  const grant = await openBase();
  grant.lockSealedStore();
  let grantRejected = false;
  try {
    await grant.addProtectedReader({
      address: addressAB,
      nextAddress: addressABC,
      addedUserId: "reader-c",
      nextRecipients: [
        {
          userId: request.subjectUserId,
          publicKey: grant.tier1IdentityPublicKeyForDiagnostics!,
        },
        { userId: "reader-b", publicKey: readerB.publicKey },
        { userId: "reader-c", publicKey: readerC.publicKey },
      ],
      authorizingCredential: grant.tier1IdentityCredentialForDiagnostics!,
    });
  } catch {
    grantRejected = true;
  }
  const grantPreservedLive =
    grant.protectedPartitionsForDiagnostics.get(addressAB) !== undefined &&
    grant.protectedPartitionsForDiagnostics.get(addressABC) === undefined;
  await grant.unlockSealedStore(request.workspaceId, request.apiOrigin);
  await grant.dispose();

  const erasure = await openBase();
  erasure.lockSealedStore();
  let erasureRejected = false;
  try {
    await erasure.cryptographicallyEraseProtectedDomain("fault-domain");
  } catch {
    erasureRejected = true;
  }
  const erasurePreservedLive =
    erasure.protectedPartitionsForDiagnostics.get(addressAB) !== undefined;
  await erasure.unlockSealedStore(request.workspaceId, request.apiOrigin);
  await erasure.dispose();
  const reopenedTier1 = await openBase();
  const tier1DurablePreserved =
    reopenedTier1.protectedPartitionsForDiagnostics.get(addressAB) !== undefined;
  await reopenedTier1.dispose();

  const tier3Address = await createProtectedDocumentAddress({
    workspaceId: request.workspaceId,
    nodeType: "WellnessTriggerEvent",
    schemaPartition: "private",
    tier: 3,
    readerSet: await createProtectedReaderSet([request.subjectUserId]),
    timeBucket: "current",
    erasureDomainId: "tier3-fault-domain",
  });
  const oldPrf = new Uint8Array(32).fill(81);
  const tier3Setup = new LocalGraphWorkerRuntime();
  await tier3Setup.unlockSealedStore(request.workspaceId, request.apiOrigin);
  await tier3Setup.initialize(request.workspaceId);
  const oldCode = await tier3Setup.beginTier3Enrollment({
    address: tier3Address,
    sessionUserId: request.subjectUserId,
    credentialId: "credential-old",
    prfInput: new Uint8Array(32).fill(80),
    prfResult: oldPrf,
  });
  await tier3Setup.confirmTier3Enrollment(oldCode);
  await tier3Setup.dispose();

  const recovery = new LocalGraphWorkerRuntime();
  await recovery.unlockSealedStore(request.workspaceId, request.apiOrigin);
  await recovery.initialize(request.workspaceId);
  const replacementCode = await recovery.recoverTier3Partitions({
    sessionUserId: request.subjectUserId,
    credentialId: "credential-new",
    prfInput: new Uint8Array(32).fill(82),
    prfResult: new Uint8Array(32).fill(83),
    recoveryCode: oldCode,
  });
  recovery.lockSealedStore();
  let recoveryRejected = false;
  try {
    await recovery.confirmTier3Recovery(replacementCode);
  } catch {
    recoveryRejected = true;
  }
  await recovery.unlockSealedStore(request.workspaceId, request.apiOrigin);
  await recovery.dispose();

  const tier3Reopen = new LocalGraphWorkerRuntime();
  await tier3Reopen.unlockSealedStore(request.workspaceId, request.apiOrigin);
  await tier3Reopen.initialize(request.workspaceId);
  await tier3Reopen.restoreTier3Partitions({
    sessionUserId: request.subjectUserId,
    credentialId: "credential-old",
    prfResult: oldPrf,
  });
  const recoveryPreservedOldDurable =
    tier3Reopen.tier3PartitionsForDiagnostics.get(tier3Address) !== undefined;
  tier3Reopen.lockSealedStore();
  let tier3ErasureRejected = false;
  try {
    await tier3Reopen.cryptographicallyEraseTier3Domain("tier3-fault-domain");
  } catch {
    tier3ErasureRejected = true;
  }
  const tier3ErasurePreservedLive =
    tier3Reopen.tier3PartitionsForDiagnostics.get(tier3Address) !== undefined;
  await tier3Reopen.unlockSealedStore(request.workspaceId, request.apiOrigin);
  await tier3Reopen.dispose();

  const tier3ErasureReopen = new LocalGraphWorkerRuntime();
  await tier3ErasureReopen.unlockSealedStore(request.workspaceId, request.apiOrigin);
  await tier3ErasureReopen.initialize(request.workspaceId);
  await tier3ErasureReopen.restoreTier3Partitions({
    sessionUserId: request.subjectUserId,
    credentialId: "credential-old",
    prfResult: oldPrf,
  });
  const tier3ErasureDurablePreserved =
    tier3ErasureReopen.tier3PartitionsForDiagnostics.get(tier3Address) !== undefined;
  await tier3ErasureReopen.dispose();

  return {
    removalRejected,
    removalPreservedLive,
    grantRejected,
    grantPreservedLive,
    erasureRejected,
    erasurePreservedLive,
    tier1DurablePreserved,
    recoveryRejected,
    recoveryPreservedOldDurable,
    tier3ErasureRejected,
    tier3ErasurePreservedLive,
    tier3ErasureDurablePreserved,
  };
}

async function handle(request: ProofRequest): Promise<Record<string, unknown>> {
  switch (request.type) {
    case "create-tier1":
      return createTier1(request);
    case "reopen-tier1":
      return reopenTier1(request);
    case "prove-failed-persist":
      return proveFailedPersist(request);
    case "prove-failed-security-transitions":
      return proveFailedSecurityTransitions(request);
    case "setup-protected-race": {
      const runtime = new LocalGraphWorkerRuntime();
      try {
        await runtime.unlockSealedStore(request.workspaceId, request.apiOrigin);
        await runtime.initialize(request.workspaceId);
        const publicA = await runtime.initializeTier1Identity(request.subjectUserId);
        const readerB = await crypto.subtle.generateKey(
          { name: "ECDH", namedCurve: "P-256" },
          true,
          ["deriveBits"],
        );
        const readerC = await crypto.subtle.generateKey(
          { name: "ECDH", namedCurve: "P-256" },
          true,
          ["deriveBits"],
        );
        const { addressAB } = await raceAddresses(request);
        await runtime.createProtectedPartition(addressAB, [
          { userId: request.subjectUserId, publicKey: publicA },
          { userId: "reader-b", publicKey: readerB.publicKey },
        ]);
        return {
          readerBPublicKey: await exportP256PublicKey(readerB.publicKey),
          readerCPublicKey: await exportP256PublicKey(readerC.publicKey),
        };
      } finally {
        await runtime.dispose();
      }
    }
    case "prepare-protected-race": {
      if (preparedRuntime !== null) throw new Error("Race Worker is already prepared");
      preparedRuntime = new LocalGraphWorkerRuntime();
      await preparedRuntime.unlockSealedStore(request.workspaceId, request.apiOrigin);
      await preparedRuntime.initialize(request.workspaceId);
      await preparedRuntime.restoreTier1Identity(request.subjectUserId);
      await preparedRuntime.restoreProtectedPartitions([
        preparedRuntime.tier1IdentityCredentialForDiagnostics!,
      ]);
      preparedReaderB = await importP256PublicKey(request.readerBPublicKey);
      preparedReaderC = await importP256PublicKey(request.readerCPublicKey);
      return { ready: true };
    }
    case "commit-protected-race": {
      if (
        preparedRuntime === null ||
        preparedReaderB === null ||
        preparedReaderC === null
      ) {
        throw new Error("Protected race Worker is not prepared");
      }
      const { addressAB, addressA, addressABC } = await raceAddresses(request);
      if (request.operation === "write") {
        await preparedRuntime.configureProtectedRetention(addressAB, {
          status: "closed",
          closedAt: "2025-04-01T00:00:00.000Z",
          windowMonths: 12,
          lastAccessedAt: new Date().toISOString(),
        });
      } else if (request.operation === "remove") {
        await preparedRuntime.removeProtectedReader({
          address: addressAB,
          nextAddress: addressA,
          removedUserId: "reader-b",
          remainingRecipients: [
            {
              userId: request.subjectUserId,
              publicKey: preparedRuntime.tier1IdentityPublicKeyForDiagnostics!,
            },
          ],
        });
      } else {
        await preparedRuntime.addProtectedReader({
          address: addressAB,
          nextAddress: addressABC,
          addedUserId: "reader-c",
          nextRecipients: [
            {
              userId: request.subjectUserId,
              publicKey: preparedRuntime.tier1IdentityPublicKeyForDiagnostics!,
            },
            { userId: "reader-b", publicKey: preparedReaderB },
            { userId: "reader-c", publicKey: preparedReaderC },
          ],
          authorizingCredential: preparedRuntime.tier1IdentityCredentialForDiagnostics!,
        });
      }
      return { committed: request.operation };
    }
    case "inspect-protected-race": {
      const runtime = new LocalGraphWorkerRuntime();
      try {
        await runtime.unlockSealedStore(request.workspaceId, request.apiOrigin);
        await runtime.initialize(request.workspaceId);
        await runtime.restoreTier1Identity(request.subjectUserId);
        await runtime.restoreProtectedPartitions([
          runtime.tier1IdentityCredentialForDiagnostics!,
        ]);
        const { addressAB, addressA, addressABC } = await raceAddresses(request);
        const active = [addressA, addressAB, addressABC]
          .map((address) => runtime.protectedPartitionsForDiagnostics.get(address))
          .find((partition) => partition !== undefined);
        return {
          activeReaders: active?.envelopes.size ?? 0,
          retentionStatus: active?.retention.status ?? "missing",
          partitionCount: runtime.protectedPartitionsForDiagnostics.size,
        };
      } finally {
        await runtime.dispose();
      }
    }
    case "setup-tier3-race": {
      const runtime = new LocalGraphWorkerRuntime();
      try {
        await runtime.unlockSealedStore(request.workspaceId, request.apiOrigin);
        await runtime.initialize(request.workspaceId);
        const oldPrfResult = new Uint8Array(32).fill(91);
        const oldRecoveryCode = await runtime.beginTier3Enrollment({
          address: await raceTier3Address(request),
          sessionUserId: request.subjectUserId,
          credentialId: "credential-old",
          prfInput: new Uint8Array(32).fill(90),
          prfResult: oldPrfResult,
        });
        await runtime.confirmTier3Enrollment(oldRecoveryCode);
        return { oldRecoveryCode, oldPrfResult };
      } finally {
        await runtime.dispose();
      }
    }
    case "prepare-tier3-recovery-race": {
      if (preparedRuntime !== null) throw new Error("Race Worker is already prepared");
      preparedRuntime = new LocalGraphWorkerRuntime();
      await preparedRuntime.unlockSealedStore(request.workspaceId, request.apiOrigin);
      await preparedRuntime.initialize(request.workspaceId);
      preparedTier3RecoveryCode = await preparedRuntime.recoverTier3Partitions({
        sessionUserId: request.subjectUserId,
        credentialId: request.credentialId,
        prfInput: request.prfInput,
        prfResult: request.prfResult,
        recoveryCode: request.oldRecoveryCode,
      });
      return { replacementCode: preparedTier3RecoveryCode };
    }
    case "commit-tier3-recovery-race": {
      if (preparedRuntime === null || preparedTier3RecoveryCode === null) {
        throw new Error("Tier 3 recovery race Worker is not prepared");
      }
      await preparedRuntime.confirmTier3Recovery(preparedTier3RecoveryCode);
      return { committed: true };
    }
    case "inspect-tier3-race": {
      const runtime = new LocalGraphWorkerRuntime();
      try {
        await runtime.unlockSealedStore(request.workspaceId, request.apiOrigin);
        await runtime.initialize(request.workspaceId);
        await runtime.restoreTier3Partitions({
          sessionUserId: request.subjectUserId,
          credentialId: request.credentialId,
          prfResult: request.prfResult,
        });
        return {
          generation:
            runtime.tier3PartitionsForDiagnostics.roots()[0]?.generation ?? -1,
          documents: runtime.tier3PartitionsForDiagnostics.size,
        };
      } finally {
        await runtime.dispose();
      }
    }
    case "prepare-race": {
      if (preparedRuntime !== null) throw new Error("Race Worker is already prepared");
      preparedRuntime = new LocalGraphWorkerRuntime();
      await preparedRuntime.unlockSealedStore(request.workspaceId, request.apiOrigin);
      await preparedRuntime.initialize(request.workspaceId);
      await preparedRuntime.restoreTier1Identity(request.subjectUserId);
      await preparedRuntime.restoreProtectedPartitions([
        preparedRuntime.tier1IdentityCredentialForDiagnostics!,
      ]);
      return { ready: true };
    }
    case "write-race": {
      if (preparedRuntime === null) throw new Error("Race Worker is not prepared");
      await preparedRuntime.configureProtectedRetention(await tier1Address(request), {
        status: "closed",
        closedAt:
          request.value === "left"
            ? "2025-02-01T00:00:00.000Z"
            : "2025-03-01T00:00:00.000Z",
        windowMonths: 12,
        lastAccessedAt: null,
      });
      return { wrote: true };
    }
    case "inspect-race":
      return {
        generation: await inspectGeneration(request.workspaceId, request.storeKey),
      };
    case "prepare-cold-rollback": {
      const runtime = new LocalGraphWorkerRuntime();
      try {
        await runtime.unlockSealedStore(request.workspaceId, request.apiOrigin);
        await runtime.sealPayload(request.storeKey, new TextEncoder().encode("old"));
        const oldRecord = await payloadRecord(request.workspaceId, request.storeKey);
        await runtime.sealPayload(request.storeKey, new TextEncoder().encode("new"));
        await replacePayloadRecord(oldRecord);
        return { replacedWithOldRecord: true };
      } finally {
        await runtime.dispose();
      }
    }
    case "open-cold-rollback": {
      const runtime = new LocalGraphWorkerRuntime();
      try {
        await runtime.unlockSealedStore(request.workspaceId, request.apiOrigin);
        const value = await runtime.openPayload(request.storeKey);
        return {
          value: value === null ? null : new TextDecoder().decode(value),
          generation: await inspectGeneration(request.workspaceId, request.storeKey),
        };
      } finally {
        await runtime.dispose();
      }
    }
    case "prepare-transfer-source": {
      if (preparedRuntime !== null)
        throw new Error("Transfer Worker is already prepared");
      preparedRuntime = new LocalGraphWorkerRuntime();
      await preparedRuntime.unlockSealedStore(request.workspaceId, request.apiOrigin);
      await preparedRuntime.initialize(request.workspaceId);
      await preparedRuntime.restoreTier1Identity(request.subjectUserId);
      return { deviceId: await preparedRuntime.deviceIdForDiagnostics() };
    }
    case "prepare-transfer-target": {
      if (preparedRuntime !== null)
        throw new Error("Transfer Worker is already prepared");
      preparedRuntime = new LocalGraphWorkerRuntime();
      await preparedRuntime.unlockSealedStore(request.workspaceId, request.apiOrigin);
      await preparedRuntime.initialize(request.workspaceId);
      return preparedRuntime.beginTier1IdentityTransferTarget({
        canonicalUserId: request.subjectUserId,
        sourceDeviceId: request.sourceDeviceId,
        transferId: request.transferId,
      });
    }
    case "create-transfer": {
      if (preparedRuntime === null) throw new Error("Transfer source is not prepared");
      const payload = await preparedRuntime.createTier1IdentityTransfer({
        canonicalUserId: request.subjectUserId,
        targetDeviceId: request.targetDeviceId,
        targetTransferPublicKey: request.targetTransferPublicKey,
        transferId: request.transferId,
        expiresAt: request.expiresAt,
      });
      const documentKey = generateTier1DocumentKeyBytes();
      const challenge = await wrapTier1DocumentKey({
        address: await tier1Address(request),
        keyEpoch: 0,
        recipient: {
          userId: request.subjectUserId,
          publicKey: preparedRuntime.tier1IdentityPublicKeyForDiagnostics!,
        },
        documentKeyBytes: documentKey,
      });
      return { payload, challenge, expectedDocumentKey: documentKey };
    }
    case "accept-transfer": {
      if (preparedRuntime === null) throw new Error("Transfer target is not prepared");
      await preparedRuntime.acceptTier1IdentityTransfer({
        payload: request.payload,
        transferId: request.transferId,
        now: request.now,
      });
      const credential = preparedRuntime.tier1IdentityCredentialForDiagnostics!;
      const opened = await unwrapTier1DocumentKey({
        envelope: request.challenge,
        recipientUserId: request.subjectUserId,
        privateKey: credential.privateKey,
      });
      const challengeOpened =
        opened.length === request.expectedDocumentKey.length &&
        opened.every((byte, index) => byte === request.expectedDocumentKey[index]);
      opened.fill(0);
      let replayDenied = false;
      try {
        await preparedRuntime.acceptTier1IdentityTransfer({
          payload: request.payload,
          transferId: request.transferId,
          now: request.now,
        });
      } catch {
        replayDenied = true;
      }
      return {
        challengeOpened,
        replayDenied,
        privateKeyExtractable: credential.privateKey.extractable,
      };
    }
  }
}

scope.onmessage = (event) => {
  const request = event.data;
  void handle(request)
    .then((result) =>
      scope.postMessage({ requestId: request.requestId, ok: true, result }),
    )
    .catch((error: unknown) =>
      scope.postMessage({
        requestId: request.requestId,
        ok: false,
        error: error instanceof Error ? error.message : "Durability proof failed",
      }),
    );
};
