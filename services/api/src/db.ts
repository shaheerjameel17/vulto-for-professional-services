import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as authSchema from "./auth/schema.js";
import * as graphSchema from "./graph/schema.js";
import { env } from "./env.js";

/**
 * The server-side Postgres connection, per VPS-A001.
 *
 * Postgres is the single source of truth (VPS-A003, F199). The graph tables are
 * declared in `graph/schema.ts` and are read and written only through
 * `graph/store.ts`, whose importers `pnpm arch:check` restricts.
 */
export const sql = postgres(env.DATABASE_URL, { max: 4, onnotice: () => {} });
export const db = drizzle(sql, { schema: { ...authSchema, ...graphSchema } });

export async function closeDatabase(): Promise<void> {
  await sql.end();
}
