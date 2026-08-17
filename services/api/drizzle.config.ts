import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
try {
  process.loadEnvFile(`${repoRoot}.env`);
} catch {
  // CI and containers provide the environment directly.
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for Drizzle migrations");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/auth/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: databaseUrl },
});
