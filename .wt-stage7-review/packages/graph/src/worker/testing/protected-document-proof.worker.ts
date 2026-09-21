import {
  createProtectedDocumentAddress,
  createProtectedEnvelopeHeader,
  createProtectedReaderSet,
  protectedEnvelopeAdditionalData,
} from "../protected-document";
import {
  generateTier1IdentityKeyPair,
  unwrapTier1DocumentKey,
  wrapTier1DocumentKey,
} from "../tier1-envelope";
import {
  importTier1SharedVectorKeyPair,
  tier1EnvelopeSharedVector,
  tier1SharedVectorDocumentKey,
  tier1SharedVectorIv,
} from "./tier1-envelope-shared-vector";
import initializeLoro from "loro-crdt/web/loro_wasm.js";
import { LoroDoc, LoroMap } from "loro-crdt/web";
import {
  NODE_FRAGMENT_CONTAINER,
  nodeFragmentKey,
  readNodeFragments,
} from "../document-node-fragments";
import { LocalGraphWorkerRuntime } from "../runtime";
import {
  decryptProtectedSnapshot,
  protectedPartitionKey,
} from "../protected-partitions";
import {
  graphSnapshotStoreKey,
  protectedPartitionManifestStoreKey,
  tier3PartitionManifestStoreKey,
} from "../storage/storage-keys";
import {
  createTier3RootAddress,
  decodeBase64Url,
  decodeTier3RecoveryCode,
  unwrapTier3Root,
} from "../tier3-root";
import { tier3ManifestSchema, type Tier3Manifest } from "../tier3-partitions";

interface WorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

interface ProofRequest {
  readonly workspaceId: string;
  readonly apiOrigin: string;
  readonly subjectUserId: string;
}

const scope = self as unknown as WorkerScope;
const decoder = new TextDecoder();

async function runProof(request: ProofRequest): Promise<{
  readonly readerSetId: string;
  readonly canonicalHeader: string;
  readonly tier1RoundTrip: boolean;
  readonly tier1SharedVectorMatches: boolean;
  readonly stage3PartitionsAfterReopen: number;
  readonly stage3EpochAfterReopen: number;
  readonly stage3RemovedReaderDenied: boolean;
  readonly stage3OldKeyDenied: boolean;
  readonly stage3DocumentBUnaffected: boolean;
  readonly stage3WorkspaceUnaffected: boolean;
  readonly stage3WorkspaceDocumentStayedTier02: boolean;
  readonly stage3AddressMappingRestored: boolean;
  readonly stage3PostReopenWriteSurvived: boolean;
  readonly stage3HistoryStayedLazy: boolean;
  readonly stage3ManifestStayedSealed: boolean;
  readonly stage3UnauthorizedOnlyMaterializationDenied: boolean;
  readonly stage3UnauthorizedOnlyOpenDenied: boolean;
  readonly stage3WrongWorkspaceDenied: boolean;
  readonly stage6ImmediateReaderGrant: boolean;
  readonly stage6RetentionLifecycle: boolean;
  readonly stage6CryptographicErasure: boolean;
  readonly stage6IntegratedColdReopen: boolean;
  readonly tier3EnrollmentSubjectOnly: boolean;
  readonly tier3PrfPersistentReopen: boolean;
  readonly tier3MandatoryRecoveryConfirmed: boolean;
  readonly tier3RecoverySubjectOnly: boolean;
  readonly tier3WrongRecoveryCodeDenied: boolean;
  readonly tier3OldRecoveryPathDenied: boolean;
  readonly tier3RetiredCredentialDenied: boolean;
  readonly tier3PostRecoveryEpoch: number;
  readonly tier3PostRecoveryWriteSurvived: boolean;
  readonly tier3UnrelatedDocumentSurvived: boolean;
  readonly tier3WorkspaceStateSurvived: boolean;
  readonly tier3GenerationHistoryValidated: boolean;
  readonly tier3RootRotated: boolean;
  readonly tier3KeysStayedWorkerPrivate: boolean;
}> {
  // Intentionally reversed supplied IDs: a Worker, not the main thread,
  // performs the one canonical reader-set normalization FDN-89 will later
  // feed with real graph-derived people.
  const readerSet = await createProtectedReaderSet(["user-bravo", "user-alpha"]);
  const address = await createProtectedDocumentAddress({
    workspaceId: "workspace-1",
    nodeType: "Employee",
    schemaPartition: "compensation",
    tier: 1,
    readerSet,
    timeBucket: "2026-08",
    erasureDomainId: "employee-1",
  });
  const header = createProtectedEnvelopeHeader({
    address,
    keyEpoch: 3,
    ciphertextKind: "document-snapshot",
  });
  const recipient = await generateTier1IdentityKeyPair();
  const documentKey = new Uint8Array(32).fill(7);
  const envelope = await wrapTier1DocumentKey({
    address,
    keyEpoch: 3,
    recipient: { userId: "user-alpha", publicKey: recipient.publicKey },
    documentKeyBytes: documentKey,
  });
  const opened = await unwrapTier1DocumentKey({
    envelope,
    recipientUserId: "user-alpha",
    privateKey: recipient.privateKey,
  });
  const vectorRecipient = await importTier1SharedVectorKeyPair(
    tier1EnvelopeSharedVector.recipientPrivateJwk,
    tier1EnvelopeSharedVector.recipientPublicJwk,
  );
  const vectorEphemeral = await importTier1SharedVectorKeyPair(
    tier1EnvelopeSharedVector.ephemeralPrivateJwk,
    tier1EnvelopeSharedVector.ephemeralPublicJwk,
    true,
  );
  // The shared vector deliberately has a one-person reader set. It must not
  // reuse the two-person address above: that address is authenticated input,
  // so changing it is supposed to change the envelope bytes.
  const vectorReaderSet = await createProtectedReaderSet(["user-alpha"]);
  const vectorAddress = await createProtectedDocumentAddress({
    workspaceId: "workspace-1",
    nodeType: "Employee",
    schemaPartition: "compensation",
    tier: 1,
    readerSet: vectorReaderSet,
    timeBucket: "2026-08",
    erasureDomainId: "employee-1",
  });
  const vectorEnvelope = await wrapTier1DocumentKey({
    address: vectorAddress,
    keyEpoch: 1,
    recipient: { userId: "user-alpha", publicKey: vectorRecipient.publicKey },
    documentKeyBytes: tier1SharedVectorDocumentKey(),
    ephemeralKeyPair: vectorEphemeral,
    iv: tier1SharedVectorIv(),
  });
  const vectorCiphertext = btoa(String.fromCharCode(...vectorEnvelope.ciphertext));
  const stage3 = await runStage3Proof(request);
  const stage5 = await runStage5Proof(request, stage3.context);
  return {
    readerSetId: readerSet.id,
    canonicalHeader: decoder.decode(protectedEnvelopeAdditionalData(header)),
    tier1RoundTrip: opened.every((byte) => byte === 7),
    tier1SharedVectorMatches:
      vectorEnvelope.header.ephemeralPublicKey ===
        tier1EnvelopeSharedVector.expected.ephemeralPublicKey &&
      vectorCiphertext === tier1EnvelopeSharedVector.expected.ciphertextBase64,
    ...stage3.result,
    ...stage5,
  };
}

