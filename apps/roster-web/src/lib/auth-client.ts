import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";

export const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3101";

/** FDN-51: the `services/sync-engine` relay WebSocket endpoint. */
export const syncRelayUrl =
  process.env.NEXT_PUBLIC_SYNC_RELAY_URL ?? "ws://localhost:8080/sync";

export const authClient = createAuthClient({
  baseURL: apiOrigin,
  fetchOptions: { credentials: "include" },
  plugins: [passkeyClient()],
});
