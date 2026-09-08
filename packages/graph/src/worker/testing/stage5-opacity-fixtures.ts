/**
 * FDN-51 Stage 5 — the server-opacity proof fixtures.
 *
 * Builds two committed fixture files consumed by
 * `services/sync-engine/tests/relay_pg.rs`'s adversarial opacity cases:
 *
 *   services/sync-engine/tests/vectors/opacity/tier1.json
 *   services/sync-engine/tests/vectors/opacity/tier3.json
 *
 * Each file carries:
 *   - `payloads`  — real FDN-52 protected-envelope byte strings (AES-GCM
 *     ciphertext under the real constructions), the kind of opaque blob that
 *     crosses the relay for a Tier 1/3 document delta or an A003-T32 identity
 *     transfer. The Rust test pushes each as `PushDelta { tier_tag: opaque }`.
 *   - `must_be_absent` — every secret in the Tier 1/3 key hierarchy (founder
 *     ruling on the Stage 5 plan). The Rust test proves none of these appears
 *     on any server surface: no `sync_*` column, no relay log line.
 *   - `not_scanned` — non-secret metadata that legitimately may appear
 *     server-side, recorded so the proof is explicit about what it does NOT
 *     treat as a leak (notably the Tier 3 PRF *input*).
 *
 * **Every key, secret, and plaintext below is a fixed non-production value
 * generated solely for this proof. None is used in, or derived from, any real
 * workspace.** The generator is deterministic — fixed keys and fixed IVs
 * throughout, and two pre-computed Shamir shares whose reconstruction is
 * re-verified here — so the committed files are byte-stable. Regenerate with:
 *
 *   pnpm stage5:opacity-fixtures
 *
 * `stage5-opacity-fixtures.test.ts` guards the committed files against drift.
 */

import {
  createProtectedDocumentAddress,
  createProtectedEnvelopeHeader,
  createProtectedReaderSet,
  PROTECTED_ENVELOPE_FORMAT_VERSION,
  protectedEnvelopeAdditionalData,
} from "../protected-document";
import { wrapTier1DocumentKey } from "../tier1-envelope";
import {
  createTier1IdentityTransfer,
  type Tier1IdentityTransferPayload,
} from "../tier1-identity-transfer";
import {
  combineTier1RecoveryShares,
  wrapTier1RecoveryDocumentKey,
} from "../tier1-recovery";
import {
  createTier3PrfHeader,
  createTier3RecoveryHeader,
  createTier3RootAddress,
  encodeBase64Url,
  encodeTier3RecoveryCode,
  wrapTier3Root,
} from "../tier3-root";

// --- fixed, test-only inputs ------------------------------------------------

const WORKSPACE_ID = "5721b0de-0000-4000-8000-00000000a5a5";
const CANONICAL_USER_ID = "user-stage5-opacity-subject";
const SOURCE_DEVICE_ID = "device-stage5-source";
const TARGET_DEVICE_ID = "device-stage5-target";
const KEY_EPOCH = 1;

/** A 12-byte IV, distinct per envelope so no two reuse a (key, IV) pair. */
const iv = (seed: number): Uint8Array =>
  Uint8Array.from({ length: 12 }, (_, i) => (seed * 41 + i * 7 + 3) & 0xff);

const bytes = (seed: number, length: number): Uint8Array =>
  Uint8Array.from({ length }, (_, i) => (seed * 131 + i * 17 + 29) & 0xff);

/** Recognizable sentinels so a positive control is trivial to write. */
const TIER1_PLAINTEXT = new TextEncoder().encode(
  "VULTO-STAGE5-TIER1-PROTECTED-PLAINTEXT-do-not-log-1234567890",
);
const TIER3_PLAINTEXT = new TextEncoder().encode(
  "VULTO-STAGE5-TIER3-PROTECTED-PLAINTEXT-do-not-log-1234567890",
);

