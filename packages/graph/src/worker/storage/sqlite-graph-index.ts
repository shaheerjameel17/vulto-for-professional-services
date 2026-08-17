import {
  edgeRecordSchema,
  nodeRecordSchema,
  type EdgeRecord,
  type JsonValue,
  type NodeRecord,
  type NodeType,
} from "@vulto/schema";
import * as SQLite from "wa-sqlite";
import SQLiteESMFactory from "wa-sqlite/dist/wa-sqlite.mjs";
import type { GraphQuery } from "../../query";
import {
  applyGraphBatch,
  validateGraphSnapshot,
  type GraphMaterializationBatch,
  type GraphMaterializationSnapshot,
  type ValidatedGraphSnapshot,
} from "../materialization";
import { canonicalJson } from "./canonical-json";

const CREATE_SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE graph_generation (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    active_generation INTEGER NOT NULL
  );

  INSERT INTO graph_generation (singleton, active_generation) VALUES (1, 0);

  CREATE TABLE node_fragments (
    generation INTEGER NOT NULL,
    node_id TEXT NOT NULL,
    partition_key TEXT NOT NULL,
    source_document_id TEXT NOT NULL,
    node_type TEXT NOT NULL,
    lifecycle_status TEXT NOT NULL,
    is_soft_deleted INTEGER NOT NULL CHECK (is_soft_deleted IN (0, 1)),
    record_json TEXT NOT NULL,
    PRIMARY KEY (generation, node_id, partition_key)
  );

  CREATE INDEX node_fragments_by_type
    ON node_fragments (generation, node_type, lifecycle_status, is_soft_deleted, node_id);
  CREATE INDEX node_fragments_by_source
    ON node_fragments (generation, source_document_id);

  CREATE TABLE graph_edges (
    generation INTEGER NOT NULL,
    edge_id TEXT NOT NULL,
    source_document_id TEXT NOT NULL,
    edge_type TEXT NOT NULL,
    from_node_id TEXT NOT NULL,
    to_node_id TEXT NOT NULL,
    effective_from TEXT,
    effective_to TEXT,
    is_soft_deleted INTEGER NOT NULL CHECK (is_soft_deleted IN (0, 1)),
    record_json TEXT NOT NULL,
    PRIMARY KEY (generation, edge_id)
  );

  CREATE INDEX graph_edges_outgoing
    ON graph_edges (generation, edge_type, from_node_id, effective_from, effective_to, edge_id);
  CREATE INDEX graph_edges_incoming
    ON graph_edges (generation, edge_type, to_node_id, effective_from, effective_to, edge_id);
  CREATE INDEX graph_edges_by_source
    ON graph_edges (generation, source_document_id);

  CREATE UNIQUE INDEX graph_edges_one_open_outgoing
    ON graph_edges (generation, edge_type, from_node_id)
    WHERE effective_to IS NULL
      AND is_soft_deleted = 0
      AND edge_type IN ('managed_by', 'scoped_to_entity');
