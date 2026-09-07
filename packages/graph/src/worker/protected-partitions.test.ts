import { LoroDoc, LoroMap } from "loro-crdt";
import { describe, expect, it } from "vitest";
import {
  NODE_FRAGMENT_CONTAINER,
  nodeFragmentKey,
  readNodeFragments,
} from "./document-node-fragments";
import {
  createProtectedDocumentAddress,
  createProtectedReaderSet,
} from "./protected-document";
import {
  decryptProtectedSnapshot,
  encryptProtectedSnapshot,
  ProtectedPartitionRegistry,
  protectedPartitionKey,
  shouldMaterializeTier1,
} from "./protected-partitions";
import {
  generateTier1IdentityKeyPair,
  unwrapTier1DocumentKey,
  wrapTier1DocumentKey,
} from "./tier1-envelope";

const WORKSPACE = "123e4567-e89b-42d3-a456-426614174000";
const ACTOR = "123e4567-e89b-42d3-a456-426614174001";
const EMPLOYEE_A = "123e4567-e89b-42d3-a456-426614174002";
const EMPLOYEE_B = "123e4567-e89b-42d3-a456-426614174003";

function registry(): ProtectedPartitionRegistry {
  return new ProtectedPartitionRegistry(
    () => new LoroDoc() as unknown as import("loro-crdt/web").LoroDoc,
  );
}

async function address(
  erasureDomainId: string,
  readers: readonly string[] = ["reader-a", "reader-b"],
  tier: 1 | 3 = 1,
) {
  return createProtectedDocumentAddress({
    workspaceId: WORKSPACE,
    nodeType: "Employee",
    schemaPartition: "compensation",
    tier,
    readerSet: await createProtectedReaderSet(readers),
    timeBucket: "current",
    erasureDomainId,
  });
}

function writeCompensation(
  document: import("loro-crdt/web").LoroDoc,
  employeeId: string,
  salary: number,
): void {
  const fragment = document
    .getMap(NODE_FRAGMENT_CONTAINER)
    .setContainer(
      nodeFragmentKey(employeeId, "compensation"),
      new LoroMap() as unknown as import("loro-crdt/web").LoroMap,
    );
  const record: Record<string, unknown> = {
    node_id: employeeId,
    workspace_id: WORKSPACE,
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
    base_salary: salary,
  };
  for (const [field, value] of Object.entries(record)) fragment.set(field, value);
  document.commit();
}

function decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function encode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe("FDN-52 Stage 3 protected partitions", () => {
  it("rotates one full-address document and restores both partitions independently", async () => {
    const first = registry();
    const readerA = await generateTier1IdentityKeyPair();
    const readerB = await generateTier1IdentityKeyPair();
    const recipients = [
      { userId: "reader-a", publicKey: readerA.publicKey },
      { userId: "reader-b", publicKey: readerB.publicKey },
    ] as const;
    const documentA = await address(EMPLOYEE_A);
    const rotatedDocumentA = await address(EMPLOYEE_A, ["reader-a"]);
    const documentB = await address(EMPLOYEE_B);
    expect(protectedPartitionKey(documentA)).not.toBe(protectedPartitionKey(documentB));

    const a = await first.create(documentA, recipients);
    const b = await first.create(documentB, recipients);
    writeCompensation(a.document, EMPLOYEE_A, 100);
    writeCompensation(b.document, EMPLOYEE_B, 200);
    const preRemovalManifest = await first.serialize();
    expect(first.size).toBe(2);
    expect(a.document).not.toBe(b.document);
    const oldEnvelope = a.envelopes.get("reader-a")!;
    const oldKey = new Uint8Array(
      await first.openFor(documentA, "reader-a", readerA.privateKey),
    );

    await first.removeReader({
      address: documentA,
      nextAddress: rotatedDocumentA,
      removedUserId: "reader-b",
      remainingRecipients: [{ userId: "reader-a", publicKey: readerA.publicKey }],
    });
    const immediatelyRotatedManifest = await first.serialize();
    const immediatelyReopened = registry();
    await immediatelyReopened.restore(immediatelyRotatedManifest, [
      { userId: "reader-a", privateKey: readerA.privateKey },
      { userId: "reader-b", privateKey: readerB.privateKey },
    ]);
    expect(immediatelyReopened.get(rotatedDocumentA)?.keyEpoch).toBe(1);
    expect(
      (
        readNodeFragments(immediatelyReopened.get(rotatedDocumentA)!.document)[0]!
          .record as Record<string, unknown>
      )["base_salary"],
    ).toBe(100);
    await expect(
      immediatelyReopened.openFor(rotatedDocumentA, "reader-b", readerB.privateKey),
    ).rejects.toThrow("no usable envelope");
    immediatelyReopened.dispose();
    const salary = a.document
      .getMap(NODE_FRAGMENT_CONTAINER)
      .get(
        nodeFragmentKey(EMPLOYEE_A, "compensation"),
      ) as import("loro-crdt/web").LoroMap;
    salary.set("base_salary", 125);
    a.document.commit();

    expect(a.keyEpoch).toBe(1);
    expect(first.size).toBe(2);
    expect(first.get(documentA)).toBeUndefined();
    expect(first.get(rotatedDocumentA)).toBe(a);
    expect(a.envelopes.has("reader-b")).toBe(false);
    await expect(
      first.openFor(rotatedDocumentA, "reader-b", readerB.privateKey),
    ).rejects.toThrow("no usable envelope");
    const newKey = await first.openFor(
      rotatedDocumentA,
      "reader-a",
      readerA.privateKey,
    );
    expect(newKey).not.toEqual(oldKey);
    await expect(
      unwrapTier1DocumentKey({
        envelope: oldEnvelope,
        recipientUserId: "reader-a",
        privateKey: readerA.privateKey,
      }),
    ).resolves.toEqual(oldKey);
    await expect(
      first.openFor(documentB, "reader-b", readerB.privateKey),
    ).resolves.toHaveLength(32);

    const manifestBytes = await first.serialize();
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
      partitions: Array<{
        address: typeof rotatedDocumentA;
        keyEpoch: number;
        historicalEpochs: Array<{
          address: typeof documentA;
          keyEpoch: number;
          envelopes: Array<{ userId: string }>;
          encoding: "snapshot" | "update";
          iv: string;
          ciphertext: string;
        }>;
        currentEncoding: "snapshot" | "update";
        currentIv: string;
        currentCiphertext: string;
      }>;
    };
    const persistedA = manifest.partitions.find(
      (partition) => partition.address.erasureDomainId === EMPLOYEE_A,
    )!;
    expect(persistedA.currentEncoding).toBe("update");
    expect(persistedA.historicalEpochs).toHaveLength(1);
    expect(persistedA.historicalEpochs[0]!.encoding).toBe("snapshot");
    expect(
      persistedA.historicalEpochs[0]!.envelopes.map(({ userId }) => userId),
    ).toEqual(["reader-a"]);
    await expect(
      decryptProtectedSnapshot({
        address: persistedA.address,
        keyEpoch: persistedA.keyEpoch,
        documentKey: oldKey,
        iv: decode(persistedA.currentIv),
        ciphertext: decode(persistedA.currentCiphertext),
        encoding: persistedA.currentEncoding,
      }),
    ).rejects.toThrow();

    const second = registry();
    await second.restore(manifestBytes, [
      { userId: "reader-a", privateKey: readerA.privateKey },
      { userId: "reader-b", privateKey: readerB.privateKey },
    ]);
    expect(second.size).toBe(2);
    expect(second.get(rotatedDocumentA)?.keyEpoch).toBe(1);
    expect(second.get(documentA)).toBeUndefined();
    expect(
      (
        readNodeFragments(second.get(rotatedDocumentA)!.document)[0]!.record as Record<
          string,
          unknown
        >
      )["base_salary"],
    ).toBe(125);
    expect(
      (
        readNodeFragments(second.get(documentB)!.document)[0]!.record as Record<
          string,
          unknown
        >
      )["base_salary"],
    ).toBe(200);
    await expect(
      second.openFor(rotatedDocumentA, "reader-b", readerB.privateKey),
    ).rejects.toThrow("no usable envelope");
    await expect(
      second.openFor(documentB, "reader-b", readerB.privateKey),
    ).resolves.toHaveLength(32);
    const reopenedManifest = JSON.parse(
      new TextDecoder().decode(await second.serialize()),
    ) as typeof manifest;
    const reopenedPersistedA = reopenedManifest.partitions.find(
      (partition) => partition.address.erasureDomainId === EMPLOYEE_A,
    )!;
    expect(reopenedPersistedA.historicalEpochs[0]!.ciphertext).toBe(
      persistedA.historicalEpochs[0]!.ciphertext,
    );

    const removedDevice = registry();
    await removedDevice.restore(preRemovalManifest, [
      { userId: "reader-b", privateKey: readerB.privateKey },
    ]);
    const purgedKey = removedDevice.get(documentA)!.documentKey;
    expect(removedDevice.purge(documentA)).toBe(true);
    expect(purgedKey.every((byte) => byte === 0)).toBe(true);
    expect(removedDevice.size).toBe(1);
    expect(removedDevice.get(documentA)).toBeUndefined();
    expect(
      (
        readNodeFragments(removedDevice.get(documentB)!.document)[0]!.record as Record<
          string,
          unknown
        >
      )["base_salary"],
    ).toBe(200);
    const purgedManifest = JSON.parse(
      new TextDecoder().decode(await removedDevice.serialize()),
    ) as { partitions: Array<{ address: typeof documentB }> };
    expect(
      purgedManifest.partitions.map(({ address }) => address.erasureDomainId),
    ).toEqual([EMPLOYEE_B]);

    first.dispose();
    second.dispose();
    removedDevice.dispose();
  });

  it("refuses a reader-set change that also crosses another address boundary", async () => {
    const partitions = registry();
    const readerA = await generateTier1IdentityKeyPair();
    const readerB = await generateTier1IdentityKeyPair();
    const original = await address(EMPLOYEE_A);
    const wrongErasureDomain = await address(EMPLOYEE_B, ["reader-a"]);
    await partitions.create(original, [
      { userId: "reader-a", publicKey: readerA.publicKey },
      { userId: "reader-b", publicKey: readerB.publicKey },
    ]);
    await expect(
      partitions.removeReader({
        address: original,
        nextAddress: wrongErasureDomain,
        removedUserId: "reader-b",
        remainingRecipients: [{ userId: "reader-a", publicKey: readerA.publicKey }],
      }),
    ).rejects.toThrow("change only");
    expect(partitions.size).toBe(1);
    partitions.dispose();
  });

  it("refuses recipient lists that disagree with the supplied full address", async () => {
    const partitions = registry();
    const readerA = await generateTier1IdentityKeyPair();
    const readerB = await generateTier1IdentityKeyPair();
    const original = await address(EMPLOYEE_A);
    await expect(
      partitions.create(original, [
        { userId: "reader-a", publicKey: readerA.publicKey },
      ]),
    ).rejects.toThrow("do not match");

    await partitions.create(original, [
      { userId: "reader-a", publicKey: readerA.publicKey },
      { userId: "reader-b", publicKey: readerB.publicKey },
    ]);
    const substitutedReaderSet = await address(EMPLOYEE_A, ["reader-a", "reader-c"]);
    await expect(
      partitions.removeReader({
        address: original,
        nextAddress: substitutedReaderSet,
        removedUserId: "reader-b",
        remainingRecipients: [{ userId: "reader-c", publicKey: readerB.publicKey }],
      }),
    ).rejects.toThrow("exactly the prior readers");
    expect(partitions.size).toBe(1);
    partitions.dispose();
  });

  it("rejects a durable envelope recipient set that disagrees with readerSetId", async () => {
    const first = registry();
    const readerA = await generateTier1IdentityKeyPair();
    const readerB = await generateTier1IdentityKeyPair();
    const readerC = await generateTier1IdentityKeyPair();
    const documentAddress = await address(EMPLOYEE_A);
    const partition = await first.create(documentAddress, [
      { userId: "reader-a", publicKey: readerA.publicKey },
      { userId: "reader-b", publicKey: readerB.publicKey },
    ]);
    writeCompensation(partition.document, EMPLOYEE_A, 100);

    const unauthorizedEnvelope = await wrapTier1DocumentKey({
      address: documentAddress,
      keyEpoch: 0,
      recipient: { userId: "reader-c", publicKey: readerC.publicKey },
      documentKeyBytes: partition.documentKey,
    });
    const manifest = JSON.parse(new TextDecoder().decode(await first.serialize())) as {
      partitions: Array<{
        envelopes: Array<{
          userId: string;
          header: typeof unauthorizedEnvelope.header;
          iv: string;
          ciphertext: string;
        }>;
      }>;
    };
    manifest.partitions[0]!.envelopes = [
      {
        userId: "reader-c",
        header: unauthorizedEnvelope.header,
        iv: encode(unauthorizedEnvelope.iv),
        ciphertext: encode(unauthorizedEnvelope.ciphertext),
      },
    ];

    const reopened = registry();
    await expect(
      reopened.restore(new TextEncoder().encode(JSON.stringify(manifest)), [
        { userId: "reader-c", privateKey: readerC.privateKey },
      ]),
    ).rejects.toThrow("reader set");
    expect(reopened.size).toBe(0);

    first.dispose();
    reopened.dispose();
  });

  it("authenticates snapshot and update kinds so neither can be relabeled", async () => {
    const documentAddress = await address(EMPLOYEE_A, ["reader-a"]);
    const documentKey = crypto.getRandomValues(new Uint8Array(32));
    const bytes = new TextEncoder().encode("kind-bound-content");
    const snapshot = await encryptProtectedSnapshot(
      documentAddress,
      0,
      documentKey,
      bytes,
      "snapshot",
    );
    await expect(
      decryptProtectedSnapshot({
        address: documentAddress,
        keyEpoch: 0,
        documentKey,
        ...snapshot,
        encoding: "snapshot",
      }),
    ).resolves.toEqual(bytes);
    await expect(
      decryptProtectedSnapshot({
        address: documentAddress,
        keyEpoch: 0,
        documentKey,
        ...snapshot,
        encoding: "update",
      }),
    ).rejects.toThrow();

    const update = await encryptProtectedSnapshot(
      documentAddress,
      1,
      documentKey,
      bytes,
      "update",
    );
    await expect(
      decryptProtectedSnapshot({
        address: documentAddress,
        keyEpoch: 1,
        documentKey,
        ...update,
        encoding: "snapshot",
      }),
    ).rejects.toThrow();
    documentKey.fill(0);
  });

  it("rejects a persisted kind/header disagreement before materialization", async () => {
    const first = registry();
    const reopened = registry();
    const readerA = await generateTier1IdentityKeyPair();
    const documentAddress = await address(EMPLOYEE_A, ["reader-a"]);
    const partition = await first.create(documentAddress, [
      { userId: "reader-a", publicKey: readerA.publicKey },
    ]);
    writeCompensation(partition.document, EMPLOYEE_A, 100);
    const updateBound = await encryptProtectedSnapshot(
      documentAddress,
      0,
      partition.documentKey,
      partition.document.export({ mode: "snapshot" }),
      "update",
    );
    const manifest = JSON.parse(new TextDecoder().decode(await first.serialize())) as {
      partitions: Array<{
        currentIv: string;
        currentCiphertext: string;
      }>;
    };
    manifest.partitions[0]!.currentIv = encode(updateBound.iv);
    manifest.partitions[0]!.currentCiphertext = encode(updateBound.ciphertext);

    await expect(
      reopened.restore(new TextEncoder().encode(JSON.stringify(manifest)), [
        { userId: "reader-a", privateKey: readerA.privateKey },
      ]),
    ).rejects.toThrow();
    expect(reopened.size).toBe(0);

    first.dispose();
    reopened.dispose();
  });

  it("grants one supplied concrete reader immediately without crossing documents", async () => {
    const partitions = registry();
    const reopened = registry();
    const readerA = await generateTier1IdentityKeyPair();
    const readerB = await generateTier1IdentityKeyPair();
    const readerC = await generateTier1IdentityKeyPair();
    const originalA = await address(EMPLOYEE_A);
    const grantedA = await address(EMPLOYEE_A, ["reader-a", "reader-b", "reader-c"]);
    const documentB = await address(EMPLOYEE_B);
    const originalRecipients = [
      { userId: "reader-a", publicKey: readerA.publicKey },
      { userId: "reader-b", publicKey: readerB.publicKey },
    ] as const;
    const partitionA = await partitions.create(originalA, originalRecipients);
    const partitionB = await partitions.create(documentB, originalRecipients);
    writeCompensation(partitionA.document, EMPLOYEE_A, 100);
    writeCompensation(partitionB.document, EMPLOYEE_B, 200);
    const priorKey = new Uint8Array(partitionA.documentKey);

    await partitions.addReader({
      address: originalA,
      nextAddress: grantedA,
      addedUserId: "reader-c",
      nextRecipients: [
        ...originalRecipients,
        { userId: "reader-c", publicKey: readerC.publicKey },
      ],
      authorizingCredential: {
        userId: "reader-a",
        privateKey: readerA.privateKey,
      },
    });

    expect(partitions.get(originalA)).toBeUndefined();
    expect(partitions.get(grantedA)).toBe(partitionA);
    expect(partitionA.keyEpoch).toBe(0);
    expect(partitionA.documentKey).toEqual(priorKey);
    await expect(
      partitions.openFor(grantedA, "reader-a", readerA.privateKey),
    ).resolves.toEqual(priorKey);
    await expect(
      partitions.openFor(grantedA, "reader-c", readerC.privateKey),
    ).resolves.toEqual(priorKey);
    await expect(
      partitions.openFor(documentB, "reader-b", readerB.privateKey),
    ).resolves.toHaveLength(32);
    await expect(
      partitions.openFor(documentB, "reader-c", readerC.privateKey),
    ).rejects.toThrow("no usable envelope");

    await reopened.restore(await partitions.serialize(), [
      { userId: "reader-c", privateKey: readerC.privateKey },
    ]);
    expect(reopened.get(grantedA)).toBeDefined();
    expect(reopened.get(documentB)).toBeUndefined();
    expect(
      (
        readNodeFragments(reopened.get(grantedA)!.document)[0]!.record as Record<
          string,
          unknown
        >
      )["base_salary"],
    ).toBe(100);

    priorKey.fill(0);
    partitions.dispose();
    reopened.dispose();
  });

  it("refuses to apply the Tier 1 lifecycle to a Tier 3 address before Stage 4", async () => {
    const partitions = registry();
    const readerA = await generateTier1IdentityKeyPair();
    const tier3Address = await createProtectedDocumentAddress({
      workspaceId: WORKSPACE,
      nodeType: "WellnessTriggerEvent",
      schemaPartition: "private",
      tier: 3,
      readerSet: await createProtectedReaderSet(["reader-a"]),
      timeBucket: "current",
      erasureDomainId: EMPLOYEE_A,
    });
    await expect(
      partitions.create(tier3Address, [
        { userId: "reader-a", publicKey: readerA.publicKey },
      ]),
    ).rejects.toThrow("Tier 1 addresses only");
    expect(partitions.size).toBe(0);
    partitions.dispose();
  });

  it("round-trips a protected snapshot larger than a JavaScript argument list", async () => {
    const first = registry();
    const second = registry();
    const readerA = await generateTier1IdentityKeyPair();
    const documentAddress = await address(EMPLOYEE_A, ["reader-a"]);
    const partition = await first.create(documentAddress, [
      { userId: "reader-a", publicKey: readerA.publicKey },
    ]);
    let state = 0x52fd1234;
    const payloadBytes = new Uint8Array(500_000);
    for (let index = 0; index < payloadBytes.length; index += 1) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      payloadBytes[index] = 32 + (state % 95);
    }
    const payload = new TextDecoder().decode(payloadBytes);
    partition.document.getMap("large-payload").set("value", payload);
    partition.document.commit();

    const manifest = await first.serialize();
    await second.restore(manifest, [
      { userId: "reader-a", privateKey: readerA.privateKey },
    ]);
    expect(
      second.get(documentAddress)!.document.getMap("large-payload").get("value"),
    ).toBe(payload);

    first.dispose();
    second.dispose();
  });

  it("enforces active, closed-window, on-demand, and thirty-day retention states", async () => {
    expect(
      shouldMaterializeTier1({
        retention: { status: "active" },
        now: "2026-08-20T00:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      shouldMaterializeTier1({
        retention: {
          status: "closed",
          closedAt: "2025-08-20T00:00:00.000Z",
          windowMonths: 12,
          lastAccessedAt: null,
        },
        now: "2026-08-20T00:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      shouldMaterializeTier1({
        retention: {
          status: "closed",
          closedAt: "2025-08-19T23:59:59.999Z",
          windowMonths: 12,
          lastAccessedAt: null,
        },
        now: "2026-08-20T00:00:00.000Z",
      }),
    ).toBe(false);

    const first = registry();
    const defaultRestore = registry();
    const onDemandRestore = registry();
    const expiredLeaseRestore = registry();
    const readerA = await generateTier1IdentityKeyPair();
    const agedAddress = await address(EMPLOYEE_A, ["reader-a"]);
    const activeAddress = await address(EMPLOYEE_B, ["reader-a"]);
    const aged = await first.create(
      agedAddress,
      [{ userId: "reader-a", publicKey: readerA.publicKey }],
      {
        status: "closed",
        closedAt: "2025-01-01T00:00:00.000Z",
        windowMonths: 12,
        lastAccessedAt: null,
      },
    );
    const active = await first.create(activeAddress, [
      { userId: "reader-a", publicKey: readerA.publicKey },
    ]);
    writeCompensation(aged.document, EMPLOYEE_A, 100);
    writeCompensation(active.document, EMPLOYEE_B, 200);
    const manifest = await first.serialize();
    const credentials = [
      { userId: "reader-a", privateKey: readerA.privateKey },
    ] as const;

    await defaultRestore.restore(manifest, credentials, {
      now: "2026-08-20T00:00:00.000Z",
    });
    expect(defaultRestore.get(agedAddress)).toBeUndefined();
    expect(defaultRestore.get(activeAddress)).toBeDefined();
    expect(
      (
        JSON.parse(new TextDecoder().decode(await defaultRestore.serialize())) as {
          partitions: unknown[];
        }
      ).partitions,
    ).toHaveLength(2);

    await onDemandRestore.restore(manifest, credentials, {
      now: "2026-08-20T00:00:00.000Z",
      onDemandPartitionKeys: [protectedPartitionKey(agedAddress)],
    });
    expect(onDemandRestore.get(agedAddress)).toBeDefined();
    const leasedManifest = await onDemandRestore.serialize();
    await expiredLeaseRestore.restore(leasedManifest, credentials, {
      now: "2026-09-20T00:00:00.001Z",
    });
    expect(expiredLeaseRestore.get(agedAddress)).toBeUndefined();
    expect(expiredLeaseRestore.get(activeAddress)).toBeDefined();

    first.dispose();
    defaultRestore.dispose();
    onDemandRestore.dispose();
    expiredLeaseRestore.dispose();
  });

  it("cryptographic erasure removes every usable key while retaining ciphertext", async () => {
    const first = registry();
    const reopened = registry();
    const readerA = await generateTier1IdentityKeyPair();
    const erasedAddress = await address(EMPLOYEE_A, ["reader-a"]);
    const unaffectedAddress = await address(EMPLOYEE_B, ["reader-a"]);
    const erasedPartition = await first.create(erasedAddress, [
      { userId: "reader-a", publicKey: readerA.publicKey },
    ]);
    const unaffectedPartition = await first.create(unaffectedAddress, [
      { userId: "reader-a", publicKey: readerA.publicKey },
    ]);
    writeCompensation(erasedPartition.document, EMPLOYEE_A, 100);
    writeCompensation(unaffectedPartition.document, EMPLOYEE_B, 200);
    const loadedKey = erasedPartition.documentKey;

    await expect(first.cryptographicallyEraseErasureDomain(EMPLOYEE_A)).resolves.toBe(
      1,
    );
    expect(loadedKey.every((byte) => byte === 0)).toBe(true);
    expect(first.get(erasedAddress)).toBeUndefined();
    expect(first.get(unaffectedAddress)).toBeDefined();
    const manifest = JSON.parse(new TextDecoder().decode(await first.serialize())) as {
      partitions: Array<{
        address: typeof erasedAddress;
        keyErased: boolean;
        envelopes: unknown[];
        currentCiphertext: string;
        historicalEpochs: Array<{ envelopes: unknown[] }>;
      }>;
    };
    const erasedStored = manifest.partitions.find(
      ({ address: stored }) => stored.erasureDomainId === EMPLOYEE_A,
    )!;
    expect(erasedStored.keyErased).toBe(true);
    expect(erasedStored.envelopes).toEqual([]);
    expect(
      erasedStored.historicalEpochs.every(({ envelopes }) => envelopes.length === 0),
    ).toBe(true);
    expect(erasedStored.currentCiphertext.length).toBeGreaterThan(0);

    await reopened.restore(new TextEncoder().encode(JSON.stringify(manifest)), [
      { userId: "reader-a", privateKey: readerA.privateKey },
    ]);
    expect(reopened.get(erasedAddress)).toBeUndefined();
    expect(reopened.get(unaffectedAddress)).toBeDefined();
    await expect(
      reopened.openFor(erasedAddress, "reader-a", readerA.privateKey),
    ).rejects.toThrow("no usable envelope");

    first.dispose();
    reopened.dispose();
  });
});