const TIER1_DOCUMENT_KEY = bytes(11, 32);
const TIER1_RECOVERY_SECRET = Uint8Array.from(
  { length: 32 },
  (_, i) => (i * 7 + 3) & 0xff,
);
/**
 * Two of the three real 2-of-3 Shamir shares of `TIER1_RECOVERY_SECRET`,
 * pre-computed with `shamir-secret-sharing@0.0.3` (the A003-T14 primitive).
 * `buildTier1Fixture` re-verifies they reconstruct the secret, so a
 * primitive change that broke them would fail generation rather than ship a
 * fake share.
 */
const TIER1_RECOVERY_SHARES = [
  "3bd984132ae82f965f4a50f3b36bf262d93768b37da05711fa115c80fb2afb4f2a",
  "6b1aa3dbd368f99ea23fa4905f920376a41b2d5e1ae460f9fe72db051cc6200946",
].map(fromHex);

const TIER3_DOCUMENT_KEY = bytes(31, 32);
const TIER3_ROOT_KEY = bytes(37, 32);
const TIER3_RECOVERY_SECRET = bytes(41, 32);
/** Stand-in for the browser-returned WebAuthn PRF *result* (the 32-byte secret). */
const TIER3_PRF_RESULT = bytes(43, 32);
/** The PRF *input* is non-secret persisted metadata — recorded, never scanned. */
const TIER3_PRF_INPUT = bytes(47, 32);
const TIER3_CREDENTIAL_ID = "stage5-opacity-credential";

// fixed P-256 keypairs (test-only)
const RECIPIENT_JWK: { private: JsonWebKey; public: JsonWebKey } = {
  private: {
    key_ops: ["deriveBits"],
    ext: true,
    kty: "EC",
    x: "CupO8mduGUxf6F_dKY08IIk4k6SAsparyh2IiD5ulKU",
    y: "iONhkUo3JM1o-cBs9_vLR27xcSjzWOGnNl0Za1H8DX4",
    crv: "P-256",
    d: "RcXXphWL0UeteBrr2hI1RZZTkBhd4bGOBGeE_DyLRn8",
  },
  public: {
    key_ops: [],
    ext: true,
    kty: "EC",
    x: "CupO8mduGUxf6F_dKY08IIk4k6SAsparyh2IiD5ulKU",
    y: "iONhkUo3JM1o-cBs9_vLR27xcSjzWOGnNl0Za1H8DX4",
    crv: "P-256",
  },
};
const EPHEMERAL_JWK: { private: JsonWebKey; public: JsonWebKey } = {
  private: {
    key_ops: ["deriveBits"],
    ext: true,
    kty: "EC",
    x: "Vw3ofIXYAbdDWIXJLXlLt4PF9F8TJLmssOaioghaxCI",
    y: "o0m93coESe8bFtxIHPjCdapE2iuxsdDji5hKZiEzRN0",
    crv: "P-256",
    d: "y4UYfMjkQR0uTBrLp_kFJWisNKh0fbETG0bUfJFdGM0",
  },
  public: {
    key_ops: [],
    ext: true,
    kty: "EC",
    x: "Vw3ofIXYAbdDWIXJLXlLt4PF9F8TJLmssOaioghaxCI",
    y: "o0m93coESe8bFtxIHPjCdapE2iuxsdDji5hKZiEzRN0",
    crv: "P-256",
  },
};
const IDENTITY_JWK: { private: JsonWebKey; public: JsonWebKey } = {
  private: {
    key_ops: ["deriveBits"],
    ext: true,
    kty: "EC",
    x: "fMG2ZcxcL1McX2j-8ylVFuliCl3QLXPPTpEybMYmjc0",
    y: "WTb5Zl72OlHwMpQJzN5vTmePVJmxHsim6SB0gC_sRx8",
    crv: "P-256",
    d: "KQQfcHdopUf3sF1ppcxqA7SLb3lMl74q-B3dYiZeCeU",
  },
  public: {
    key_ops: [],
    ext: true,
    kty: "EC",
    x: "fMG2ZcxcL1McX2j-8ylVFuliCl3QLXPPTpEybMYmjc0",
    y: "WTb5Zl72OlHwMpQJzN5vTmePVJmxHsim6SB0gC_sRx8",
    crv: "P-256",
  },
};
const SOURCE_TRANSFER_JWK: { private: JsonWebKey; public: JsonWebKey } = {
  private: {
    key_ops: ["deriveBits"],
    ext: true,
    kty: "EC",
    x: "qkNtAyen4LJsYtXO6lETgH1XQ_6GtcfBZiCN5NQHnaE",
    y: "oNzOBEPrlz3P3iXe1_tcnwfMugHPyGnbCwX1DNDT1KQ",
    crv: "P-256",
    d: "v7-jF7gY3eA2pPT7mEfelESIuDoVc7K2pYer81Bnfp8",
  },
  public: {
    key_ops: [],
    ext: true,
    kty: "EC",
    x: "qkNtAyen4LJsYtXO6lETgH1XQ_6GtcfBZiCN5NQHnaE",
    y: "oNzOBEPrlz3P3iXe1_tcnwfMugHPyGnbCwX1DNDT1KQ",
    crv: "P-256",
  },
};
const TARGET_TRANSFER_JWK: { private: JsonWebKey; public: JsonWebKey } = {
  private: {
    key_ops: ["deriveBits"],
    ext: true,
    kty: "EC",
    x: "F3llFcSvzorBkPa0h7LDVstNECgqzp9Kha2J8r4cZ5Y",
    y: "0vBJgTXVYmPx4iUWZEz-IXqZxzCo9GSol7zI3gUfhBE",
    crv: "P-256",
    d: "WsKP-SVINZ3CL1KjMgwwfVRQhcnyrs9Bri_ya33Oz-8",
  },
  public: {
    key_ops: [],
    ext: true,
    kty: "EC",
    x: "F3llFcSvzorBkPa0h7LDVstNECgqzp9Kha2J8r4cZ5Y",
    y: "0vBJgTXVYmPx4iUWZEz-IXqZxzCo9GSol7zI3gUfhBE",
    crv: "P-256",
  },
};

