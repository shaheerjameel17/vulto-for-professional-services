import { combine, split } from "shamir-secret-sharing";
import {
  createProtectedEnvelopeHeader,
  protectedEnvelopeAdditionalData,
  type ProtectedDocumentAddress,
  type ProtectedEnvelopeHeader,
} from "./protected-document";

/**
 * FDN-52 — Tier 1 no-device recovery (F167, closed by founder ruling naming
 * `shamir-secret-sharing` v0.0.3 as the approved primitive; A003-T13/T14).
 *
 * This is the path A003 describes as: "If no existing device remains, two
 * of the three trusted recovery holders reconstruct the workspace recovery
 * secret in a recovery Worker's memory, unwrap the needed document keys,
 * and re-wrap them to a newly generated identity key for the recovering
 * person." This module builds the reconstruct-and-unwrap half; the re-wrap
 * half is `tier1-envelope.ts#wrapTier1DocumentKey`, already built and
 * proven — recovery does not need a second wrapping primitive, only a
 * second way to reach the plaintext document key.
 *
 * The recovery "recipient" is not a P-256 identity the way an ordinary
 * Tier 1 reader is. It is addressed by knowledge of a reconstructed
 * 256-bit secret, split 2-of-3 across trusted people. The envelope this
 * module produces uses the *same* canonical protected-document header and
 * AAD contract as every other Tier 1 envelope
 * (`protected-document.ts`'s `"tier1-recovery-envelope"` ciphertext kind,
 * already reserved in that schema), and feeds the *same*
 * HKDF-SHA-256/AES-256-GCM pipeline `tier1-envelope.ts` and `tier3-root.ts`
 * already use — no new cryptographic primitive beyond the threshold
 * secret-sharing step itself.
 */

const HKDF_INFO = new TextEncoder().encode("vulto:tier1-recovery-envelope:v1");
const RECOVERY_SHARE_THRESHOLD = 2;
const RECOVERY_SHARE_COUNT = 3;
const RECOVERY_SECRET_BYTES = 32;
/** `split()`'s own share format: one coordinate byte appended to the secret's length. */
const RECOVERY_SHARE_BYTES = RECOVERY_SECRET_BYTES + 1;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export interface Tier1RecoveryEnvelope {
  readonly header: Extract<
    ProtectedEnvelopeHeader,
    { readonly ciphertextKind: "tier1-recovery-envelope" }
  >;
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
}

/**
 * A003-T13: "Any Tier 1 recovery artifact MUST be product-generated." Never
 * derived from anything a person chooses — the same rule Tier 3's recovery
 * code already follows.
 */
export function generateTier1RecoverySecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(RECOVERY_SECRET_BYTES));
}

/**
 * A003-T14: 2-of-3 by default. Splits via the pinned, founder-approved
 * `shamir-secret-sharing@0.0.3` — genuine (k,n) Shamir over GF(2^8), not an
 * approximation, information-theoretically secure below threshold. Each
 * returned share is self-describing (it carries its own x-coordinate byte),
 * so no external index-to-holder bookkeeping is required to reconstruct.
 *
 * Deliberately takes no `n`/`threshold` parameters: A003-T14 fixes the
 * default, and this project has no present use case for a different split.
 * A future one should be a new, separately reviewed function rather than a
 * silently widened one, so a caller cannot accidentally request a threshold
 * this assessment never examined.
 */
export async function splitTier1RecoverySecret(
  secret: Uint8Array,
): Promise<readonly Uint8Array[]> {
  if (secret.byteLength !== RECOVERY_SECRET_BYTES) {
    throw new TypeError("Tier 1 recovery secret must be 256 bits");
  }
  const shares = await split(secret, RECOVERY_SHARE_COUNT, RECOVERY_SHARE_THRESHOLD);
  if (shares.length !== RECOVERY_SHARE_COUNT) {
    throw new Error("Tier 1 recovery split did not produce three shares");
  }
  return shares;
}