const pendingPrf = new Map<
  string,
  {
    resolve(value: { credentialId: string; prfResult: Uint8Array }): void;
    reject(error: Error): void;
  }
>();

async function requestPrf(
  credentialSlot: string,
  create: boolean,
  suppliedInput?: Uint8Array,
): Promise<{
  prfInput: Uint8Array;
  credentialId: string;
  prfResult: Uint8Array;
}> {
  const prfInput = suppliedInput ?? crypto.getRandomValues(new Uint8Array(32));
  const requestId = crypto.randomUUID();
  const result = new Promise<{ credentialId: string; prfResult: Uint8Array }>(
    (resolve, reject) => pendingPrf.set(requestId, { resolve, reject }),
  );
  const outbound = prfInput.slice().buffer;
  scope.postMessage(
    {
      type: "tier3-prf-request",
      requestId,
      credentialSlot,
      create,
      prfInput: outbound,
    },
    [outbound],
  );
  return { prfInput, ...(await result) };
}

function corruptRecoveryCode(code: string): string {
  return code.slice(0, -1) + (code.endsWith("0") ? "1" : "0");
}

const ACTOR = "44444444-4444-4444-8444-444444444444";
const EMPLOYEE_A = "55555555-5555-4555-8555-555555555551";
const EMPLOYEE_B = "55555555-5555-4555-8555-555555555552";
const EMPLOYEE_C = "55555555-5555-4555-8555-555555555553";

interface Stage3Context {
  readonly readerA: CryptoKeyPair;
  readonly readerC: CryptoKeyPair;
  readonly grantedAddressA: Awaited<ReturnType<typeof createProtectedDocumentAddress>>;
  readonly addressB: Awaited<ReturnType<typeof createProtectedDocumentAddress>>;
  readonly erasedAddressC: Awaited<ReturnType<typeof createProtectedDocumentAddress>>;
}

function writeEmployeeFragment(
  document: LoroDoc,
  workspaceId: string,
  employeeId: string,
  partitionKey: "operational" | "compensation",
  value: string | number,
): void {
  const fragment = document
    .getMap(NODE_FRAGMENT_CONTAINER)
    .setContainer(nodeFragmentKey(employeeId, partitionKey), new LoroMap());
  const record: Record<string, unknown> = {
    node_id: employeeId,
    workspace_id: workspaceId,
    node_type: "Employee",
    schema_version: 1,
    lifecycle_status: "Active",
    created_at: "2026-01-01T09:00:00.000Z",
    created_by: ACTOR,
    updated_at: "2026-01-01T09:00:00.000Z",
    updated_by: ACTOR,
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
    ...(partitionKey === "operational" ? { job_title: value } : { base_salary: value }),
  };
  for (const [field, fieldValue] of Object.entries(record)) {
    fragment.set(field, fieldValue);
  }
  document.commit();
}

function workspaceSnapshot(workspaceId: string): Uint8Array {
  const document = new LoroDoc();
  writeEmployeeFragment(document, workspaceId, EMPLOYEE_A, "operational", "A");
  writeEmployeeFragment(document, workspaceId, EMPLOYEE_B, "operational", "B");
  const snapshot = document.export({ mode: "snapshot" });
  document.free();
  return snapshot;
}