const WARNING =
  "TEST-ONLY. Every key, secret, and plaintext in this file is a fixed " +
  "non-production value generated solely for FDN-51 Stage 5's server-opacity " +
  "proof (services/sync-engine/tests/relay_pg.rs). None of these values is " +
  "used in, or derived from, any real workspace. Regenerate with " +
  "`pnpm stage5:opacity-fixtures`.";

// --- helpers --------------------------------------------------------------

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
}

function b64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Deterministic JSON — recursively key-sorted — for a stable envelope byte string. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        )
      : v,
  );
}

async function importEcdh(
  jwk: { private: JsonWebKey; public: JsonWebKey },
  extractablePrivate = false,
): Promise<CryptoKeyPair> {
  const alg = { name: "ECDH", namedCurve: "P-256" } as const;
  return {
    privateKey: await crypto.subtle.importKey(
      "jwk",
      jwk.private,
      alg,
      extractablePrivate,
      ["deriveBits"],
    ),
    publicKey: await crypto.subtle.importKey("jwk", jwk.public, alg, true, []),
  };
}

async function aesEncrypt(
  keyBytes: Uint8Array,
  ivBytes: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  return new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: ivBytes as BufferSource,
        additionalData: aad as BufferSource,
      },
      key,
      plaintext as BufferSource,
    ),
  );
}

