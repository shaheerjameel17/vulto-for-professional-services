#!/usr/bin/env node
// Sets the `vulto_electric` role's password from ELECTRIC_DB_PASSWORD, after the
// migration that creates the role. No secret lives in a migration. With no
// password set the role cannot log in, so Electric cannot connect — which is the
// safe state — and this says so instead of failing.
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
try {
  process.loadEnvFile(`${repoRoot}.env`);
} catch {
  // CI and containers provide the environment directly.
}

const url = process.env.DATABASE_URL;
const password = process.env.ELECTRIC_DB_PASSWORD;
if (!url) throw new Error("DATABASE_URL is required");
if (!password) {
  process.stdout.write(
    "ELECTRIC_DB_PASSWORD is not set; vulto_electric cannot log in yet\n",
  );
  process.exit(0);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  const literal = `'${password.replaceAll("'", "''")}'`;
  await sql.unsafe(`ALTER ROLE vulto_electric PASSWORD ${literal}`);
  process.stdout.write("vulto_electric password set\n");
} finally {
  await sql.end();
}
