import { LoroDoc, type VersionVector } from "loro-crdt/web";
import { z } from "zod";
import type { NodeFragmentInput } from "./materialization";
import { readNodeFragments } from "./document-node-fragments";
import {
  createProtectedEnvelopeHeader,
  createProtectedReaderSet,
  protectedDocumentAddressSchema,
  protectedEnvelopeAdditionalData,
  protectedEnvelopeHeaderSchema,
  type ProtectedDocumentAddress,
  type ProtectedEnvelopeHeader,
} from "./protected-document";
import {
  decryptProtectedSnapshot,
  encryptProtectedSnapshot,
  protectedPartitionKey,
} from "./protected-partitions";
import {
  createTier3PrfHeader,
  createTier3RecoveryHeader,
  createTier3RootAddress,
  decodeBase64Url,
  decodeTier3RecoveryCode,
  encodeBase64Url,
  encodeTier3RecoveryCode,
  generateTier3Secret,
  tier3RootAddressSchema,
  tier3RootEnvelopeHeaderSchema,
  tier3PrfEnvelopeHeaderSchema,
  tier3RecoveryEnvelopeHeaderSchema,
  unwrapTier3Root,
  wrapTier3Root,
  type Tier3RootAddress,
  type Tier3RootEnvelope,
} from "./tier3-root";

const MANIFEST_VERSION = 2 as const;

const serializedEnvelopeBytesSchema = z
  .object({
    iv: z.string(),
    ciphertext: z.string(),
  })
  .strict();

const serializedPrfEnvelopeSchema = serializedEnvelopeBytesSchema.extend({
  header: tier3PrfEnvelopeHeaderSchema,
});

const serializedRecoveryEnvelopeSchema = serializedEnvelopeBytesSchema.extend({
  header: tier3RecoveryEnvelopeHeaderSchema,
});

const serializedKeyEnvelopeSchema = serializedEnvelopeBytesSchema.extend({
  header: protectedEnvelopeHeaderSchema,
});

const serializedEpochSchema = z
  .object({
    address: protectedDocumentAddressSchema,
    keyEpoch: z.number().int().nonnegative(),
    documentKeyEnvelope: serializedKeyEnvelopeSchema,
    encoding: z.enum(["snapshot", "update"]),
    iv: z.string(),
    ciphertext: z.string(),
  })
  .strict();

const serializedPartitionSchema = z
  .object({
    address: protectedDocumentAddressSchema,
    keyEpoch: z.number().int().nonnegative(),
    documentKeyEnvelope: serializedKeyEnvelopeSchema,
    historicalEpochs: z.array(serializedEpochSchema),
    currentEncoding: z.enum(["snapshot", "update"]),
    currentIv: z.string(),
    currentCiphertext: z.string(),
  })
  .strict();

const erasedEpochSchema = z
  .object({
    address: protectedDocumentAddressSchema,
    keyEpoch: z.number().int().nonnegative(),
    encoding: z.enum(["snapshot", "update"]),
    iv: z.string(),
    ciphertext: z.string(),
  })
  .strict();

const erasedPartitionSchema = z
  .object({
    address: protectedDocumentAddressSchema,
    keyEpoch: z.number().int().nonnegative(),
    historicalEpochs: z.array(erasedEpochSchema),
    currentEncoding: z.enum(["snapshot", "update"]),
    currentIv: z.string(),
    currentCiphertext: z.string(),
  })
  .strict();

const serializedRootSchema = z
  .object({
    address: tier3RootAddressSchema,
    generation: z.number().int().nonnegative(),
    generationHistory: z.array(z.number().int().nonnegative()).min(1),
    credentialId: z.string().min(1),
    prfEnvelope: serializedPrfEnvelopeSchema,
    recoveryGeneration: z.number().int().nonnegative(),
    recoveryEnvelope: serializedRecoveryEnvelopeSchema,
    partitions: z.array(serializedPartitionSchema),
    erasedPartitions: z.array(erasedPartitionSchema).optional(),
  })
  .strict();

export const tier3ManifestSchema = z
  .object({
    formatVersion: z.literal(MANIFEST_VERSION),
    roots: z.array(serializedRootSchema),
  })
  .strict();

export type Tier3Manifest = z.infer<typeof tier3ManifestSchema>;
type SerializedRootEnvelope =
  | z.infer<typeof serializedPrfEnvelopeSchema>
  | z.infer<typeof serializedRecoveryEnvelopeSchema>;
type SerializedKeyEnvelope = z.infer<typeof serializedKeyEnvelopeSchema>;
type SerializedRoot = z.infer<typeof serializedRootSchema>;
type ErasedPartition = z.infer<typeof erasedPartitionSchema>;

