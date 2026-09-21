import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { openSyncDatabase, type SyncDatabase } from "./database";

const require = createRequire(import.meta.url);

/** An in-memory cache database for tests, loading the WASM from disk. */
export function openTestDatabase(): Promise<SyncDatabase> {
  const wasm = readFileSync(require.resolve("wa-sqlite/dist/wa-sqlite-async.wasm"));
  return openSyncDatabase({ kind: "memory" }, { wasmBinary: wasm });
}
