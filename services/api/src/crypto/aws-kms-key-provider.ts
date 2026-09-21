import { DecryptCommand, EncryptCommand, KMSClient } from "@aws-sdk/client-kms";
import type { KeyContext, KeyProvider, WrappedKek } from "./key-provider.js";

/** The slice of the KMS client the provider uses, so tests can supply a mock. */
export interface KmsLike {
  send(command: EncryptCommand | DecryptCommand): Promise<{
    CiphertextBlob?: Uint8Array;
    Plaintext?: Uint8Array;
    KeyId?: string;
  }>;
}

/**
 * The production root (A003-T73). Each workspace KEK is wrapped by the customer
 * master key with the workspace id as its encryption context, so a wrapped KEK
 * cannot be unwrapped for another workspace. This is the only module that
 * imports the AWS SDK; `pnpm arch:check` enforces it.
 */
export class AwsKmsKeyProvider implements KeyProvider {
  readonly #client: KmsLike;
  readonly #keyId: string;

  constructor(options: {
    readonly keyId: string;
    readonly region?: string;
    readonly client?: KmsLike;
  }) {
    if (options.keyId.length === 0)
      throw new Error("VULTO_KMS_ROOT_KEY_ARN is required");
    this.#keyId = options.keyId;
    this.#client =
      options.client ??
      (new KMSClient({
        ...(options.region ? { region: options.region } : {}),
      }) as unknown as KmsLike);
  }

  async wrapKek(plain: Uint8Array, context: KeyContext): Promise<WrappedKek> {
    const response = await this.#client.send(
      new EncryptCommand({
        KeyId: this.#keyId,
        Plaintext: plain,
        EncryptionContext: { workspace_id: context.workspaceId },
      }),
    );
    if (!response.CiphertextBlob) throw new Error("KMS returned no ciphertext");
    return {
      wrapped: response.CiphertextBlob,
      rootKeyRef: response.KeyId ?? this.#keyId,
    };
  }

  async unwrapKek(
    wrapped: Uint8Array,
    rootKeyRef: string,
    context: KeyContext,
  ): Promise<Uint8Array> {
    const response = await this.#client.send(
      new DecryptCommand({
        CiphertextBlob: wrapped,
        KeyId: rootKeyRef,
        EncryptionContext: { workspace_id: context.workspaceId },
      }),
    );
    if (!response.Plaintext) throw new Error("KMS returned no plaintext");
    return response.Plaintext;
  }

  toJSON(): undefined {
    return undefined;
  }
}