/** The wire shape of one opaque protected envelope: canonical JSON, UTF-8. */
function serializeEnvelope(
  header: object,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Uint8Array {
  return new TextEncoder().encode(
    stableJson({
      formatVersion: PROTECTED_ENVELOPE_FORMAT_VERSION,
      header: header as Record<string, unknown>,
      iv: b64(iv),
      ciphertext: b64(ciphertext),
    }),
  );
}

interface OpacityFixture {
  readonly _warning: string;
  readonly tier: 1 | 3;
  readonly payloads: readonly { readonly label: string; readonly hex: string }[];
  readonly must_be_absent: readonly {
    readonly name: string;
    readonly hex: string;
    readonly ascii?: string;
  }[];
  readonly not_scanned: readonly { readonly name: string; readonly value: string }[];
}

// --- Tier 1 --------------------------------------------------------------

export async function buildTier1Fixture(): Promise<OpacityFixture> {
  const reconstructed = await combineTier1RecoveryShares(TIER1_RECOVERY_SHARES);
  if (toHex(reconstructed) !== toHex(TIER1_RECOVERY_SECRET)) {
    throw new Error(
      "pre-computed Tier 1 recovery shares no longer reconstruct the secret",
    );
  }

  const readerSet = await createProtectedReaderSet([CANONICAL_USER_ID]);
  const address = await createProtectedDocumentAddress({
    workspaceId: WORKSPACE_ID,
    nodeType: "Employee",
    schemaPartition: "compensation",
    tier: 1,
    readerSet,
    timeBucket: "2026-09",
    erasureDomainId: "stage5-opacity",
  });

  // 1. protected document update, AES-GCM under the per-document key.
  const docHeader = createProtectedEnvelopeHeader({
    address,
    keyEpoch: KEY_EPOCH,
    ciphertextKind: "document-update",
  });
  const docCiphertext = await aesEncrypt(
    TIER1_DOCUMENT_KEY,
    iv(1),
    protectedEnvelopeAdditionalData(docHeader),
    TIER1_PLAINTEXT,
  );
  const docPayload = serializeEnvelope(docHeader, iv(1), docCiphertext);

  // 2. recipient key envelope — the per-document key wrapped to the reader.
  const recipient = await importEcdh(RECIPIENT_JWK);
  const ephemeral = await importEcdh(EPHEMERAL_JWK);
  const recipientEnvelope = await wrapTier1DocumentKey({
    address,
    keyEpoch: KEY_EPOCH,
    recipient: { userId: CANONICAL_USER_ID, publicKey: recipient.publicKey },
    documentKeyBytes: TIER1_DOCUMENT_KEY,
    ephemeralKeyPair: ephemeral,
    iv: iv(2),
  });
  const recipientPayload = serializeEnvelope(
    recipientEnvelope.header,
    recipientEnvelope.iv,
    recipientEnvelope.ciphertext,
  );

  // 3. recovery envelope — the per-document key wrapped to the recovery secret.
  const recoveryEnvelope = await wrapTier1RecoveryDocumentKey({
    address,
    keyEpoch: KEY_EPOCH,
    recoverySecret: TIER1_RECOVERY_SECRET,
    documentKeyBytes: TIER1_DOCUMENT_KEY,
    iv: iv(3),
  });
  const recoveryPayload = serializeEnvelope(
    recoveryEnvelope.header,
    recoveryEnvelope.iv,
    recoveryEnvelope.ciphertext,
  );

  // 4. identity-transfer envelope (A003-T32) — the reader's identity private
  //    key wrapped for a new device. FDN-51 is its delivery path.
  const identity = await importEcdh(IDENTITY_JWK, true);
  const sourceTransfer = await importEcdh(SOURCE_TRANSFER_JWK);
  const targetTransfer = await importEcdh(TARGET_TRANSFER_JWK);
  const transfer: Tier1IdentityTransferPayload = await createTier1IdentityTransfer({
    identityPrivateKey: identity.privateKey,
    identityPublicKey: identity.publicKey,
    targetTransferPublicKey: targetTransfer.publicKey,
    workspaceId: WORKSPACE_ID,
    canonicalUserId: CANONICAL_USER_ID,
    sourceDeviceId: SOURCE_DEVICE_ID,
    targetDeviceId: TARGET_DEVICE_ID,
    transferId: "stage5-opacity-transfer",
    expiresAt: "2099-01-01T00:00:00.000Z",
    sourceTransferKeyPair: sourceTransfer,
    iv: iv(4),
  });
  const transferPayload = new TextEncoder().encode(stableJson(transfer));

  const identityPrivatePkcs8 = new Uint8Array(
    await crypto.subtle.exportKey(
      "pkcs8",
      await crypto.subtle.importKey(
        "jwk",
        IDENTITY_JWK.private,
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveBits"],
      ),
    ),
  );
  const recipientPrivatePkcs8 = new Uint8Array(
    await crypto.subtle.exportKey(
      "pkcs8",
      await crypto.subtle.importKey(
        "jwk",
        RECIPIENT_JWK.private,
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveBits"],
      ),
    ),
  );

  return {
    _warning: WARNING,
    tier: 1,
    payloads: [
      {
        label: "tier1 protected document update (AES-GCM under the document key)",
        hex: toHex(docPayload),
      },
      {
        label: "tier1 recipient key envelope (per-document key wrapped to the reader)",
        hex: toHex(recipientPayload),
      },
      {
        label:
          "tier1 recovery envelope (per-document key wrapped to the recovery secret)",
        hex: toHex(recoveryPayload),
      },
      {
        label:
          "tier1 identity-transfer envelope, A003-T32 (identity private key wrapped for a new device)",
        hex: toHex(transferPayload),
      },
    ],
    must_be_absent: [
      {
        name: "tier1 protected plaintext",
        hex: toHex(TIER1_PLAINTEXT),
        ascii: new TextDecoder().decode(TIER1_PLAINTEXT),
      },
      { name: "tier1 per-document key", hex: toHex(TIER1_DOCUMENT_KEY) },
      { name: "tier1 workspace recovery secret", hex: toHex(TIER1_RECOVERY_SECRET) },
      {
        name: "tier1 recovery share (2-of-3 Shamir)",
        hex: toHex(TIER1_RECOVERY_SHARES[0]!),
      },
      {
        name: "reader-set unwrap material (recipient ECDH private key, pkcs8)",
        hex: toHex(recipientPrivatePkcs8),
      },
      { name: "tier1 identity private key (pkcs8)", hex: toHex(identityPrivatePkcs8) },
      {
        name: "tier1 identity-transfer unwrapped contents (== the identity private key, pkcs8)",
        hex: toHex(identityPrivatePkcs8),
      },
    ],
    not_scanned: [
      {
        name: "protected document address (non-secret routing metadata)",
        value: JSON.stringify(address),
      },
      { name: "reader set id (non-secret)", value: readerSet.id },
    ],
  };
}

// --- Tier 3 --------------------------------------------------------------

export async function buildTier3Fixture(): Promise<OpacityFixture> {
  const readerSet = await createProtectedReaderSet([CANONICAL_USER_ID]);
  const address = await createProtectedDocumentAddress({
    workspaceId: WORKSPACE_ID,
    nodeType: "WellnessTriggerEvent",
    schemaPartition: "private",
    tier: 3,
    readerSet,
    timeBucket: "current",
    erasureDomainId: "stage5-opacity",
  });
  const rootAddress = createTier3RootAddress(WORKSPACE_ID, CANONICAL_USER_ID);

  // 1. protected document update, AES-GCM under the per-document key.
  const docHeader = createProtectedEnvelopeHeader({
    address,
    keyEpoch: KEY_EPOCH,
    ciphertextKind: "document-update",
  });
  const docCiphertext = await aesEncrypt(
    TIER3_DOCUMENT_KEY,
    iv(21),
    protectedEnvelopeAdditionalData(docHeader),
    TIER3_PLAINTEXT,
  );
  const docPayload = serializeEnvelope(docHeader, iv(21), docCiphertext);

  // 2. document-key envelope — per-document key wrapped under the root key.
  const dkHeader = createProtectedEnvelopeHeader({
    address,
    keyEpoch: KEY_EPOCH,
    ciphertextKind: "tier3-document-key-envelope",
  });
  const dkCiphertext = await aesEncrypt(
    TIER3_ROOT_KEY,
    iv(22),
    protectedEnvelopeAdditionalData(dkHeader),
    TIER3_DOCUMENT_KEY,
  );
  const dkPayload = serializeEnvelope(dkHeader, iv(22), dkCiphertext);

  // 3. PRF root envelope — root key wrapped under the WebAuthn PRF result.
  const prfHeader = createTier3PrfHeader({
    rootAddress,
    rootGeneration: 1,
    credentialId: TIER3_CREDENTIAL_ID,
    prfInput: TIER3_PRF_INPUT,
  });
  const prfEnvelope = await wrapTier3Root({
    rootKey: TIER3_ROOT_KEY,
    ikm: TIER3_PRF_RESULT,
    header: prfHeader,
    iv: iv(23),
  });
  const prfPayload = serializeEnvelope(
    prfEnvelope.header,
    prfEnvelope.iv,
    prfEnvelope.ciphertext,
  );

  // 4. recovery root envelope — root key wrapped under the recovery secret.
  const recoveryHeader = createTier3RecoveryHeader({
    rootAddress,
    rootGeneration: 1,
    recoveryGeneration: 1,
  });
  const recoveryEnvelope = await wrapTier3Root({
    rootKey: TIER3_ROOT_KEY,
    ikm: TIER3_RECOVERY_SECRET,
    header: recoveryHeader,
    iv: iv(24),
  });
  const recoveryPayload = serializeEnvelope(
    recoveryEnvelope.header,
    recoveryEnvelope.iv,
    recoveryEnvelope.ciphertext,
  );

  const recoveryCode = encodeTier3RecoveryCode(TIER3_RECOVERY_SECRET);

  return {
    _warning: WARNING,
    tier: 3,
    payloads: [
      {
        label: "tier3 protected document update (AES-GCM under the document key)",
        hex: toHex(docPayload),
      },
      {
        label:
          "tier3 document-key envelope (per-document key wrapped under the root key)",
        hex: toHex(dkPayload),
      },
      {
        label:
          "tier3 PRF root envelope (root key wrapped under the WebAuthn PRF result)",
        hex: toHex(prfPayload),
      },
      {
        label:
          "tier3 recovery root envelope (root key wrapped under the recovery secret)",
        hex: toHex(recoveryPayload),
      },
    ],
    must_be_absent: [
      {
        name: "tier3 protected plaintext",
        hex: toHex(TIER3_PLAINTEXT),
        ascii: new TextDecoder().decode(TIER3_PLAINTEXT),
      },
      { name: "tier3 per-document key", hex: toHex(TIER3_DOCUMENT_KEY) },
      {
        name: "tier3 root key (per subject, per generation)",
        hex: toHex(TIER3_ROOT_KEY),
      },
      { name: "tier3 recovery secret", hex: toHex(TIER3_RECOVERY_SECRET) },
      {
        name: "tier3 recovery code (256-bit product-generated code)",
        hex: toHex(new TextEncoder().encode(recoveryCode)),
        ascii: recoveryCode,
      },
      {
        name: "WebAuthn PRF result (browser-returned 32-byte secret)",
        hex: toHex(TIER3_PRF_RESULT),
      },
    ],
    not_scanned: [
      {
        name: "WebAuthn PRF input — non-secret persisted metadata, deliberately NOT scanned for",
        value: encodeBase64Url(TIER3_PRF_INPUT),
      },
      { name: "tier3 root address (non-secret)", value: JSON.stringify(rootAddress) },
      {
        name: "protected document address (non-secret)",
        value: JSON.stringify(address),
      },
    ],
  };
}

// --- write ---------------------------------------------------------------

export async function writeFixtures(): Promise<void> {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const dir = fileURLToPath(
    new URL(
      "../../../../../services/sync-engine/tests/vectors/opacity/",
      import.meta.url,
    ),
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    `${dir}tier1.json`,
    `${JSON.stringify(await buildTier1Fixture(), null, 2)}\n`,
  );
  writeFileSync(
    `${dir}tier3.json`,
    `${JSON.stringify(await buildTier3Fixture(), null, 2)}\n`,
  );
  console.log(`Stage 5 opacity fixtures written to ${dir}`);
}

if (
  import.meta.url ===
  (typeof process !== "undefined" ? `file://${process.argv[1]}` : "")
) {
  await writeFixtures();
}
