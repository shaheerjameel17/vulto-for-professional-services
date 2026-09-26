import { AsyncLocalStorage } from "node:async_hooks";

const writes = new AsyncLocalStorage<Set<string> | undefined>();

export const currentWriteScope = (): Set<string> | undefined => writes.getStore();

/** No logging outside a delivery scope; rolled-back ids are harmless on drain. */
export function recordWrite(id: string): void {
  writes.getStore()?.add(id);
}

export function runInWriteScope<T>(fn: () => Promise<T>): Promise<T> {
  return writes.run(new Set<string>(), fn);
}

export function withoutWriteScope<T>(fn: () => Promise<T>): Promise<T> {
  return writes.run(undefined, fn);
}