/**
 * Any two of the three. Below-threshold combination is refused by the
 * library itself (`combine` requires at least two shares); this function
 * adds only the output-length check the library's own README names as a
 * caller responsibility ("does not verify the result of share
 * reconstruction") — a wrong-length result cannot be a real secret and must
 * fail here rather than being handed to HKDF, which would happily derive a
 * key from bytes that were never a valid reconstruction.
 *
 * A genuinely wrong-but-right-length reconstruction (mismatched or
 * corrupted shares producing 32 plausible-looking bytes) is not caught by
 * this function — it is caught downstream, the same way every other wrong
 * key in this codebase is caught: the derived AES-GCM key fails to
 * authenticate the envelope it is asked to open. This module never treats a
 * successful `combine()` call alone as proof of a correct reconstruction.
 */
export async function combineTier1RecoveryShares(
  shares: readonly Uint8Array[],
): Promise<Uint8Array> {
  if (shares.length < RECOVERY_SHARE_THRESHOLD) {
    throw new Error(
      `Tier 1 recovery requires at least ${RECOVERY_SHARE_THRESHOLD} shares`,
    );
  }
  const secret = await combine([...shares]);
  if (secret.byteLength !== RECOVERY_SECRET_BYTES) {
    throw new Error("Tier 1 recovery reconstruction did not produce a 256-bit secret");
  }
  return secret;
}

/**
 * Display/re-entry encoding for one 33-byte share (32-byte secret value +
 * 1-byte coordinate). Same Crockford-Base32, grouped-digit style A003
 * already established for the Tier 3 recovery code, generalized to this
 * share's own byte length rather than hard-coded to 256 bits — a share is
 * one byte longer than the secret it was split from.
 *
 * Deliberately a distinct artifact from the Tier 3 recovery code's own
 * codec: the two are different byte lengths (33 vs 32) and different
 * secrets, and conflating their formats would let a share be silently
 * misread as the wrong kind of value.
 */
export function encodeTier1RecoveryShare(share: Uint8Array): string {
  if (share.byteLength !== RECOVERY_SHARE_BYTES) {
    throw new TypeError("Tier 1 recovery share must be 33 bytes");
  }
  let value = 0n;
  for (const byte of share) value = (value << 8n) | BigInt(byte);
  const totalBits = RECOVERY_SHARE_BYTES * 8;
  const characterCount = Math.ceil(totalBits / 5);
  const characters = Array.from({ length: characterCount }, () => "0");
  for (let index = characterCount - 1; index >= 0; index -= 1) {
    characters[index] = CROCKFORD[Number(value & 31n)]!;
    value >>= 5n;
  }
  const groups: string[] = [];
  for (let index = 0; index < characterCount; index += 4) {
    groups.push(characters.slice(index, index + 4).join(""));
  }
  return groups.join("-");
}

/**
 * Inverse of `encodeTier1RecoveryShare`, and the T13 "correct re-entry"
 * check: rejects anything that does not re-encode to the exact string
 * presented, the same canonical-form discipline the Tier 3 recovery code
 * already uses. A transcription error that happens to decode to *some*
 * 33 bytes is not accepted merely because it decodes — it must decode to
 * the one canonical value that encodes back to the identical text.
 */
export function decodeTier1RecoveryShare(code: string): Uint8Array {
  const compact = code.toUpperCase().replaceAll("-", "");
  const totalBits = RECOVERY_SHARE_BYTES * 8;
  const characterCount = Math.ceil(totalBits / 5);
  if (compact.length !== characterCount || !/^[0-9A-HJKMNP-TV-Z]+$/.test(compact)) {
    throw new Error("Invalid Tier 1 recovery share");
  }
  let value = 0n;
  for (const character of compact) {
    const digit = CROCKFORD.indexOf(character);
    if (digit < 0) throw new Error("Invalid Tier 1 recovery share");
    value = (value << 5n) | BigInt(digit);
  }
  if (value >> BigInt(totalBits)) throw new Error("Invalid Tier 1 recovery share");
  const share = new Uint8Array(RECOVERY_SHARE_BYTES);
  for (let index = RECOVERY_SHARE_BYTES - 1; index >= 0; index -= 1) {
    share[index] = Number(value & 255n);
    value >>= 8n;
  }
  if (encodeTier1RecoveryShare(share) !== code.toUpperCase().trim()) {
    throw new Error("Tier 1 recovery share is not canonical");
  }
  return share;
}

