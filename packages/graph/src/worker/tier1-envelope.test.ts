import { describe, expect, it } from "vitest";
import {
  createProtectedDocumentAddress,
  createProtectedReaderSet,
} from "./protected-document";
import {
  generateTier1DocumentKeyBytes,
  generateTier1IdentityKeyPair,
  unwrapTier1DocumentKey,
  wrapTier1DocumentKey,
} from "./tier1-envelope";
import {
  importTier1SharedVectorKeyPair,
  tier1EnvelopeSharedVector,
  tier1SharedVectorDocumentKey,
  tier1SharedVectorIv,
} from "./testing/tier1-envelope-shared-vector";

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function fixture() {
  const readerSet = await createProtectedReaderSet(["user-alpha"]);
  const address = await createProtectedDocumentAddress({
    workspaceId: "workspace-1",
    nodeType: "Employee",
    schemaPartition: "compensation",
    tier: 1,
    readerSet,
    timeBucket: "2026-08",
    erasureDomainId: "employee-1",
  });
  const recipient = await generateTier1IdentityKeyPair();
  const other = await generateTier1IdentityKeyPair();
  const documentKeyBytes = new Uint8Array(32).fill(7);
  return { address, recipient, other, documentKeyBytes };
}

describe("Tier 1 recipient envelopes", () => {
  it("reproduces the checked-in shared envelope vector byte-for-byte", async () => {
    const readerSet = await createProtectedReaderSet(["user-alpha"]);
    const address = await createProtectedDocumentAddress({
      workspaceId: "workspace-1",
      nodeType: "Employee",
      schemaPartition: "compensation",
      tier: 1,
      readerSet,
      timeBucket: "2026-08",
      erasureDomainId: "employee-1",
    });
    const recipient = await importTier1SharedVectorKeyPair(
      tier1EnvelopeSharedVector.recipientPrivateJwk,
      tier1EnvelopeSharedVector.recipientPublicJwk,
    );
    const ephemeral = await importTier1SharedVectorKeyPair(
      tier1EnvelopeSharedVector.ephemeralPrivateJwk,
      tier1EnvelopeSharedVector.ephemeralPublicJwk,
      true,
    );
    const envelope = await wrapTier1DocumentKey({
      address,
      keyEpoch: 1,
      recipient: { userId: "user-alpha", publicKey: recipient.publicKey },
      documentKeyBytes: tier1SharedVectorDocumentKey(),
      ephemeralKeyPair: ephemeral,
      iv: tier1SharedVectorIv(),
    });
    expect(envelope.header.ephemeralPublicKey).toBe(
      tier1EnvelopeSharedVector.expected.ephemeralPublicKey,
    );
    expect(base64(envelope.ciphertext)).toBe(
      tier1EnvelopeSharedVector.expected.ciphertextBase64,
    );
    await expect(
      unwrapTier1DocumentKey({
        envelope,
        recipientUserId: "user-alpha",
        privateKey: recipient.privateKey,
      }),
    ).resolves.toEqual(tier1SharedVectorDocumentKey());
  });

  it("wraps a 256-bit document key for exactly its recipient", async () => {
    const { address, recipient, documentKeyBytes } = await fixture();
    const envelope = await wrapTier1DocumentKey({
      address,
      keyEpoch: 1,
      recipient: { userId: "user-alpha", publicKey: recipient.publicKey },
      documentKeyBytes,
      iv: new Uint8Array(12).fill(9),
    });
    await expect(
      unwrapTier1DocumentKey({
        envelope,
        recipientUserId: "user-alpha",
        privateKey: recipient.privateKey,
      }),
    ).resolves.toEqual(documentKeyBytes);
  });

  it("rejects wrong recipient keys and altered recipient identity", async () => {
    const { address, recipient, other, documentKeyBytes } = await fixture();
    const envelope = await wrapTier1DocumentKey({
      address,
      keyEpoch: 1,
      recipient: { userId: "user-alpha", publicKey: recipient.publicKey },
      documentKeyBytes,
    });
    await expect(
      unwrapTier1DocumentKey({
        envelope,
        recipientUserId: "user-bravo",
        privateKey: other.privateKey,
      }),
    ).rejects.toThrow("Recipient identity");
    await expect(
      unwrapTier1DocumentKey({
        envelope,
        recipientUserId: "user-alpha",
        privateKey: other.privateKey,
      }),
    ).rejects.toThrow("cannot be opened");
  });

  it("rejects altered authenticated address metadata", async () => {
    const { address, recipient, documentKeyBytes } = await fixture();
    const envelope = await wrapTier1DocumentKey({
      address,
      keyEpoch: 1,
      recipient: { userId: "user-alpha", publicKey: recipient.publicKey },
      documentKeyBytes,
    });
    const altered = { ...envelope, header: { ...envelope.header, keyEpoch: 2 } };
    await expect(
      unwrapTier1DocumentKey({
        envelope: altered,
        recipientUserId: "user-alpha",
        privateKey: recipient.privateKey,
      }),
    ).rejects.toThrow("cannot be opened");
  });

  it("rejects every sampled ciphertext-bit flip and truncation", async () => {
    const { address, recipient, documentKeyBytes } = await fixture();
    const envelope = await wrapTier1DocumentKey({
      address,
      keyEpoch: 1,
      recipient: { userId: "user-alpha", publicKey: recipient.publicKey },
      documentKeyBytes,
    });
    for (let index = 0; index < envelope.ciphertext.length; index += 3) {
      const ciphertext = new Uint8Array(envelope.ciphertext);
      ciphertext[index] = ciphertext[index]! ^ (1 << (index % 8));
      await expect(
        unwrapTier1DocumentKey({
          envelope: { ...envelope, ciphertext },
          recipientUserId: "user-alpha",
          privateKey: recipient.privateKey,
        }),
      ).rejects.toThrow("cannot be opened");
    }
    await expect(
      unwrapTier1DocumentKey({
        envelope: { ...envelope, ciphertext: envelope.ciphertext.subarray(0, 31) },
        recipientUserId: "user-alpha",
        privateKey: recipient.privateKey,
      }),
    ).rejects.toThrow("cannot be opened");
  });

  it("creates a fresh 256-bit document key", () => {
    expect(generateTier1DocumentKeyBytes()).toHaveLength(32);
  });
});
