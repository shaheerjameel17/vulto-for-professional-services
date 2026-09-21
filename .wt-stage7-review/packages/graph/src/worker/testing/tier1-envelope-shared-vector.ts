/**
 * Fixed non-production interoperability fixture for FDN-52 Stage 2.
 *
 * These P-256 keys are public test material only. The expected envelope was
 * generated once from this fixed input set and is checked in so independent
 * implementations can reproduce it byte-for-byte.
 */
export const tier1EnvelopeSharedVector = {
  recipientPrivateJwk: {
    key_ops: ["deriveBits"],
    ext: true,
    kty: "EC",
    x: "CupO8mduGUxf6F_dKY08IIk4k6SAsparyh2IiD5ulKU",
    y: "iONhkUo3JM1o-cBs9_vLR27xcSjzWOGnNl0Za1H8DX4",
    crv: "P-256",
    d: "RcXXphWL0UeteBrr2hI1RZZTkBhd4bGOBGeE_DyLRn8",
  } as JsonWebKey,
  recipientPublicJwk: {
    key_ops: [],
    ext: true,
    kty: "EC",
    x: "CupO8mduGUxf6F_dKY08IIk4k6SAsparyh2IiD5ulKU",
    y: "iONhkUo3JM1o-cBs9_vLR27xcSjzWOGnNl0Za1H8DX4",
    crv: "P-256",
  } as JsonWebKey,
  ephemeralPrivateJwk: {
    key_ops: ["deriveBits"],
    ext: true,
    kty: "EC",
    x: "Vw3ofIXYAbdDWIXJLXlLt4PF9F8TJLmssOaioghaxCI",
    y: "o0m93coESe8bFtxIHPjCdapE2iuxsdDji5hKZiEzRN0",
    crv: "P-256",
    d: "y4UYfMjkQR0uTBrLp_kFJWisNKh0fbETG0bUfJFdGM0",
  } as JsonWebKey,
  ephemeralPublicJwk: {
    key_ops: [],
    ext: true,
    kty: "EC",
    x: "Vw3ofIXYAbdDWIXJLXlLt4PF9F8TJLmssOaioghaxCI",
    y: "o0m93coESe8bFtxIHPjCdapE2iuxsdDji5hKZiEzRN0",
    crv: "P-256",
  } as JsonWebKey,
  expected: {
    ephemeralPublicKey:
      "BFcN6HyF2AG3Q1iFyS15S7eDxfRfEyS5rLDmoqIIWsQio0m93coESe8bFtxIHPjCdapE2iuxsdDji5hKZiEzRN0",
    ciphertextBase64:
      "UY3Id9BUYx1oaOXTY9K7E/v/AxQn3fWvw5jBtFEc9K1u1NGj2CJrzYS6YOZenZrt",
  },
} as const;

export async function importTier1SharedVectorKeyPair(
  privateJwk: JsonWebKey,
  publicJwk: JsonWebKey,
  extractable = false,
): Promise<CryptoKeyPair> {
  const algorithm = { name: "ECDH", namedCurve: "P-256" } as const;
  return {
    privateKey: await crypto.subtle.importKey("jwk", privateJwk, algorithm, false, [
      "deriveBits",
    ]),
    publicKey: await crypto.subtle.importKey(
      "jwk",
      publicJwk,
      algorithm,
      extractable,
      [],
    ),
  };
}

export function tier1SharedVectorDocumentKey(): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, index) => index);
}

export function tier1SharedVectorIv(): Uint8Array {
  return Uint8Array.from({ length: 12 }, (_, index) => index + 16);
}
