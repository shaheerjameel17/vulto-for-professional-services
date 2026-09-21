import canonicalize from "canonicalize";
import { z } from "zod";

export const TIER1_IDENTITY_TRANSFER_CONSTRUCTION =
  "vulto:tier1-identity-transfer:v1" as const;
const TRANSFER_INFO = new TextEncoder().encode("vulto:tier1-identity-transfer-kek:v1");

const identifier = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._:-]+$/);
const publicKey = z.string().min(1);

export const tier1IdentityTransferHeaderSchema = z
  .object({
    construction: z.literal(TIER1_IDENTITY_TRANSFER_CONSTRUCTION),
    formatVersion: z.literal(1),
    workspaceId: identifier,
    canonicalUserId: identifier,
    sourceDeviceId: identifier,
    targetDeviceId: identifier,
    transferId: identifier,
    expiresAt: z.string().datetime({ offset: true }),
    sourceIdentityPublicKey: publicKey,
    sourceTransferPublicKey: publicKey,
    targetTransferPublicKey: publicKey,
  })
  .strict();

export const tier1IdentityTransferPayloadSchema = z
  .object({
    header: tier1IdentityTransferHeaderSchema,
    iv: z.string().min(1),
    wrappedPrivateKey: z.string().min(1),
  })
  .strict();

export type Tier1IdentityTransferHeader = z.infer<
  typeof tier1IdentityTransferHeaderSchema
>;
export type Tier1IdentityTransferPayload = z.infer<
  typeof tier1IdentityTransferPayloadSchema
>;

function b64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function unb64(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(
    atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)),
    (character) => character.charCodeAt(0),
  );
}

function aad(header: Tier1IdentityTransferHeader): Uint8Array {
  const serialized = canonicalize(tier1IdentityTransferHeaderSchema.parse(header));
  if (serialized === undefined) throw new TypeError("Transfer header is not canonical");
  return new TextEncoder().encode(serialized);
}

export async function importP256PublicKey(value: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    unb64(value) as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [],
  );
}

async function deriveKek(
  privateKey: CryptoKey,
  peerPublicKey: CryptoKey,
  header: Tier1IdentityTransferHeader,
): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits(
    { name: "ECDH", public: peerPublicKey },
    privateKey,
    256,
  );
  const base = await crypto.subtle.importKey("raw", shared, "HKDF", false, [
    "deriveKey",
  ]);
  const salt = await crypto.subtle.digest("SHA-256", aad(header) as BufferSource);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: TRANSFER_INFO },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

/**
 * Web Crypto does not expose a direct "derive public key" operation. ECDH
 * symmetry gives an equivalent consistency proof without exporting either
 * private key: both sides of a fresh verifier exchange must produce the same
 * shared secret only when `privateKey` and `publicKey` are one key pair.
 */
export async function assertP256KeyPair(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
): Promise<void> {
  const verifier = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  const [fromPrivate, fromPublic] = await Promise.all([
    crypto.subtle.deriveBits(
      { name: "ECDH", public: verifier.publicKey },
      privateKey,
      256,
    ),
    crypto.subtle.deriveBits(
      { name: "ECDH", public: publicKey },
      verifier.privateKey,
      256,
    ),
  ]);
  const left = new Uint8Array(fromPrivate);
  const right = new Uint8Array(fromPublic);
  let difference = left.byteLength ^ right.byteLength;
  for (let index = 0; index < Math.min(left.byteLength, right.byteLength); index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  left.fill(0);
  right.fill(0);
  if (difference !== 0)
    throw new Error("Tier 1 identity public and private keys do not match");
}

export async function exportP256PublicKey(key: CryptoKey): Promise<string> {
  return b64(new Uint8Array(await crypto.subtle.exportKey("raw", key)));
}

export async function generateTier1TransferKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
}

