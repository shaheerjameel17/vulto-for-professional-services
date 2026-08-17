import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";

export const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3101";

export const authClient = createAuthClient({
  baseURL: apiOrigin,
  fetchOptions: { credentials: "include" },
  plugins: [passkeyClient()],
});
