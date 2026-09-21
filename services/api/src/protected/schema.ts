import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  customType,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * The key hierarchy's stored half (VPS-A003 "The encryption architecture"): one
 * workspace KEK wrapped by the root key, and data keys wrapped by that KEK.
 * Never replicated. Destroying a data key sets `wrapped_key` to null.
 */
export const protectedDataKeys = pgTable(
  "protected_data_keys",
  {
    keyId: uuid("key_id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    kind: text("kind").notNull(),
    tier: smallint("tier"),
    erasureDomainId: uuid("erasure_domain_id"),
    parentKeyId: uuid("parent_key_id").references(
      (): AnyPgColumn => protectedDataKeys.keyId,
    ),
    rootKeyRef: text("root_key_ref"),
    wrappedKey: bytea("wrapped_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    destroyedAt: timestamp("destroyed_at", { withTimezone: true }),
  },
  (table) => [
    check("protected_data_keys_kind_check", sql`${table.kind} in ('kek', 'dek')`),
    check(
      "protected_data_keys_tier_check",
      sql`${table.tier} is null or ${table.tier} in (1, 2)`,
    ),
    check(
      "protected_data_keys_kek_shape_check",
      sql`${table.kind} <> 'kek' or (${table.parentKeyId} is null and ${table.rootKeyRef} is not null and ${table.tier} is null)`,
    ),
    check(
      "protected_data_keys_dek_shape_check",
      sql`${table.kind} <> 'dek' or (${table.parentKeyId} is not null and ${table.tier} is not null)`,
    ),
    check(
      "protected_data_keys_tier1_domain_check",
      sql`not (${table.kind} = 'dek' and ${table.tier} = 1) or ${table.erasureDomainId} is not null`,
    ),
    // A key is either live (it has its wrapped bytes) or destroyed (it has none).
    check(
      "protected_data_keys_destroyed_check",
      sql`(${table.destroyedAt} is null) = (${table.wrappedKey} is not null)`,
    ),
    uniqueIndex("protected_data_keys_live_kek_uidx")
      .on(table.workspaceId)
      .where(sql`${table.kind} = 'kek' and ${table.destroyedAt} is null`),
    uniqueIndex("protected_data_keys_live_tier2_dek_uidx")
      .on(table.workspaceId)
      .where(
        sql`${table.kind} = 'dek' and ${table.tier} = 2 and ${table.destroyedAt} is null`,
      ),
    uniqueIndex("protected_data_keys_live_tier1_dek_uidx")
      .on(table.workspaceId, table.erasureDomainId)
      .where(
        sql`${table.kind} = 'dek' and ${table.tier} = 1 and ${table.destroyedAt} is null`,
      ),
    index("protected_data_keys_workspace_idx").on(table.workspaceId, table.kind),
  ],
);

/**
 * Tier 1 and Tier 2 content, and nothing else (A003-T55): AES-256-GCM
 * ciphertext whose RFC 8785 header is authenticated as additional data. Never
 * replicated, so a device cannot receive it.
 */
export const graphProtectedFragments = pgTable(
  "graph_protected_fragments",
  {
    fragmentId: uuid("fragment_id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    ownerKind: text("owner_kind").notNull(),
    ownerId: uuid("owner_id").notNull(),
    schemaPartition: text("schema_partition").notNull(),
    tier: smallint("tier").notNull(),
    erasureDomainId: uuid("erasure_domain_id").notNull(),
    dataKeyId: uuid("data_key_id")
      .notNull()
      .references(() => protectedDataKeys.keyId),
    nonce: bytea("nonce").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    header: jsonb("header").notNull(),
    version: bigint("version", { mode: "number" }).notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    updatedBy: uuid("updated_by"),
  },
  (table) => [
    check(
      "graph_protected_fragments_owner_kind_check",
      sql`${table.ownerKind} in ('node', 'edge')`,
    ),
    check("graph_protected_fragments_tier_check", sql`${table.tier} in (1, 2)`),
    uniqueIndex("graph_protected_fragments_owner_partition_uidx").on(
      table.ownerKind,
      table.ownerId,
      table.schemaPartition,
    ),
    index("graph_protected_fragments_workspace_owner_idx").on(
      table.workspaceId,
      table.ownerId,
    ),
    index("graph_protected_fragments_key_idx").on(table.dataKeyId),
  ],
);
