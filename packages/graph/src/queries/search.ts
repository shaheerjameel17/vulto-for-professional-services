import { SEARCHABLE_NODE_TYPES, type SearchableNodeType } from "@vulto/schema";
import type { SyncDatabase } from "../sync-client/database";
import { localEdges, localNodes } from "./cache-data";
import { employeeAvailabilityById } from "./skill-matrix";
import { matchSearchCommands } from "./search-commands";

/**
 * Entirely local. When `skillMatched` is true, the palette separately calls the
 * existing server `skillMatcher.adHocSearch` unmodified. That group arrives
 * after local results and alone degrades to `requires-connection` offline.
 */
export interface SearchEntityMatch {
  readonly nodeType: string;
  readonly nodeId: string;
  readonly label: string;
  readonly secondaryLabel: string | null;
  readonly lifecycleStatus: string;
  readonly isGhost?: boolean;
  readonly availabilityStatus?: "Assigned" | "Available";
  readonly nextRolloffDate?: string | null;
}

const escapedLike = (value: string): string => value.replace(/[\\%_]/g, "\\$&");

const types = SEARCHABLE_NODE_TYPES.map(({ nodeType }) => nodeType);

export async function searchQuery(
  database: SyncDatabase,
  input: { readonly text: string; readonly limit?: number },
): Promise<{
  readonly commandMatches: ReturnType<typeof matchSearchCommands>;
  readonly entityMatches: readonly SearchEntityMatch[];
  readonly skillMatched: boolean;
}> {
  const text = input.text.trim();
  if (text === "") {
    return { commandMatches: [], entityMatches: [], skillMatched: false };
  }
  const commandMatches = matchSearchCommands(text);
  const pattern = escapedLike(text);
  const rows = await database.all(
    `SELECT node_id, node_type, label, lifecycle_status FROM cache_search
     WHERE search_text LIKE '%' || lower(?) || '%' ESCAPE '\\'
     ORDER BY CASE node_type
       WHEN 'Employee' THEN 0 WHEN 'Skill' THEN 1
       WHEN 'Project' THEN 2 WHEN 'Client' THEN 3 ELSE 4 END,
       CASE WHEN lower(label) LIKE lower(?) || '%' ESCAPE '\\' THEN 0
         WHEN search_text LIKE '% ' || lower(?) || '%' ESCAPE '\\' THEN 1
         ELSE 2 END,
       CASE WHEN lifecycle_status = 'Active' THEN 0 ELSE 1 END,
       label COLLATE BINARY, node_id COLLATE BINARY`,
    [pattern, pattern, pattern],
  );
  const skillMatched = rows.some((row) => row["node_type"] === "Skill");
  const limit = Math.max(0, Math.floor(input.limit ?? 8));
  const selected: typeof rows = [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const type = String(row["node_type"]);
    if (!types.includes(type as (typeof types)[number])) continue;
    const count = counts.get(type) ?? 0;
    if (count >= limit) continue;
    selected.push(row);
    counts.set(type, count + 1);
  }
  if (selected.length === 0) {
    return { commandMatches, entityMatches: [], skillMatched };
  }

  const employeeIds = selected
    .filter((row) => row["node_type"] === "Employee")
    .map((row) => String(row["node_id"]));
  const projectIds = selected
    .filter((row) => row["node_type"] === "Project")
    .map((row) => String(row["node_id"]));
  const detailIds = [
    ...employeeIds,
    ...selected
      .filter((row) => row["node_type"] === "Skill")
      .map((row) => String(row["node_id"])),
  ];
  const detailRows = detailIds.length
    ? await database.all(
        `SELECT node_id, record_json FROM cache_nodes WHERE node_id IN (${detailIds.map(() => "?").join(",")})`,
        detailIds,
      )
    : [];
  const records = new Map(
    detailRows.map((row) => [
      String(row["node_id"]),
      JSON.parse(String(row["record_json"])) as Record<string, unknown>,
    ]),
  );
  const availability =
    employeeIds.length > 0
      ? employeeAvailabilityById(
          await localNodes(database, ["Assignment"]),
          new Date().toISOString().slice(0, 10),
        )
      : new Map();
  const projectClients = new Map<string, string>();
  if (projectIds.length > 0) {
    const edges = await localEdges(database, ["belongs_to"]);
    const clients = new Map(
      (await localNodes(database, ["Client"])).map((node) => [node.nodeId, node]),
    );
    for (const edge of edges) {
      if (!projectIds.includes(edge.fromNodeId)) continue;
      if (edge.effectiveTo !== null) continue;
      const name = clients.get(edge.toNodeId)?.record["name"];
      if (typeof name === "string") projectClients.set(edge.fromNodeId, name);
    }
  }

  const entityMatches = selected.map((row): SearchEntityMatch => {
    const nodeType = String(row["node_type"]);
    const nodeId = String(row["node_id"]);
    const label = String(row["label"]);
    const record = records.get(nodeId) ?? {};
    const registration: SearchableNodeType | undefined = SEARCHABLE_NODE_TYPES.find(
      (entry) => entry.nodeType === nodeType,
    );
    const secondaryField = registration?.secondaryField;
    const secondary = secondaryField ? record[secondaryField] : undefined;
    const secondaryLabel =
      nodeType === "Project"
        ? (projectClients.get(nodeId) ?? null)
        : typeof secondary === "string" && secondary !== label
          ? secondary
          : null;
    return {
      nodeType,
      nodeId,
      label,
      secondaryLabel,
      lifecycleStatus: String(row["lifecycle_status"]),
      ...(nodeType === "Employee"
        ? {
            isGhost: record["employee_type"] === "Ghost",
            availabilityStatus:
              availability.get(nodeId)?.availabilityStatus ?? ("Available" as const),
            nextRolloffDate: availability.get(nodeId)?.nextRolloffDate ?? null,
          }
        : {}),
    };
  });
  return { commandMatches, entityMatches, skillMatched };
}
