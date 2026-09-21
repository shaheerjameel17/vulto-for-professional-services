/// <reference lib="webworker" />
import { detach, handleRequest, type HostPort } from "./host";
import type { WorkerRequest } from "./protocol";

/**
 * The worker entry. Loaded as a SharedWorker where the browser has one, and as a
 * dedicated Worker otherwise; the same code serves both.
 */
declare const self: SharedWorkerGlobalScope & DedicatedWorkerGlobalScope;

function serve(
  port: MessagePort | DedicatedWorkerGlobalScope,
  mode: "shared" | "dedicated",
): void {
  const hostPort: HostPort = { postMessage: (message) => port.postMessage(message) };
  port.onmessage = (event: MessageEvent<WorkerRequest>) => {
    void handleRequest(hostPort, event.data, mode).then((response) =>
      port.postMessage(response),
    );
  };
  // A SharedWorker port stays open until the tab is gone; a lost tab is forgotten
  // when its port closes.
  (port as MessagePort).onmessageerror = () => detach(hostPort);
}

if ("onconnect" in self) {
  self.onconnect = (event: MessageEvent) => {
    const port = event.ports[0]!;
    serve(port, "shared");
    port.start();
  };
} else {
  serve(self, "dedicated");
}
