import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "./env.js";

/**
 * The server-side Postgres connection, per VPS-A001.
 *
 * This is NOT the graph. The canonical graph lives on user devices as Loro
 * documents, per VPS-A003, and Postgres holds the durable copy of snapshots and
 * deltas the sync engine persists, plus the data that sits outside the synced
 * graph. Nothing in this file reads or writes a graph node, and nothing should
 * until FDN-45 registers the schema and FDN-51 gives the sync engine content.
 */
export const sql = postgres(env.DATABASE_URL, { max: 4, onnotice: () => {} });
export const db = drizzle(sql);
