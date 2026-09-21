import { KEY_BYTES, openCombined, sealCombined } from "./aes.js";
import type { KeyContext, KeyProvider, WrappedKek } from "./key-provider.js";

const REF = "local:v1";
const aad = (context: KeyContext) => Buffer.from(context.workspaceId, "utf8");

/**
 * Development and CI only. Its root key is a base64 value from the environment
 * (`VULTO_LOCAL_ROOT_KEY`), and the workspace id is bound as additional
 * authenticated data. The factory refuses it in production (A003-T73).
 */
export class LocalKeyProvider implements KeyProvider {
  readonly #rootKey: Buffer;

  constructor(base64RootKey: string) {
    const key = Buffer.from(base64RootKey, "base64");
    if (key.length !== KEY_BYTES) {
      throw new Error("VULTO_LOCAL_ROOT_KEY must be a base64-encoded 32-byte key");
    }
    this.#rootKey = key;
  }

  async wrapKek(plain: Uint8Array, context: KeyContext): Promise<WrappedKek> {
    return {
      wrapped: sealCombined(this.#rootKey, plain, aad(context)),
      rootKeyRef: REF,
    };
  }

  async unwrapKek(
    wrapped: Uint8Array,
    rootKeyRef: string,
    context: KeyContext,
  ): Promise<Uint8Array> {
    if (rootKeyRef !== REF)
      throw new Error(`Not a local root key reference: ${rootKeyRef}`);
    return openCombined(this.#rootKey, wrapped, aad(context));
  }

  toJSON(): undefined {
    return undefined;
  }
}
