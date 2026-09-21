import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM with a fresh random 96-bit nonce per encryption, through Node's
 * `crypto`. Standard primitives only (A003 "Standard primitives only").
 */
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
export const KEY_BYTES = 32;

export function randomKey(): Uint8Array {
  return randomBytes(KEY_BYTES);
}

export function seal(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): { nonce: Uint8Array; ciphertext: Uint8Array } {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { nonce, ciphertext: Buffer.concat([body, cipher.getAuthTag()]) };
}

/** Throws if the key, nonce, additional data or ciphertext do not all match. */
export function open(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  if (ciphertext.length < TAG_BYTES) throw new Error("ciphertext is too short");
  const body = ciphertext.subarray(0, ciphertext.length - TAG_BYTES);
  const tag = ciphertext.subarray(ciphertext.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/** `nonce || ciphertext || tag`, the layout stored for a wrapped key. */
export function sealCombined(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  const { nonce, ciphertext } = seal(key, plaintext, aad);
  return Buffer.concat([nonce, ciphertext]);
}

export function openCombined(
  key: Uint8Array,
  combined: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  if (combined.length < NONCE_BYTES + TAG_BYTES)
    throw new Error("wrapped key is too short");
  return open(
    key,
    combined.subarray(0, NONCE_BYTES),
    combined.subarray(NONCE_BYTES),
    aad,
  );
}
