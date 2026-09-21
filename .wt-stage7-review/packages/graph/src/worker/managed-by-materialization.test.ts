import { LoroDoc, type LoroTree, type LoroTreeNode } from "loro-crdt";
import { describe, expect, it } from "vitest";
import type { EdgeRecord } from "@vulto/schema";
import {
  applyTreeMove,
  BackdatedMoveNotSupportedError,
  createEmployeeTreeNode,
  materializeManagedByEdges,
  ORG_HIERARCHY_TREE,
  TreeMaterializationConflictError,
} from "./managed-by-materialization";
import { validateGraphSnapshot, type NodeFragmentInput } from "./materialization";

/**
 * FDN-50 stage 4. These tests drive real `LoroDoc` instances — including
 * two genuinely separate documents for the concurrency proof, never one
 * document simulating two and never a mocked merge.
 */

const WORKSPACE = "123e4567-e89b-42d3-a456-426614174000";
const ACTOR = "123e4567-e89b-42d3-a456-426614174001";
const EMPLOYEE = "123e4567-e89b-42d3-a456-426614174002";
const MANAGER_A = "123e4567-e89b-42d3-a456-426614174003";
const MANAGER_B = "123e4567-e89b-42d3-a456-426614174004";
const MANAGER_C = "123e4567-e89b-42d3-a456-426614174005";
const RECORDED = "2026-01-05T09:00:00.000Z";

/**
 * The on-document contract, spelled out independently of the implementation
 * constants.
 *
 * Deliberate, and the same technique the stage 3 diagnostics harness uses
 * for the document-meta container: importing the constants would make these
 * tests agree with a rename by construction, and a rename is exactly the
 * change that must not pass silently — it would make every already-persisted
 * document read as "this employee has no dated moves", which materializes as
 * an empty history rather than as an error.
 */
const RAW_TREE = "org_hierarchy";
const RAW_EMPLOYEE_KEY = "employee_node_id";
const RAW_MOVE_PREFIX = "move:";

function record(edge: { record: unknown }): EdgeRecord {
  return edge.record as EdgeRecord;
}

function summarize(edges: readonly { record: unknown }[]): string[] {
  return edges.map((edge) => {
    const value = record(edge);
    return `${value.from_node_id} -> ${value.to_node_id} [${String(value.effective_from)}, ${String(value.effective_to)})`;
  });
}

function employeeFragment(id: string): NodeFragmentInput {
  return {
    sourceDocumentId: `employee-${id}`,
    partitionKey: "operational",
    record: {
      node_id: id,
      workspace_id: WORKSPACE,
      node_type: "Employee",
      schema_version: 1,
      lifecycle_status: "Active",
      created_at: RECORDED,
      created_by: ACTOR,
      updated_at: RECORDED,
      updated_by: ACTOR,
      is_soft_deleted: false,
      soft_deleted_at: null,
      soft_deleted_by: null,
      display_name: `Employee ${id}`,
    },
  };
}

/** A seed document: three managers as roots, and the employee unplaced. */
function seedDocument(): Uint8Array {
  const doc = new LoroDoc();
  doc.setPeerId(1n);
  const tree = doc.getTree(ORG_HIERARCHY_TREE);
  createEmployeeTreeNode(tree, MANAGER_A, undefined, undefined);
  createEmployeeTreeNode(tree, MANAGER_B, undefined, undefined);
  createEmployeeTreeNode(tree, MANAGER_C, undefined, undefined);
  createEmployeeTreeNode(tree, EMPLOYEE, undefined, undefined);
  doc.commit();
  const bytes = doc.export({ mode: "snapshot" });
  doc.free();
  return bytes;
}

function nodeFor(tree: LoroTree, employeeId: string): LoroTreeNode {
  const found = tree
    .nodes()
    .find((node) => node.data.get(RAW_EMPLOYEE_KEY) === employeeId);
  if (found === undefined) throw new Error(`No tree node for ${employeeId}`);
  return found;
}

function device(peer: bigint, seed: Uint8Array): LoroDoc {
  const doc = new LoroDoc();
  doc.setPeerId(peer);
  doc.import(seed);
  return doc;
}

