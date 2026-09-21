import type { db } from "../db.js";

/** A Drizzle transaction. Every graph, audit and permission function takes one. */
export type GraphTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
