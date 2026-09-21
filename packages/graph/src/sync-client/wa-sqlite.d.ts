declare module "wa-sqlite/dist/wa-sqlite-async.mjs" {
  const factory: (config?: Record<string, unknown>) => Promise<unknown>;
  export default factory;
}

declare module "wa-sqlite/src/examples/IDBBatchAtomicVFS.js" {
  export class IDBBatchAtomicVFS {
    constructor(name: string, options?: Record<string, unknown>);
    name: string;
    close(): Promise<void>;
  }
}

declare module "wa-sqlite/src/examples/MemoryVFS.js" {
  export class MemoryVFS {
    name: string;
  }
}