async function runStage3Proof(request: ProofRequest) {
  await initializeLoro();
  const readerA = await generateTier1IdentityKeyPair();
  const readerB = await generateTier1IdentityKeyPair();
  const readerC = await generateTier1IdentityKeyPair();
  const bothReaders = await createProtectedReaderSet(["reader-a", "reader-b"]);
  const onlyReaderA = await createProtectedReaderSet(["reader-a"]);
  const readerAAndC = await createProtectedReaderSet(["reader-a", "reader-c"]);
  const addressA = await createProtectedDocumentAddress({
    workspaceId: request.workspaceId,
    nodeType: "Employee",
    schemaPartition: "compensation",
    tier: 1,
    readerSet: bothReaders,
    timeBucket: "current",
    erasureDomainId: EMPLOYEE_A,
  });
  const rotatedAddressA = await createProtectedDocumentAddress({
    workspaceId: request.workspaceId,
    nodeType: "Employee",
    schemaPartition: "compensation",
    tier: 1,
    readerSet: onlyReaderA,
    timeBucket: "current",
    erasureDomainId: EMPLOYEE_A,
  });
  const addressB = await createProtectedDocumentAddress({
    workspaceId: request.workspaceId,
    nodeType: "Employee",
    schemaPartition: "compensation",
    tier: 1,
    readerSet: bothReaders,
    timeBucket: "current",
    erasureDomainId: EMPLOYEE_B,
  });
  const addressC = await createProtectedDocumentAddress({
    workspaceId: request.workspaceId,
    nodeType: "Employee",
    schemaPartition: "compensation",
    tier: 1,
    readerSet: bothReaders,
    timeBucket: "current",
    erasureDomainId: EMPLOYEE_C,
  });
  const grantedAddressA = await createProtectedDocumentAddress({
    workspaceId: request.workspaceId,
    nodeType: "Employee",
    schemaPartition: "compensation",
    tier: 1,
    readerSet: readerAAndC,
    timeBucket: "current",
    erasureDomainId: EMPLOYEE_A,
  });
  const wrongWorkspaceAddress = await createProtectedDocumentAddress({
    workspaceId: `${request.workspaceId}-other`,
    nodeType: "Employee",
    schemaPartition: "compensation",
    tier: 1,
    readerSet: bothReaders,
    timeBucket: "current",
    erasureDomainId: "wrong-workspace-domain",
  });
  const recipients = [
    { userId: "reader-a", publicKey: readerA.publicKey },
    { userId: "reader-b", publicKey: readerB.publicKey },
  ];

  const first = new LocalGraphWorkerRuntime();
  let oldDocumentAKey = new Uint8Array();
  let oldEpochCiphertext = "";
  let stage3WrongWorkspaceDenied = false;
  try {
    await first.unlockSealedStore(request.workspaceId, request.apiOrigin);
    await first.initialize(request.workspaceId);
    const workspace = workspaceSnapshot(request.workspaceId);
    await first.applyDeltaBatch([workspace.slice().buffer]);
    await first.sealPayload(
      "fdn52-stage3-unrelated",
      new TextEncoder().encode("intact"),
    );
    try {
      await first.createProtectedPartition(wrongWorkspaceAddress, recipients);
      await first.purgeProtectedPartition(wrongWorkspaceAddress);
    } catch {
      stage3WrongWorkspaceDenied = true;
    }
    await first.createProtectedPartition(addressA, recipients);
    await first.createProtectedPartition(addressB, recipients);
    await first.createProtectedPartition(addressC, recipients, {
      status: "closed",
      closedAt: "2025-01-01T00:00:00.000Z",
      windowMonths: 12,
      lastAccessedAt: null,
    });
    const partitionA = first.protectedPartitionsForDiagnostics.get(addressA)!;
    const partitionB = first.protectedPartitionsForDiagnostics.get(addressB)!;
    const partitionC = first.protectedPartitionsForDiagnostics.get(addressC)!;
    writeEmployeeFragment(
      partitionA.document,
      request.workspaceId,
      EMPLOYEE_A,
      "compensation",
      100,
    );
    writeEmployeeFragment(
      partitionB.document,
      request.workspaceId,
      EMPLOYEE_B,
      "compensation",
      200,
    );
    writeEmployeeFragment(
      partitionC.document,
      request.workspaceId,
      EMPLOYEE_C,
      "compensation",
      300,
    );
    await first.persistProtectedPartitions();
    oldDocumentAKey = new Uint8Array(
      await first.protectedPartitionsForDiagnostics.openFor(
        addressA,
        "reader-b",
        readerB.privateKey,
      ),
    );
    await first.removeProtectedReader({
      address: addressA,
      nextAddress: rotatedAddressA,
      removedUserId: "reader-b",
      remainingRecipients: [{ userId: "reader-a", publicKey: readerA.publicKey }],
    });
    const rotated = first.protectedPartitionsForDiagnostics.get(rotatedAddressA)!;
    const fragment = rotated.document
      .getMap(NODE_FRAGMENT_CONTAINER)
      .get(nodeFragmentKey(EMPLOYEE_A, "compensation")) as LoroMap;
    fragment.set("base_salary", 125);
    rotated.document.commit();
    await first.persistProtectedPartitions();
    const firstManifestBytes = await first.openPayload(
      protectedPartitionManifestStoreKey(request.workspaceId),
    );
    const firstManifest = JSON.parse(new TextDecoder().decode(firstManifestBytes!)) as {
      partitions: Array<{
        address: typeof rotatedAddressA;
        historicalEpochs: Array<{ ciphertext: string }>;
      }>;
    };
    oldEpochCiphertext = firstManifest.partitions.find(
      (partition) => partition.address.erasureDomainId === EMPLOYEE_A,
    )!.historicalEpochs[0]!.ciphertext;
  } finally {
    await first.dispose();
  }

  const second = new LocalGraphWorkerRuntime();
  let stage3WorkspaceDocumentStayedTier02 = false;
  try {
    await second.unlockSealedStore(request.workspaceId, request.apiOrigin);
    await second.initialize(request.workspaceId);
    const workspaceBytes = await second.openPayload(
      graphSnapshotStoreKey(request.workspaceId),
    );
    const workspaceDocument = new LoroDoc();
    workspaceDocument.import(workspaceBytes!);
    const workspaceFragments = readNodeFragments(workspaceDocument);
    stage3WorkspaceDocumentStayedTier02 =
      second.protectedPartitionsForDiagnostics.size === 0 &&
      workspaceFragments.length === 2 &&
      workspaceFragments.every(
        ({ record }) => !("base_salary" in (record as Record<string, unknown>)),
      );
    workspaceDocument.free();
    await second.restoreProtectedPartitions([
      { userId: "reader-a", privateKey: readerA.privateKey },
      { userId: "reader-b", privateKey: readerB.privateKey },
    ]);
    const reopenedA = second.protectedPartitionsForDiagnostics.get(rotatedAddressA)!;
    const fragment = reopenedA.document
      .getMap(NODE_FRAGMENT_CONTAINER)
      .get(nodeFragmentKey(EMPLOYEE_A, "compensation")) as LoroMap;
    fragment.set("base_salary", 150);
    reopenedA.document.commit();
    await second.persistProtectedPartitions();
  } finally {
    await second.dispose();
  }

  const third = new LocalGraphWorkerRuntime();
  let stage3RemovedReaderDenied = false;
  let stage3OldKeyDenied = false;
  let stage3DocumentBUnaffected = false;
  let stage3WorkspaceUnaffected = false;
  let stage3AddressMappingRestored = false;
  let stage3PostReopenWriteSurvived = false;
  let stage3HistoryStayedLazy = false;
  let stage3ManifestStayedSealed = false;
  let stage3PartitionsAfterReopen = -1;
  let stage3EpochAfterReopen = -1;
  let stage6ImmediateReaderGrant = false;
  try {
    await third.unlockSealedStore(request.workspaceId, request.apiOrigin);
    await third.initialize(request.workspaceId);
    await third.restoreProtectedPartitions([
      { userId: "reader-a", privateKey: readerA.privateKey },
      { userId: "reader-b", privateKey: readerB.privateKey },
    ]);
    stage3PartitionsAfterReopen = third.protectedPartitionsForDiagnostics.size;
    const reopenedA = third.protectedPartitionsForDiagnostics.get(rotatedAddressA)!;
    const reopenedB = third.protectedPartitionsForDiagnostics.get(addressB)!;
    stage3EpochAfterReopen = reopenedA.keyEpoch;
    stage3AddressMappingRestored =
      third.protectedPartitionsForDiagnostics.get(addressA) === undefined &&
      reopenedA.address.readerSetId === onlyReaderA.id &&
      reopenedB.address.erasureDomainId === EMPLOYEE_B;
    const aRecord = readNodeFragments(reopenedA.document)[0]!.record as Record<
      string,
      unknown
    >;
    const bRecord = readNodeFragments(reopenedB.document)[0]!.record as Record<
      string,
      unknown
    >;
    stage3PostReopenWriteSurvived = aRecord["base_salary"] === 150;
    const marker = await third.openPayload("fdn52-stage3-unrelated");
    stage3WorkspaceUnaffected =
      new TextDecoder().decode(marker ?? new Uint8Array()) === "intact" &&
      third.materializedIndexForDiagnostics
        ?.canonicalSnapshot()
        .includes(EMPLOYEE_A) === true &&
      third.materializedIndexForDiagnostics
        ?.canonicalSnapshot()
        .includes(EMPLOYEE_B) === true &&
      aRecord["base_salary"] === 150;
    stage3DocumentBUnaffected =
      bRecord["base_salary"] === 200 &&
      (
        await third.protectedPartitionsForDiagnostics.openFor(
          addressB,
          "reader-b",
          readerB.privateKey,
        )
      ).byteLength === 32;
    try {
      await third.protectedPartitionsForDiagnostics.openFor(
        rotatedAddressA,
        "reader-b",
        readerB.privateKey,
      );
    } catch {
      stage3RemovedReaderDenied = true;
    }
    const manifestBytes = await third.openPayload(
      protectedPartitionManifestStoreKey(request.workspaceId),
    );
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes!)) as {
      partitions: Array<{
        address: typeof rotatedAddressA;
        keyEpoch: number;
        envelopes: Array<{ userId: string }>;
        historicalEpochs: Array<{
          envelopes: Array<{ userId: string }>;
          ciphertext: string;
        }>;
        currentEncoding: "snapshot" | "update";
        currentIv: string;
        currentCiphertext: string;
      }>;
    };
    const storedA = manifest.partitions.find(
      (partition) => partition.address.erasureDomainId === EMPLOYEE_A,
    )!;
    stage3HistoryStayedLazy =
      storedA.currentEncoding === "update" &&
      storedA.historicalEpochs.length === 1 &&
      storedA.historicalEpochs[0]!.ciphertext === oldEpochCiphertext &&
      storedA.historicalEpochs[0]!.envelopes.length === 1 &&
      storedA.historicalEpochs[0]!.envelopes[0]!.userId === "reader-a";
    try {
      await decryptProtectedSnapshot({
        address: storedA.address,
        keyEpoch: storedA.keyEpoch,
        documentKey: oldDocumentAKey,
        iv: Uint8Array.from(atob(storedA.currentIv), (character) =>
          character.charCodeAt(0),
        ),
        ciphertext: Uint8Array.from(atob(storedA.currentCiphertext), (character) =>
          character.charCodeAt(0),
        ),
        encoding: storedA.currentEncoding,
      });
    } catch {
      stage3OldKeyDenied = true;
    }
    stage3ManifestStayedSealed = !new TextDecoder()
      .decode(manifestBytes!)
      .includes("base_salary");

    const preGrantKey = new Uint8Array(reopenedA.documentKey);
    const preGrantEpoch = reopenedA.keyEpoch;
    await third.addProtectedReader({
      address: rotatedAddressA,
      nextAddress: grantedAddressA,
      addedUserId: "reader-c",
      nextRecipients: [
        { userId: "reader-a", publicKey: readerA.publicKey },
        { userId: "reader-c", publicKey: readerC.publicKey },
      ],
      authorizingCredential: {
        userId: "reader-a",
        privateKey: readerA.privateKey,
      },
    });
    const granted = third.protectedPartitionsForDiagnostics.get(grantedAddressA)!;
    stage6ImmediateReaderGrant =
      third.protectedPartitionsForDiagnostics.get(rotatedAddressA) === undefined &&
      granted.keyEpoch === preGrantEpoch &&
      granted.documentKey.every((byte, index) => byte === preGrantKey[index]) &&
      (
        await third.protectedPartitionsForDiagnostics.openFor(
          grantedAddressA,
          "reader-c",
          readerC.privateKey,
        )
      ).byteLength === 32;
    try {
      await third.protectedPartitionsForDiagnostics.openFor(
        addressB,
        "reader-c",
        readerC.privateKey,
      );
      stage6ImmediateReaderGrant = false;
    } catch {
      // Expected: the concrete grant is scoped to Document A.
    }
    preGrantKey.fill(0);
  } finally {
    await third.dispose();
  }

  // A device that supplies only the removed reader's credential must not
  // restore Document A at all. This is distinct from the mixed-credential
  // reopen above: Reader A's usable envelope must not accidentally authorize
  // materialization on Reader B's behalf.
  const unauthorizedOnly = new LocalGraphWorkerRuntime();
  let stage3UnauthorizedOnlyMaterializationDenied = false;
  let stage3UnauthorizedOnlyOpenDenied = false;
  try {
    await unauthorizedOnly.unlockSealedStore(request.workspaceId, request.apiOrigin);
    await unauthorizedOnly.initialize(request.workspaceId);
    await unauthorizedOnly.restoreProtectedPartitions([
      { userId: "reader-b", privateKey: readerB.privateKey },
    ]);
    const canonical = JSON.parse(
      unauthorizedOnly.materializedIndexForDiagnostics!.canonicalSnapshot(),
    ) as {
      nodes: Array<{
        partitionKey: string;
        record: Record<string, unknown>;
      }>;
    };
    stage3UnauthorizedOnlyMaterializationDenied =
      unauthorizedOnly.protectedPartitionsForDiagnostics.get(grantedAddressA) ===
        undefined &&
      unauthorizedOnly.protectedPartitionsForDiagnostics.get(addressB) !== undefined &&
      !canonical.nodes.some(
        ({ partitionKey, record }) =>
          partitionKey === "compensation" && record["node_id"] === EMPLOYEE_A,
      ) &&
      canonical.nodes.some(
        ({ partitionKey, record }) =>
          partitionKey === "compensation" &&
          record["node_id"] === EMPLOYEE_B &&
          record["base_salary"] === 200,
      );
    try {
      await unauthorizedOnly.protectedPartitionsForDiagnostics.openFor(
        grantedAddressA,
        "reader-b",
        readerB.privateKey,
      );
    } catch (error) {
      stage3UnauthorizedOnlyOpenDenied =
        error instanceof Error && error.message.includes("no usable envelope");
    }
  } finally {
    await unauthorizedOnly.dispose();
  }

  const retention = new LocalGraphWorkerRuntime();
  let stage6RetentionLifecycle = false;
  let stage6CryptographicErasure = false;
  try {
    await retention.unlockSealedStore(request.workspaceId, request.apiOrigin);
    await retention.initialize(request.workspaceId);
    await retention.restoreProtectedPartitions(
      [{ userId: "reader-a", privateKey: readerA.privateKey }],
      {
        now: "2026-08-20T00:00:00.000Z",
        onDemandPartitionKeys: [protectedPartitionKey(addressC)],
      },
    );
    const retainedC = retention.protectedPartitionsForDiagnostics.get(addressC);
    stage6RetentionLifecycle =
      retainedC !== undefined &&
      (readNodeFragments(retainedC.document)[0]!.record as Record<string, unknown>)[
        "base_salary"
      ] === 300;
    const loadedKey = retainedC!.documentKey;
    stage6CryptographicErasure =
      (await retention.cryptographicallyEraseProtectedDomain(EMPLOYEE_C)) === 1 &&
      loadedKey.every((byte) => byte === 0) &&
      retention.protectedPartitionsForDiagnostics.get(addressC) === undefined &&
      retention.protectedPartitionsForDiagnostics.get(grantedAddressA) !== undefined &&
      retention.protectedPartitionsForDiagnostics.get(addressB) !== undefined;
    const erasedManifestBytes = await retention.openPayload(
      protectedPartitionManifestStoreKey(request.workspaceId),
    );
    const erasedManifest = JSON.parse(
      new TextDecoder().decode(erasedManifestBytes!),
    ) as {
      partitions: Array<{
        address: typeof addressC;
        keyErased: boolean;
        envelopes: unknown[];
        historicalEpochs: Array<{ envelopes: unknown[] }>;
        currentCiphertext: string;
      }>;
    };
    const erased = erasedManifest.partitions.find(
      ({ address }) => address.erasureDomainId === EMPLOYEE_C,
    )!;
    stage6CryptographicErasure &&=
      erased.keyErased &&
      erased.envelopes.length === 0 &&
      erased.historicalEpochs.every(({ envelopes }) => envelopes.length === 0) &&
      erased.currentCiphertext.length > 0;
  } finally {
    await retention.dispose();
  }
  return {
    result: {
      stage3PartitionsAfterReopen,
      stage3EpochAfterReopen,
      stage3RemovedReaderDenied,
      stage3OldKeyDenied,
      stage3DocumentBUnaffected,
      stage3WorkspaceUnaffected,
      stage3WorkspaceDocumentStayedTier02,
      stage3AddressMappingRestored,
      stage3PostReopenWriteSurvived,
      stage3HistoryStayedLazy,
      stage3ManifestStayedSealed,
      stage3UnauthorizedOnlyMaterializationDenied,
      stage3UnauthorizedOnlyOpenDenied,
      stage3WrongWorkspaceDenied,
      stage6ImmediateReaderGrant,
      stage6RetentionLifecycle,
      stage6CryptographicErasure,
    },
    context: {
      readerA,
      readerC,
      grantedAddressA,
      addressB,
      erasedAddressC: addressC,
    } satisfies Stage3Context,
  };
}

