# `@vulto/graph`

This package owns the browser's dedicated local-graph Worker boundary from VPS-A001-T06.

Its public surface is deliberately small: a lifecycle-managed client, the runtime-validated local message contract, and availability outcomes. The private Worker runtime is the only browser-side TypeScript code allowed to import Loro or `wa-sqlite`. FDN-49 will enforce that import boundary automatically.

The SQLite table in FDN-77 is an in-memory materialization probe only. It proves that Loro merge and SQLite-WASM work occur inside the Worker without choosing the durable representation, indexes, query API, VFS, or rebuild strategy owned by FDN-48.

The local Worker protocol is not the TypeScript–Rust sync wire. FDN-51 owns that separate contract.
