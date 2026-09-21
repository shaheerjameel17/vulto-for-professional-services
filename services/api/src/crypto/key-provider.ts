/**
 * The root of the key hierarchy (VPS-A003 "The encryption architecture"): the
 * one place a workspace key-encryption key (KEK) is wrapped and unwrapped
 * under a key that never leaves its holder. Production uses AWS KMS; local
 * development and CI use a provider whose root key comes from the environment
 * (A003-T73). Nothing else in the codebase calls KMS.
 */
export interface KeyContext {
  readonly workspaceId: string;
}

export interface WrappedKek {
  readonly wrapped: Uint8Array;
  /** Which root key wrapped it, so it can be unwrapped later. */
  readonly rootKeyRef: string;
}

export interface KeyProvider {
  wrapKek(plain: Uint8Array, context: KeyContext): Promise<WrappedKek>;
  unwrapKek(
    wrapped: Uint8Array,
    rootKeyRef: string,
    context: KeyContext,
  ): Promise<Uint8Array>;
}