async function tier3Address(
  request: ProofRequest,
  readerSetId: string,
  domain: string,
) {
  return createProtectedDocumentAddress({
    workspaceId: request.workspaceId,
    nodeType: "WellnessTriggerEvent",
    schemaPartition: "private",
    tier: 3,
    readerSet: { id: readerSetId, userIds: [request.subjectUserId] },
    timeBucket: "current",
    erasureDomainId: domain,
  });
}

async function runStage5Proof(request: ProofRequest, stage3: Stage3Context) {
  const readerSet = await createProtectedReaderSet([request.subjectUserId]);
  const addressA = await tier3Address(request, readerSet.id, "tier3-wellness-a");
  const addressB = await tier3Address(request, readerSet.id, "tier3-wellness-b");
  const initialCredential = await requestPrf("tier3-initial", true);

  let tier3EnrollmentSubjectOnly = false;
  const refusedEnrollment = new LocalGraphWorkerRuntime();
  try {
    await refusedEnrollment.unlockSealedStore(request.workspaceId, request.apiOrigin);
    await refusedEnrollment.initialize(request.workspaceId);
    try {
      await refusedEnrollment.beginTier3Enrollment({
        address: addressA,
        sessionUserId: "different-owner-user",
        ...initialCredential,
      });
    } catch {
      tier3EnrollmentSubjectOnly =
        refusedEnrollment.tier3PartitionsForDiagnostics.size === 0;
    }
  } finally {
    await refusedEnrollment.dispose();
  }

  const first = new LocalGraphWorkerRuntime();
  let oldRecoveryCode = "";
  let oldRootKey = new Uint8Array();
  let oldRecoveryEnvelope:
    | ReturnType<
        LocalGraphWorkerRuntime["tier3PartitionsForDiagnostics"]["roots"]
      >[number]["recoveryEnvelope"]
    | undefined;
  let tier3MandatoryRecoveryConfirmed = false;
  try {
    await first.unlockSealedStore(request.workspaceId, request.apiOrigin);
    await first.initialize(request.workspaceId);
    oldRecoveryCode = await first.beginTier3Enrollment({
      address: addressA,
      sessionUserId: request.subjectUserId,
      ...initialCredential,
    });
    try {
      await first.confirmTier3Enrollment(corruptRecoveryCode(oldRecoveryCode));
    } catch {
      tier3MandatoryRecoveryConfirmed = first.tier3PartitionsForDiagnostics.size === 0;
    }
    await first.confirmTier3Enrollment(oldRecoveryCode);
    const rootAddress = createTier3RootAddress(
      request.workspaceId,
      request.subjectUserId,
    );
    await first.addTier3Document(rootAddress, addressB);
    first.tier3PartitionsForDiagnostics
      .get(addressA)!
      .document.getMap("tier3-private")
      .set("value", "wellness-a-before");
    first.tier3PartitionsForDiagnostics.get(addressA)!.document.commit();
    first.tier3PartitionsForDiagnostics
      .get(addressB)!
      .document.getMap("tier3-private")
      .set("value", "wellness-b");
    first.tier3PartitionsForDiagnostics.get(addressB)!.document.commit();
    await first.persistTier3Partitions();
    const state = first.tier3PartitionsForDiagnostics.roots()[0]!;
    oldRootKey = new Uint8Array(state.rootKey);
    oldRecoveryEnvelope = {
      header: state.recoveryEnvelope.header,
      iv: new Uint8Array(state.recoveryEnvelope.iv),
      ciphertext: new Uint8Array(state.recoveryEnvelope.ciphertext),
    };
  } finally {
    await first.dispose();
  }

  const persistedBefore = await readTier3Manifest(request);
  const persistedInitialInput = decodeBase64Url(
    persistedBefore.roots[0]!.prfEnvelope.header.prfInput,
  );
  const reopenedCredential = await requestPrf(
    "tier3-initial",
    false,
    persistedInitialInput,
  );
  const second = new LocalGraphWorkerRuntime();
  let tier3PrfPersistentReopen = false;
  try {
    await second.unlockSealedStore(request.workspaceId, request.apiOrigin);
    await second.initialize(request.workspaceId);
    await second.restoreTier3Partitions({
      sessionUserId: request.subjectUserId,
      credentialId: reopenedCredential.credentialId,
      prfResult: reopenedCredential.prfResult,
    });
    tier3PrfPersistentReopen =
      second.tier3PartitionsForDiagnostics.size === 2 &&
      second.tier3PartitionsForDiagnostics
        .get(addressA)!
        .document.getMap("tier3-private")
        .get("value") === "wellness-a-before" &&
      second.tier3PartitionsForDiagnostics
        .get(addressB)!
        .document.getMap("tier3-private")
        .get("value") === "wellness-b";
  } finally {
    await second.dispose();
  }

  const replacementCredential = await requestPrf("tier3-replacement", true);
  const recovering = new LocalGraphWorkerRuntime();
  let tier3RecoverySubjectOnly = false;
  let tier3WrongRecoveryCodeDenied = false;
  let replacementCode = "";
  try {
    await recovering.unlockSealedStore(request.workspaceId, request.apiOrigin);
    await recovering.initialize(request.workspaceId);
    try {
      await recovering.recoverTier3Partitions({
        sessionUserId: "different-owner-user",
        recoveryCode: oldRecoveryCode,
        ...replacementCredential,
      });
    } catch {
      tier3RecoverySubjectOnly = true;
    }
    try {
      await recovering.recoverTier3Partitions({
        sessionUserId: request.subjectUserId,
        recoveryCode: corruptRecoveryCode(oldRecoveryCode),
        ...replacementCredential,
      });
    } catch {
      tier3WrongRecoveryCodeDenied = true;
    }
    replacementCode = await recovering.recoverTier3Partitions({
      sessionUserId: request.subjectUserId,
      recoveryCode: oldRecoveryCode,
      ...replacementCredential,
    });
    try {
      await recovering.confirmTier3Recovery(corruptRecoveryCode(replacementCode));
    } catch {
      tier3MandatoryRecoveryConfirmed &&=
        recovering.tier3PartitionsForDiagnostics.size === 0;
    }
    await recovering.confirmTier3Recovery(replacementCode);
    const partition = recovering.tier3PartitionsForDiagnostics.get(addressA)!;
    partition.document.getMap("tier3-private").set("value", "wellness-a-after");
    partition.document.commit();
    await recovering.persistTier3Partitions();
  } finally {
    await recovering.dispose();
  }

  const persistedAfter = await readTier3Manifest(request);
  const rootAfter = persistedAfter.roots[0]!;
  const currentRecoveryEnvelope = {
    header: rootAfter.recoveryEnvelope.header,
    iv: decodeBase64Url(rootAfter.recoveryEnvelope.iv),
    ciphertext: decodeBase64Url(rootAfter.recoveryEnvelope.ciphertext),
  };
  let tier3OldRecoveryPathDenied = false;
  try {
    await unwrapTier3Root({
      envelope: currentRecoveryEnvelope,
      ikm: decodeTier3RecoveryCode(oldRecoveryCode),
    });
  } catch {
    const recoveredOldRoot = await unwrapTier3Root({
      envelope: oldRecoveryEnvelope!,
      ikm: decodeTier3RecoveryCode(oldRecoveryCode),
    });
    tier3OldRecoveryPathDenied =
      recoveredOldRoot.every((byte, index) => byte === oldRootKey[index]) &&
      rootAfter.generation === 1;
    recoveredOldRoot.fill(0);
  }

  const retired = new LocalGraphWorkerRuntime();
  let tier3RetiredCredentialDenied = false;
  try {
    await retired.unlockSealedStore(request.workspaceId, request.apiOrigin);
    await retired.initialize(request.workspaceId);
    try {
      await retired.restoreTier3Partitions({
        sessionUserId: request.subjectUserId,
        credentialId: reopenedCredential.credentialId,
        prfResult: reopenedCredential.prfResult,
      });
    } catch {
      tier3RetiredCredentialDenied = true;
    }
  } finally {
    await retired.dispose();
  }

  const currentPrfInput = decodeBase64Url(rootAfter.prfEnvelope.header.prfInput);
  const currentCredential = await requestPrf(
    "tier3-replacement",
    false,
    currentPrfInput,
  );
  const finalRuntime = new LocalGraphWorkerRuntime();
  let tier3PostRecoveryEpoch = -1;
  let tier3PostRecoveryWriteSurvived = false;
  let tier3UnrelatedDocumentSurvived = false;
  let tier3WorkspaceStateSurvived = false;
  let stage6IntegratedColdReopen = false;
  try {
    await finalRuntime.unlockSealedStore(request.workspaceId, request.apiOrigin);
    await finalRuntime.initialize(request.workspaceId);
    await finalRuntime.restoreTier3Partitions({
      sessionUserId: request.subjectUserId,
      credentialId: currentCredential.credentialId,
      prfResult: currentCredential.prfResult,
    });
    await finalRuntime.restoreProtectedPartitions([
      { userId: "reader-a", privateKey: stage3.readerA.privateKey },
      { userId: "reader-c", privateKey: stage3.readerC.privateKey },
    ]);
    const partition = finalRuntime.tier3PartitionsForDiagnostics.get(addressA)!;
    const unrelated = finalRuntime.tier3PartitionsForDiagnostics.get(addressB)!;
    tier3PostRecoveryEpoch = partition.keyEpoch;
    tier3PostRecoveryWriteSurvived =
      partition.document.getMap("tier3-private").get("value") === "wellness-a-after";
    tier3UnrelatedDocumentSurvived =
      unrelated.keyEpoch === 1 &&
      unrelated.document.getMap("tier3-private").get("value") === "wellness-b";
    const unrelatedMarker = await finalRuntime.openPayload("fdn52-stage3-unrelated");
    const canonicalWorkspace =
      finalRuntime.materializedIndexForDiagnostics!.canonicalSnapshot();
    tier3WorkspaceStateSurvived =
      new TextDecoder().decode(unrelatedMarker ?? new Uint8Array()) === "intact" &&
      canonicalWorkspace.includes(EMPLOYEE_A) &&
      canonicalWorkspace.includes(EMPLOYEE_B);
    stage6IntegratedColdReopen =
      finalRuntime.protectedPartitionsForDiagnostics.get(stage3.grantedAddressA)
        ?.keyEpoch === 1 &&
      finalRuntime.protectedPartitionsForDiagnostics.get(stage3.addressB)?.keyEpoch ===
        0 &&
      finalRuntime.protectedPartitionsForDiagnostics.get(stage3.erasedAddressC) ===
        undefined &&
      finalRuntime.tier3PartitionsForDiagnostics.size === 2 &&
      tier3WorkspaceStateSurvived;
  } finally {
    await finalRuntime.dispose();
  }

  const manifestText = JSON.stringify(persistedAfter);
  return {
    tier3EnrollmentSubjectOnly,
    tier3PrfPersistentReopen,
    tier3MandatoryRecoveryConfirmed,
    tier3RecoverySubjectOnly,
    tier3WrongRecoveryCodeDenied,
    tier3OldRecoveryPathDenied,
    tier3RetiredCredentialDenied,
    tier3PostRecoveryEpoch,
    tier3PostRecoveryWriteSurvived,
    tier3UnrelatedDocumentSurvived,
    tier3WorkspaceStateSurvived,
    tier3GenerationHistoryValidated: rootAfter.generationHistory.join(",") === "0,1",
    tier3RootRotated: rootAfter.generation === 1,
    tier3KeysStayedWorkerPrivate:
      !manifestText.includes(oldRecoveryCode) &&
      !manifestText.includes(replacementCode) &&
      !manifestText.includes("wellness-a-after"),
    stage6IntegratedColdReopen,
  };
}

