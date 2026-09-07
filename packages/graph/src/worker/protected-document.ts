import canonicalize from "canonicalize";
import { z } from "zod";
import {
  isNodeType,
  resolveRegisteredProtectionTier,
  type DataTier,
} from "@vulto/schema";

/**
 * FDN-52 stage 1: the durable identity of one protected document.
 *
 * This module deliberately contains neither a content key nor ciphertext.
 * It defines the bytes later stages authenticate before any key-management
 * mechanism is allowed to use them. The current workspace-wide Loro source
 * is not a protected-document identity and must not be reused for one.
 */
export const PROTECTED_ENVELOPE_FORMAT_VERSION = 1 as const;

const asciiIdentifierSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._:-]+$/, "must be an ASCII identifier");

const sha256HexSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "must be a SHA-256 hex digest");

/** A supplied, concrete set of people — never roles — that may read a protected document. */
export const protectedReaderSetSchema = z
  .object({
    /** Canonically sorted, distinct canonical user IDs. */
    userIds: z.array(asciiIdentifierSchema).min(1),
    /** SHA-256 of the RFC 8785 serialization of `userIds`. */
    id: sha256HexSchema,
  })
  .strict()
  .superRefine((value, context) => {
    for (let index = 1; index < value.userIds.length; index += 1) {
      if (value.userIds[index - 1]! >= value.userIds[index]!) {
        context.addIssue({
          code: "custom",
          path: ["userIds", index],
          message: "must be strictly ordered by raw UTF-16 code-unit comparison",
        });
      }
    }
  });

export const protectedDocumentAddressSchema = z
  .object({
    workspaceId: asciiIdentifierSchema,
    nodeType: asciiIdentifierSchema,
    schemaPartition: asciiIdentifierSchema,
    tier: z.union([z.literal(1), z.literal(3)]),
    readerSetId: sha256HexSchema,
    timeBucket: asciiIdentifierSchema,
    erasureDomainId: asciiIdentifierSchema,
  })
  .strict();

/** The only ciphertext classes whose headers can be authenticated by this contract. */
export const protectedCiphertextKindSchema = z.enum([
  "document-snapshot",
  "document-update",
  "tier1-recipient-envelope",
  "tier1-recovery-envelope",
  "tier3-prf-envelope",
  "tier3-recovery-code-envelope",
  "tier3-document-key-envelope",
]);

/**
 * The complete additional-authenticated-data contract. Later stages must
 * serialize exactly these bytes, then supply them to AES-GCM as `additionalData`.
 */
const protectedEnvelopeHeaderBaseSchema = z
  .object({
    formatVersion: z.literal(PROTECTED_ENVELOPE_FORMAT_VERSION),
    address: protectedDocumentAddressSchema,
    keyEpoch: z.number().int().nonnegative(),
    ciphertextKind: protectedCiphertextKindSchema,
  })
  .strict();

export const protectedEnvelopeHeaderSchema = z.discriminatedUnion("ciphertextKind", [
  protectedEnvelopeHeaderBaseSchema.extend({
    ciphertextKind: z.literal("tier1-recipient-envelope"),
    recipientUserId: asciiIdentifierSchema,
    ephemeralPublicKey: z.string().min(1),
  }),
  protectedEnvelopeHeaderBaseSchema.extend({
    ciphertextKind: z.union([
      z.literal("document-snapshot"),
      z.literal("document-update"),
      z.literal("tier1-recovery-envelope"),
      z.literal("tier3-prf-envelope"),
      z.literal("tier3-recovery-code-envelope"),
      z.literal("tier3-document-key-envelope"),
    ]),
  }),
]);

export type ProtectedReaderSet = z.infer<typeof protectedReaderSetSchema>;
export type ProtectedDocumentAddress = z.infer<typeof protectedDocumentAddressSchema>;
export type ProtectedCiphertextKind = z.infer<typeof protectedCiphertextKindSchema>;
export type ProtectedEnvelopeHeader = z.infer<typeof protectedEnvelopeHeaderSchema>;

function canonicalizeRequired(value: unknown): string {
  const serialized = canonicalize(value);
  if (serialized === undefined) {
    throw new TypeError("Protected document metadata cannot be canonicalized");
  }
  return serialized;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function protectedReaderSetId(userIds: readonly string[]): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    utf8(canonicalizeRequired(userIds)) as BufferSource,
  );
  return hex(new Uint8Array(digest));
}

