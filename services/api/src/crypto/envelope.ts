import canonicalize from "canonicalize";

/**
 * The authenticated headers (VPS-A003 A003-T55). Both are serialized with
 * RFC 8785 and used as AES-GCM additional data, so ciphertext moved to another
 * owner, partition, tier, key or workspace fails to decrypt instead of
 * decrypting in the wrong place.
 */
export const FRAGMENT_FORMAT = "vulto:protected-fragment:v1";
export const DEK_FORMAT = "vulto:dek:v1";

export interface FragmentHeader {
  readonly format: typeof FRAGMENT_FORMAT;
  readonly workspace_id: string;
  readonly owner_kind: "node" | "edge";
  readonly owner_id: string;
  /** The node or edge type of the owner. */
  readonly owner_type: string;
  readonly schema_partition: string;
  readonly tier: 1 | 2;
  readonly erasure_domain_id: string;
  readonly data_key_id: string;
}

export interface DekHeader {
  readonly format: typeof DEK_FORMAT;
  readonly key_id: string;
  readonly workspace_id: string;
  readonly tier: 1 | 2;
  readonly erasure_domain_id: string | null;
}

function aadOf(header: object): Uint8Array {
  const canonical = canonicalize(header);
  if (canonical === undefined) throw new Error("header is not canonicalizable");
  return Buffer.from(canonical, "utf8");
}

export const fragmentAad = (header: FragmentHeader): Uint8Array => aadOf(header);
export const dekAad = (header: DekHeader): Uint8Array => aadOf(header);

export function encodeContent(value: unknown): Uint8Array {
  const canonical = canonicalize(value);
  if (canonical === undefined) throw new Error("content is not JSON");
  return Buffer.from(canonical, "utf8");
}

export function decodeContent(bytes: Uint8Array): unknown {
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}

export class FragmentAuthenticationError extends Error {
  constructor() {
    super("The protected fragment failed authentication");
    this.name = "FragmentAuthenticationError";
  }
}
