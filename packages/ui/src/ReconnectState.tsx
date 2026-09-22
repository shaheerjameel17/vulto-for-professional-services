import { Button } from "./Button";
import { Text } from "./Text";

/** VPS-D004's whole-application response to a refused authenticated session. */
export function ReconnectState({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg-canvas px-4 text-center">
      <Text variant="body" className="text-text-primary">
        Reconnect to continue. Vulto needs to verify your session before opening your
        workspace.
      </Text>
      <Button variant="primary" onClick={onRetry}>
        Retry
      </Button>
    </main>
  );
}
