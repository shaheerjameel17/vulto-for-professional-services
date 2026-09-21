import type { UndoEntry } from "../mutators/cache";
import type { SyncDatabase } from "./database";

/**
 * The durable queue of named mutations (A003-T63, T64). Rows are appended in the
 * same transaction as the optimistic change they belong to, uploaded in `seq`
 * order, and removed only when the server answers `applied` or `duplicate`.
 * A rejected mutation stays, marked with its reason, so it is never silently
 * dropped.
 */
export type OutboxStatus = "pending" | "inflight" | "rejected";

export interface OutboxRow {
  readonly seq: number;
  readonly mutationId: string;
  readonly name: string;
  readonly args: unknown;
  readonly undo: UndoEntry[];
  readonly status: OutboxStatus;
  readonly reason: string | null;
  readonly createdAt: string;
}

const toRow = (row: Record<string, string | number | null>): OutboxRow => ({
  seq: Number(row["seq"]),
  mutationId: String(row["mutation_id"]),
  name: String(row["name"]),
  args: JSON.parse(String(row["args_json"])),
  undo: JSON.parse(String(row["undo_json"])) as UndoEntry[],
  status: row["status"] as OutboxStatus,
  reason: (row["reason"] as string | null) ?? null,
  createdAt: String(row["created_at"]),
});

/** Retry delay after `failures` consecutive network failures: 1 s doubling to 60 s. */
export function backoffDelayMs(failures: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.max(0, failures - 1));
}

export class Outbox {
  constructor(private readonly database: SyncDatabase) {}

  async append(entry: {
    mutationId: string;
    name: string;
    args: unknown;
    undo: UndoEntry[];
    createdAt: string;
  }): Promise<void> {
    await this.database.run(
      `INSERT INTO outbox (mutation_id, name, args_json, undo_json, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
      [
        entry.mutationId,
        entry.name,
        JSON.stringify(entry.args),
        JSON.stringify(entry.undo),
        entry.createdAt,
      ],
    );
  }

  /** The oldest `limit` rows still waiting, in upload order. */
  async nextPending(limit: number): Promise<OutboxRow[]> {
    const rows = await this.database.all(
      "SELECT * FROM outbox WHERE status = 'pending' ORDER BY seq LIMIT ?",
      [limit],
    );
    return rows.map(toRow);
  }

  async get(mutationId: string): Promise<OutboxRow | undefined> {
    const [row] = await this.database.all(
      "SELECT * FROM outbox WHERE mutation_id = ?",
      [mutationId],
    );
    return row ? toRow(row) : undefined;
  }

  async markInflight(mutationIds: readonly string[]): Promise<void> {
    for (const id of mutationIds) {
      await this.database.run(
        "UPDATE outbox SET status = 'inflight' WHERE mutation_id = ?",
        [id],
      );
    }
  }

  /** After a restart or a failed upload, whatever was in flight is simply waiting again. */
  async requeueInflight(): Promise<void> {
    await this.database.run(
      "UPDATE outbox SET status = 'pending' WHERE status = 'inflight'",
    );
  }

  async remove(mutationId: string): Promise<void> {
    await this.database.run("DELETE FROM outbox WHERE mutation_id = ?", [mutationId]);
  }

  async reject(mutationId: string, reason: string): Promise<void> {
    await this.database.run(
      "UPDATE outbox SET status = 'rejected', reason = ? WHERE mutation_id = ?",
      [reason, mutationId],
    );
  }

  async requeue(mutationId: string): Promise<void> {
    await this.database.run(
      "UPDATE outbox SET status = 'pending', reason = NULL WHERE mutation_id = ?",
      [mutationId],
    );
  }

  async counts(): Promise<{ pending: number; rejected: number }> {
    const [row] = await this.database.all(
      `SELECT SUM(CASE WHEN status IN ('pending','inflight') THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected FROM outbox`,
    );
    return {
      pending: Number(row?.["pending"] ?? 0),
      rejected: Number(row?.["rejected"] ?? 0),
    };
  }

  async rejected(): Promise<OutboxRow[]> {
    return (
      await this.database.all(
        "SELECT * FROM outbox WHERE status = 'rejected' ORDER BY seq",
      )
    ).map(toRow);
  }
}
