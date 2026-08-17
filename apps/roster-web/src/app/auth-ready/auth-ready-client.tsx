"use client";

import { Button, InlineAlert, Text } from "@vulto/ui";
import { useRouter } from "next/navigation";
import { authClient } from "../../lib/auth-client";

export function AuthReadyClient() {
  const router = useRouter();
  const { data, isPending } = authClient.useSession();

  async function signOut() {
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  if (isPending) {
    return <Text variant="body">Checking your session…</Text>;
  }

  if (!data) {
    return (
      <InlineAlert
        tone="danger"
        action={<Button onClick={() => router.push("/sign-in")}>Sign in</Button>}
      >
        Your session is not available.
      </InlineAlert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <InlineAlert tone="success">
        Session restored from the server-backed cookie.
      </InlineAlert>
      <div>
        <Text variant="h3" className="text-text-primary">
          {data.user.name}
        </Text>
        <Text variant="body" className="text-text-secondary">
          {data.user.email}
        </Text>
      </div>
      <Text variant="small" className="text-text-secondary">
        No bearer token is exposed to application JavaScript. Workspace access remains
        closed until the server confirms the membership projection.
      </Text>
      <Button variant="secondary" onClick={signOut}>
        Sign out
      </Button>
    </div>
  );
}
