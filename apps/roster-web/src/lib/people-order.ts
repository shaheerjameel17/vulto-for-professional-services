/** Transient per-workspace directory order; never persisted or put in a URL. */
const orders = new Map<string, string[]>();
export function rememberPeopleOrder(workspaceId: string, ids: string[]) {
  orders.set(workspaceId, ids);
}
export function peopleOrder(workspaceId: string): readonly string[] {
  return orders.get(workspaceId) ?? [];
}