interface KeyEnvelope {
  readonly header: ProtectedEnvelopeHeader;
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
}

interface Tier3Epoch {
  readonly address: ProtectedDocumentAddress;
  readonly keyEpoch: number;
  documentKeyEnvelope: KeyEnvelope;
  readonly encoding: "snapshot" | "update";
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
}

export interface Tier3Partition {
  readonly address: ProtectedDocumentAddress;
  readonly document: LoroDoc;
  keyEpoch: number;
  documentKey: Uint8Array;
  documentKeyEnvelope: KeyEnvelope;
  historicalEpochs: Tier3Epoch[];
  epochBaseVersion: VersionVector | null;
}

export interface Tier3RootState {
  readonly address: Tier3RootAddress;
  generation: number;
  generationHistory: number[];
  credentialId: string;
  prfEnvelope: Tier3RootEnvelope;
  recoveryGeneration: number;
  recoveryEnvelope: Tier3RootEnvelope;
  rootKey: Uint8Array;
  readonly partitions: Map<string, Tier3Partition>;
  readonly erasedPartitions: Map<string, ErasedPartition>;
}

interface PendingEnrollment {
  readonly state: Tier3RootState;
  readonly recoverySecret: Uint8Array;
  readonly recoveryCode: string;
}

function b64(bytes: Uint8Array): string {
  return encodeBase64Url(bytes);
}

function unb64(value: string): Uint8Array {
  return decodeBase64Url(value);
}

async function aesKey(bytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", bytes as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function wrapDocumentKey(input: {
  readonly address: ProtectedDocumentAddress;
  readonly keyEpoch: number;
  readonly rootKey: Uint8Array;
  readonly documentKey: Uint8Array;
}): Promise<KeyEnvelope> {
  const header = createProtectedEnvelopeHeader({
    address: input.address,
    keyEpoch: input.keyEpoch,
    ciphertextKind: "tier3-document-key-envelope",
  });
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return {
    header,
    iv,
    ciphertext: new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: iv as BufferSource,
          additionalData: protectedEnvelopeAdditionalData(header) as BufferSource,
        },
        await aesKey(input.rootKey),
        input.documentKey as BufferSource,
      ),
    ),
  };
}

async function unwrapDocumentKey(
  envelope: KeyEnvelope,
  rootKey: Uint8Array,
): Promise<Uint8Array> {
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: envelope.iv as BufferSource,
          additionalData: protectedEnvelopeAdditionalData(
            envelope.header,
          ) as BufferSource,
        },
        await aesKey(rootKey),
        envelope.ciphertext as BufferSource,
      ),
    );
  } catch {
    throw new Error("Tier 3 document key envelope cannot be opened");
  }
}

async function requireSubjectAddress(
  addressInput: ProtectedDocumentAddress,
  workspaceId: string,
  subjectUserId: string,
): Promise<ProtectedDocumentAddress & { readonly tier: 3 }> {
  const address = protectedDocumentAddressSchema.parse(addressInput);
  if (address.tier !== 3 || address.workspaceId !== workspaceId) {
    throw new Error("Tier 3 document does not match its root workspace");
  }
  const readerSet = await createProtectedReaderSet([subjectUserId]);
  if (readerSet.id !== address.readerSetId) {
    throw new Error("Tier 3 document reader set must be exactly its canonical subject");
  }
  return address as ProtectedDocumentAddress & { readonly tier: 3 };
}

function sameRootAddress(left: Tier3RootAddress, right: Tier3RootAddress): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    left.canonicalSubjectUserId === right.canonicalSubjectUserId &&
    left.construction === right.construction
  );
}

function serializeEnvelope(envelope: Tier3RootEnvelope | KeyEnvelope) {
  return {
    header: envelope.header,
    iv: b64(envelope.iv),
    ciphertext: b64(envelope.ciphertext),
  };
}

function deserializeRootEnvelope(value: SerializedRootEnvelope): Tier3RootEnvelope {
  return {
    header: tier3RootEnvelopeHeaderSchema.parse(value.header),
    iv: unb64(value.iv),
    ciphertext: unb64(value.ciphertext),
  };
}

function deserializeKeyEnvelope(
  value: SerializedKeyEnvelope,
  address: ProtectedDocumentAddress,
  keyEpoch: number,
): KeyEnvelope {
  const header = protectedEnvelopeHeaderSchema.parse(value.header);
  if (
    header.ciphertextKind !== "tier3-document-key-envelope" ||
    header.keyEpoch !== keyEpoch ||
    protectedPartitionKey(header.address) !== protectedPartitionKey(address)
  ) {
    throw new Error("Tier 3 document-key envelope does not match its document");
  }
  return { header, iv: unb64(value.iv), ciphertext: unb64(value.ciphertext) };
}

