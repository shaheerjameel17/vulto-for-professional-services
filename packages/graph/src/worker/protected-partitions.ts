import { LoroDoc, type VersionVector } from "loro-crdt/web";
import type { NodeFragmentInput } from "./materialization";
import { readNodeFragments } from "./document-node-fragments";
import {
  createProtectedEnvelopeHeader,
  createProtectedReaderSet,
  protectedDocumentAddressSchema,
  protectedEnvelopeAdditionalData,
  protectedEnvelopeHeaderSchema,
  type ProtectedDocumentAddress,
} from "./protected-document";
import {
  type Tier1Recipient,
  type Tier1RecipientEnvelope,
  generateTier1DocumentKeyBytes,
  unwrapTier1DocumentKey,
  wrapTier1DocumentKey,
} from "./tier1-envelope";

const MANIFEST_VERSION = 2 as const;
const RETENTION_LEASE_DAYS = 30;

export type Tier1RetentionState =
  | { readonly status: "active" }
  | {
      readonly status: "closed";
      readonly closedAt: string;
      readonly windowMonths: number;
      readonly lastAccessedAt: string | null;
    };

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label} timestamp`);
  return parsed;
}

function retentionState(value: Tier1RetentionState): Tier1RetentionState {
  if (value.status === "active") return { status: "active" };
  if (
    value.status !== "closed" ||
    !Number.isInteger(value.windowMonths) ||
    value.windowMonths < 6 ||
    value.windowMonths > 24
  ) {
    throw new Error("Tier 1 retention window must be an integer from 6 to 24 months");
  }
  timestamp(value.closedAt, "Tier 1 close");
  if (value.lastAccessedAt !== null) {
    timestamp(value.lastAccessedAt, "Tier 1 last-access");
  }
  return { ...value };
}

function subtractUtcMonths(value: Date, months: number): Date {
  const targetMonth = value.getUTCMonth() - months;
  const targetYear = value.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      targetYear,
      normalizedMonth,
      Math.min(value.getUTCDate(), lastDay),
      value.getUTCHours(),
      value.getUTCMinutes(),
      value.getUTCSeconds(),
      value.getUTCMilliseconds(),
    ),
  );
}

export function shouldMaterializeTier1(input: {
  readonly retention: Tier1RetentionState;
  readonly now: string;
}): boolean {
  const retention = retentionState(input.retention);
  if (retention.status === "active") return true;
  const now = timestamp(input.now, "retention evaluation");
  const cutoff = subtractUtcMonths(new Date(now), retention.windowMonths).getTime();
  if (timestamp(retention.closedAt, "Tier 1 close") >= cutoff) return true;
  if (retention.lastAccessedAt === null) return false;
  const leaseAge = now - timestamp(retention.lastAccessedAt, "Tier 1 last-access");
  return leaseAge >= 0 && leaseAge <= RETENTION_LEASE_DAYS * 24 * 60 * 60 * 1000;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function unbase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

/** Stable identity of a real protected Loro document, covering every address field. */
export function protectedPartitionKey(address: ProtectedDocumentAddress): string {
  const header = createProtectedEnvelopeHeader({
    address,
    keyEpoch: 0,
    ciphertextKind: "document-snapshot",
  });
  return base64(protectedEnvelopeAdditionalData(header)).replaceAll("=", "");
}

function sameAddressExceptReaderSet(
  before: ProtectedDocumentAddress,
  after: ProtectedDocumentAddress,
): boolean {
  return (
    before.workspaceId === after.workspaceId &&
    before.nodeType === after.nodeType &&
    before.schemaPartition === after.schemaPartition &&
    before.tier === after.tier &&
    before.timeBucket === after.timeBucket &&
    before.erasureDomainId === after.erasureDomainId
  );
}

function requireTier1Address(
  address: ProtectedDocumentAddress,
): ProtectedDocumentAddress & { readonly tier: 1 } {
  if (address.tier !== 1) {
    throw new Error("Stage 3 protected partitions accept Tier 1 addresses only");
  }
  return address as ProtectedDocumentAddress & { readonly tier: 1 };
}

async function requireRecipientsMatchAddress(
  address: ProtectedDocumentAddress,
  recipients: readonly Tier1Recipient[],
): Promise<void> {
  const readerSet = await createProtectedReaderSet(
    recipients.map(({ userId }) => userId),
  );
  if (readerSet.id !== address.readerSetId) {
    throw new Error("Tier 1 recipients do not match the protected address reader set");
  }
}

function serializeEnvelopes(
  envelopes: ReadonlyMap<string, Tier1RecipientEnvelope>,
): readonly SerializedEnvelope[] {
  return [...envelopes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([userId, envelope]) => ({
      userId,
      header: envelope.header,
      iv: base64(envelope.iv),
      ciphertext: base64(envelope.ciphertext),
    }));
}

function deserializeEnvelopes(
  serializedEnvelopes: readonly SerializedEnvelope[],
  address: ProtectedDocumentAddress,
  keyEpoch: number,
): Map<string, Tier1RecipientEnvelope> {
  const envelopes = new Map<string, Tier1RecipientEnvelope>();
  for (const stored of serializedEnvelopes) {
    const header = protectedEnvelopeHeaderSchema.parse(stored.header);
    if (
      header.ciphertextKind !== "tier1-recipient-envelope" ||
      header.keyEpoch !== keyEpoch ||
      protectedPartitionKey(header.address) !== protectedPartitionKey(address) ||
      header.recipientUserId !== stored.userId ||
      envelopes.has(stored.userId)
    ) {
      throw new Error(
        "Protected recipient envelope does not match its partition manifest",
      );
    }
    envelopes.set(stored.userId, {
      header,
      iv: unbase64(stored.iv),
      ciphertext: unbase64(stored.ciphertext),
    });
  }
  return envelopes;
}

function cloneRecipientEnvelope(
  envelope: Tier1RecipientEnvelope,
): Tier1RecipientEnvelope {
  return {
    header: structuredClone(envelope.header),
    iv: new Uint8Array(envelope.iv),
    ciphertext: new Uint8Array(envelope.ciphertext),
  };
}

function cloneEnvelopeMap(
  envelopes: ReadonlyMap<string, Tier1RecipientEnvelope>,
): Map<string, Tier1RecipientEnvelope> {
  return new Map(
    [...envelopes.entries()].map(([userId, envelope]) => [
      userId,
      cloneRecipientEnvelope(envelope),
    ]),
  );
}

async function requireEnvelopeReadersMatchCurrentAddress(
  address: ProtectedDocumentAddress,
  envelopes: ReadonlyMap<string, Tier1RecipientEnvelope>,
): Promise<void> {
  const readerSet = await createProtectedReaderSet([...envelopes.keys()]);
  if (readerSet.id !== address.readerSetId) {
    throw new Error(
      "Protected recipient envelopes do not match the current address reader set",
    );
  }
}

async function aesKey(bytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    bytes as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptProtectedSnapshot(
  address: ProtectedDocumentAddress,
  keyEpoch: number,
  documentKey: Uint8Array,
  snapshot: Uint8Array,
  encoding: "snapshot" | "update",
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = createProtectedEnvelopeHeader({
    address,
    keyEpoch,
    ciphertextKind: encoding === "snapshot" ? "document-snapshot" : "document-update",
  });
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv as BufferSource,
        additionalData: protectedEnvelopeAdditionalData(header) as BufferSource,
      },
      await aesKey(documentKey),
      snapshot as BufferSource,
    ),
  );
  return { iv, ciphertext };
}

export async function decryptProtectedSnapshot(input: {
  readonly address: ProtectedDocumentAddress;
  readonly keyEpoch: number;
  readonly documentKey: Uint8Array;
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
  readonly encoding: "snapshot" | "update";
}): Promise<Uint8Array> {
  const header = createProtectedEnvelopeHeader({
    address: input.address,
    keyEpoch: input.keyEpoch,
    ciphertextKind:
      input.encoding === "snapshot" ? "document-snapshot" : "document-update",
  });
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: input.iv as BufferSource,
        additionalData: protectedEnvelopeAdditionalData(header) as BufferSource,
      },
      await aesKey(input.documentKey),
      input.ciphertext as BufferSource,
    ),
  );
}

interface SerializedEnvelope {
  readonly userId: string;
  readonly header: Tier1RecipientEnvelope["header"];
  readonly iv: string;
  readonly ciphertext: string;
}

interface SerializedPartition {
  readonly address: ProtectedDocumentAddress;
  readonly keyEpoch: number;
  readonly envelopes: readonly SerializedEnvelope[];
  readonly historicalEpochs: readonly SerializedEpoch[];
  readonly currentEncoding: "snapshot" | "update";
  readonly currentIv: string;
  readonly currentCiphertext: string;
  readonly retention: Tier1RetentionState;
  readonly keyErased: boolean;
}

interface SerializedEpoch {
  readonly address: ProtectedDocumentAddress;
  readonly keyEpoch: number;
  readonly envelopes: readonly SerializedEnvelope[];
  readonly encoding: "snapshot" | "update";
  readonly iv: string;
  readonly ciphertext: string;
}

interface SerializedManifest {
  readonly formatVersion: typeof MANIFEST_VERSION;
  readonly partitions: readonly SerializedPartition[];
}

export interface ProtectedPartition {
  address: ProtectedDocumentAddress;
  readonly document: LoroDoc;
  keyEpoch: number;
  documentKey: Uint8Array;
  readonly envelopes: Map<string, Tier1RecipientEnvelope>;
  historicalEpochs: ProtectedHistoricalEpoch[];
  epochBaseVersion: VersionVector | null;
  retention: Tier1RetentionState;
}

interface ProtectedHistoricalEpoch {
  readonly address: ProtectedDocumentAddress;
  readonly keyEpoch: number;
  readonly envelopes: Map<string, Tier1RecipientEnvelope>;
  readonly encoding: "snapshot" | "update";
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
}

export interface ProtectedReaderCredential {
  readonly userId: string;
  readonly privateKey: CryptoKey;
}

/** Worker-private Tier 1 documents, never containers inside the Tier 0/2 workspace document. */
export class ProtectedPartitionRegistry {
  #partitions = new Map<string, ProtectedPartition>();
  #retainedPartitions = new Map<string, SerializedPartition>();
  readonly #createDocument: () => LoroDoc;

  constructor(createDocument: () => LoroDoc = () => new LoroDoc()) {
    this.#createDocument = createDocument;
  }

  /** F173 copy-on-write proposal. The returned registry owns every raw key/document copy. */
  fork(): ProtectedPartitionRegistry {
    const proposal = new ProtectedPartitionRegistry(this.#createDocument);
    for (const [key, partition] of this.#partitions) {
      proposal.#partitions.set(key, {
        address: structuredClone(partition.address),
        document: partition.document.fork(),
        keyEpoch: partition.keyEpoch,
        documentKey: new Uint8Array(partition.documentKey),
        envelopes: cloneEnvelopeMap(partition.envelopes),
        historicalEpochs: partition.historicalEpochs.map((epoch) => ({
          address: structuredClone(epoch.address),
          keyEpoch: epoch.keyEpoch,
          envelopes: cloneEnvelopeMap(epoch.envelopes),
          encoding: epoch.encoding,
          iv: new Uint8Array(epoch.iv),
          ciphertext: new Uint8Array(epoch.ciphertext),
        })),
        epochBaseVersion: partition.epochBaseVersion,
        retention: { ...partition.retention },
      });
    }
    for (const [key, retained] of this.#retainedPartitions) {
      proposal.#retainedPartitions.set(key, structuredClone(retained));
    }
    return proposal;
  }

  async create(
    addressInput: ProtectedDocumentAddress,
    recipients: readonly Tier1Recipient[],
    retentionInput: Tier1RetentionState = { status: "active" },
  ): Promise<ProtectedPartition> {
    const address = requireTier1Address(
      protectedDocumentAddressSchema.parse(addressInput),
    );
    const partitionKey = protectedPartitionKey(address);
    if (
      this.#partitions.has(partitionKey) ||
      this.#retainedPartitions.has(partitionKey)
    ) {
      throw new Error("Protected partition already exists for this full address");
    }
    if (recipients.length === 0) {
      throw new Error("A protected partition requires at least one recipient");
    }
    await requireRecipientsMatchAddress(address, recipients);
    const documentKey = generateTier1DocumentKeyBytes();
    try {
      const envelopes = new Map<string, Tier1RecipientEnvelope>();
      for (const recipient of recipients) {
        if (envelopes.has(recipient.userId)) {
          throw new Error("A protected partition cannot wrap twice for one reader");
        }
        envelopes.set(
          recipient.userId,
          await wrapTier1DocumentKey({
            address,
            keyEpoch: 0,
            recipient,
            documentKeyBytes: documentKey,
          }),
        );
      }
      const partition = {
        address,
        document: this.#createDocument(),
        keyEpoch: 0,
        documentKey,
        envelopes,
        historicalEpochs: [],
        epochBaseVersion: null,
        retention: retentionState(retentionInput),
      };
      this.#partitions.set(partitionKey, partition);
      return partition;
    } catch (error) {
      documentKey.fill(0);
      throw error;
    }
  }

  get(address: ProtectedDocumentAddress): ProtectedPartition | undefined {
    return this.#partitions.get(protectedPartitionKey(address));
  }

  get size(): number {
    return this.#partitions.size;
  }

  /** Purges exactly one protected document from a newly unauthorized device. */
  purge(address: ProtectedDocumentAddress): boolean {
    const partitionKey = protectedPartitionKey(address);
    const partition = this.#partitions.get(partitionKey);
    if (partition) {
      partition.documentKey.fill(0);
      partition.document.free();
      this.#partitions.delete(partitionKey);
      return true;
    }
    return this.#retainedPartitions.delete(partitionKey);
  }

  nodeFragments(): readonly NodeFragmentInput[] {
    return [...this.#partitions.entries()].flatMap(([partitionKey, partition]) =>
      readNodeFragments(partition.document).map((fragment) => ({
        ...fragment,
        sourceDocumentId: `protected-document:${partitionKey}`,
      })),
    );
  }

  async removeReader(input: {
    readonly address: ProtectedDocumentAddress;
    readonly nextAddress: ProtectedDocumentAddress;
    readonly removedUserId: string;
    readonly remainingRecipients: readonly Tier1Recipient[];
  }): Promise<ProtectedPartition> {
    const partition = this.get(input.address);
    if (!partition) throw new Error("Protected partition does not exist");
    const nextAddress = protectedDocumentAddressSchema.parse(input.nextAddress);
    if (
      !sameAddressExceptReaderSet(partition.address, nextAddress) ||
      partition.address.readerSetId === nextAddress.readerSetId
    ) {
      throw new Error(
        "Reader removal must change only the protected address reader set",
      );
    }
    if (!partition.envelopes.has(input.removedUserId)) {
      throw new Error("Reader has no envelope for this protected partition");
    }
    if (input.remainingRecipients.length === 0) {
      throw new Error("Tier 1 reader removal cannot leave an empty reader set");
    }
    const expectedRemaining = [...partition.envelopes.keys()]
      .filter((userId) => userId !== input.removedUserId)
      .sort();
    const suppliedRemaining = input.remainingRecipients
      .map(({ userId }) => userId)
      .sort();
    if (
      expectedRemaining.length !== suppliedRemaining.length ||
      expectedRemaining.some((userId, index) => userId !== suppliedRemaining[index])
    ) {
      throw new Error(
        "Reader removal recipients must be exactly the prior readers less the removed reader",
      );
    }
    await requireRecipientsMatchAddress(nextAddress, input.remainingRecipients);
    const oldPartitionKey = protectedPartitionKey(partition.address);
    const nextPartitionKey = protectedPartitionKey(nextAddress);
    if (this.#partitions.has(nextPartitionKey)) {
      throw new Error("Rotated protected address already exists");
    }

    const nextDocumentKey = generateTier1DocumentKeyBytes();
    const nextEpoch = partition.keyEpoch + 1;
    const nextEnvelopes = new Map<string, Tier1RecipientEnvelope>();
    let finalizedCurrent: ProtectedHistoricalEpoch;
    let filteredHistorical: ProtectedHistoricalEpoch[];
    try {
      for (const recipient of input.remainingRecipients) {
        if (recipient.userId === input.removedUserId) {
          throw new Error("Removed reader cannot receive a new envelope");
        }
        if (nextEnvelopes.has(recipient.userId)) {
          throw new Error("A protected partition cannot wrap twice for one reader");
        }
        nextEnvelopes.set(
          recipient.userId,
          await wrapTier1DocumentKey({
            address: nextAddress,
            keyEpoch: nextEpoch,
            recipient,
            documentKeyBytes: nextDocumentKey,
          }),
        );
      }
      const allowedReaders = new Set(expectedRemaining);
      const filterEnvelopes = (
        envelopes: ReadonlyMap<string, Tier1RecipientEnvelope>,
      ) =>
        new Map(
          [...envelopes.entries()].filter(([userId]) => allowedReaders.has(userId)),
        );
      filteredHistorical = partition.historicalEpochs.map((epoch) => ({
        ...epoch,
        envelopes: filterEnvelopes(epoch.envelopes),
      }));
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
      finalizedCurrent = {
        address: partition.address,
        keyEpoch: partition.keyEpoch,
        envelopes: filterEnvelopes(partition.envelopes),
        encoding,
        iv: encrypted.iv,
        ciphertext: encrypted.ciphertext,
      };
    } catch (error) {
      nextDocumentKey.fill(0);
      throw error;
    }

    partition.documentKey.fill(0);
    partition.address = nextAddress;
    partition.keyEpoch = nextEpoch;
    partition.documentKey = nextDocumentKey;
    partition.historicalEpochs = [...filteredHistorical, finalizedCurrent];
    partition.epochBaseVersion = partition.document.version();
    partition.envelopes.clear();
    for (const [userId, envelope] of nextEnvelopes) {
      partition.envelopes.set(userId, envelope);
    }
    this.#partitions.delete(oldPartitionKey);
    this.#partitions.set(nextPartitionKey, partition);
    return partition;
  }

  /**
   * Grants one supplied concrete reader immediately without rotating the
   * document key or epoch. Because reader-set identity is authenticated, all
   * retained ciphertext and envelopes are re-authenticated under the expanded
   * full address while the underlying Loro bytes and keys remain unchanged.
   */
  async addReader(input: {
    readonly address: ProtectedDocumentAddress;
    readonly nextAddress: ProtectedDocumentAddress;
    readonly addedUserId: string;
    readonly nextRecipients: readonly Tier1Recipient[];
    readonly authorizingCredential: ProtectedReaderCredential;
  }): Promise<ProtectedPartition> {
    const partition = this.get(input.address);
    if (!partition) throw new Error("Protected partition does not exist");
    const nextAddress = requireTier1Address(
      protectedDocumentAddressSchema.parse(input.nextAddress),
    );
    if (
      !sameAddressExceptReaderSet(partition.address, nextAddress) ||
      partition.address.readerSetId === nextAddress.readerSetId
    ) {
      throw new Error("Reader grant must change only the protected address reader set");
    }
    if (partition.envelopes.has(input.addedUserId)) {
      throw new Error("Reader already has an envelope for this protected partition");
    }
    if (!partition.envelopes.has(input.authorizingCredential.userId)) {
      throw new Error("Reader grant requires a currently authorized credential");
    }
    const expectedNext = [...partition.envelopes.keys(), input.addedUserId].sort();
    const suppliedNext = input.nextRecipients.map(({ userId }) => userId).sort();
    if (
      expectedNext.length !== suppliedNext.length ||
      expectedNext.some((userId, index) => userId !== suppliedNext[index])
    ) {
      throw new Error(
        "Reader grant recipients must be exactly the prior readers plus the added reader",
      );
    }
    await requireRecipientsMatchAddress(nextAddress, input.nextRecipients);
    const oldPartitionKey = protectedPartitionKey(partition.address);
    const nextPartitionKey = protectedPartitionKey(nextAddress);
    if (this.#partitions.has(nextPartitionKey)) {
      throw new Error("Granted protected address already exists");
    }

    const wrapForNext = async (
      keyEpoch: number,
      documentKey: Uint8Array,
    ): Promise<Map<string, Tier1RecipientEnvelope>> => {
      const envelopes = new Map<string, Tier1RecipientEnvelope>();
      for (const recipient of input.nextRecipients) {
        if (envelopes.has(recipient.userId)) {
          throw new Error("A protected partition cannot wrap twice for one reader");
        }
        envelopes.set(
          recipient.userId,
          await wrapTier1DocumentKey({
            address: nextAddress,
            keyEpoch,
            recipient,
            documentKeyBytes: documentKey,
          }),
        );
      }
      return envelopes;
    };

    const nextHistorical: ProtectedHistoricalEpoch[] = [];
    for (const epoch of partition.historicalEpochs) {
      const authorizingEnvelope = epoch.envelopes.get(
        input.authorizingCredential.userId,
      );
      if (!authorizingEnvelope) {
        throw new Error("Authorizing reader cannot open protected history");
      }
      const historicalKey = await unwrapTier1DocumentKey({
        envelope: authorizingEnvelope,
        recipientUserId: input.authorizingCredential.userId,
        privateKey: input.authorizingCredential.privateKey,
      });
      try {
        const bytes = await decryptProtectedSnapshot({
          address: epoch.address,
          keyEpoch: epoch.keyEpoch,
          documentKey: historicalKey,
          iv: epoch.iv,
          ciphertext: epoch.ciphertext,
          encoding: epoch.encoding,
        });
        const encrypted = await encryptProtectedSnapshot(
          nextAddress,
          epoch.keyEpoch,
          historicalKey,
          bytes,
          epoch.encoding,
        );
        nextHistorical.push({
          address: nextAddress,
          keyEpoch: epoch.keyEpoch,
          envelopes: await wrapForNext(epoch.keyEpoch, historicalKey),
          encoding: epoch.encoding,
          iv: encrypted.iv,
          ciphertext: encrypted.ciphertext,
        });
      } finally {
        historicalKey.fill(0);
      }
    }
    const nextEnvelopes = await wrapForNext(partition.keyEpoch, partition.documentKey);

    partition.address = nextAddress;
    partition.historicalEpochs = nextHistorical;
    partition.envelopes.clear();
    for (const [userId, envelope] of nextEnvelopes) {
      partition.envelopes.set(userId, envelope);
    }
    this.#partitions.delete(oldPartitionKey);
    this.#partitions.set(nextPartitionKey, partition);
    return partition;
  }

  async openFor(
    address: ProtectedDocumentAddress,
    userId: string,
    privateKey: CryptoKey,
    accessedAt?: string,
  ): Promise<Uint8Array> {
    const partition = this.get(address);
    const envelope = partition?.envelopes.get(userId);
    if (!envelope) {
      throw new Error("Reader has no usable envelope for this protected partition");
    }
    const key = await unwrapTier1DocumentKey({
      envelope,
      recipientUserId: userId,
      privateKey,
    });
    if (partition?.retention.status === "closed" && accessedAt !== undefined) {
      timestamp(accessedAt, "Tier 1 last-access");
      partition.retention = { ...partition.retention, lastAccessedAt: accessedAt };
    }
    return key;
  }

  configureRetention(
    address: ProtectedDocumentAddress,
    retentionInput: Tier1RetentionState,
  ): void {
    const partition = this.get(address);
    if (!partition) throw new Error("Protected partition is not materialized");
    partition.retention = retentionState(retentionInput);
  }

  async purgeExpiredRetention(now: string): Promise<number> {
    timestamp(now, "retention evaluation");
    let purged = 0;
    for (const [key, partition] of [...this.#partitions.entries()]) {
      if (shouldMaterializeTier1({ retention: partition.retention, now })) continue;
      this.#retainedPartitions.set(key, await this.#serializePartition(partition));
      partition.documentKey.fill(0);
      partition.document.free();
      this.#partitions.delete(key);
      purged += 1;
    }
    return purged;
  }

  async cryptographicallyEraseErasureDomain(erasureDomainId: string): Promise<number> {
    let erased = 0;
    for (const [key, partition] of [...this.#partitions.entries()]) {
      if (partition.address.erasureDomainId !== erasureDomainId) continue;
      const serialized = await this.#serializePartition(partition);
      this.#retainedPartitions.set(key, this.#stripUsableKeys(serialized));
      partition.documentKey.fill(0);
      partition.document.free();
      this.#partitions.delete(key);
      erased += 1;
    }
    for (const [key, serialized] of [...this.#retainedPartitions.entries()]) {
      if (
        serialized.address.erasureDomainId !== erasureDomainId ||
        serialized.keyErased
      ) {
        continue;
      }
      this.#retainedPartitions.set(key, this.#stripUsableKeys(serialized));
      erased += 1;
    }
    return erased;
  }

  async serialize(): Promise<Uint8Array> {
    const partitions: SerializedPartition[] = [...this.#retainedPartitions.values()];
    for (const partition of this.#partitions.values()) {
      partitions.push(await this.#serializePartition(partition));
    }
    partitions.sort((a, b) =>
      protectedPartitionKey(a.address).localeCompare(protectedPartitionKey(b.address)),
    );
    const manifest: SerializedManifest = {
      formatVersion: MANIFEST_VERSION,
      partitions,
    };
    return new TextEncoder().encode(JSON.stringify(manifest));
  }

  async restore(
    bytes: Uint8Array,
    credentials: readonly ProtectedReaderCredential[],
    options: {
      readonly now?: string;
      readonly onDemandPartitionKeys?: readonly string[];
      readonly expectedWorkspaceId?: string;
    } = {},
  ): Promise<void> {
    if (this.#partitions.size !== 0 || this.#retainedPartitions.size !== 0) {
      throw new Error("Protected partitions must restore into an empty registry");
    }
    const parsed = JSON.parse(
      new TextDecoder().decode(bytes),
    ) as Partial<SerializedManifest>;
    if (
      parsed.formatVersion !== MANIFEST_VERSION ||
      !Array.isArray(parsed.partitions)
    ) {
      throw new Error("Unsupported protected partition manifest");
    }
    const credentialMap = new Map(
      credentials.map((credential) => [credential.userId, credential.privateKey]),
    );
    const now = options.now ?? new Date().toISOString();
    timestamp(now, "retention evaluation");
    const onDemand = new Set(options.onDemandPartitionKeys ?? []);
    const seenPartitionKeys = new Set<string>();
    try {
      for (const serialized of parsed.partitions) {
        const address = requireTier1Address(
          protectedDocumentAddressSchema.parse(serialized.address),
        );
        if (
          options.expectedWorkspaceId !== undefined &&
          address.workspaceId !== options.expectedWorkspaceId
        ) {
          throw new Error(
            "Protected partition workspace does not match the current Worker workspace",
          );
        }
        if (!Number.isInteger(serialized.keyEpoch) || serialized.keyEpoch < 0) {
          throw new Error("Invalid protected partition epoch");
        }
        const partitionKey = protectedPartitionKey(address);
        if (seenPartitionKeys.has(partitionKey)) {
          throw new Error("Duplicate protected partition address in manifest");
        }
        seenPartitionKeys.add(partitionKey);
        const retention = retentionState(serialized.retention);
        if (typeof serialized.keyErased !== "boolean") {
          throw new Error("Invalid protected partition key-erasure state");
        }
        if (
          !Array.isArray(serialized.envelopes) ||
          !Array.isArray(serialized.historicalEpochs) ||
          (serialized.currentEncoding !== "snapshot" &&
            serialized.currentEncoding !== "update") ||
          serialized.historicalEpochs.length !== serialized.keyEpoch ||
          (serialized.keyEpoch === 0 && serialized.currentEncoding !== "snapshot") ||
          (serialized.keyEpoch > 0 && serialized.currentEncoding !== "update")
        ) {
          throw new Error("Invalid protected partition epoch history");
        }
        if (serialized.keyErased) {
          if (
            serialized.envelopes.length !== 0 ||
            serialized.historicalEpochs.some(
              (epoch: SerializedEpoch) => epoch.envelopes.length !== 0,
            )
          ) {
            throw new Error("Cryptographically erased partition retains an envelope");
          }
          this.#retainedPartitions.set(partitionKey, {
            ...serialized,
            retention,
          });
          continue;
        }
        const requestedOnDemand = onDemand.has(partitionKey);
        const effectiveRetention =
          requestedOnDemand && retention.status === "closed"
            ? { ...retention, lastAccessedAt: now }
            : retention;
        if (
          !requestedOnDemand &&
          !shouldMaterializeTier1({ retention: effectiveRetention, now })
        ) {
          this.#retainedPartitions.set(partitionKey, {
            ...serialized,
            retention: effectiveRetention,
          });
          continue;
        }
        const envelopes = deserializeEnvelopes(
          serialized.envelopes,
          address,
          serialized.keyEpoch,
        );
        await requireEnvelopeReadersMatchCurrentAddress(address, envelopes);
        const usable = [...envelopes.entries()].find(([userId]) =>
          credentialMap.has(userId),
        );
        if (!usable) continue;
        const [userId, envelope] = usable;
        let keyToClear: Uint8Array | null = null;
        let documentToFree: LoroDoc | null = null;
        try {
          const document = this.#createDocument();
          documentToFree = document;
          const historicalEpochs: ProtectedHistoricalEpoch[] = [];
          for (const [
            index,
            serializedEpoch,
          ] of serialized.historicalEpochs.entries()) {
            const epochAddress = requireTier1Address(
              protectedDocumentAddressSchema.parse(serializedEpoch.address),
            );
            if (
              serializedEpoch.keyEpoch !== index ||
              (index === 0 && serializedEpoch.encoding !== "snapshot") ||
              (index > 0 && serializedEpoch.encoding !== "update") ||
              !sameAddressExceptReaderSet(epochAddress, address) ||
              !Array.isArray(serializedEpoch.envelopes)
            ) {
              throw new Error("Invalid protected historical epoch");
            }
            const epochEnvelopes = deserializeEnvelopes(
              serializedEpoch.envelopes,
              epochAddress,
              serializedEpoch.keyEpoch,
            );
            await requireEnvelopeReadersMatchCurrentAddress(address, epochEnvelopes);
            const historicalUsable = [...epochEnvelopes.entries()].find(
              ([historicalUserId]) => credentialMap.has(historicalUserId),
            );
            if (!historicalUsable) {
              throw new Error(
                "Current reader has no usable envelope for protected history",
              );
            }
            const [historicalUserId, historicalEnvelope] = historicalUsable;
            const historicalKey = await unwrapTier1DocumentKey({
              envelope: historicalEnvelope,
              recipientUserId: historicalUserId,
              privateKey: credentialMap.get(historicalUserId)!,
            });
            try {
              document.import(
                await decryptProtectedSnapshot({
                  address: epochAddress,
                  keyEpoch: serializedEpoch.keyEpoch,
                  documentKey: historicalKey,
                  iv: unbase64(serializedEpoch.iv),
                  ciphertext: unbase64(serializedEpoch.ciphertext),
                  encoding: serializedEpoch.encoding,
                }),
              );
            } finally {
              historicalKey.fill(0);
            }
            historicalEpochs.push({
              address: epochAddress,
              keyEpoch: serializedEpoch.keyEpoch,
              envelopes: epochEnvelopes,
              encoding: serializedEpoch.encoding,
              iv: unbase64(serializedEpoch.iv),
              ciphertext: unbase64(serializedEpoch.ciphertext),
            });
          }
          const epochBaseVersion =
            historicalEpochs.length === 0 ? null : document.version();
          const documentKey = await unwrapTier1DocumentKey({
            envelope,
            recipientUserId: userId,
            privateKey: credentialMap.get(userId)!,
          });
          keyToClear = documentKey;
          document.import(
            await decryptProtectedSnapshot({
              address,
              keyEpoch: serialized.keyEpoch,
              documentKey,
              iv: unbase64(serialized.currentIv),
              ciphertext: unbase64(serialized.currentCiphertext),
              encoding: serialized.currentEncoding,
            }),
          );
          this.#partitions.set(partitionKey, {
            address,
            document,
            keyEpoch: serialized.keyEpoch,
            documentKey,
            envelopes,
            historicalEpochs,
            epochBaseVersion,
            retention: effectiveRetention,
          });
          keyToClear = null;
          documentToFree = null;
        } finally {
          keyToClear?.fill(0);
          documentToFree?.free();
        }
      }
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  dispose(): void {
    for (const partition of this.#partitions.values()) {
      partition.documentKey.fill(0);
      partition.document.free();
    }
    this.#partitions.clear();
    this.#retainedPartitions.clear();
  }

  async #serializePartition(
    partition: ProtectedPartition,
  ): Promise<SerializedPartition> {
    const currentEncoding = partition.epochBaseVersion === null ? "snapshot" : "update";
    const currentBytes =
      currentEncoding === "snapshot"
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
      currentEncoding,
    );
    return {
      address: partition.address,
      keyEpoch: partition.keyEpoch,
      envelopes: serializeEnvelopes(partition.envelopes),
      historicalEpochs: partition.historicalEpochs.map((epoch) => ({
        address: epoch.address,
        keyEpoch: epoch.keyEpoch,
        envelopes: serializeEnvelopes(epoch.envelopes),
        encoding: epoch.encoding,
        iv: base64(epoch.iv),
        ciphertext: base64(epoch.ciphertext),
      })),
      currentEncoding,
      currentIv: base64(encrypted.iv),
      currentCiphertext: base64(encrypted.ciphertext),
      retention: retentionState(partition.retention),
      keyErased: false,
    };
  }

  #stripUsableKeys(serialized: SerializedPartition): SerializedPartition {
    return {
      ...serialized,
      envelopes: [],
      historicalEpochs: serialized.historicalEpochs.map((epoch) => ({
        ...epoch,
        envelopes: [],
      })),
      keyErased: true,
    };
  }
}
