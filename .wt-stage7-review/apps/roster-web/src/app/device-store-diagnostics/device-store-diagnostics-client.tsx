"use client";

import {
  createUncheckedLocalGraphClient,
  type UncheckedLocalGraphClient,
} from "@vulto/graph/testing/unchecked-mutation";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LockedShellGate } from "../../components/device-store/LockedShellGate";

interface DeviceStoreDiagnosticsApi {
  getStatus(): Promise<{ locked: boolean }>;
  unlock(apiOrigin: string): Promise<void>;
  lock(): Promise<void>;
  seal(storeKey: string, base64Plaintext: string): Promise<void>;
  open(storeKey: string): Promise<string | null>;
}

declare global {
  interface Window {
    __vultoDeviceStoreDiagnostics?: DeviceStoreDiagnosticsApi;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function DeviceStoreDiagnosticsClient() {
  const params = useSearchParams();
  const workspaceId = params.get("workspaceId") ?? "fdn-84-browser-proof";
  const clientRef = useRef<UncheckedLocalGraphClient | null>(null);
  const [client, setClient] = useState<UncheckedLocalGraphClient | null>(null);

  useEffect(() => {
    const created = createUncheckedLocalGraphClient(workspaceId);
    clientRef.current = created;
    setClient(created);
    window.__vultoDeviceStoreDiagnostics = {
      getStatus: () => created.getSealedStoreStatus(),
      unlock: (apiOrigin) => created.unlockSealedStore(apiOrigin),
      lock: () => created.lockSealedStore(),
      seal: (storeKey, base64Plaintext) =>
        created.sealPayload(storeKey, fromBase64(base64Plaintext)),
      open: async (storeKey) => {
        const plaintext = await created.openPayload(storeKey);
        return plaintext ? toBase64(plaintext) : null;
      },
    };
    return () => {
      delete window.__vultoDeviceStoreDiagnostics;
      void created.dispose();
    };
  }, [workspaceId]);

  if (!client) return null;

  return (
    <LockedShellGate workspaceId={workspaceId} client={client}>
      <p data-testid="device-store-unlocked">unlocked</p>
    </LockedShellGate>
  );
}