describe("managed_by materialization from the Movable Tree", () => {
  it("materializes one close-plus-open pair per move, with half-open intervals", async () => {
    const doc = new LoroDoc();
    doc.setPeerId(1n);
    const tree = doc.getTree(ORG_HIERARCHY_TREE);
    const managerA = createEmployeeTreeNode(tree, MANAGER_A, undefined, undefined);
    const managerB = createEmployeeTreeNode(tree, MANAGER_B, undefined, undefined);
    const employee = createEmployeeTreeNode(tree, EMPLOYEE, managerA, {
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      recordedAt: RECORDED,
      movedBy: ACTOR,
    });
    doc.commit();
    applyTreeMove(employee, managerB, {
      employeeNodeId: EMPLOYEE,
      effectiveFrom: "2026-03-01T00:00:00.000Z",
      recordedAt: "2026-02-20T11:00:00.000Z",
      movedBy: ACTOR,
    });
    doc.commit();

    const { edges } = await materializeManagedByEdges(doc);

    // Gate the materializer's output on materialization.ts's OWN untouched
    // single-active-outgoing validator before asserting anything about the
    // shape here: it rejects overlapping intervals for one source, so a
    // materializer that opened a new edge without closing the prior one
    // fails on the generic policy rather than only on this file's
    // expectations.
    const validated = validateGraphSnapshot(
      {
        nodeFragments: [MANAGER_A, MANAGER_B, EMPLOYEE].map(employeeFragment),
        edges: [...edges],
      },
      WORKSPACE,
    );
    expect(validated.edges).toHaveLength(2);

    expect(summarize(edges)).toEqual([
      `${EMPLOYEE} -> ${MANAGER_A} [2026-01-01T00:00:00.000Z, 2026-03-01T00:00:00.000Z)`,
      `${EMPLOYEE} -> ${MANAGER_B} [2026-03-01T00:00:00.000Z, null)`,
    ]);

    // The close half of the pair is not merely present, it is the exact
    // boundary the open half starts at — `[effective_from, effective_to)`.
    expect(record(edges[0]!).effective_to).toBe(record(edges[1]!).effective_from);
    expect(record(edges[1]!).effective_to).toBeNull();

    // Every timestamp is a value that replicated with the move. `created_at`
    // is the authoring device's recorded clock, not a clock read here.
    expect(record(edges[0]!).created_at).toBe(RECORDED);
    expect(record(edges[1]!).created_at).toBe("2026-02-20T11:00:00.000Z");
    doc.free();
  });

  it("reads the on-disk move-record contract written with raw literal keys", async () => {
    const doc = new LoroDoc();
    doc.setPeerId(1n);
    const tree = doc.getTree(RAW_TREE);
    const manager = tree.createNode();
    manager.data.set(RAW_EMPLOYEE_KEY, MANAGER_A);
    const employee = tree.createNode();
    employee.data.set(RAW_EMPLOYEE_KEY, EMPLOYEE);
    employee.move(manager);
    const opId = employee.getLastMoveId()!;
    employee.data.set(`${RAW_MOVE_PREFIX}${opId.peer}:${opId.counter}`, {
      manager_employee_node_id: MANAGER_A,
      effective_from: "2026-02-01T00:00:00.000Z",
      recorded_at: RECORDED,
      moved_by: ACTOR,
    });
    doc.commit();

    const { edges } = await materializeManagedByEdges(doc);
    expect(summarize(edges)).toEqual([
      `${EMPLOYEE} -> ${MANAGER_A} [2026-02-01T00:00:00.000Z, null)`,
    ]);
    doc.free();
  });

  it("converges on one identical edge history from two offline devices, in either merge order", async () => {
    const seed = seedDocument();
    const deviceA = device(21n, seed);
    const deviceB = device(22n, seed);

    // Device A, offline: employee -> MANAGER_A, effective March.
    const treeA = deviceA.getTree(ORG_HIERARCHY_TREE);
    const moveA = applyTreeMove(nodeFor(treeA, EMPLOYEE), nodeFor(treeA, MANAGER_A), {
      employeeNodeId: EMPLOYEE,
      effectiveFrom: "2026-03-01T00:00:00.000Z",
      recordedAt: "2026-02-20T08:00:00.000Z",
      movedBy: ACTOR,
    });
    deviceA.commit();

    // Device B, offline: the SAME employee -> MANAGER_B, effective April.
    const treeB = deviceB.getTree(ORG_HIERARCHY_TREE);
    const moveB = applyTreeMove(nodeFor(treeB, EMPLOYEE), nodeFor(treeB, MANAGER_B), {
      employeeNodeId: EMPLOYEE,
      effectiveFrom: "2026-04-01T00:00:00.000Z",
      recordedAt: "2026-03-25T08:00:00.000Z",
      movedBy: ACTOR,
    });
    deviceB.commit();

    const bytesA = deviceA.export({ mode: "snapshot" });
    const bytesB = deviceB.export({ mode: "snapshot" });

    // Merge into each device, in opposite orders. No cycle, no error.
    deviceA.import(bytesB);
    deviceB.import(bytesA);

    // The premise of this whole proof: the two moves carry the SAME Lamport
    // value, so Lamport alone cannot pick a winner and the peer identifier
    // is what decides. Derived here from `getChangeAt` independently of the
    // implementation — a change is a run of ops sharing one starting Lamport,
    // so the op's own value is change.lamport + (counter - change.counter).
    // If a future Loro release stopped producing this tie, this assertion
    // fails and tells us the proof's premise changed, rather than the tie
    // -break silently going untested.
    const lamportOf = (id: { peer: `${number}`; counter: number }): number => {
      const change = deviceA.getChangeAt(id);
      return change.lamport + (id.counter - change.counter);
    };
    expect(lamportOf(moveA)).toBe(lamportOf(moveB));
    expect(deviceA.cmpFrontiers([moveA], [moveB])).toBeUndefined();

    const historyA = await materializeManagedByEdges(deviceA);
    const historyB = await materializeManagedByEdges(deviceB);

    // 2. One deterministic winner, agreed by both documents.
    expect(nodeFor(deviceA.getTree(ORG_HIERARCHY_TREE), EMPLOYEE).parent()?.id).toBe(
      nodeFor(deviceB.getTree(ORG_HIERARCHY_TREE), EMPLOYEE).parent()?.id,
    );

    // 3. Identical edge history — same intervals, same target, same ids —
    // regardless of merge order.
    expect(JSON.stringify(historyA.edges)).toBe(JSON.stringify(historyB.edges));

    // 4. The losing move never materializes as its own active period. Peer
    // 22 wins the (lamport, peer) tie-break, so MANAGER_B is the only
    // manager in the history and MANAGER_A appears nowhere.
    expect(summarize(historyA.edges)).toEqual([
      `${EMPLOYEE} -> ${MANAGER_B} [2026-04-01T00:00:00.000Z, null)`,
    ]);
    expect(JSON.stringify(historyA.edges)).not.toContain(MANAGER_A);

    deviceA.free();
    deviceB.free();
  });

  it("breaks the (lamport, peer) tie numerically, not lexicographically", async () => {
    // Peers 9 and 10 disagree between numeric and string order:
    // ["9","10"].sort() puts "10" first. Loro resolves the Tree numerically,
    // so peer 10 must win. An implementation comparing peers as strings picks
    // peer 9 and then disagrees with the Tree it is supposed to be
    // materializing.
    const seed = seedDocument();
    const nine = device(9n, seed);
    const ten = device(10n, seed);

    const treeNine = nine.getTree(ORG_HIERARCHY_TREE);
    applyTreeMove(nodeFor(treeNine, EMPLOYEE), nodeFor(treeNine, MANAGER_A), {
      employeeNodeId: EMPLOYEE,
      effectiveFrom: "2026-03-01T00:00:00.000Z",
      recordedAt: RECORDED,
      movedBy: ACTOR,
    });
    nine.commit();

    const treeTen = ten.getTree(ORG_HIERARCHY_TREE);
    applyTreeMove(nodeFor(treeTen, EMPLOYEE), nodeFor(treeTen, MANAGER_C), {
      employeeNodeId: EMPLOYEE,
      effectiveFrom: "2026-05-01T00:00:00.000Z",
      recordedAt: RECORDED,
      movedBy: ACTOR,
    });
    ten.commit();

    nine.import(ten.export({ mode: "snapshot" }));
    const { edges } = await materializeManagedByEdges(nine);
    expect(summarize(edges)).toEqual([
      `${EMPLOYEE} -> ${MANAGER_C} [2026-05-01T00:00:00.000Z, null)`,
    ]);

    nine.free();
    ten.free();
  });

  it("keeps a causal predecessor while eliminating a concurrent loser", async () => {
    const seed = seedDocument();
    const deviceA = device(21n, seed);
    const treeA = deviceA.getTree(ORG_HIERARCHY_TREE);
    applyTreeMove(nodeFor(treeA, EMPLOYEE), nodeFor(treeA, MANAGER_A), {
      employeeNodeId: EMPLOYEE,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      recordedAt: RECORDED,
      movedBy: ACTOR,
    });
    deviceA.commit();
    const placed = deviceA.export({ mode: "snapshot" });

    // Both devices now agree the employee reports to MANAGER_A. They then
    // move concurrently: A -> MANAGER_B, B -> MANAGER_C.
    const deviceB = device(22n, placed);
    applyTreeMove(nodeFor(treeA, EMPLOYEE), nodeFor(treeA, MANAGER_B), {
      employeeNodeId: EMPLOYEE,
      effectiveFrom: "2026-06-01T00:00:00.000Z",
      recordedAt: RECORDED,
      movedBy: ACTOR,
    });
    deviceA.commit();
    const treeB = deviceB.getTree(ORG_HIERARCHY_TREE);
    applyTreeMove(nodeFor(treeB, EMPLOYEE), nodeFor(treeB, MANAGER_C), {
      employeeNodeId: EMPLOYEE,
      effectiveFrom: "2026-07-01T00:00:00.000Z",
      recordedAt: RECORDED,
      movedBy: ACTOR,
    });
    deviceB.commit();

    const bytesA = deviceA.export({ mode: "snapshot" });
    const bytesB = deviceB.export({ mode: "snapshot" });
    deviceA.import(bytesB);
    deviceB.import(bytesA);

    const historyA = await materializeManagedByEdges(deviceA);
    const historyB = await materializeManagedByEdges(deviceB);
    expect(JSON.stringify(historyA.edges)).toBe(JSON.stringify(historyB.edges));

    // The first move is a causal ancestor of both later moves: it is real
    // history and survives. The concurrent loser (MANAGER_B, peer 21) does
    // not appear at all.
    expect(summarize(historyA.edges)).toEqual([
      `${EMPLOYEE} -> ${MANAGER_A} [2026-01-01T00:00:00.000Z, 2026-07-01T00:00:00.000Z)`,
      `${EMPLOYEE} -> ${MANAGER_C} [2026-07-01T00:00:00.000Z, null)`,
    ]);
    expect(JSON.stringify(historyA.edges)).not.toContain(MANAGER_B);

    deviceA.free();
    deviceB.free();
  });

  it("refuses a backdated move rather than rewriting history (F125)", async () => {
    const doc = new LoroDoc();
    doc.setPeerId(1n);
    const tree = doc.getTree(ORG_HIERARCHY_TREE);
    const managerA = createEmployeeTreeNode(tree, MANAGER_A, undefined, undefined);
    const managerB = createEmployeeTreeNode(tree, MANAGER_B, undefined, undefined);
    const employee = createEmployeeTreeNode(tree, EMPLOYEE, managerA, {
      effectiveFrom: "2026-05-01T00:00:00.000Z",
      recordedAt: RECORDED,
      movedBy: ACTOR,
    });
    doc.commit();
    applyTreeMove(employee, managerB, {
      employeeNodeId: EMPLOYEE,
      effectiveFrom: "2026-02-01T00:00:00.000Z",
      recordedAt: RECORDED,
      movedBy: ACTOR,
    });
    doc.commit();

    await expect(materializeManagedByEdges(doc)).rejects.toBeInstanceOf(
      BackdatedMoveNotSupportedError,
    );
    await expect(materializeManagedByEdges(doc)).rejects.toThrow(/F125/);
    doc.free();
  });

  it("refuses a move effective at the same instant as the one it replaces", async () => {
    const doc = new LoroDoc();
    doc.setPeerId(1n);
    const tree = doc.getTree(ORG_HIERARCHY_TREE);
    const managerA = createEmployeeTreeNode(tree, MANAGER_A, undefined, undefined);
    const managerB = createEmployeeTreeNode(tree, MANAGER_B, undefined, undefined);
    const employee = createEmployeeTreeNode(tree, EMPLOYEE, managerA, {
      effectiveFrom: "2026-05-01T00:00:00.000Z",
      recordedAt: RECORDED,
      movedBy: ACTOR,
    });
    doc.commit();
    applyTreeMove(employee, managerB, {
      employeeNodeId: EMPLOYEE,
      effectiveFrom: "2026-05-01T00:00:00.000Z",
      recordedAt: RECORDED,
      movedBy: ACTOR,
    });
    doc.commit();

    // A zero-length interval would otherwise be produced, which
    // edgeRecordSchema rejects anyway — refused here with the reason.
    await expect(materializeManagedByEdges(doc)).rejects.toBeInstanceOf(
      BackdatedMoveNotSupportedError,
    );
    doc.free();
  });

  it("refuses a Tree placement carrying no effective date", async () => {
    const doc = new LoroDoc();
    doc.setPeerId(1n);
    const tree = doc.getTree(ORG_HIERARCHY_TREE);
    const manager = tree.createNode();
    manager.data.set(RAW_EMPLOYEE_KEY, MANAGER_A);
    const employee = tree.createNode();
    employee.data.set(RAW_EMPLOYEE_KEY, EMPLOYEE);
    employee.move(manager);
    doc.commit();

    await expect(materializeManagedByEdges(doc)).rejects.toBeInstanceOf(
      TreeMaterializationConflictError,
    );
    doc.free();
  });

  it("refuses a move record whose manager disagrees with the Tree's resolved parent", async () => {
    const doc = new LoroDoc();
    doc.setPeerId(1n);
    const tree = doc.getTree(RAW_TREE);
    const managerA = tree.createNode();
    managerA.data.set(RAW_EMPLOYEE_KEY, MANAGER_A);
    const managerB = tree.createNode();
    managerB.data.set(RAW_EMPLOYEE_KEY, MANAGER_B);
    const employee = tree.createNode();
    employee.data.set(RAW_EMPLOYEE_KEY, EMPLOYEE);
    employee.move(managerA);
    const opId = employee.getLastMoveId()!;
    // Records MANAGER_B while the Tree resolved to MANAGER_A. The Tree is
    // authoritative, so this is a refusal rather than a silent preference.
    employee.data.set(`${RAW_MOVE_PREFIX}${opId.peer}:${opId.counter}`, {
      manager_employee_node_id: MANAGER_B,
      effective_from: "2026-02-01T00:00:00.000Z",
      recorded_at: RECORDED,
      moved_by: ACTOR,
    });
    doc.commit();

    await expect(materializeManagedByEdges(doc)).rejects.toBeInstanceOf(
      TreeMaterializationConflictError,
    );
    doc.free();
  });

  it("closes the final interval without opening one when an employee moves to no manager", async () => {
    const doc = new LoroDoc();
    doc.setPeerId(1n);
    const tree = doc.getTree(ORG_HIERARCHY_TREE);
    const managerA = createEmployeeTreeNode(tree, MANAGER_A, undefined, undefined);
    const employee = createEmployeeTreeNode(tree, EMPLOYEE, managerA, {
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      recordedAt: RECORDED,
      movedBy: ACTOR,
    });
    doc.commit();
    applyTreeMove(employee, undefined, {
      employeeNodeId: EMPLOYEE,
      effectiveFrom: "2026-09-01T00:00:00.000Z",
      recordedAt: RECORDED,
      movedBy: ACTOR,
    });
    doc.commit();

    const { edges } = await materializeManagedByEdges(doc);
    expect(summarize(edges)).toEqual([
      `${EMPLOYEE} -> ${MANAGER_A} [2026-01-01T00:00:00.000Z, 2026-09-01T00:00:00.000Z)`,
    ]);
    doc.free();
  });

  it("produces edge ids that are a pure function of replicated data", async () => {
    const build = (): LoroDoc => {
      const doc = new LoroDoc();
      doc.setPeerId(1n);
      const tree = doc.getTree(ORG_HIERARCHY_TREE);
      const managerA = createEmployeeTreeNode(tree, MANAGER_A, undefined, undefined);
      createEmployeeTreeNode(tree, EMPLOYEE, managerA, {
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        recordedAt: RECORDED,
        movedBy: ACTOR,
      });
      doc.commit();
      return doc;
    };
    const first = build();
    const second = build();
    const a = await materializeManagedByEdges(first);
    const b = await materializeManagedByEdges(second);
    expect(record(a.edges[0]!).edge_id).toBe(record(b.edges[0]!).edge_id);
    // Re-materializing the same document is stable, not merely equal once.
    const again = await materializeManagedByEdges(first);
    expect(record(again.edges[0]!).edge_id).toBe(record(a.edges[0]!).edge_id);
    first.free();
    second.free();
  });
});