/**
 * T13's mandatory re-entry check, made explicit and directly testable
 * rather than left implicit in a UI flow this phase does not build. A
 * setup ceremony calls this once per displayed share before treating that
 * share as captured; a screenshot or a partial copy fails here rather than
 * silently completing setup.
 */
export function verifyTier1RecoveryShareReentry(
  displayed: Uint8Array,
  reentered: string,
): boolean {
  let decoded: Uint8Array;
  try {
    decoded = decodeTier1RecoveryShare(reentered);
  } catch {
    return false;
  }
  if (decoded.byteLength !== displayed.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < displayed.byteLength; index += 1) {
    difference |= displayed[index]! ^ decoded[index]!;
  }
  return difference === 0;
}

async function deriveWrappingKey(
  recoverySecret: Uint8Array,
  header: ProtectedEnvelopeHeader,
): Promise<CryptoKey> {
  if (recoverySecret.byteLength !== RECOVERY_SECRET_BYTES) {
    throw new TypeError("Tier 1 recovery secret must be 256 bits");
  }
  const material = await crypto.subtle.importKey(
    "raw",
    recoverySecret as BufferSource,
    "HKDF",
    false,
    ["deriveKey"],
  );
  const salt = await crypto.subtle.digest(
    "SHA-256",
    protectedEnvelopeAdditionalData(header) as BufferSource,
  );
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: HKDF_INFO },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Wraps one protected document's key under the workspace recovery secret —
 * the "recovery envelope" A003's cryptographic-suite table names. This is
 * the T13/setup half: called once when recovery is established (or later
 * re-established after an explicit refresh ceremony), never automatically
 * on every ordinary reader change. See `protected-partitions.ts`'s
 * `establishRecovery` for why keeping this current is a deliberate,
 * infrequent operation rather than a side effect of routine rotation.
 */
export async function wrapTier1RecoveryDocumentKey(input: {
  readonly address: ProtectedDocumentAddress;
  readonly keyEpoch: number;
  readonly recoverySecret: Uint8Array;
  readonly documentKeyBytes: Uint8Array;
  readonly iv?: Uint8Array;
}): Promise<Tier1RecoveryEnvelope> {
  if (input.documentKeyBytes.byteLength !== 32) {
    throw new TypeError("Tier 1 document key must be 256 bits");
  }
  const header = createProtectedEnvelopeHeader({
    address: input.address,
    keyEpoch: input.keyEpoch,
    ciphertextKind: "tier1-recovery-envelope",
  });
  const iv = input.iv
    ? new Uint8Array(input.iv)
    : crypto.getRandomValues(new Uint8Array(12));
  if (iv.byteLength !== 12) {
    throw new TypeError("Tier 1 recovery envelope IV must be 96 bits");
  }
  const key = await deriveWrappingKey(input.recoverySecret, header);
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
  return { header: header as Tier1RecoveryEnvelope["header"], iv, ciphertext };
}

/**
 * Unwraps a document key using the reconstructed recovery secret. Fails
 * closed and non-specifically on any mismatch — wrong secret, wrong
 * envelope, tampered ciphertext, or a stale envelope from a since-rotated
 * epoch all produce the same "cannot be opened" outcome, exactly like
 * `unwrapTier1DocumentKey`'s existing failure shape. A caller cannot learn
 * *why* recovery failed from this function, only that it did — the same
 * non-enumerating discipline this project already holds everywhere else a
 * key either opens or it does not.
 */
export async function unwrapTier1RecoveryDocumentKey(input: {
  readonly envelope: Tier1RecoveryEnvelope;
  readonly recoverySecret: Uint8Array;
}): Promise<Uint8Array> {
  const header = input.envelope.header;
  if (header.ciphertextKind !== "tier1-recovery-envelope") {
    throw new TypeError("Not a Tier 1 recovery envelope");
  }
  try {
    const key = await deriveWrappingKey(input.recoverySecret, header);
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
    throw new TypeError("Tier 1 recovery envelope cannot be opened");
  }
}
