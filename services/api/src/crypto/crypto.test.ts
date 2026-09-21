import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { randomKey, seal } from "./aes.js";
import { AwsKmsKeyProvider, type KmsLike } from "./aws-kms-key-provider.js";
import { decryptFragment } from "./decrypt.js";
import {
  encodeContent,
  FragmentAuthenticationError,
  fragmentAad,
  type FragmentHeader,
} from "./envelope.js";
import { LocalKeyProvider } from "./local-key-provider.js";
import { createKeyProvider } from "./provider.js";

const ROOT = Buffer.alloc(32, 7).toString("base64");

describe("the key provider factory (A003-T73)", () => {
  it("refuses the local provider in production, whether named or defaulted", () => {
    const base = {
      nodeEnv: "production",
      localRootKey: ROOT,
      awsRegion: undefined,
      kmsRootKeyArn: undefined,
    };
    expect(() => createKeyProvider({ ...base, provider: "local" })).toThrow(
      /production/,
    );
    expect(() => createKeyProvider({ ...base, provider: undefined })).toThrow(
      /production/,
    );
  });

  it("builds the local provider outside production and requires its key", () => {
    const base = {
      nodeEnv: "test",
      awsRegion: undefined,
      kmsRootKeyArn: undefined,
      provider: "local",
    };
    expect(createKeyProvider({ ...base, localRootKey: ROOT })).toBeInstanceOf(
      LocalKeyProvider,
    );
    expect(() => createKeyProvider({ ...base, localRootKey: undefined })).toThrow(
      /VULTO_LOCAL_ROOT_KEY/,
    );
    expect(() => createKeyProvider({ ...base, localRootKey: "c2hvcnQ=" })).toThrow(
      /32-byte/,
    );
  });

  it("builds the KMS provider in production and rejects unknown names", () => {
    const kms = createKeyProvider({
      provider: "aws-kms",
      nodeEnv: "production",
      localRootKey: undefined,
      awsRegion: "eu-west-2",
      kmsRootKeyArn: "arn:aws:kms:eu-west-2:000000000000:key/test",
    });
    expect(kms).toBeInstanceOf(AwsKmsKeyProvider);
    expect(() =>
      createKeyProvider({
        provider: "rot13",
        nodeEnv: "test",
        localRootKey: ROOT,
        awsRegion: undefined,
        kmsRootKeyArn: undefined,
      }),
    ).toThrow(/Unknown/);
  });
});

describe("LocalKeyProvider", () => {
  it("wraps and unwraps a KEK, bound to its workspace", async () => {
    const provider = new LocalKeyProvider(ROOT);
    const kek = randomKey();
    const workspaceId = randomUUID();
    const { wrapped, rootKeyRef } = await provider.wrapKek(kek, { workspaceId });
    expect(Buffer.from(wrapped).includes(Buffer.from(kek))).toBe(false);
    expect(
      Buffer.from(await provider.unwrapKek(wrapped, rootKeyRef, { workspaceId })),
    ).toEqual(Buffer.from(kek));
    await expect(
      provider.unwrapKek(wrapped, rootKeyRef, { workspaceId: randomUUID() }),
    ).rejects.toThrow();
    expect(JSON.stringify(provider)).toBeUndefined();
  });
});

describe("AwsKmsKeyProvider — with a mocked KMS client, no network", () => {
  const ARN = "arn:aws:kms:eu-west-2:000000000000:key/test";

  function mockKms() {
    const calls: { name: string; input: Record<string, unknown> }[] = [];
    const client: KmsLike = {
      async send(command) {
        const input = (command as unknown as { input: Record<string, unknown> }).input;
        const name = command.constructor.name;
        calls.push({ name, input });
        if (name === "EncryptCommand") {
          return {
            CiphertextBlob: Buffer.concat([
              Buffer.from("kms:"),
              Buffer.from(input["Plaintext"] as Uint8Array),
            ]),
            KeyId: ARN,
          };
        }
        const blob = Buffer.from(input["CiphertextBlob"] as Uint8Array);
        return { Plaintext: blob.subarray(4) };
      },
    };
    return { client, calls };
  }

  it("wraps and unwraps with the workspace as the encryption context and the configured key", async () => {
    const { client, calls } = mockKms();
    const provider = new AwsKmsKeyProvider({ keyId: ARN, client });
    const workspaceId = randomUUID();
    const kek = randomKey();
    const { wrapped, rootKeyRef } = await provider.wrapKek(kek, { workspaceId });
    expect(rootKeyRef).toBe(ARN);
    expect(
      Buffer.from(await provider.unwrapKek(wrapped, rootKeyRef, { workspaceId })),
    ).toEqual(Buffer.from(kek));
    expect(calls.map((c) => c.name)).toEqual(["EncryptCommand", "DecryptCommand"]);
    for (const call of calls) {
      expect(call.input["EncryptionContext"]).toEqual({ workspace_id: workspaceId });
      expect(call.input["KeyId"]).toBe(ARN);
    }
  });

  it("requires a key id", () => {
    expect(() => new AwsKmsKeyProvider({ keyId: "" })).toThrow();
  });
});

describe("the fragment envelope", () => {
  const header = (over: Partial<FragmentHeader> = {}): FragmentHeader => ({
    format: "vulto:protected-fragment:v1",
    workspace_id: randomUUID(),
    owner_kind: "node",
    owner_id: randomUUID(),
    owner_type: "Employee",
    schema_partition: "compensation",
    tier: 1,
    erasure_domain_id: randomUUID(),
    data_key_id: randomUUID(),
    ...over,
  });

  it("decrypts under the same header and fails under any changed field", () => {
    const key = randomKey();
    const h = header();
    const sealed = seal(key, encodeContent({ salary: 1 }), fragmentAad(h));
    expect(decryptFragment(key, sealed, h)).toEqual({ salary: 1 });
    const changes: Partial<FragmentHeader>[] = [
      { workspace_id: randomUUID() },
      { owner_id: randomUUID() },
      { owner_type: "Entity" },
      { schema_partition: "operational" },
      { tier: 2 },
      { erasure_domain_id: randomUUID() },
      { data_key_id: randomUUID() },
    ];
    for (const change of changes) {
      expect(() => decryptFragment(key, sealed, { ...h, ...change })).toThrow(
        FragmentAuthenticationError,
      );
    }
    expect(() => decryptFragment(randomKey(), sealed, h)).toThrow(
      FragmentAuthenticationError,
    );
  });

  it("uses a fresh 96-bit nonce for every encryption", () => {
    const key = randomKey();
    const aad = fragmentAad(header());
    const nonces = new Set(
      Array.from({ length: 50 }, () =>
        Buffer.from(seal(key, encodeContent(1), aad).nonce).toString("hex"),
      ),
    );
    expect(nonces.size).toBe(50);
    expect(seal(key, encodeContent(1), aad).nonce.length).toBe(12);
  });

  it("serializes the header with RFC 8785 ordering, independent of key order", () => {
    const h = header();
    const reordered = Object.fromEntries(
      Object.entries(h).reverse(),
    ) as unknown as FragmentHeader;
    expect(Buffer.from(fragmentAad(reordered))).toEqual(Buffer.from(fragmentAad(h)));
  });
});
