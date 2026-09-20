/** Server-safe entrypoint for the suite's one permission evaluator. */
export {
  resolvePermissionDecision,
  type PermissionDecision,
} from "./worker/permission/policy-table";
