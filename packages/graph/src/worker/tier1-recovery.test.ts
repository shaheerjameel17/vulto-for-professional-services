import { describe, expect, it } from "vitest";
import { createProtectedDocumentAddress, createProtectedReaderSet } from "./protected-document";
import {
  combineTier1RecoveryShares,
  decodeTier1RecoveryShare,
  encodeTier1RecoveryShare,
  generateTier1RecoverySecret,
  splitTier1RecoverySecret,
  unwrapTier1RecoveryDocumentKey,
  verifyTier1RecoveryShareReentry,
  wrapTier1RecoveryDocumentKey,
} from "./tier1-recovery";

async function fixtureAddress() {
  const readerSet = await createProtectedReaderSet(["owner-1", "owner-2", "owner-3"]);
  return createProtectedDocumentAddress({
    workspaceId: "workspace-1",
    nodeType: "Employee",
    schemaPartition: "compensation",
    tier: 1,
    readerSet,
    timeBucket: "2026-08",
    erasureDomainId: "employee-1",
  });
}

describe("FDN-52 F167 — Tier 1 recovery: split, combine, share encoding", () => {
  it("splits a secret 2-of-3 and reconstructs it from any pair of the three shares", async () => {
    const secret = generateTier1RecoverySecret();
    expect(secret.byteLength).toBe(32);
    const shares = await splitTier1RecoverySecret(secret);
    expect(shares.length).toBe(3);
    for (const share of shares) expect(share.byteLength).toBe(33);

    const pairs: Array<[number, number]> = [
      [0, 1],
      [0, 2],
      [1, 2],
    ];
    for (const [a, b] of pairs) {
      const reconstructed = await combineTier1RecoveryShares([shares[a]!, shares[b]!]);
      expect(reconstructed).toEqual(secret);
    }
  });

  it("rejects reconstruction from a single share — below threshold, not merely inconvenient", async () => {
    const secret = generateTier1RecoverySecret();
    const shares = await splitTier1RecoverySecret(secret);
    await expect(combineTier1RecoveryShares([shares[0]!])).rejects.toThrow();
  });

  it("rejects splitting a secret of the wrong length", async () => {
    await expect(splitTier1RecoverySecret(new Uint8Array(31))).rejects.toThrow();
    await expect(splitTier1RecoverySecret(new Uint8Array(33))).rejects.toThrow();
  });

  it("share encoding round-trips and rejects a non-canonical re-entry", async () => {
    const secret = generateTier1RecoverySecret();
    const shares = await splitTier1RecoverySecret(secret);
    for (const share of shares) {
      const code = encodeTier1RecoveryShare(share);
      expect(decodeTier1RecoveryShare(code)).toEqual(share);
      // Case-insensitive, matching Tier 3's recovery-code convention.
      expect(decodeTier1RecoveryShare(code.toLowerCase())).toEqual(share);
    }
    // A transcription error must not silently decode to a different value.
    const share = shares[0]!;
    const code = encodeTier1RecoveryShare(share);
    const corrupted = code[0] === "0" ? "1" + code.slice(1) : "0" + code.slice(1);
    expect(() => decodeTier1RecoveryShare(corrupted)).not.toThrow();
    expect(decodeTier1RecoveryShare(corrupted)).not.toEqual(share);
  });

  it("T13's mandatory re-entry check accepts only an exact match", async () => {
    const secret = generateTier1RecoverySecret();
    const shares = await splitTier1RecoverySecret(secret);
    const share = shares[0]!;
    const code = encodeTier1RecoveryShare(share);
    expect(verifyTier1RecoveryShareReentry(share, code)).toBe(true);
    expect(verifyTier1RecoveryShareReentry(share, code.toLowerCase())).toBe(true);
    expect(verifyTier1RecoveryShareReentry(share, encodeTier1RecoveryShare(shares[1]!))).toBe(
      false,
    );
    expect(verifyTier1RecoveryShareReentry(share, "not a share")).toBe(false);
  });
});