function disposeRootState(root: Tier3RootState): void {
  root.rootKey.fill(0);
  for (const partition of root.partitions.values()) {
    partition.documentKey.fill(0);
    partition.document.free();
  }
}

function cloneRootEnvelope(envelope: Tier3RootEnvelope): Tier3RootEnvelope {
  return {
    header: structuredClone(envelope.header),
    iv: new Uint8Array(envelope.iv),
    ciphertext: new Uint8Array(envelope.ciphertext),
  };
}

function cloneKeyEnvelope(envelope: KeyEnvelope): KeyEnvelope {
  return {
    header: structuredClone(envelope.header),
    iv: new Uint8Array(envelope.iv),
    ciphertext: new Uint8Array(envelope.ciphertext),
  };
}

export class Tier3PartitionRegistry {
  #roots = new Map<string, Tier3RootState>();
  #pending: PendingEnrollment | null = null;
  #pendingRecovery: PendingEnrollment | null = null;
  readonly #createDocument: () => LoroDoc;

  constructor(createDocument: () => LoroDoc = () => new LoroDoc()) {
    this.#createDocument = createDocument;
  }

  /** F173 copy-on-write proposal. Pending ceremonies are deliberately not cloned. */
  fork(): Tier3PartitionRegistry {
    if (this.#pending !== null || this.#pendingRecovery !== null) {
      throw new Error("Cannot fork Tier 3 state during an unconfirmed ceremony");
    }
    const proposal = new Tier3PartitionRegistry(this.#createDocument);
    for (const [key, root] of this.#roots) {
      proposal.#roots.set(key, {
        address: structuredClone(root.address),
        generation: root.generation,
        generationHistory: [...root.generationHistory],
        credentialId: root.credentialId,
        prfEnvelope: cloneRootEnvelope(root.prfEnvelope),
        recoveryGeneration: root.recoveryGeneration,
        recoveryEnvelope: cloneRootEnvelope(root.recoveryEnvelope),
        rootKey: new Uint8Array(root.rootKey),
        partitions: new Map(
          [...root.partitions.entries()].map(([partitionKey, partition]) => [
            partitionKey,
            {
              address: structuredClone(partition.address),
              document: partition.document.fork(),
              keyEpoch: partition.keyEpoch,
              documentKey: new Uint8Array(partition.documentKey),
              documentKeyEnvelope: cloneKeyEnvelope(partition.documentKeyEnvelope),
              historicalEpochs: partition.historicalEpochs.map((epoch) => ({
                address: structuredClone(epoch.address),
                keyEpoch: epoch.keyEpoch,
                documentKeyEnvelope: cloneKeyEnvelope(epoch.documentKeyEnvelope),
                encoding: epoch.encoding,
                iv: new Uint8Array(epoch.iv),
                ciphertext: new Uint8Array(epoch.ciphertext),
              })),
              epochBaseVersion: partition.epochBaseVersion,
            },
          ]),
        ),
        erasedPartitions: new Map(
          [...root.erasedPartitions.entries()].map(([partitionKey, partition]) => [
            partitionKey,
            structuredClone(partition),
          ]),
        ),
      });
    }
    return proposal;
  }

  get size(): number {
    return [...this.#roots.values()].reduce(
      (total, root) => total + root.partitions.size,
      0,
    );
  }

  roots(): readonly Tier3RootState[] {
    return [...this.#roots.values()];
  }

  get(address: ProtectedDocumentAddress): Tier3Partition | undefined {
    for (const root of this.#roots.values()) {
      const found = root.partitions.get(protectedPartitionKey(address));
      if (found) return found;
    }
    return undefined;
  }

  nodeFragments(): readonly NodeFragmentInput[] {
    return this.roots().flatMap((root) =>
      [...root.partitions.entries()].flatMap(([key, partition]) =>
        readNodeFragments(partition.document).map((fragment) => ({
          ...fragment,
          sourceDocumentId: `tier3-document:${key}`,
        })),
      ),
    );
  }

  async beginEnrollment(input: {
    readonly address: ProtectedDocumentAddress;
    readonly sessionUserId: string;
    readonly credentialId: string;
    readonly prfInput: Uint8Array;
    readonly prfResult: Uint8Array;
  }): Promise<string> {
    if (this.#roots.size !== 0 || this.#pending || this.#pendingRecovery) {
      throw new Error("Tier 3 enrollment already exists");
    }
    const rootAddress = createTier3RootAddress(
      input.address.workspaceId,
      input.sessionUserId,
    );
    const address = await requireSubjectAddress(
      input.address,
      rootAddress.workspaceId,
      input.sessionUserId,
    );
    const rootKey = generateTier3Secret();
    const documentKey = generateTier3Secret();
    const recoverySecret = generateTier3Secret();
    try {
      const prfEnvelope = await wrapTier3Root({
        rootKey,
        ikm: input.prfResult,
        header: createTier3PrfHeader({
          rootAddress,
          rootGeneration: 0,
          credentialId: input.credentialId,
          prfInput: input.prfInput,
        }),
      });
      const recoveryEnvelope = await wrapTier3Root({
        rootKey,
        ikm: recoverySecret,
        header: createTier3RecoveryHeader({
          rootAddress,
          rootGeneration: 0,
          recoveryGeneration: 0,
        }),
      });
      const documentKeyEnvelope = await wrapDocumentKey({
        address,
        keyEpoch: 0,
        rootKey,
        documentKey,
      });
      const state: Tier3RootState = {
        address: rootAddress,
        generation: 0,
        generationHistory: [0],
        credentialId: input.credentialId,
        prfEnvelope,
        recoveryGeneration: 0,
        recoveryEnvelope,
        rootKey,
        partitions: new Map([
          [
            protectedPartitionKey(address),
            {
              address,
              document: this.#createDocument(),
              keyEpoch: 0,
              documentKey,
              documentKeyEnvelope,
              historicalEpochs: [],
              epochBaseVersion: null,
            },
          ],
        ]),
        erasedPartitions: new Map(),
      };
      const recoveryCode = encodeTier3RecoveryCode(recoverySecret);
      this.#pending = { state, recoverySecret, recoveryCode };
      return recoveryCode;
    } catch (error) {
      rootKey.fill(0);
      documentKey.fill(0);
      recoverySecret.fill(0);
      throw error;
    }
  }

  confirmEnrollment(reenteredCode: string): Tier3RootState {
    const pending = this.#pending;
    if (!pending) throw new Error("No Tier 3 enrollment awaits confirmation");
    let supplied: Uint8Array;
    try {
      supplied = decodeTier3RecoveryCode(reenteredCode);
    } catch {
      throw new Error("Tier 3 recovery code confirmation failed");
    }
    const matches = supplied.every(
      (byte, index) => byte === pending.recoverySecret[index],
    );
    supplied.fill(0);
    if (!matches) throw new Error("Tier 3 recovery code confirmation failed");
    const key = JSON.stringify(pending.state.address);
    this.#roots.set(key, pending.state);
    pending.recoverySecret.fill(0);
    this.#pending = null;
    return pending.state;
  }

  confirmRecovery(reenteredCode: string): Tier3RootState {
    const pending = this.#pendingRecovery;
    if (!pending) throw new Error("No Tier 3 recovery awaits confirmation");
    let supplied: Uint8Array;
    try {
      supplied = decodeTier3RecoveryCode(reenteredCode);
    } catch {
      throw new Error("Tier 3 replacement recovery code confirmation failed");
    }
    const matches = supplied.every(
      (byte, index) => byte === pending.recoverySecret[index],
    );
    supplied.fill(0);
    if (!matches) {
      throw new Error("Tier 3 replacement recovery code confirmation failed");
    }
    this.#roots.set(JSON.stringify(pending.state.address), pending.state);
    pending.recoverySecret.fill(0);
    this.#pendingRecovery = null;
    return pending.state;
  }

  async addDocument(
    rootAddress: Tier3RootAddress,
    addressInput: ProtectedDocumentAddress,
  ): Promise<Tier3Partition> {
    const root = this.#roots.get(JSON.stringify(rootAddress));
    if (!root) throw new Error("Tier 3 root does not exist");
    const address = await requireSubjectAddress(
      addressInput,
      root.address.workspaceId,
      root.address.canonicalSubjectUserId,
    );
    const key = protectedPartitionKey(address);
    if (root.partitions.has(key) || root.erasedPartitions.has(key)) {
      throw new Error("Tier 3 document already exists or was cryptographically erased");
    }
    const documentKey = generateTier3Secret();
    const partition: Tier3Partition = {
      address,
      document: this.#createDocument(),
      keyEpoch: 0,
      documentKey,
      documentKeyEnvelope: await wrapDocumentKey({
        address,
        keyEpoch: 0,
        rootKey: root.rootKey,
        documentKey,
      }),
      historicalEpochs: [],
      epochBaseVersion: null,
    };
    root.partitions.set(key, partition);
    return partition;
  }

  /** F174 document/erasure-domain key destruction, preserving ciphertext and the root. */
  async cryptographicallyEraseErasureDomain(erasureDomainId: string): Promise<number> {
    let erased = 0;
    for (const root of this.#roots.values()) {
      for (const [key, partition] of [...root.partitions.entries()]) {
        if (partition.address.erasureDomainId !== erasureDomainId) continue;
        const encoding = partition.epochBaseVersion === null ? "snapshot" : "update";
        const bytes =
          encoding === "snapshot"
            ? partition.document.export({ mode: "snapshot" })
            : partition.document.export({
                mode: "update",
                from: partition.epochBaseVersion!,
              });
        const current = await encryptProtectedSnapshot(
          partition.address,
          partition.keyEpoch,
          partition.documentKey,
          bytes,
          encoding,
        );
        root.erasedPartitions.set(key, {
          address: structuredClone(partition.address),
          keyEpoch: partition.keyEpoch,
          historicalEpochs: partition.historicalEpochs.map((epoch) => ({
            address: structuredClone(epoch.address),
            keyEpoch: epoch.keyEpoch,
            encoding: epoch.encoding,
            iv: b64(epoch.iv),
            ciphertext: b64(epoch.ciphertext),
          })),
          currentEncoding: encoding,
          currentIv: b64(current.iv),
          currentCiphertext: b64(current.ciphertext),
        });
        partition.documentKey.fill(0);
        partition.document.free();
        root.partitions.delete(key);
        erased += 1;
      }
    }
    return erased;
  }

  async serialize(): Promise<Uint8Array> {
    const roots = [];
    for (const root of this.roots()) {
      const partitions = [];
      for (const partition of root.partitions.values()) {
        const encoding = partition.epochBaseVersion === null ? "snapshot" : "update";
        const bytes =
          encoding === "snapshot"
            ? partition.document.export({ mode: "snapshot" })
            : partition.document.export({
                mode: "update",
                from: partition.epochBaseVersion!,
              });
        const encrypted = await encryptProtectedSnapshot(
          partition.address,
          partition.keyEpoch,
          partition.documentKey,
          bytes,
          encoding,
        );
        partitions.push({
          address: partition.address,
          keyEpoch: partition.keyEpoch,
          documentKeyEnvelope: serializeEnvelope(partition.documentKeyEnvelope),
          historicalEpochs: partition.historicalEpochs.map((epoch) => ({
            address: epoch.address,
            keyEpoch: epoch.keyEpoch,
            documentKeyEnvelope: serializeEnvelope(epoch.documentKeyEnvelope),
            encoding: epoch.encoding,
            iv: b64(epoch.iv),
            ciphertext: b64(epoch.ciphertext),
          })),
          currentEncoding: encoding,
          currentIv: b64(encrypted.iv),
          currentCiphertext: b64(encrypted.ciphertext),
        });
      }
      roots.push({
        address: root.address,
        generation: root.generation,
        generationHistory: root.generationHistory,
        credentialId: root.credentialId,
        prfEnvelope: serializeEnvelope(root.prfEnvelope),
        recoveryGeneration: root.recoveryGeneration,
        recoveryEnvelope: serializeEnvelope(root.recoveryEnvelope),
        partitions,
        erasedPartitions: [...root.erasedPartitions.values()].sort((a, b) =>
          protectedPartitionKey(a.address).localeCompare(
            protectedPartitionKey(b.address),
          ),
        ),
      });
    }
    return new TextEncoder().encode(
      JSON.stringify({ formatVersion: MANIFEST_VERSION, roots }),
    );
  }

  async restore(
    bytes: Uint8Array,
    input: {
      readonly sessionUserId: string;
      readonly credentialId: string;
      readonly prfResult: Uint8Array;
      readonly expectedWorkspaceId?: string;
    },
  ): Promise<void> {
    if (this.#roots.size !== 0 || this.#pending || this.#pendingRecovery) {
      throw new Error("Tier 3 partitions must restore into an empty registry");
    }
    const manifest = this.parseManifest(bytes);
    if (manifest.roots.length !== 1)
      throw new Error("Expected one Tier 3 subject root");
    const stored = manifest.roots[0]!;
    const rootAddress = tier3RootAddressSchema.parse(stored.address);
    if (
      input.expectedWorkspaceId !== undefined &&
      rootAddress.workspaceId !== input.expectedWorkspaceId
    ) {
      throw new Error("Tier 3 root does not match the current Worker workspace");
    }
    if (rootAddress.canonicalSubjectUserId !== input.sessionUserId) {
      throw new Error("Tier 3 session subject does not match the root subject");
    }
    const prfEnvelope = deserializeRootEnvelope(stored.prfEnvelope);
    this.validatePrfEnvelope(stored, rootAddress, prfEnvelope);
    if (
      prfEnvelope.header.ciphertextKind !== "tier3-prf-root-envelope" ||
      prfEnvelope.header.credentialId !== input.credentialId ||
      stored.credentialId !== input.credentialId
    )
      throw new Error("Tier 3 PRF envelope does not match the current root");
    const recoveryEnvelope = deserializeRootEnvelope(stored.recoveryEnvelope);
    this.validateRecoveryEnvelope(stored, rootAddress, recoveryEnvelope);
    const rootKey = await unwrapTier3Root({
      envelope: prfEnvelope,
      ikm: input.prfResult,
    });
    try {
      const root = await this.restoreRootDocuments(stored, rootAddress, rootKey, {
        prfEnvelope,
        recoveryEnvelope,
      });
      this.#roots.set(JSON.stringify(rootAddress), root);
    } catch (error) {
      rootKey.fill(0);
      throw error;
    }
  }

  async recover(
    bytes: Uint8Array,
    input: {
      readonly sessionUserId: string;
      readonly credentialId: string;
      readonly prfInput: Uint8Array;
      readonly prfResult: Uint8Array;
      readonly recoveryCode: string;
      readonly expectedWorkspaceId?: string;
    },
  ): Promise<string> {
    if (this.#roots.size !== 0 || this.#pendingRecovery !== null) {
      throw new Error("Recovery requires an empty registry with no pending recovery");
    }
    const manifest = this.parseManifest(bytes);
    if (manifest.roots.length !== 1)
      throw new Error("Expected one Tier 3 subject root");
    const stored = manifest.roots[0]!;
    const rootAddress = tier3RootAddressSchema.parse(stored.address);
    if (
      input.expectedWorkspaceId !== undefined &&
      rootAddress.workspaceId !== input.expectedWorkspaceId
    ) {
      throw new Error("Tier 3 root does not match the current Worker workspace");
    }
    if (rootAddress.canonicalSubjectUserId !== input.sessionUserId) {
      throw new Error("Tier 3 recovery requires the canonical subject's session");
    }
    const recoveryEnvelope = deserializeRootEnvelope(stored.recoveryEnvelope);
    this.validateRecoveryEnvelope(stored, rootAddress, recoveryEnvelope);
    const recoverySecret = decodeTier3RecoveryCode(input.recoveryCode);
    const oldRoot = await unwrapTier3Root({
      envelope: recoveryEnvelope,
      ikm: recoverySecret,
    });
    recoverySecret.fill(0);
    const oldPrfEnvelope = deserializeRootEnvelope(stored.prfEnvelope);
    this.validatePrfEnvelope(stored, rootAddress, oldPrfEnvelope);
    const root = await this.restoreRootDocuments(stored, rootAddress, oldRoot, {
      prfEnvelope: oldPrfEnvelope,
      recoveryEnvelope,
    });
    const newRoot = generateTier3Secret();
    const newRecoverySecret = generateTier3Secret();
    const nextGeneration = root.generation + 1;
    try {
      for (const partition of root.partitions.values()) {
        const rewrappedHistory: Tier3Epoch[] = [];
        for (const epoch of partition.historicalEpochs) {
          const historicalKey = await unwrapDocumentKey(
            epoch.documentKeyEnvelope,
            oldRoot,
          );
          try {
            rewrappedHistory.push({
              ...epoch,
              documentKeyEnvelope: await wrapDocumentKey({
                address: epoch.address,
                keyEpoch: epoch.keyEpoch,
                rootKey: newRoot,
                documentKey: historicalKey,
              }),
            });
          } finally {
            historicalKey.fill(0);
          }
        }
        const encoding = partition.epochBaseVersion === null ? "snapshot" : "update";
        const currentBytes =
          encoding === "snapshot"
            ? partition.document.export({ mode: "snapshot" })
            : partition.document.export({
                mode: "update",
                from: partition.epochBaseVersion!,
              });
        const encrypted = await encryptProtectedSnapshot(
          partition.address,
          partition.keyEpoch,
          partition.documentKey,
          currentBytes,
          encoding,
        );
        rewrappedHistory.push({
          address: partition.address,
          keyEpoch: partition.keyEpoch,
          documentKeyEnvelope: await wrapDocumentKey({
            address: partition.address,
            keyEpoch: partition.keyEpoch,
            rootKey: newRoot,
            documentKey: partition.documentKey,
          }),
          encoding,
          iv: encrypted.iv,
          ciphertext: encrypted.ciphertext,
        });
        partition.documentKey.fill(0);
        partition.keyEpoch += 1;
        partition.documentKey = generateTier3Secret();
        partition.documentKeyEnvelope = await wrapDocumentKey({
          address: partition.address,
          keyEpoch: partition.keyEpoch,
          rootKey: newRoot,
          documentKey: partition.documentKey,
        });
        partition.historicalEpochs = rewrappedHistory;
        partition.epochBaseVersion = partition.document.version();
      }
      root.rootKey.fill(0);
      root.rootKey = newRoot;
      root.generation = nextGeneration;
      root.generationHistory.push(nextGeneration);
      root.credentialId = input.credentialId;
      root.prfEnvelope = await wrapTier3Root({
        rootKey: newRoot,
        ikm: input.prfResult,
        header: createTier3PrfHeader({
          rootAddress,
          rootGeneration: nextGeneration,
          credentialId: input.credentialId,
          prfInput: input.prfInput,
        }),
      });
      root.recoveryGeneration = nextGeneration;
      root.recoveryEnvelope = await wrapTier3Root({
        rootKey: newRoot,
        ikm: newRecoverySecret,
        header: createTier3RecoveryHeader({
          rootAddress,
          rootGeneration: nextGeneration,
          recoveryGeneration: nextGeneration,
        }),
      });
      const recoveryCode = encodeTier3RecoveryCode(newRecoverySecret);
      this.#pendingRecovery = {
        state: root,
        recoverySecret: newRecoverySecret,
        recoveryCode,
      };
      return recoveryCode;
    } catch (error) {
      newRoot.fill(0);
      disposeRootState(root);
      throw error;
    } finally {
      oldRoot.fill(0);
      if (this.#pendingRecovery === null) newRecoverySecret.fill(0);
    }
  }

  private parseManifest(bytes: Uint8Array): Tier3Manifest {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const result = tier3ManifestSchema.safeParse(parsed);
    if (!result.success) throw new Error("Unsupported Tier 3 manifest");
    return result.data;
  }

  private validateRecoveryEnvelope(
    stored: SerializedRoot,
    address: Tier3RootAddress,
    envelope: Tier3RootEnvelope,
  ): void {
    if (
      envelope.header.ciphertextKind !== "tier3-recovery-root-envelope" ||
      !sameRootAddress(envelope.header.rootAddress, address) ||
      envelope.header.rootGeneration !== stored.generation ||
      envelope.header.recoveryGeneration !== stored.recoveryGeneration ||
      stored.recoveryGeneration !== stored.generation
    ) {
      throw new Error("Tier 3 recovery envelope is not the authoritative generation");
    }
  }

  private validatePrfEnvelope(
    stored: SerializedRoot,
    address: Tier3RootAddress,
    envelope: Tier3RootEnvelope,
  ): void {
    if (envelope.header.ciphertextKind !== "tier3-prf-root-envelope") {
      throw new Error("Tier 3 PRF envelope does not match the authoritative root");
    }
    if (
      !sameRootAddress(envelope.header.rootAddress, address) ||
      envelope.header.rootGeneration !== stored.generation ||
      envelope.header.credentialId !== stored.credentialId
    ) {
      throw new Error("Tier 3 PRF envelope does not match the authoritative root");
    }
  }

  private async restoreRootDocuments(
    stored: SerializedRoot,
    rootAddress: Tier3RootAddress,
    rootKey: Uint8Array,
    envelopes: {
      readonly prfEnvelope: Tier3RootEnvelope;
      readonly recoveryEnvelope: Tier3RootEnvelope;
    },
  ): Promise<Tier3RootState> {
    const partitions = new Map<string, Tier3Partition>();
    const expectedGenerationHistory = Array.from(
      { length: stored.generation + 1 },
      (_, generation) => generation,
    );
    if (
      stored.generationHistory.length !== expectedGenerationHistory.length ||
      stored.generationHistory.some(
        (generation, index) => generation !== expectedGenerationHistory[index],
      )
    ) {
      throw new Error("Malformed Tier 3 root generation history");
    }
    try {
      for (const serialized of stored.partitions) {
        const address = await requireSubjectAddress(
          serialized.address,
          rootAddress.workspaceId,
          rootAddress.canonicalSubjectUserId,
        );
        if (
          serialized.keyEpoch !== serialized.historicalEpochs.length ||
          !Number.isInteger(serialized.keyEpoch)
        ) {
          throw new Error("Malformed Tier 3 document epoch history");
        }
        const document = this.#createDocument();
        const historicalEpochs: Tier3Epoch[] = [];
        let currentDocumentKey: Uint8Array | null = null;
        try {
          for (const [index, epochStored] of serialized.historicalEpochs.entries()) {
            const epochAddress = await requireSubjectAddress(
              epochStored.address,
              rootAddress.workspaceId,
              rootAddress.canonicalSubjectUserId,
            );
            if (epochStored.keyEpoch !== index) {
              throw new Error("Malformed Tier 3 historical generation");
            }
            if (
              protectedPartitionKey(epochAddress) !== protectedPartitionKey(address)
            ) {
              throw new Error(
                "Tier 3 historical document address does not match its current document",
              );
            }
            const keyEnvelope = deserializeKeyEnvelope(
              epochStored.documentKeyEnvelope,
              epochAddress,
              index,
            );
            const key = await unwrapDocumentKey(keyEnvelope, rootKey);
            try {
              document.import(
                await decryptProtectedSnapshot({
                  address: epochAddress,
                  keyEpoch: index,
                  documentKey: key,
                  iv: unb64(epochStored.iv),
                  ciphertext: unb64(epochStored.ciphertext),
                  encoding: epochStored.encoding,
                }),
              );
            } finally {
              key.fill(0);
            }
            historicalEpochs.push({
              address: epochAddress,
              keyEpoch: index,
              documentKeyEnvelope: keyEnvelope,
              encoding: epochStored.encoding,
              iv: unb64(epochStored.iv),
              ciphertext: unb64(epochStored.ciphertext),
            });
          }
          const documentKeyEnvelope = deserializeKeyEnvelope(
            serialized.documentKeyEnvelope,
            address,
            serialized.keyEpoch,
          );
          currentDocumentKey = await unwrapDocumentKey(documentKeyEnvelope, rootKey);
          document.import(
            await decryptProtectedSnapshot({
              address,
              keyEpoch: serialized.keyEpoch,
              documentKey: currentDocumentKey,
              iv: unb64(serialized.currentIv),
              ciphertext: unb64(serialized.currentCiphertext),
              encoding: serialized.currentEncoding,
            }),
          );
          const key = protectedPartitionKey(address);
          if (partitions.has(key)) throw new Error("Duplicate Tier 3 document address");
          const documentKey = currentDocumentKey;
          partitions.set(key, {
            address,
            document,
            keyEpoch: serialized.keyEpoch,
            documentKey,
            documentKeyEnvelope,
            historicalEpochs,
            epochBaseVersion: historicalEpochs.length === 0 ? null : document.version(),
          });
          currentDocumentKey = null;
        } catch (error) {
          currentDocumentKey?.fill(0);
          document.free();
          throw error;
        }
      }
    } catch (error) {
      for (const partition of partitions.values()) {
        partition.documentKey.fill(0);
        partition.document.free();
      }
      throw error;
    }
    return {
      address: rootAddress,
      generation: stored.generation,
      generationHistory: [...stored.generationHistory],
      credentialId: stored.credentialId,
      prfEnvelope: envelopes.prfEnvelope,
      recoveryGeneration: stored.recoveryGeneration,
      recoveryEnvelope: envelopes.recoveryEnvelope,
      rootKey,
      partitions,
      erasedPartitions: await this.validateErasedPartitions(
        stored,
        rootAddress,
        new Set(partitions.keys()),
      ),
    };
  }

  private async validateErasedPartitions(
    stored: SerializedRoot,
    rootAddress: Tier3RootAddress,
    activeKeys: ReadonlySet<string>,
  ): Promise<Map<string, ErasedPartition>> {
    const erased = new Map<string, ErasedPartition>();
    for (const candidate of stored.erasedPartitions ?? []) {
      const address = await requireSubjectAddress(
        candidate.address,
        rootAddress.workspaceId,
        rootAddress.canonicalSubjectUserId,
      );
      if (candidate.keyEpoch !== candidate.historicalEpochs.length) {
        throw new Error("Malformed erased Tier 3 document");
      }
      const key = protectedPartitionKey(address);
      if (activeKeys.has(key) || erased.has(key)) {
        throw new Error("Duplicate erased Tier 3 document address");
      }
      for (const [index, epoch] of candidate.historicalEpochs.entries()) {
        if (epoch.keyEpoch !== index || protectedPartitionKey(epoch.address) !== key) {
          throw new Error("Malformed erased Tier 3 history");
        }
      }
      erased.set(key, structuredClone(candidate));
    }
    return erased;
  }

  dispose(): void {
    if (this.#pending) {
      this.#pending.recoverySecret.fill(0);
      disposeRootState(this.#pending.state);
      this.#pending = null;
    }
    if (this.#pendingRecovery) {
      this.#pendingRecovery.recoverySecret.fill(0);
      disposeRootState(this.#pendingRecovery.state);
      this.#pendingRecovery = null;
    }
    for (const root of this.#roots.values()) {
      disposeRootState(root);
    }
    this.#roots.clear();
  }
}
