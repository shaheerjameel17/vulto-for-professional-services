import { relations, sql } from "drizzle-orm";
import {
  check,
  customType,
  pgTable,
  primaryKey,
  smallint,
  text,
  bigint,
  timestamp,
  boolean,
  integer,
  uuid,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Postgres `bytea`. drizzle-orm has no first-class helper for it. */
const bytea = customType<{ data: Buffer; notNull: true; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const user = pgTable(
  "user",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    status: text("status").default("active").notNull(),
  },
  (table) => [
    check(
      "user_status_check",
      sql`${table.status} in ('active', 'suspended', 'deleted')`,
    ),
  ],
);

export const session = pgTable(
  "session",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_organization_id"),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("account_userId_idx").on(table.userId),
    uniqueIndex("account_provider_account_uidx").on(table.providerId, table.accountId),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const organization = pgTable(
  "organization",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    logo: text("logo"),
    createdAt: timestamp("created_at").notNull(),
    metadata: text("metadata"),
    status: text("status").default("active").notNull(),
  },
  (table) => [
    check(
      "organization_status_check",
      sql`${table.status} in ('active', 'suspended', 'canceled')`,
    ),
  ],
);

export const member = pgTable(
  "member",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").default("team-member").notNull(),
    createdAt: timestamp("created_at").notNull(),
    status: text("status").default("pending").notNull(),
    projectionState: text("projection_state").default("pending").notNull(),
  },
  (table) => [
    index("member_organizationId_idx").on(table.organizationId),
    index("member_userId_idx").on(table.userId),
    uniqueIndex("member_organization_user_uidx").on(table.organizationId, table.userId),
    check(
      "member_status_check",
      sql`${table.status} in ('pending', 'active', 'revoked')`,
    ),
    check(
      "member_projection_state_check",
      sql`${table.projectionState} in ('pending', 'confirmed', 'revocation-pending')`,
    ),
    check(
      "member_roles_check",
      sql`${table.role} ~ '^(owner|hr-admin|finance-admin|team-member)(,(owner|hr-admin|finance-admin|team-member))*$'`,
    ),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    inviterId: uuid("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("invitation_organizationId_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ],
);

export const passkey = pgTable(
  "passkey",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    createdAt: timestamp("created_at"),
    aaguid: text("aaguid"),
  },
  (table) => [
    index("passkey_userId_idx").on(table.userId),
    uniqueIndex("passkey_credentialID_uidx").on(table.credentialID),
  ],
);

export const passkeyRegistrationContext = pgTable(
  "passkey_registration_context",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("passkey_registration_context_email_idx").on(table.email),
    index("passkey_registration_context_expires_idx").on(table.expiresAt),
  ],
);

/**
 * The server-held half of a device's sealed local-store unlock secret
 * (FDN-84 / A003-T04). This is not the storage key itself and it decrypts
 * nothing by itself — it is combined on-device with a device-held half that
 * never leaves IndexedDB. Deleting/marking a row here is the revocation
 * kill switch: it denies the next unlock attempt for that device without
 * touching the device's own copy of the ciphertext.
 */
export const deviceUnlockSecret = pgTable(
  "device_unlock_secret",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    keyEpoch: integer("key_epoch").default(1).notNull(),
    serverHalf: text("server_half").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at"),
  },
  (table) => [
    uniqueIndex("device_unlock_secret_workspace_device_uidx").on(
      table.workspaceId,
      table.deviceId,
    ),
    index("device_unlock_secret_userId_idx").on(table.userId),
  ],
);

/**
 * FDN-63 / `VPS-F001` — the canonical Device identity record.
 *
 * Distinct from `deviceUnlockSecret` above: that is `VPS-A003`'s per-workspace
 * unlock half (one row per `(workspace, device)`), this is the device's own
 * identity (one row per `(user, application)`, `id` shared across every
 * workspace that device unlocks). It is a Better Auth control-plane row, not a
 * graph node — the `Device` node projection is deferred alongside
 * Workspace/WorkspaceMembership per F189. Carries exactly `VPS-F001`'s nine
 * fields; revocation *time* and *actor* live on `deviceTrustEvent`, not here.
 *
 * `id` is the device-generated identifier (`SealedStore.deviceId()`), the same
 * value `deviceUnlockSecret.deviceId` carries — not a UUID.
 */