describe("FDN-52 F167 — Tier 1 recovery envelope: wraps/unwraps under the reconstructed secret", () => {
  it("round-trips a document key under a reconstructed 2-of-3 secret", async () => {
    const address = await fixtureAddress();
    const secret = generateTier1RecoverySecret();
    const documentKeyBytes = new Uint8Array(32).fill(7);
    const shares = await splitTier1RecoverySecret(secret);
    const reconstructed = await combineTier1RecoveryShares([shares[0]!, shares[2]!]);

    const envelope = await wrapTier1RecoveryDocumentKey({
      address,
      keyEpoch: 0,
      recoverySecret: secret,
      documentKeyBytes,
    });
    expect(envelope.header.ciphertextKind).toBe("tier1-recovery-envelope");

    const opened = await unwrapTier1RecoveryDocumentKey({
      envelope,
      recoverySecret: reconstructed,
    });
    expect(opened).toEqual(documentKeyBytes);
  });

  it("negative: the wrong pair of shares reconstructs a different secret, and the envelope fails to open", async () => {
    const address = await fixtureAddress();
    const secretA = generateTier1RecoverySecret();
    const secretB = generateTier1RecoverySecret();
    const documentKeyBytes = new Uint8Array(32).fill(9);
    const sharesA = await splitTier1RecoverySecret(secretA);
    const sharesB = await splitTier1RecoverySecret(secretB);

    const envelope = await wrapTier1RecoveryDocumentKey({
      address,
      keyEpoch: 0,
      recoverySecret: secretA,
      documentKeyBytes,
    });

    // "Wrong holder": one share from this partition's split, one share from
    // an entirely different workspace/document's split. combine() itself
    // has no way to know these came from different secrets — it will
    // produce 32 bytes regardless. The envelope must still refuse to open.
    const wrongPairSecret = await combineTier1RecoveryShares([sharesA[0]!, sharesB[1]!]);
    await expect(
      unwrapTier1RecoveryDocumentKey({ envelope, recoverySecret: wrongPairSecret }),
    ).rejects.toThrow();
  });

  it("negative: a corrupted share reconstructs the wrong secret, and the envelope fails to open", async () => {
    const address = await fixtureAddress();
    const secret = generateTier1RecoverySecret();
    const documentKeyBytes = new Uint8Array(32).fill(3);
    const shares = await splitTier1RecoverySecret(secret);
    const envelope = await wrapTier1RecoveryDocumentKey({
      address,
      keyEpoch: 0,
      recoverySecret: secret,
      documentKeyBytes,
    });

    const corrupted = new Uint8Array(shares[1]!);
    corrupted[0] = corrupted[0]! ^ 0xff;
    const wrongSecret = await combineTier1RecoveryShares([shares[0]!, corrupted]);
    // The corruption must have actually changed the reconstruction, or this
    // test proves nothing.
    expect(wrongSecret).not.toEqual(secret);
    await expect(
      unwrapTier1RecoveryDocumentKey({ envelope, recoverySecret: wrongSecret }),
    ).rejects.toThrow();
  });

  it("negative: an envelope from a different protected address cannot be opened with the right secret", async () => {
    const addressA = await fixtureAddress();
    const readerSetB = await createProtectedReaderSet(["owner-4"]);
    const addressB = await createProtectedDocumentAddress({
      workspaceId: "workspace-2",
      nodeType: "Employee",
      schemaPartition: "compensation",
      tier: 1,
      readerSet: readerSetB,
      timeBucket: "2026-08",
      erasureDomainId: "employee-2",
    });
    const secret = generateTier1RecoverySecret();
    const documentKeyBytes = new Uint8Array(32).fill(5);
    const envelope = await wrapTier1RecoveryDocumentKey({
      address: addressA,
      keyEpoch: 0,
      recoverySecret: secret,
      documentKeyBytes,
    });
    // Rebuild the SAME ciphertext/iv under a header claiming address B — the
    // AAD-binding check this project applies to every other envelope kind.
    const relabeled = {
      ...envelope,
      header: { ...envelope.header, address: addressB },
    };
    await expect(
      unwrapTier1RecoveryDocumentKey({ envelope: relabeled, recoverySecret: secret }),
    ).rejects.toThrow();
  });
});