export async function createTier1IdentityTransfer(input: {
  readonly identityPrivateKey: CryptoKey;
  readonly identityPublicKey: CryptoKey;
  readonly targetTransferPublicKey: CryptoKey;
  readonly workspaceId: string;
  readonly canonicalUserId: string;
  readonly sourceDeviceId: string;
  readonly targetDeviceId: string;
  readonly transferId: string;
  readonly expiresAt: string;
  readonly sourceTransferKeyPair?: CryptoKeyPair;
  readonly iv?: Uint8Array;
}): Promise<Tier1IdentityTransferPayload> {
  if (!input.identityPrivateKey.extractable) {
    throw new Error("Transfer requires a transient extractable identity key");
  }
  await assertP256KeyPair(input.identityPrivateKey, input.identityPublicKey);
  const sourceTransfer =
    input.sourceTransferKeyPair ?? (await generateTier1TransferKeyPair());
  const header = tier1IdentityTransferHeaderSchema.parse({
    construction: TIER1_IDENTITY_TRANSFER_CONSTRUCTION,
    formatVersion: 1,
    workspaceId: input.workspaceId,
    canonicalUserId: input.canonicalUserId,
    sourceDeviceId: input.sourceDeviceId,
    targetDeviceId: input.targetDeviceId,
    transferId: input.transferId,
    expiresAt: input.expiresAt,
    sourceIdentityPublicKey: await exportP256PublicKey(input.identityPublicKey),
    sourceTransferPublicKey: await exportP256PublicKey(sourceTransfer.publicKey),
    targetTransferPublicKey: await exportP256PublicKey(input.targetTransferPublicKey),
  });
  const iv = input.iv
    ? new Uint8Array(input.iv)
    : crypto.getRandomValues(new Uint8Array(12));
  if (iv.byteLength !== 12) throw new TypeError("Transfer IV must be 96 bits");
  const kek = await deriveKek(
    sourceTransfer.privateKey,
    input.targetTransferPublicKey,
    header,
  );
  const wrappedPrivateKey = new Uint8Array(
    await crypto.subtle.wrapKey("pkcs8", input.identityPrivateKey, kek, {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: aad(header) as BufferSource,
    }),
  );
  return { header, iv: b64(iv), wrappedPrivateKey: b64(wrappedPrivateKey) };
}

export async function openTier1IdentityTransfer(input: {
  readonly payload: Tier1IdentityTransferPayload;
  readonly targetTransferPrivateKey: CryptoKey;
  readonly expectedWorkspaceId: string;
  readonly expectedCanonicalUserId: string;
  readonly expectedSourceDeviceId: string;
  readonly expectedTargetDeviceId: string;
  readonly expectedTransferId: string;
  readonly expectedTargetTransferPublicKey: CryptoKey;
  readonly now: string;
  readonly extractable: boolean;
}): Promise<{
  readonly privateKey: CryptoKey;
  readonly sourceIdentityPublicKey: CryptoKey;
}> {
  const payload = tier1IdentityTransferPayloadSchema.parse(input.payload);
  const header = payload.header;
  const now = Date.parse(input.now);
  const expiry = Date.parse(header.expiresAt);
  if (!Number.isFinite(now) || !Number.isFinite(expiry) || expiry <= now) {
    throw new Error("Tier 1 identity transfer is expired");
  }
  if (
    header.workspaceId !== input.expectedWorkspaceId ||
    header.canonicalUserId !== input.expectedCanonicalUserId ||
    header.sourceDeviceId !== input.expectedSourceDeviceId ||
    header.targetDeviceId !== input.expectedTargetDeviceId ||
    header.transferId !== input.expectedTransferId ||
    header.targetTransferPublicKey !==
      (await exportP256PublicKey(input.expectedTargetTransferPublicKey))
  ) {
    throw new Error("Tier 1 identity transfer context does not match enrollment");
  }
  const sourceTransferPublicKey = await importP256PublicKey(
    header.sourceTransferPublicKey,
  );
  const kek = await deriveKek(
    input.targetTransferPrivateKey,
    sourceTransferPublicKey,
    header,
  );
  try {
    const privateKey = await crypto.subtle.unwrapKey(
      "pkcs8",
      unb64(payload.wrappedPrivateKey) as BufferSource,
      kek,
      {
        name: "AES-GCM",
        iv: unb64(payload.iv) as BufferSource,
        additionalData: aad(header) as BufferSource,
      },
      { name: "ECDH", namedCurve: "P-256" },
      input.extractable,
      ["deriveBits"],
    );
    const sourceIdentityPublicKey = await importP256PublicKey(
      header.sourceIdentityPublicKey,
    );
    await assertP256KeyPair(privateKey, sourceIdentityPublicKey);
    return {
      privateKey,
      sourceIdentityPublicKey,
    };
  } catch {
    throw new Error("Tier 1 identity transfer cannot be opened");
  }
}
