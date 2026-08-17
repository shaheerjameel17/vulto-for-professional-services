import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const databaseName = "vulto_fdn84_browser";
const adminUrl =
  process.env.FDN84_ADMIN_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/postgres";
const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  `postgres://vulto:vulto@localhost:5432/${databaseName}`;
const certificateDirectory = "/tmp/vulto-fdn84-browser";
const certificatePath = `${certificateDirectory}/cert.pem`;
const keyPath = `${certificateDirectory}/key.pem`;

const admin = postgres(adminUrl, { max: 1 });
const [existing] = await admin<{ exists: number }[]>`
  select 1 as exists from pg_database where datname = ${databaseName}
`;
if (!existing) await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
await admin.end();

const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
await migrate(drizzle(client), {
  migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
});
await client.unsafe(`
  TRUNCATE TABLE
    "device_unlock_secret", "passkey_registration_context", "passkey",
    "invitation", "member", "organization", "session", "account",
    "verification", "user", "rate_limit"
  RESTART IDENTITY CASCADE
`);
await client.end();

mkdirSync(certificateDirectory, { recursive: true });
if (!existsSync(certificatePath) || !existsSync(keyPath)) {
  execFileSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    keyPath,
    "-out",
    certificatePath,
    "-days",
    "7",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ]);
}

console.log("FDN-84 browser database migrated and local TLS material ready.");