`;

type Sqlite = ReturnType<typeof SQLite.Factory>;

export interface MaterializedNodeFragment {
  readonly partitionKey: string;
  readonly sourceDocumentId: string;
  readonly record: NodeRecord;
}

export interface MaterializedNode {
  readonly nodeId: string;
  readonly nodeType: NodeType;
  readonly fragments: readonly MaterializedNodeFragment[];
}

export interface MaterializedNeighbor {
  readonly edge: EdgeRecord;
  readonly node: MaterializedNode;
}

export interface MaterializedRecursiveNeighbor extends MaterializedNeighbor {
  readonly depth: number;
}

export type GraphQueryResult =
  | { readonly kind: "node-get"; readonly node: MaterializedNode | null }
  | {
      readonly kind: "node-list";
      readonly nodes: readonly MaterializedNode[];
      readonly nextNodeId: string | null;
    }
  | {
      readonly kind: "edge-neighbors";
      readonly neighbors: readonly MaterializedNeighbor[];
      readonly nextEdgeId: string | null;
    }
  | {
      readonly kind: "recursive-neighbors";
      readonly neighbors: readonly MaterializedRecursiveNeighbor[];
      readonly truncated: boolean;
    };

interface StoredFragmentRow {
  readonly nodeId: string;
  readonly partitionKey: string;
  readonly sourceDocumentId: string;
  readonly record: NodeRecord;
}

interface StoredEdgeRow {
  readonly edge: EdgeRecord;
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new Error("SQLite returned an unsafe integer");
  return parsed;
}

function textValue(value: unknown): string {
  if (typeof value !== "string") throw new Error("SQLite returned a non-text value");
  return value;
}

function canonicalTimestamp(value: string): string {
  return new Date(value).toISOString();
}

function groupFragments(rows: readonly StoredFragmentRow[]): MaterializedNode[] {
  const grouped = new Map<string, MaterializedNodeFragment[]>();
  for (const row of rows) {
    const fragments = grouped.get(row.nodeId) ?? [];
    fragments.push({
      partitionKey: row.partitionKey,
      sourceDocumentId: row.sourceDocumentId,
      record: row.record,
    });
    grouped.set(row.nodeId, fragments);
  }
  return [...grouped.entries()].map(([nodeId, fragments]) => ({
    nodeId,
    nodeType: fragments[0]!.record.node_type,
    fragments,
  }));
}

/**
 * Private raw executor for the disposable read model. This module is not a
 * package export and no production Worker message can invoke `execute`.
 */
export class SQLiteGraphIndex {
  readonly #workspaceId: string;
  #database: number | null = null;
  #snapshot: ValidatedGraphSnapshot = { nodeFragments: [], edges: [] };
  #sqlite: Sqlite | null = null;
  #subscribers = new Set<() => void>();

  constructor(workspaceId: string) {
    if (workspaceId.length === 0) throw new Error("workspaceId must not be empty");
    this.#workspaceId = workspaceId;
  }

  get generation(): Promise<number> {
    return this.#readGeneration();
  }

  async initialize(): Promise<void> {
    if (this.#database !== null) throw new Error("Graph index is already initialized");
    const module = await SQLiteESMFactory();
    this.#sqlite = SQLite.Factory(module);
    this.#database = await this.#sqlite.open_v2(":memory:");
    await this.#sqlite.exec(this.#database, CREATE_SCHEMA);
  }

  async rebuild(snapshot: GraphMaterializationSnapshot): Promise<number> {
    const validated = validateGraphSnapshot(snapshot, this.#workspaceId);
    const generation = await this.#commitGeneration(validated);
    this.#snapshot = validated;
    this.#notify();
    return generation;
  }

  async apply(batch: GraphMaterializationBatch): Promise<number> {
    const validated = applyGraphBatch(this.#snapshot, batch, this.#workspaceId);
    const generation = await this.#commitGeneration(validated);
    this.#snapshot = validated;
    this.#notify();
    return generation;
  }

  subscribe(listener: () => void): () => void {
    this.#subscribers.add(listener);
    return () => this.#subscribers.delete(listener);
  }

  async execute(query: GraphQuery): Promise<GraphQueryResult> {
    switch (query.kind) {
      case "node-get": {
        const nodes = groupFragments(
          await this.#readNodeFragments(
            query.nodeId,
            query.nodeType,
            query.includeSoftDeleted,
          ),
        );
        return { kind: "node-get", node: nodes[0] ?? null };
      }
      case "node-list": {
        const sqlite = this.#requireSqlite();
        const database = this.#requireDatabase();
        const generation = await this.#readGeneration();
        const result = await sqlite.execWithParams(
          database,
          `SELECT DISTINCT node_id
             FROM node_fragments
            WHERE generation = ?
              AND node_type = ?
              AND (? IS NULL OR lifecycle_status = ?)
              AND (? = 1 OR is_soft_deleted = 0)
              AND node_id > ?
            ORDER BY node_id
            LIMIT ?`,
          [
            generation,
            query.nodeType,
            query.lifecycleStatus ?? null,
            query.lifecycleStatus ?? null,
            query.includeSoftDeleted ? 1 : 0,
            query.afterNodeId ?? "",
            query.limit + 1,
          ],
        );
        const ids = result.rows.map((row) => textValue(row[0]));
        const hasNext = ids.length > query.limit;
        const pageIds = ids.slice(0, query.limit);
        const rows = await this.#readNodeFragmentsForIds(
          pageIds,
          query.nodeType,
          query.includeSoftDeleted,
        );
        return {
          kind: "node-list",
          nodes: groupFragments(rows),
          nextNodeId: hasNext ? (pageIds.at(-1) ?? null) : null,
        };
      }
      case "edge-neighbors": {
        const rows = await this.#readNeighborEdges(query);
        const page = rows.slice(0, query.limit);
        const nodeType =
          query.direction === "outgoing" ? query.toNodeType : query.fromNodeType;
        const endpointIds = page.map(({ edge }) =>
          query.direction === "outgoing" ? edge.to_node_id : edge.from_node_id,
        );
        const nodes = new Map(
          groupFragments(
            await this.#readNodeFragmentsForIds(
              endpointIds,
              nodeType,
              query.includeSoftDeleted,
            ),
          ).map((node) => [node.nodeId, node]),
        );
        const neighbors = page.map(({ edge }) => {
          const nodeId =
            query.direction === "outgoing" ? edge.to_node_id : edge.from_node_id;
          const node = nodes.get(nodeId);
          if (node === undefined) {
            throw new Error(
              `Materialized edge ${edge.edge_id} has no visible endpoint`,
            );
          }
          return { edge, node };
        });
        return {
          kind: "edge-neighbors",
          neighbors,
          nextEdgeId:
            rows.length > query.limit ? (neighbors.at(-1)?.edge.edge_id ?? null) : null,
        };
      }
      case "recursive-neighbors": {
        const visited = new Set([query.startNodeId]);
        let frontier = [query.startNodeId];
        const neighbors: MaterializedRecursiveNeighbor[] = [];
        let truncated = false;
        for (
          let depth = 1;
          depth <= query.maxDepth && frontier.length > 0;
          depth += 1
        ) {
          const next: string[] = [];
          for (const startNodeId of frontier) {
            const step = await this.execute({
              ...query,
              kind: "edge-neighbors",
              startNodeId,
              afterEdgeId: undefined,
              limit: 200,
            });
            if (step.kind !== "edge-neighbors")
              throw new Error("Invalid recursion step");
            for (const neighbor of step.neighbors) {
              if (visited.has(neighbor.node.nodeId)) continue;
              visited.add(neighbor.node.nodeId);
              next.push(neighbor.node.nodeId);
              neighbors.push({ ...neighbor, depth });
              if (neighbors.length === query.maxResults) {
                truncated = true;
                return { kind: "recursive-neighbors", neighbors, truncated };
              }
            }
          }
          frontier = next;
        }
        return { kind: "recursive-neighbors", neighbors, truncated };
      }
    }
  }

  async explain(
    query: Extract<GraphQuery, { kind: "edge-neighbors" }>,
  ): Promise<string[]> {
    const sqlite = this.#requireSqlite();
    const database = this.#requireDatabase();
    const generation = await this.#readGeneration();
    const endpoint = query.direction === "outgoing" ? "from_node_id" : "to_node_id";
    const result = await sqlite.execWithParams(
      database,
      `EXPLAIN QUERY PLAN
       SELECT record_json FROM graph_edges INDEXED BY graph_edges_${query.direction}
        WHERE generation = ? AND edge_type = ? AND ${endpoint} = ?
          AND (effective_from IS NULL OR effective_from <= ?)
          AND (effective_to IS NULL OR effective_to > ?)
        ORDER BY edge_id LIMIT ?`,
      [
        generation,
        query.edgeType,
        query.startNodeId,
        canonicalTimestamp(query.asOf),
        canonicalTimestamp(query.asOf),
        query.limit,
      ],
    );
    return result.rows.map((row) => textValue(row[3]));
  }

  canonicalSnapshot(): string {
    const nodes = [...this.#snapshot.nodeFragments]
      .sort((left, right) =>
        `${left.record.node_id}\u0000${left.partitionKey}`.localeCompare(
          `${right.record.node_id}\u0000${right.partitionKey}`,
        ),
      )
      .map(({ sourceDocumentId, partitionKey, record }) => ({
        sourceDocumentId,
        partitionKey,
        record,
      }));
    const edges = [...this.#snapshot.edges]
      .sort((left, right) => left.record.edge_id.localeCompare(right.record.edge_id))
      .map(({ sourceDocumentId, record }) => ({ sourceDocumentId, record }));
    return canonicalJson({ nodes, edges } as unknown as JsonValue);
  }

  async dispose(): Promise<void> {
    if (this.#sqlite !== null && this.#database !== null) {
      await this.#sqlite.close(this.#database);
    }
    this.#database = null;
    this.#sqlite = null;
    this.#snapshot = { nodeFragments: [], edges: [] };
    this.#subscribers.clear();
  }

  async #commitGeneration(snapshot: ValidatedGraphSnapshot): Promise<number> {
    const sqlite = this.#requireSqlite();
    const database = this.#requireDatabase();
    const current = await this.#readGeneration();
    const next = current + 1;
    await sqlite.exec(database, "BEGIN IMMEDIATE");
    try {
      for (const fragment of snapshot.nodeFragments) {
        await sqlite.execWithParams(
          database,
          `INSERT INTO node_fragments
             (generation, node_id, partition_key, source_document_id, node_type,
              lifecycle_status, is_soft_deleted, record_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            next,
            fragment.record.node_id,
            fragment.partitionKey,
            fragment.sourceDocumentId,
            fragment.record.node_type,
            fragment.record.lifecycle_status,
            fragment.record.is_soft_deleted ? 1 : 0,
            canonicalJson(fragment.record as unknown as JsonValue),
          ],
        );
      }
      for (const edge of snapshot.edges) {
        await sqlite.execWithParams(
          database,
          `INSERT INTO graph_edges
             (generation, edge_id, source_document_id, edge_type, from_node_id,
              to_node_id, effective_from, effective_to, is_soft_deleted, record_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            next,
            edge.record.edge_id,
            edge.sourceDocumentId,
            edge.record.edge_type,
            edge.record.from_node_id,
            edge.record.to_node_id,
            edge.record.effective_from === null
              ? null
              : canonicalTimestamp(edge.record.effective_from),
            edge.record.effective_to === null
              ? null
              : canonicalTimestamp(edge.record.effective_to),
            edge.record.is_soft_deleted ? 1 : 0,
            canonicalJson(edge.record as unknown as JsonValue),
          ],
        );
      }
      await sqlite.execWithParams(
        database,
        "UPDATE graph_generation SET active_generation = ? WHERE singleton = 1",
        [next],
      );
      await sqlite.execWithParams(
        database,
        "DELETE FROM node_fragments WHERE generation <> ?",
        [next],
      );
      await sqlite.execWithParams(
        database,
        "DELETE FROM graph_edges WHERE generation <> ?",
        [next],
      );
      await sqlite.exec(database, "COMMIT");
      return next;
    } catch (error) {
      await sqlite.exec(database, "ROLLBACK");
      throw error;
    }
  }

  async #readGeneration(): Promise<number> {
    const result = await this.#requireSqlite().execWithParams(
      this.#requireDatabase(),
      "SELECT active_generation FROM graph_generation WHERE singleton = 1",
    );
    return numberValue(result.rows[0]?.[0]);
  }

  async #readNodeFragments(
    nodeId: string,
    nodeType: NodeType,
    includeSoftDeleted: boolean,
  ): Promise<StoredFragmentRow[]> {
    const generation = await this.#readGeneration();
    const result = await this.#requireSqlite().execWithParams(
      this.#requireDatabase(),
      `SELECT node_id, partition_key, source_document_id, record_json
         FROM node_fragments
        WHERE generation = ? AND node_id = ? AND node_type = ?
          AND (? = 1 OR is_soft_deleted = 0)
        ORDER BY partition_key`,
      [generation, nodeId, nodeType, includeSoftDeleted ? 1 : 0],
    );
    return result.rows.map((row) => ({
      nodeId: textValue(row[0]),
      partitionKey: textValue(row[1]),
      sourceDocumentId: textValue(row[2]),
      record: nodeRecordSchema.parse(JSON.parse(textValue(row[3]))),
    }));
  }

  async #readNeighborEdges(
    query: Extract<GraphQuery, { kind: "edge-neighbors" }>,
  ): Promise<StoredEdgeRow[]> {
    const endpoint = query.direction === "outgoing" ? "from_node_id" : "to_node_id";
    const otherEndpoint =
      query.direction === "outgoing" ? "to_node_id" : "from_node_id";
    const generation = await this.#readGeneration();
    const result = await this.#requireSqlite().execWithParams(
      this.#requireDatabase(),
      `SELECT record_json
         FROM graph_edges INDEXED BY graph_edges_${query.direction}
        WHERE generation = ? AND edge_type = ? AND ${endpoint} = ?
          AND (? = 1 OR is_soft_deleted = 0)
          AND (effective_from IS NULL OR effective_from <= ?)
          AND (effective_to IS NULL OR effective_to > ?)
          AND (? = 1 OR EXISTS (
            SELECT 1
              FROM node_fragments AS endpoint_node
             WHERE endpoint_node.generation = graph_edges.generation
               AND endpoint_node.node_id = graph_edges.${otherEndpoint}
               AND endpoint_node.is_soft_deleted = 0
          ))
          AND edge_id > ?
        ORDER BY edge_id
        LIMIT ?`,
      [
        generation,
        query.edgeType,
        query.startNodeId,
        query.includeSoftDeleted ? 1 : 0,
        canonicalTimestamp(query.asOf),
        canonicalTimestamp(query.asOf),
        query.includeSoftDeleted ? 1 : 0,
        query.afterEdgeId ?? "",
        query.limit + 1,
      ],
    );
    return result.rows.map((row) => ({
      edge: edgeRecordSchema.parse(JSON.parse(textValue(row[0]))),
    }));
  }

  async #readNodeFragmentsForIds(
    nodeIds: readonly string[],
    nodeType: NodeType,
    includeSoftDeleted: boolean,
  ): Promise<StoredFragmentRow[]> {
    if (nodeIds.length === 0) return [];
    const generation = await this.#readGeneration();
    const placeholders = nodeIds.map(() => "?").join(", ");
    const result = await this.#requireSqlite().execWithParams(
      this.#requireDatabase(),
      `SELECT node_id, partition_key, source_document_id, record_json
         FROM node_fragments
        WHERE generation = ? AND node_type = ?
          AND (? = 1 OR is_soft_deleted = 0)
          AND node_id IN (${placeholders})
        ORDER BY node_id, partition_key`,
      [generation, nodeType, includeSoftDeleted ? 1 : 0, ...nodeIds],
    );
    return result.rows.map((row) => ({
      nodeId: textValue(row[0]),
      partitionKey: textValue(row[1]),
      sourceDocumentId: textValue(row[2]),
      record: nodeRecordSchema.parse(JSON.parse(textValue(row[3]))),
    }));
  }

  #notify(): void {
    for (const subscriber of this.#subscribers) subscriber();
  }

  #requireSqlite(): Sqlite {
    if (this.#sqlite === null) throw new Error("Graph index is not initialized");
    return this.#sqlite;
  }

  #requireDatabase(): number {
    if (this.#database === null) throw new Error("Graph index is not initialized");
    return this.#database;
  }
}
