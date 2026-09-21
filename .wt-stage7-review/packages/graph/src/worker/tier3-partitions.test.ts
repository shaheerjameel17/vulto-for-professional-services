import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import {
  createProtectedDocumentAddress,
  createProtectedReaderSet,
} from "./protected-document";
import { tier3ManifestSchema, Tier3PartitionRegistry } from "./tier3-partitions";
import {
  createTier3RootAddress,
  decodeTier3RecoveryCode,
  unwrapTier3Root,
} from "./tier3-root";

const WORKSPACE = "123e4567-e89b-42d3-a456-426614174000";
const SUBJECT = "subject-user";

function registry(): Tier3PartitionRegistry {
  return new Tier3PartitionRegistry(
    () => new LoroDoc() as unknown as import("loro-crdt/web").LoroDoc,
  );
}

async function address(domain: string) {
  return createProtectedDocumentAddress({
    workspaceId: WORKSPACE,
    nodeType: "WellnessTriggerEvent",
    schemaPartition: "private",
    tier: 3,
    readerSet: await createProtectedReaderSet([SUBJECT]),
    timeBucket: "current",
    erasureDomainId: domain,
  });
}

function corrupt(code: string): string {
  return code.slice(0, -1) + (code.endsWith("0") ? "1" : "0");
}