async function readTier3Manifest(request: ProofRequest): Promise<Tier3Manifest> {
  const runtime = new LocalGraphWorkerRuntime();
  try {
    await runtime.unlockSealedStore(request.workspaceId, request.apiOrigin);
    await runtime.initialize(request.workspaceId);
    const bytes = await runtime.openPayload(
      tier3PartitionManifestStoreKey(request.workspaceId),
    );
    if (!bytes) throw new Error("Tier 3 manifest is absent");
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return tier3ManifestSchema.parse(parsed);
  } finally {
    await runtime.dispose();
  }
}

scope.onmessage = (event: MessageEvent<unknown>) => {
  const data = event.data as
    | ProofRequest
    | {
        type: "tier3-prf-response";
        requestId: string;
        credentialId: string;
        prfResult: ArrayBuffer;
      };
  if ("type" in data && data.type === "tier3-prf-response") {
    const pending = pendingPrf.get(data.requestId);
    if (!pending) return;
    pendingPrf.delete(data.requestId);
    pending.resolve({
      credentialId: data.credentialId,
      prfResult: new Uint8Array(data.prfResult),
    });
    return;
  }
  void runProof(data as ProofRequest)
    .then((result) => scope.postMessage({ ok: true, result }))
    .catch((error: unknown) =>
      scope.postMessage({
        ok: false,
        error:
          error instanceof Error ? error.message : "Protected document proof failed",
      }),
    );
};
