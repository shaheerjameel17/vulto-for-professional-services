import { SealedStore } from "../storage/sealed-store";

const store = new SealedStore();
interface TestWorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  close(): void;
}
const scope = self as unknown as TestWorkerScope;

scope.onmessage = (event: MessageEvent<unknown>) => {
  void (async () => {
    const request = event.data as Record<string, unknown>;
    const requestId = typeof request.requestId === "string" ? request.requestId : null;
    try {
      switch (request.type) {
        case "unlock":
          if (
            typeof request.workspaceId !== "string" ||
            typeof request.apiOrigin !== "string"
          ) {
            throw new Error("Invalid test sealed-store unlock");
          }
          await store.unlockOnline(request.workspaceId, request.apiOrigin);
          scope.postMessage({ requestId, ok: true });
          return;
        case "lock":
          store.lock();
          scope.postMessage({ requestId, ok: true });
          return;
        case "seal":
          if (
            typeof request.storeKey !== "string" ||
            !(request.plaintext instanceof ArrayBuffer)
          ) {
            throw new Error("Invalid test sealed-store write");
          }
          await store.put(request.storeKey, new Uint8Array(request.plaintext));
          scope.postMessage({ requestId, ok: true });
          return;
        case "open": {
          if (typeof request.storeKey !== "string") {
            throw new Error("Invalid test sealed-store read");
          }
          const value = await store.get(request.storeKey);
          const plaintext = value?.slice().buffer ?? null;
          scope.postMessage(
            { requestId, ok: true, plaintext },
            plaintext ? [plaintext] : [],
          );
          return;
        }
        case "dispose":
          store.dispose();
          scope.postMessage({ requestId, ok: true });
          scope.close();
          return;
        default:
          throw new Error("Unsupported test sealed-store request");
      }
    } catch (error) {
      scope.postMessage({
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
};