describe("FDN-52 Stage 5 Tier 3 lifecycle", () => {
  it("enrolls only the exact subject, requires recovery-code confirmation, and reopens with PRF", async () => {
    const documentA = await address("wellness-a");
    const documentB = await address("wellness-b");
    const prfInput = new Uint8Array(32).fill(1);
    const prfResult = new Uint8Array(32).fill(2);

    const wrongSubject = registry();
    await expect(
      wrongSubject.beginEnrollment({
        address: documentA,
        sessionUserId: "owner-user",
        credentialId: "owner_credential",
        prfInput,
        prfResult,
      }),
    ).rejects.toThrow("exactly its canonical subject");
    expect(wrongSubject.size).toBe(0);

    const first = registry();
    const recoveryCode = await first.beginEnrollment({
      address: documentA,
      sessionUserId: SUBJECT,
      credentialId: "credential_1",
      prfInput,
      prfResult,
    });
    expect(first.size).toBe(0);
    expect(() => first.confirmEnrollment(corrupt(recoveryCode))).toThrow(
      "confirmation failed",
    );
    const root = first.confirmEnrollment(recoveryCode);
    await first.addDocument(createTier3RootAddress(WORKSPACE, SUBJECT), documentB);
    expect(first.size).toBe(2);
    first.get(documentA)!.document.getMap("private").set("value", "alpha");
    first.get(documentA)!.document.commit();
    first.get(documentB)!.document.getMap("private").set("value", "bravo");
    first.get(documentB)!.document.commit();
    const bytes = await first.serialize();
    expect(new TextDecoder().decode(bytes)).not.toContain("alpha");
    expect(root.address.canonicalSubjectUserId).toBe(SUBJECT);

    const reopened = registry();
    await reopened.restore(bytes, {
      sessionUserId: SUBJECT,
      credentialId: "credential_1",
      prfResult,
    });
    expect(reopened.get(documentA)!.document.getMap("private").get("value")).toBe(
      "alpha",
    );
    expect(reopened.get(documentB)!.document.getMap("private").get("value")).toBe(
      "bravo",
    );
    const denied = registry();
    await expect(
      denied.restore(bytes, {
        sessionUserId: "owner-user",
        credentialId: "credential_1",
        prfResult,
      }),
    ).rejects.toThrow("does not match");

    const malformedManifest = tier3ManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    malformedManifest.roots[0]!.generationHistory[0] = 1;
    const malformed = registry();
    await expect(
      malformed.restore(new TextEncoder().encode(JSON.stringify(malformedManifest)), {
        sessionUserId: SUBJECT,
        credentialId: "credential_1",
        prfResult,
      }),
    ).rejects.toThrow("root generation history");

    first.dispose();
    reopened.dispose();
    denied.dispose();
    malformed.dispose();
    wrongSubject.dispose();
  });

  it("rotates root, recovery path, credential and document epochs for future writes", async () => {
    const document = await address("wellness-a");
    const oldPrfInput = new Uint8Array(32).fill(3);
    const oldPrfResult = new Uint8Array(32).fill(4);
    const first = registry();
    const oldCode = await first.beginEnrollment({
      address: document,
      sessionUserId: SUBJECT,
      credentialId: "credential_old",
      prfInput: oldPrfInput,
      prfResult: oldPrfResult,
    });
    const oldState = first.confirmEnrollment(oldCode);
    first.get(document)!.document.getMap("private").set("value", "before");
    first.get(document)!.document.commit();
    const oldDocumentKey = new Uint8Array(first.get(document)!.documentKey);
    const oldRoot = new Uint8Array(oldState.rootKey);
    const oldRecoveryEnvelope = oldState.recoveryEnvelope;
    const bytes = await first.serialize();
    first.dispose();

    const recovered = registry();
    await expect(
      recovered.recover(bytes, {
        sessionUserId: "owner-user",
        credentialId: "credential_new",
        prfInput: new Uint8Array(32).fill(5),
        prfResult: new Uint8Array(32).fill(6),
        recoveryCode: oldCode,
      }),
    ).rejects.toThrow("canonical subject");
    await expect(
      recovered.recover(bytes, {
        sessionUserId: SUBJECT,
        credentialId: "credential_new",
        prfInput: new Uint8Array(32).fill(5),
        prfResult: new Uint8Array(32).fill(6),
        recoveryCode: corrupt(oldCode),
      }),
    ).rejects.toThrow();

    const replacementCode = await recovered.recover(bytes, {
      sessionUserId: SUBJECT,
      credentialId: "credential_new",
      prfInput: new Uint8Array(32).fill(5),
      prfResult: new Uint8Array(32).fill(6),
      recoveryCode: oldCode,
    });
    expect(() => recovered.confirmRecovery(corrupt(replacementCode))).toThrow(
      "confirmation failed",
    );
    recovered.confirmRecovery(replacementCode);
    const current = recovered.roots()[0]!;
    expect(current.generation).toBe(1);
    expect(current.rootKey).not.toEqual(oldRoot);
    expect(recovered.get(document)!.keyEpoch).toBe(1);
    expect(recovered.get(document)!.documentKey).not.toEqual(oldDocumentKey);
    recovered.get(document)!.document.getMap("private").set("value", "after");
    recovered.get(document)!.document.commit();
    const rotatedBytes = await recovered.serialize();

    await expect(
      unwrapTier3Root({
        envelope: current.recoveryEnvelope,
        ikm: decodeTier3RecoveryCode(oldCode),
      }),
    ).rejects.toThrow("cannot be opened");
    await expect(
      unwrapTier3Root({
        envelope: oldRecoveryEnvelope,
        ikm: decodeTier3RecoveryCode(oldCode),
      }),
    ).resolves.toEqual(oldRoot);

    const oldCredential = registry();
    await expect(
      oldCredential.restore(rotatedBytes, {
        sessionUserId: SUBJECT,
        credentialId: "credential_old",
        prfResult: oldPrfResult,
      }),
    ).rejects.toThrow("does not match");
    const currentCredential = registry();
    await currentCredential.restore(rotatedBytes, {
      sessionUserId: SUBJECT,
      credentialId: "credential_new",
      prfResult: new Uint8Array(32).fill(6),
    });
    expect(
      currentCredential.get(document)!.document.getMap("private").get("value"),
    ).toBe("after");
    expect(replacementCode).not.toBe(oldCode);

    recovered.dispose();
    oldCredential.dispose();
    currentCredential.dispose();
  });

  it("rejects stale recovery generations and Tier 1 envelope kinds in Tier 3 durable state", async () => {
    const document = await address("wellness-format");
    const prfResult = new Uint8Array(32).fill(12);
    const enrolled = registry();
    const code = await enrolled.beginEnrollment({
      address: document,
      sessionUserId: SUBJECT,
      credentialId: "credential_format",
      prfInput: new Uint8Array(32).fill(11),
      prfResult,
    });
    enrolled.confirmEnrollment(code);
    const bytes = await enrolled.serialize();

    const stale = tier3ManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    stale.roots[0]!.recoveryGeneration = 1;
    const staleRegistry = registry();
    await expect(
      staleRegistry.restore(new TextEncoder().encode(JSON.stringify(stale)), {
        sessionUserId: SUBJECT,
        credentialId: "credential_format",
        prfResult,
      }),
    ).rejects.toThrow("authoritative generation");

    const tier1Kind = tier3ManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    const storedEnvelope = tier1Kind.roots[0]!.partitions[0]!.documentKeyEnvelope;
    storedEnvelope.header = {
      ...storedEnvelope.header,
      ciphertextKind: "tier1-recipient-envelope",
      recipientUserId: SUBJECT,
      ephemeralPublicKey: "tier1-substitution",
    };
    const tier1KindRegistry = registry();
    await expect(
      tier1KindRegistry.restore(new TextEncoder().encode(JSON.stringify(tier1Kind)), {
        sessionUserId: SUBJECT,
        credentialId: "credential_format",
        prfResult,
      }),
    ).rejects.toThrow("does not match its document");

    enrolled.dispose();
    staleRegistry.dispose();
    tier1KindRegistry.dispose();
  });

  it("rejects recovery when the stored PRF envelope does not describe the authoritative root", async () => {
    const document = await address("wellness-prf-mismatch");
    const enrolled = registry();
    const recoveryCode = await enrolled.beginEnrollment({
      address: document,
      sessionUserId: SUBJECT,
      credentialId: "credential_original",
      prfInput: new Uint8Array(32).fill(13),
      prfResult: new Uint8Array(32).fill(14),
    });
    enrolled.confirmEnrollment(recoveryCode);
    const manifest = tier3ManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(await enrolled.serialize())),
    );
    manifest.roots[0]!.prfEnvelope.header.credentialId = "credential_substituted";

    const recovering = registry();
    await expect(
      recovering.recover(new TextEncoder().encode(JSON.stringify(manifest)), {
        sessionUserId: SUBJECT,
        credentialId: "credential_replacement",
        prfInput: new Uint8Array(32).fill(15),
        prfResult: new Uint8Array(32).fill(16),
        recoveryCode,
      }),
    ).rejects.toThrow("PRF envelope does not match");

    enrolled.dispose();
    recovering.dispose();
  });

  it("frees every partially restored Tier 3 document when a later duplicate fails", async () => {
    const document = await address("wellness-partial-cleanup");
    const prfResult = new Uint8Array(32).fill(18);
    const enrolled = registry();
    const recoveryCode = await enrolled.beginEnrollment({
      address: document,
      sessionUserId: SUBJECT,
      credentialId: "credential_cleanup",
      prfInput: new Uint8Array(32).fill(17),
      prfResult,
    });
    enrolled.confirmEnrollment(recoveryCode);
    const manifest = tier3ManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(await enrolled.serialize())),
    );
    manifest.roots[0]!.partitions.push(
      structuredClone(manifest.roots[0]!.partitions[0]!),
    );

    let freed = 0;
    const restoring = new Tier3PartitionRegistry(() => {
      const created = new LoroDoc() as unknown as import("loro-crdt/web").LoroDoc;
      const originalFree = created.free.bind(created);
      created.free = () => {
        freed += 1;
        originalFree();
      };
      return created;
    });
    await expect(
      restoring.restore(new TextEncoder().encode(JSON.stringify(manifest)), {
        sessionUserId: SUBJECT,
        credentialId: "credential_cleanup",
        prfResult,
      }),
    ).rejects.toThrow("Duplicate Tier 3 document address");
    expect(freed).toBe(2);

    enrolled.dispose();
    restoring.dispose();
  });

  it("rejects a valid historical epoch spliced from a different Tier 3 document", async () => {
    const documentA = await address("wellness-a");
    const documentB = await address("wellness-b");
    const oldPrfResult = new Uint8Array(32).fill(21);
    const enrolled = registry();
    const oldCode = await enrolled.beginEnrollment({
      address: documentA,
      sessionUserId: SUBJECT,
      credentialId: "credential_old",
      prfInput: new Uint8Array(32).fill(20),
      prfResult: oldPrfResult,
    });
    enrolled.confirmEnrollment(oldCode);
    await enrolled.addDocument(createTier3RootAddress(WORKSPACE, SUBJECT), documentB);
    enrolled.get(documentA)!.document.getMap("private").set("value", "alpha");
    enrolled.get(documentA)!.document.commit();
    enrolled.get(documentB)!.document.getMap("private").set("value", "bravo");
    enrolled.get(documentB)!.document.commit();
    const oldBytes = await enrolled.serialize();
    enrolled.dispose();

    const newPrfResult = new Uint8Array(32).fill(23);
    const rotated = registry();
    const replacementCode = await rotated.recover(oldBytes, {
      sessionUserId: SUBJECT,
      credentialId: "credential_new",
      prfInput: new Uint8Array(32).fill(22),
      prfResult: newPrfResult,
      recoveryCode: oldCode,
    });
    rotated.confirmRecovery(replacementCode);
    const manifest = tier3ManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(await rotated.serialize())),
    );
    const storedA = manifest.roots[0]!.partitions.find(
      ({ address: storedAddress }) => storedAddress.erasureDomainId === "wellness-a",
    )!;
    const storedB = manifest.roots[0]!.partitions.find(
      ({ address: storedAddress }) => storedAddress.erasureDomainId === "wellness-b",
    )!;
    storedA.historicalEpochs[0] = storedB.historicalEpochs[0]!;

    const reopened = registry();
    await expect(
      reopened.restore(new TextEncoder().encode(JSON.stringify(manifest)), {
        sessionUserId: SUBJECT,
        credentialId: "credential_new",
        prfResult: newPrfResult,
      }),
    ).rejects.toThrow("historical document address");
    expect(reopened.size).toBe(0);

    rotated.dispose();
    reopened.dispose();
  });

  it("rejects rollback restore over an already-open newer root generation", async () => {
    const document = await address("wellness-rollback");
    const oldPrfResult = new Uint8Array(32).fill(31);
    const enrolled = registry();
    const oldCode = await enrolled.beginEnrollment({
      address: document,
      sessionUserId: SUBJECT,
      credentialId: "credential_old",
      prfInput: new Uint8Array(32).fill(30),
      prfResult: oldPrfResult,
    });
    enrolled.confirmEnrollment(oldCode);
    const oldBytes = await enrolled.serialize();
    enrolled.dispose();

    const current = registry();
    const replacementCode = await current.recover(oldBytes, {
      sessionUserId: SUBJECT,
      credentialId: "credential_new",
      prfInput: new Uint8Array(32).fill(32),
      prfResult: new Uint8Array(32).fill(33),
      recoveryCode: oldCode,
    });
    current.confirmRecovery(replacementCode);
    expect(current.roots()[0]!.generation).toBe(1);

    await expect(
      current.restore(oldBytes, {
        sessionUserId: SUBJECT,
        credentialId: "credential_old",
        prfResult: oldPrfResult,
      }),
    ).rejects.toThrow("empty registry");
    expect(current.roots()[0]!.generation).toBe(1);

    current.dispose();
  });

  it("cryptographically erases one Tier 3 domain across history without destroying its root or siblings", async () => {
    const documentA = await address("wellness-erased");
    const documentB = await address("wellness-retained");
    const oldPrf = new Uint8Array(32).fill(41);
    const enrolled = registry();
    const oldCode = await enrolled.beginEnrollment({
      address: documentA,
      sessionUserId: SUBJECT,
      credentialId: "credential_old",
      prfInput: new Uint8Array(32).fill(40),
      prfResult: oldPrf,
    });
    enrolled.confirmEnrollment(oldCode);
    await enrolled.addDocument(createTier3RootAddress(WORKSPACE, SUBJECT), documentB);
    enrolled.get(documentA)!.document.getMap("private").set("value", "erase-me");
    enrolled.get(documentA)!.document.commit();
    enrolled.get(documentB)!.document.getMap("private").set("value", "keep-me");
    enrolled.get(documentB)!.document.commit();
    const beforeRecovery = await enrolled.serialize();
    enrolled.dispose();

    const newPrf = new Uint8Array(32).fill(43);
    const current = registry();
    const newCode = await current.recover(beforeRecovery, {
      sessionUserId: SUBJECT,
      credentialId: "credential_new",
      prfInput: new Uint8Array(32).fill(42),
      prfResult: newPrf,
      recoveryCode: oldCode,
    });
    current.confirmRecovery(newCode);
    expect(await current.cryptographicallyEraseErasureDomain("wellness-erased")).toBe(
      1,
    );
    expect(current.get(documentA)).toBeUndefined();
    expect(current.get(documentB)!.document.getMap("private").get("value")).toBe(
      "keep-me",
    );
    expect(current.roots()).toHaveLength(1);

    const bytes = await current.serialize();
    const manifest = tier3ManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    expect(manifest.roots[0]!.erasedPartitions).toHaveLength(1);
    expect(manifest.roots[0]!.erasedPartitions![0]!.historicalEpochs).toHaveLength(1);
    expect(JSON.stringify(manifest.roots[0]!.erasedPartitions)).not.toContain(
      "documentKeyEnvelope",
    );

    const reopened = registry();
    await reopened.restore(bytes, {
      sessionUserId: SUBJECT,
      credentialId: "credential_new",
      prfResult: newPrf,
    });
    expect(reopened.get(documentA)).toBeUndefined();
    expect(reopened.get(documentB)!.document.getMap("private").get("value")).toBe(
      "keep-me",
    );

    const incomplete = structuredClone(manifest) as unknown as Record<string, unknown>;
    const root = (incomplete.roots as Array<Record<string, unknown>>)[0]!;
    const erased = (root.erasedPartitions as Array<Record<string, unknown>>)[0]!;
    erased.documentKeyEnvelope = (
      root.partitions as Array<Record<string, unknown>>
    )[0]!.documentKeyEnvelope;
    expect(() => tier3ManifestSchema.parse(incomplete)).toThrow();

    current.dispose();
    reopened.dispose();
  });
});