/**
 * Normalizes supplied concrete people once, before any later key or query
 * layer sees them. FDN-89 will supply real graph-derived IDs; this stage
 * refuses an empty set rather than treating the permission layer's current
 * conservative `none` answer as a valid reader set.
 */
export async function createProtectedReaderSet(
  suppliedUserIds: readonly string[],
): Promise<ProtectedReaderSet> {
  const userIds = [...suppliedUserIds].sort();
  if (userIds.length === 0) {
    throw new TypeError("A protected document requires at least one concrete reader");
  }
  for (let index = 1; index < userIds.length; index += 1) {
    if (userIds[index - 1] === userIds[index]) {
      throw new TypeError("A protected reader set cannot contain a duplicate user ID");
    }
  }
  const parsedUserIds = z.array(asciiIdentifierSchema).min(1).parse(userIds);
  return protectedReaderSetSchema.parse({
    id: await protectedReaderSetId(parsedUserIds),
    userIds: parsedUserIds,
  });
}

/**
 * Constructs an address only when the supplied reader set is the same one
 * whose digest appears in it. This makes a caller's accidental or hostile
 * reader-set substitution fail before encryption is introduced.
 */
export async function createProtectedDocumentAddress(input: {
  readonly workspaceId: string;
  readonly nodeType: string;
  readonly schemaPartition: string;
  readonly tier: 1 | 3;
  readonly readerSet: ProtectedReaderSet;
  readonly timeBucket: string;
  readonly erasureDomainId: string;
  /** Required only for an A002 `Inherited` registration. */
  readonly inheritedSourceTiers?: readonly DataTier[];
}): Promise<ProtectedDocumentAddress> {
  const readerSet = protectedReaderSetSchema.parse(input.readerSet);
  if ((await protectedReaderSetId(readerSet.userIds)) !== readerSet.id) {
    throw new TypeError("Protected reader set ID does not match its concrete user IDs");
  }
  if (!isNodeType(input.nodeType)) {
    throw new TypeError(
      `Protected document node type is not registered: ${input.nodeType}`,
    );
  }
  const enforcedTier = resolveRegisteredProtectionTier({
    nodeType: input.nodeType,
    schemaPartition: input.schemaPartition,
    inheritedSourceTiers: input.inheritedSourceTiers,
  });
  if (enforcedTier !== input.tier) {
    throw new TypeError(
      `Protected document tier does not match the registered effective tier: expected ${enforcedTier}, received ${input.tier}`,
    );
  }
  return protectedDocumentAddressSchema.parse({
    workspaceId: input.workspaceId,
    nodeType: input.nodeType,
    schemaPartition: input.schemaPartition,
    tier: input.tier,
    readerSetId: readerSet.id,
    timeBucket: input.timeBucket,
    erasureDomainId: input.erasureDomainId,
  });
}

export function createProtectedEnvelopeHeader(input: {
  readonly address: ProtectedDocumentAddress;
  readonly keyEpoch: number;
  readonly ciphertextKind: ProtectedCiphertextKind;
  readonly recipientUserId?: string;
  readonly ephemeralPublicKey?: string;
}): ProtectedEnvelopeHeader {
  const base = {
    formatVersion: PROTECTED_ENVELOPE_FORMAT_VERSION,
    address: input.address,
    keyEpoch: input.keyEpoch,
    ciphertextKind: input.ciphertextKind,
  };
  if (input.ciphertextKind === "tier1-recipient-envelope") {
    return protectedEnvelopeHeaderSchema.parse({
      ...base,
      recipientUserId: input.recipientUserId,
      ephemeralPublicKey: input.ephemeralPublicKey,
    });
  }
  return protectedEnvelopeHeaderSchema.parse(base);
}

/** RFC 8785 canonical UTF-8 bytes used as AES-GCM additional authenticated data in later stages. */
export function protectedEnvelopeAdditionalData(
  header: ProtectedEnvelopeHeader,
): Uint8Array {
  return utf8(canonicalizeRequired(protectedEnvelopeHeaderSchema.parse(header)));
}
