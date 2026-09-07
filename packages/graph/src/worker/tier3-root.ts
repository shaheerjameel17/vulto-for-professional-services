import canonicalize from "canonicalize";
import { z } from "zod";

export const TIER3_ROOT_ADDRESS_CONSTRUCTION = "vulto:tier3-root-address:v1" as const;
export const TIER3_ROOT_ENVELOPE_CONSTRUCTION = "vulto:tier3-root-envelope:v1" as const;
const PRF_INFO = new TextEncoder().encode("vulto:tier3-prf-envelope:v1");
const RECOVERY_INFO = new TextEncoder().encode("vulto:tier3-recovery-code-envelope:v1");
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const identifier = z.string().min(1).max(512);
const base64Url = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/);
const prfInputBase64Url = base64Url.refine((value) => {
  try {
    const decoded = decodeBase64Url(value);
    return decoded.byteLength === 32 && encodeBase64Url(decoded) === value;
  } catch {
    return false;
  }
}, "must be a 32-byte canonical base64url value");

export const tier3RootAddressSchema = z
  .object({
    workspaceId: identifier,
    canonicalSubjectUserId: identifier,
    construction: z.literal(TIER3_ROOT_ADDRESS_CONSTRUCTION),
  })
  .strict();

const rootHeaderBase = z
  .object({
    construction: z.literal(TIER3_ROOT_ENVELOPE_CONSTRUCTION),
    rootAddress: tier3RootAddressSchema,
    rootGeneration: z.number().int().nonnegative(),
  })
  .strict();

export const tier3PrfEnvelopeHeaderSchema = rootHeaderBase.extend({
  ciphertextKind: z.literal("tier3-prf-root-envelope"),
  credentialId: base64Url,
  prfInput: prfInputBase64Url,
});

export const tier3RecoveryEnvelopeHeaderSchema = rootHeaderBase.extend({
  ciphertextKind: z.literal("tier3-recovery-root-envelope"),
  recoveryGeneration: z.number().int().nonnegative(),
});

export const tier3RootEnvelopeHeaderSchema = z.discriminatedUnion("ciphertextKind", [
  tier3PrfEnvelopeHeaderSchema,
  tier3RecoveryEnvelopeHeaderSchema,
]);

export type Tier3RootAddress = z.infer<typeof tier3RootAddressSchema>;
export type Tier3RootEnvelopeHeader = z.infer<typeof tier3RootEnvelopeHeaderSchema>;
export interface Tier3RootEnvelope {
  readonly header: Tier3RootEnvelopeHeader;
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
}

