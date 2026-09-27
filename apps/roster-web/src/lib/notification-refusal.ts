/** Presentation only: the server still decides whether a read-state write is allowed. */
export const NOTIFICATION_REFUSAL_MESSAGES: Readonly<Record<string, string>> = {
  "not-found": "This item is no longer available",
  role: "You don't have access to do that",
  "write-authority": "This action isn't available in this application",
  "mutation-id-conflict":
    "This action conflicts with an earlier request. Reload and try again",
  "invalid-args": "This action couldn't be understood. Reload and try again",
  "unknown-mutation": "This action isn't available. Reload and try again",
  "constraint-violation": "This action couldn't be saved. Reload and try again",
  "missing-optimistic-mutator":
    "This action isn't available on this device. Reload and try again",
  "stale-state": "This item changed. Reload and try again",
  "target-deleted": "This item is no longer available",
  "requires-connection": "Reconnect to complete this action",
  "access-revoked": "Your workspace access has changed. Reconnect to continue",
  "signed-out": "Sign in again to complete this action",
  "blocked-by-earlier-rejection":
    "An earlier action could not be completed. Resolve it and try again",
  rejected: "That action could not be completed",
};

export function notificationRefusalMessage(reason: string): string {
  return Object.hasOwn(NOTIFICATION_REFUSAL_MESSAGES, reason)
    ? NOTIFICATION_REFUSAL_MESSAGES[reason]!
    : "That action could not be completed";
}