export const device = pgTable(
  "device",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    deviceName: text("device_name").notNull(),
    platform: text("platform").notNull(),
    application: text("application").default("VultoRoster").notNull(),
    pushToken: text("push_token"),
    registeredAt: timestamp("registered_at").defaultNow().notNull(),
    lastActiveAt: timestamp("last_active_at").defaultNow().notNull(),
    isRevoked: boolean("is_revoked").default(false).notNull(),
  },
  (table) => [
    index("device_userId_idx").on(table.userId),
    check("device_id_format_check", sql`${table.id} ~ '^[A-Za-z0-9_-]{16,128}$'`),
    check(
      "device_platform_check",
      sql`${table.platform} in ('web', 'ios', 'android', 'macos', 'windows')`,
    ),
    check(
      "device_application_check",
      sql`${table.application} in ('VultoRoster', 'VultoAccounts', 'VultoProjects', 'VultoLegal')`,
    ),
  ],
);

/**
 * FDN-63 Stage 2 — the append-only device/trust audit log. Every registration,
 * trust decision and revocation event lands here. No `UPDATE`/`DELETE` path
 * exists in application code. `workspaceId` is nullable because registration is
 * workspace-agnostic; `actorUserId` is nullable for system/cascade events.
 */
export const deviceTrustEvent = pgTable(
  "device_trust_event",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    deviceId: text("device_id")
      .notNull()
      .references(() => device.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    eventType: text("event_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("device_trust_event_device_created_idx").on(table.deviceId, table.createdAt),
    check(
      "device_trust_event_type_check",
      sql`${table.eventType} in ('registered', 'revoked-explicit', 'revoked-membership', 'retired-by-user', 'stale-flagged', 're-approved')`,
    ),
  ],
);

export const deviceRelations = relations(device, ({ one, many }) => ({
  user: one(user, { fields: [device.userId], references: [user.id] }),
  trustEvents: many(deviceTrustEvent),
}));

export const deviceTrustEventRelations = relations(deviceTrustEvent, ({ one }) => ({
  device: one(device, {
    fields: [deviceTrustEvent.deviceId],
    references: [device.id],
  }),
  user: one(user, { fields: [deviceTrustEvent.userId], references: [user.id] }),
}));

export const deviceUnlockSecretRelations = relations(deviceUnlockSecret, ({ one }) => ({
  organization: one(organization, {
    fields: [deviceUnlockSecret.workspaceId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [deviceUnlockSecret.userId],
    references: [user.id],
  }),
}));

export const rateLimit = pgTable("rate_limit", {
  id: uuid("id")
    .default(sql`pg_catalog.gen_random_uuid()`)
    .primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  members: many(member),
  invitations: many(invitation),
  passkeys: many(passkey),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(member),
  invitations: many(invitation),
}));

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}));

export const passkeyRelations = relations(passkey, ({ one }) => ({
  user: one(user, {
    fields: [passkey.userId],
    references: [user.id],
  }),
}));

/**
 * FDN-51 sync-engine tables.
 *
 * These three tables are written and read **exclusively by `services/sync-engine`**
 * (the Rust relay), which reaches Postgres with `sqlx`. Drizzle owns their DDL
 * only, because the repo has one schema-management story and one migration
 * lineage against the shared database — nothing in TypeScript queries them.
 *
 * `sync_delta` holds the durable, opaque delta log; `sync_workspace_cursor` is
 * the per-workspace locked counter that assigns each delta its delivery cursor
 * at transaction commit (A003-T39); `sync_device_ack` is per-device
 * acknowledgement state with a SQL-level monotonic clamp.
 */

export const syncWorkspaceCursor = pgTable(
  "sync_workspace_cursor",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    lastCursor: bigint("last_cursor", { mode: "bigint" })
      .default(sql`0`)
      .notNull(),
  },
  (table) => [
    check(
      "sync_workspace_cursor_last_cursor_non_negative",
      sql`${table.lastCursor} >= 0`,
    ),
  ],
);

