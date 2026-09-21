import { describe, expect, it } from "vitest";
import {
  createTier1IdentityTransfer,
  generateTier1TransferKeyPair,
  openTier1IdentityTransfer,
} from "./tier1-identity-transfer";

async function fixture() {
  const identity = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const target = await generateTier1TransferKeyPair();
  const payload = await createTier1IdentityTransfer({
    identityPrivateKey: identity.privateKey,
    identityPublicKey: identity.publicKey,
    targetTransferPublicKey: target.publicKey,
    workspaceId: "workspace-1",
    canonicalUserId: "user-1",
    sourceDeviceId: "source-1",
    targetDeviceId: "target-1",
    transferId: "transfer-1",
    expiresAt: "2026-08-21T12:05:00.000Z",
    iv: new Uint8Array(12).fill(7),
  });
  return { identity, target, payload };
}

async function open(
  value: Awaited<ReturnType<typeof fixture>>,
  overrides: Partial<Parameters<typeof openTier1IdentityTransfer>[0]> = {},
) {
  return openTier1IdentityTransfer({
    payload: value.payload,
    targetTransferPrivateKey: value.target.privateKey,
    expectedWorkspaceId: "workspace-1",
    expectedCanonicalUserId: "user-1",
    expectedSourceDeviceId: "source-1",
    expectedTargetDeviceId: "target-1",
    expectedTransferId: "transfer-1",
    expectedTargetTransferPublicKey: value.target.publicKey,
    now: "2026-08-21T12:00:00.000Z",
    extractable: false,
    ...overrides,
  });
}

describe("Tier 1 existing-device identity transfer", () => {
  it("moves the identity private key only as authenticated ciphertext", async () => {
    const value = await fixture();
    const opened = await open(value);
    expect(opened.privateKey.extractable).toBe(false);

    const peer = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
    const [sourceBits, targetBits] = await Promise.all([
      crypto.subtle.deriveBits(
        { name: "ECDH", public: peer.publicKey },
        value.identity.privateKey,
        256,
      ),
      crypto.subtle.deriveBits(
        { name: "ECDH", public: peer.publicKey },
        opened.privateKey,
        256,
      ),
    ]);
    expect(new Uint8Array(targetBits)).toEqual(new Uint8Array(sourceBits));
  });

  it.each([
    ["workspace", { expectedWorkspaceId: "workspace-2" }],
    ["user", { expectedCanonicalUserId: "user-2" }],
    ["source", { expectedSourceDeviceId: "source-2" }],
    ["target", { expectedTargetDeviceId: "target-2" }],
    ["transfer", { expectedTransferId: "transfer-2" }],
  ] as const)("rejects wrong %s context", async (_label, override) => {
    const value = await fixture();
    await expect(open(value, override)).rejects.toThrow("context");
  });

  it("rejects expiry and a wrong target transfer key", async () => {
    const value = await fixture();
    await expect(open(value, { now: "2026-08-21T12:05:00.000Z" })).rejects.toThrow(
      "expired",
    );
    const other = await generateTier1TransferKeyPair();
    await expect(
      open(value, { expectedTargetTransferPublicKey: other.publicKey }),
    ).rejects.toThrow("context");
  });

  it("rejects every authenticated header alteration and ciphertext mutation", async () => {
    const value = await fixture();
    const alteredHeader = {
      ...value.payload,
      header: { ...value.payload.header, expiresAt: "2026-08-21T12:06:00.000Z" },
    };
    await expect(open(value, { payload: alteredHeader })).rejects.toThrow(
      "cannot be opened",
    );

    const first = value.payload.wrappedPrivateKey[0]!;
    const alteredCiphertext = {
      ...value.payload,
      wrappedPrivateKey: `${first === "A" ? "B" : "A"}${value.payload.wrappedPrivateKey.slice(1)}`,
    };
    await expect(open(value, { payload: alteredCiphertext })).rejects.toThrow(
      "cannot be opened",
    );
  });

  it("rejects a source identity whose public and private keys do not match", async () => {
    const value = await fixture();
    const otherIdentity = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
    await expect(
      createTier1IdentityTransfer({
        identityPrivateKey: value.identity.privateKey,
        identityPublicKey: otherIdentity.publicKey,
        targetTransferPublicKey: value.target.publicKey,
        workspaceId: "workspace-1",
        canonicalUserId: "user-1",
        sourceDeviceId: "source-1",
        targetDeviceId: "target-1",
        transferId: "transfer-1",
        expiresAt: "2026-08-21T12:05:00.000Z",
      }),
    ).rejects.toThrow("do not match");
  });
});
