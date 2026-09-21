import { describe, expect, it } from "vitest";
import {
  createTier3PrfHeader,
  createTier3RecoveryHeader,
  createTier3RootAddress,
  decodeTier3RecoveryCode,
  encodeTier3RecoveryCode,
  generateTier3Secret,
  tier3PrfEnvelopeHeaderSchema,
  unwrapTier3Root,
  wrapTier3Root,
} from "./tier3-root";

describe("FDN-52 Tier 3 root envelopes", () => {
  it("round-trips both exact domain-separated envelope constructions", async () => {
    const address = createTier3RootAddress("workspace-1", "subject-1");
    const root = new Uint8Array(32).fill(7);
    const prf = new Uint8Array(32).fill(8);
    const recovery = new Uint8Array(32).fill(9);
    const input = new Uint8Array(32).fill(10);
    const prfEnvelope = await wrapTier3Root({
      rootKey: root,
      ikm: prf,
      header: createTier3PrfHeader({
        rootAddress: address,
        rootGeneration: 0,
        credentialId: "credential_1",
        prfInput: input,
      }),
      iv: new Uint8Array(12).fill(11),
    });
    const recoveryEnvelope = await wrapTier3Root({
      rootKey: root,
      ikm: recovery,
      header: createTier3RecoveryHeader({
        rootAddress: address,
        rootGeneration: 0,
        recoveryGeneration: 0,
      }),
      iv: new Uint8Array(12).fill(12),
    });

    await expect(unwrapTier3Root({ envelope: prfEnvelope, ikm: prf })).resolves.toEqual(
      root,
    );
    await expect(
      unwrapTier3Root({ envelope: recoveryEnvelope, ikm: recovery }),
    ).resolves.toEqual(root);
    expect(prfEnvelope.ciphertext).not.toEqual(recoveryEnvelope.ciphertext);
    await expect(
      unwrapTier3Root({ envelope: prfEnvelope, ikm: new Uint8Array(32).fill(1) }),
    ).rejects.toThrow("cannot be opened");

    const altered = {
      ...prfEnvelope,
      header: { ...prfEnvelope.header, credentialId: "credential_2" },
    };
    await expect(unwrapTier3Root({ envelope: altered, ikm: prf })).rejects.toThrow(
      "cannot be opened",
    );
    const alteredPrfInput = {
      ...prfEnvelope,
      header: {
        ...prfEnvelope.header,
        prfInput: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
    };
    await expect(
      unwrapTier3Root({ envelope: alteredPrfInput, ikm: prf }),
    ).rejects.toThrow("cannot be opened");
  });

  it("encodes all 256 recovery bits in the required canonical shape", () => {
    const secret = generateTier3Secret();
    const code = encodeTier3RecoveryCode(secret);
    expect(code).toMatch(
      /^[0-9A-F]{1}[0-9A-HJKMNP-TV-Z]{3}(?:-[0-9A-HJKMNP-TV-Z]{4}){12}$/,
    );
    expect(decodeTier3RecoveryCode(code)).toEqual(secret);
    expect(() => decodeTier3RecoveryCode(code.toLowerCase())).not.toThrow();
    expect(() => decodeTier3RecoveryCode(code.replace("-", ""))).toThrow(
      "not canonical",
    );
  });

  it("round-trips sampled 256-bit recovery secrets and rejects short durable PRF input", () => {
    let state = 0x52_03_00_01;
    for (let trial = 0; trial < 128; trial += 1) {
      const secret = new Uint8Array(32);
      for (let index = 0; index < secret.length; index += 1) {
        state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
        secret[index] = state >>> 24;
      }
      const code = encodeTier3RecoveryCode(secret);
      expect(decodeTier3RecoveryCode(code)).toEqual(secret);
    }

    const valid = createTier3PrfHeader({
      rootAddress: createTier3RootAddress("workspace-1", "subject-1"),
      rootGeneration: 0,
      credentialId: "credential_1",
      prfInput: new Uint8Array(32).fill(1),
    });
    expect(() =>
      tier3PrfEnvelopeHeaderSchema.parse({ ...valid, prfInput: "AA" }),
    ).toThrow("32-byte canonical base64url");
  });
});
