/**
 * FDN-51 Stage 2b — prepare the database for `tests/relay_pg.rs`.
 *
 * Mirrors `browser-setup-worker.ts`: create a dedicated database, run the
 * Drizzle migrations (so `session` / `member` / `organization` /
 * `device_unlock_secret` and the `sync_*` tables exist), and truncate. The
 * Rust tests then run inside the pinned container via
 * `services/sync-engine/scripts/pg-tests.sh`.
 */

import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const databaseName = "vulto_fdn51_sync";
const adminUrl =
  process.env.SYNC_ENGINE_ADMIN_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/postgres";
const databaseUrl =
  process.env.SYNC_ENGINE_TEST_DATABASE_URL ??
  `postgres://vulto:vulto@localhost:5432/${databaseName}`;

const admin = postgres(adminUrl, { max: 1, connect_timeout: 10 });
const [existing] = await admin<{ exists: number }[]>`
  select 1 as exists from pg_database where datname = ${databaseName}
`;
if (!existing) await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
await admin.end();

const client = postgres(databaseUrl, {
  max: 1,
  connect_timeout: 10,
  onnotice: () => {},
});
await migrate(drizzle(client), {
  migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
});
await client.unsafe(`
  TRUNCATE TABLE
    "sync_delta", "sync_device_ack", "sync_workspace_cursor", "sync_ticket",
    "device_unlock_secret", "passkey_registration_context", "passkey",
    "invitation", "member", "organization", "session", "account",
    "verification", "user", "rate_limit"
  RESTART IDENTITY CASCADE
`);
await client.end();

console.log("FDN-51 sync-engine test database migrated and truncated.");
