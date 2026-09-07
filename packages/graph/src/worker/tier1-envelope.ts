import {
  createProtectedEnvelopeHeader,
  protectedEnvelopeAdditionalData,
  type ProtectedDocumentAddress,
  type ProtectedEnvelopeHeader,
} from "./protected-document";

const HKDF_INFO = new TextEncoder().encode("vulto:tier1-recipient-envelope:v1");

export interface Tier1Recipient {
  readonly userId: string;
  readonly publicKey: CryptoKey;
}

export interface Tier1RecipientEnvelope {
  readonly header: Extract<
    ProtectedEnvelopeHeader,
    { readonly ciphertextKind: "tier1-recipient-envelope" }
  >;
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function deriveWrappingKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  header: ProtectedEnvelopeHeader,
): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits(
    { name: "ECDH", public: publicKey },
    privateKey,
    256,
  );
  const base = await crypto.subtle.importKey("raw", shared, "HKDF", false, [
    "deriveKey",
  ]);
  const salt = await crypto.subtle.digest(
    "SHA-256",
    protectedEnvelopeAdditionalData(header) as BufferSource,
  );
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: HKDF_INFO },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function generateTier1DocumentKeyBytes(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function generateTier1IdentityKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, [
    "deriveBits",
  ]);
}

export async function wrapTier1DocumentKey(input: {
  readonly address: ProtectedDocumentAddress;
  readonly keyEpoch: number;
  readonly recipient: Tier1Recipient;
  readonly documentKeyBytes: Uint8Array;
  readonly ephemeralKeyPair?: CryptoKeyPair;
  readonly iv?: Uint8Array;
}): Promise<Tier1RecipientEnvelope> {
  if (input.documentKeyBytes.byteLength !== 32)
    throw new TypeError("Tier 1 document key must be 256 bits");
  const pair =
    input.ephemeralKeyPair ??
    (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ]));
  const rawEphemeralPublicKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  );
  const header = createProtectedEnvelopeHeader({
    address: input.address,
    keyEpoch: input.keyEpoch,
    ciphertextKind: "tier1-recipient-envelope",
    recipientUserId: input.recipient.userId,
    ephemeralPublicKey: bytesToBase64Url(rawEphemeralPublicKey),
  });
  const iv = input.iv
    ? new Uint8Array(input.iv)
    : crypto.getRandomValues(new Uint8Array(12));
  if (iv.byteLength !== 12)
    throw new TypeError("Tier 1 recipient envelope IV must be 96 bits");
  const key = await deriveWrappingKey(
    pair.privateKey,
    input.recipient.publicKey,
    header,
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv as BufferSource,
        additionalData: protectedEnvelopeAdditionalData(header) as BufferSource,
      },
      key,
      input.documentKeyBytes as BufferSource,
    ),
  );
  return { header: header as Tier1RecipientEnvelope["header"], iv, ciphertext };
}

export async function unwrapTier1DocumentKey(input: {
  readonly envelope: Tier1RecipientEnvelope;
  readonly recipientUserId: string;
  readonly privateKey: CryptoKey;
}): Promise<Uint8Array> {
  const header = input.envelope.header;
  if (header.ciphertextKind !== "tier1-recipient-envelope")
    throw new TypeError("Not a Tier 1 recipient envelope");
  if (header.recipientUserId !== input.recipientUserId)
    throw new TypeError("Recipient identity does not match envelope");
  const padded = header.ephemeralPublicKey.replaceAll("-", "+").replaceAll("_", "/");
  const ephemeralBytes = Uint8Array.from(
    atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)),
    (c) => c.charCodeAt(0),
  );
  const ephemeralPublicKey = await crypto.subtle.importKey(
    "raw",
    ephemeralBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const key = await deriveWrappingKey(input.privateKey, ephemeralPublicKey, header);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: input.envelope.iv as BufferSource,
          additionalData: protectedEnvelopeAdditionalData(header) as BufferSource,
        },
        key,
        input.envelope.ciphertext as BufferSource,
      ),
    );
  } catch {
    throw new TypeError("Tier 1 recipient envelope cannot be opened");
  }
}
