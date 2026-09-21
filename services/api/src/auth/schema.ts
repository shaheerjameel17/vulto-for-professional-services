import { relations, sql } from "drizzle-orm";
import {
  check,
  pgTable,
  primaryKey,
  text,
  bigint,
  timestamp,
  boolean,
  integer,
  uuid,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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
 * A workspace's revocation of one device (F191, F210). An Owner's revoke of a
 * device in one workspace, a membership removal and an account suspension each
 * record one row here; the session path and the shape proxy both refuse a
 * device with a row for the workspace they are acting in. It is a control-plane
 * table: identifiers only, never replicated to a device.
 *
 * Deliberately workspace-scoped: the canonical `device` row spans workspaces, so
 * only the device's own user may revoke it globally (`device.is_revoked`, via
 * `retireOwnDevice`). Deleting the row is what re-approval of a stale device
 * does.
 *
 * Replaces `device_unlock_secret`, whose `revoked_at` was the only place this
 * was recorded; the migration that created this table backfilled it from there.
 */
export const deviceWorkspaceRevocation = pgTable(
  "device_workspace_revocation",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    revokedAt: timestamp("revoked_at").defaultNow().notNull(),
    /** Who revoked it; an identifier, not a reference, so the record outlives the person. */
    revokedBy: uuid("revoked_by"),
    reason: text("reason").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.deviceId] }),
    index("device_workspace_revocation_device_idx").on(table.deviceId),
  ],
);

/**
 * FDN-63 / `VPS-F001` — the canonical Device identity record.
 *
 * This is the device's own identity (one row per `(user, application)`, `id`
 * shared across every workspace the device is used in). It is a Better Auth control-plane row, not a
 * graph node — the `Device` node projection is deferred alongside
 * Workspace/WorkspaceMembership per F189. Carries exactly `VPS-F001`'s nine
 * fields; revocation *time* and *actor* live on `deviceTrustEvent`, not here.
 *
 * `id` is the device-generated identifier — not a UUID.
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
