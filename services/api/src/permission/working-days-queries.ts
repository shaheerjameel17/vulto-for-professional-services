import type { NodeType } from "@vulto/schema";
import {
  addWorkingDays as addWorkingDaysFromGraph,
  countWorkingDays as countWorkingDaysFromGraph,
  hoursOn as hoursOnFromGraph,
  nextWorkingDay as nextWorkingDayFromGraph,
  type WorkingDaysReadGuard,
} from "../graph/working-days.js";
import type { GraphTx } from "../graph/tx.js";
import { authorizeRead } from "./interceptor.js";
import type { Principal } from "./principal.js";

function readGuard(tx: GraphTx, principal: Principal): WorkingDaysReadGuard {
  return async (node) => {
    const decision = await authorizeRead(tx, principal, {
      workspaceId: principal.workspaceId,
      nodeType: node.nodeType as NodeType,
      nodeId: node.nodeId,
    });
    return decision.access === "read" || decision.access === "full";
  };
}

export const hoursOn = (
  tx: GraphTx,
  principal: Principal,
  employeeId: string,
  date: string,
) => hoursOnFromGraph(tx, principal.workspaceId, employeeId, date, readGuard(tx, principal));

export const countWorkingDays = (
  tx: GraphTx,
  principal: Principal,
  employeeId: string,
  from: string,
  to: string,
) => countWorkingDaysFromGraph(tx, principal.workspaceId, employeeId, from, to, readGuard(tx, principal));

export const nextWorkingDay = (
  tx: GraphTx,
  principal: Principal,
  employeeId: string,
  from: string,
  n: number,
) => nextWorkingDayFromGraph(tx, principal.workspaceId, employeeId, from, n, readGuard(tx, principal));

export const addWorkingDays = (
  tx: GraphTx,
  principal: Principal,
  employeeId: string,
  from: string,
  n: number,
) => addWorkingDaysFromGraph(tx, principal.workspaceId, employeeId, from, n, readGuard(tx, principal));