function canonical(value: unknown): Uint8Array {
  const text = canonicalize(value);
  if (text === undefined) throw new TypeError("Tier 3 metadata is not canonicalizable");
  return new TextEncoder().encode(text);
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export function createTier3RootAddress(
  workspaceId: string,
  canonicalSubjectUserId: string,
): Tier3RootAddress {
  return tier3RootAddressSchema.parse({
    workspaceId,
    canonicalSubjectUserId,
    construction: TIER3_ROOT_ADDRESS_CONSTRUCTION,
  });
}

export function createTier3PrfHeader(input: {
  readonly rootAddress: Tier3RootAddress;
  readonly rootGeneration: number;
  readonly credentialId: string;
  readonly prfInput: Uint8Array;
}): Tier3RootEnvelopeHeader {
  if (input.prfInput.byteLength !== 32) {
    throw new TypeError("Tier 3 PRF application input must be 32 bytes");
  }
  return tier3RootEnvelopeHeaderSchema.parse({
    construction: TIER3_ROOT_ENVELOPE_CONSTRUCTION,
    rootAddress: input.rootAddress,
    rootGeneration: input.rootGeneration,
    ciphertextKind: "tier3-prf-root-envelope",
    credentialId: input.credentialId,
    prfInput: encodeBase64Url(input.prfInput),
  });
}

export function createTier3RecoveryHeader(input: {
  readonly rootAddress: Tier3RootAddress;
  readonly rootGeneration: number;
  readonly recoveryGeneration: number;
}): Tier3RootEnvelopeHeader {
  return tier3RootEnvelopeHeaderSchema.parse({
    construction: TIER3_ROOT_ENVELOPE_CONSTRUCTION,
    rootAddress: input.rootAddress,
    rootGeneration: input.rootGeneration,
    ciphertextKind: "tier3-recovery-root-envelope",
    recoveryGeneration: input.recoveryGeneration,
  });
}

export function tier3RootEnvelopeAdditionalData(
  header: Tier3RootEnvelopeHeader,
): Uint8Array {
  return canonical(tier3RootEnvelopeHeaderSchema.parse(header));
}

async function deriveWrappingKey(
  ikm: Uint8Array,
  header: Tier3RootEnvelopeHeader,
): Promise<CryptoKey> {
  if (ikm.byteLength !== 32)
    throw new TypeError("Tier 3 envelope IKM must be 32 bytes");
  const material = await crypto.subtle.importKey(
    "raw",
    ikm as BufferSource,
    "HKDF",
    false,
    ["deriveKey"],
  );
  const aad = tier3RootEnvelopeAdditionalData(header);
  const salt = await crypto.subtle.digest("SHA-256", aad as BufferSource);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info:
        header.ciphertextKind === "tier3-prf-root-envelope" ? PRF_INFO : RECOVERY_INFO,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function wrapTier3Root(input: {
  readonly rootKey: Uint8Array;
  readonly ikm: Uint8Array;
  readonly header: Tier3RootEnvelopeHeader;
  readonly iv?: Uint8Array;
}): Promise<Tier3RootEnvelope> {
  if (input.rootKey.byteLength !== 32)
    throw new TypeError("Tier 3 root must be 32 bytes");
  const header = tier3RootEnvelopeHeaderSchema.parse(input.header);
  const iv = input.iv ?? crypto.getRandomValues(new Uint8Array(12));
  if (iv.byteLength !== 12) throw new TypeError("AES-GCM IV must be 12 bytes");
  const key = await deriveWrappingKey(input.ikm, header);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: tier3RootEnvelopeAdditionalData(header) as BufferSource,
    },
    key,
    input.rootKey as BufferSource,
  );
  return { header, iv, ciphertext: new Uint8Array(ciphertext) };
}

export async function unwrapTier3Root(input: {
  readonly envelope: Tier3RootEnvelope;
  readonly ikm: Uint8Array;
}): Promise<Uint8Array> {
  const header = tier3RootEnvelopeHeaderSchema.parse(input.envelope.header);
  try {
    const key = await deriveWrappingKey(input.ikm, header);
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: input.envelope.iv as BufferSource,
          additionalData: tier3RootEnvelopeAdditionalData(header) as BufferSource,
        },
        key,
        input.envelope.ciphertext as BufferSource,
      ),
    );
  } catch {
    throw new Error("Tier 3 root envelope cannot be opened");
  }
}

export function generateTier3Secret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function encodeTier3RecoveryCode(secret: Uint8Array): string {
  if (secret.byteLength !== 32) throw new TypeError("Recovery secret must be 32 bytes");
  let value = 0n;
  for (const byte of secret) value = (value << 8n) | BigInt(byte);
  const characters = Array.from({ length: 52 }, () => "0");
  for (let index = 51; index >= 0; index -= 1) {
    characters[index] = CROCKFORD[Number(value & 31n)]!;
    value >>= 5n;
  }
  return Array.from({ length: 13 }, (_, index) =>
    characters.slice(index * 4, index * 4 + 4).join(""),
  ).join("-");
}

export function decodeTier3RecoveryCode(code: string): Uint8Array {
  const compact = code.toUpperCase().replaceAll("-", "");
  if (compact.length !== 52 || !/^[0-9A-HJKMNP-TV-Z]+$/.test(compact)) {
    throw new Error("Invalid Tier 3 recovery code");
  }
  let value = 0n;
  for (const character of compact) {
    const digit = CROCKFORD.indexOf(character);
    if (digit < 0) throw new Error("Invalid Tier 3 recovery code");
    value = (value << 5n) | BigInt(digit);
  }
  if (value >> 256n) throw new Error("Invalid Tier 3 recovery code");
  const secret = new Uint8Array(32);
  for (let index = 31; index >= 0; index -= 1) {
    secret[index] = Number(value & 255n);
    value >>= 8n;
  }
  if (encodeTier3RecoveryCode(secret) !== code.toUpperCase()) {
    throw new Error("Tier 3 recovery code is not canonical");
  }
  return secret;
}