export const syncDelta = pgTable(
  "sync_delta",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    cursor: bigint("cursor", { mode: "bigint" }).notNull(),
    documentId: text("document_id").notNull(),
    tierTag: smallint("tier_tag").notNull(),
    payloadKind: smallint("payload_kind").notNull(),
    originDeviceId: text("origin_device_id").notNull(),
    // `clock_timestamp()`, not `now()`: `now()` is the transaction-start time,
    // which under concurrent appends does not track the order the per-workspace
    // cursor lock is acquired. `clock_timestamp()` is evaluated at insert time,
    // after the `SELECT ... FOR UPDATE`, so committed_at order tracks cursor
    // order (A003-T39).
    committedAt: timestamp("committed_at", { withTimezone: true })
      .default(sql`clock_timestamp()`)
      .notNull(),
    payload: bytea("payload").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.cursor] }),
    index("sync_delta_workspace_document_cursor_idx").on(
      table.workspaceId,
      table.documentId,
      table.cursor,
    ),
    check("sync_delta_cursor_positive", sql`${table.cursor} > 0`),
    check("sync_delta_tier_tag_check", sql`${table.tierTag} in (0, 1)`),
    check("sync_delta_payload_kind_check", sql`${table.payloadKind} in (0, 1)`),
  ],
);

export const syncDeviceAck = pgTable(
  "sync_device_ack",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    ackedCursor: bigint("acked_cursor", { mode: "bigint" })
      .default(sql`0`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.deviceId] }),
    check("sync_device_ack_acked_cursor_non_negative", sql`${table.ackedCursor} >= 0`),
  ],
);

/**
 * FDN-51 Stage 4a — short-lived sync-handshake tickets.
 *
 * The browser holds its Better Auth session only in an httpOnly cookie, so
 * neither the page nor the graph Worker can read the raw `session.token` the
 * relay's `Hello` needs. `POST /sync/ticket` (authenticated by the session
 * cookie, via `requireCurrentWorkspaceSession`) mints a random ticket bound to
 * one `(workspace, device)` with a ~10-minute TTL; the Worker puts it in
 * `Hello`; the relay validates it here instead of a session token.
 *
 * Only the SHA-256 hash of the ticket is stored — the raw ticket is a bearer
 * credential and is never persisted, mirroring how the relay keys on hashes
 * elsewhere. A leaked ticket buys sync for one workspace + one device until
 * `expires_at`, nothing more; the relay's periodic re-authorization (A003-T45)
 * still evicts a revoked device or removed member within one interval.
 *
 * Written by `services/api`, read by `services/sync-engine` (the Rust relay,
 * via `sqlx`). Like the other `sync_*` tables, Drizzle owns the DDL only.
 */
export const syncTicket = pgTable(
  "sync_ticket",
  {
    tokenHash: text("token_hash").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("sync_ticket_workspace_device_idx").on(table.workspaceId, table.deviceId),
    index("sync_ticket_expires_at_idx").on(table.expiresAt),
  ],
);

/**
 * FDN-85 — the single-use, server-signed grant that authorizes the graph
 * Worker's privileged workspace-admission projection command, and nothing
 * else.
 *
 * A brand-new workspace's membership is `pending`, so `requireCurrentWorkspaceSession`
 * refuses it and the graph Worker cannot run an ordinary `mutate`. This
 * grant is the one narrow way in: minted by a cookie-authenticated route
 * only after `createPendingWorkspaceAdmission` has recorded the pending row,
 * bound to exactly one `(workspace, device, membership)`, hash-stored, and
 * consumed on first use. It carries the server half of the device's
 * unlock secret (provisioned here for the founding workspace) so the Worker
 * can open the sealed store for the projection write. It authorizes no other
 * write shape — the projection command it unlocks constructs the five
 * reserved-type records itself and accepts no arbitrary fragment input.
 *
 * The raw grant string is returned to the caller once and never stored;
 * only its SHA-256 hash lands here.
 */
export const workspaceProjectionGrant = pgTable(
  "workspace_projection_grant",
  {
    tokenHash: text("token_hash").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [
    index("workspace_projection_grant_membership_idx").on(table.membershipId),
    index("workspace_projection_grant_expires_at_idx").on(table.expiresAt),
  ],
);
