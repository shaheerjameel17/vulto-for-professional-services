# `@vulto/graph`

This package owns the browser's dedicated local-graph Worker boundary from VPS-A001-T06.

Its public surface is deliberately small: a lifecycle-managed client, the runtime-validated local message contract, availability outcomes, and structural typed-query plans. The private Worker runtime is the only browser-side TypeScript code allowed to import Loro or `wa-sqlite`. FDN-49 will enforce that import boundary automatically.

FDN-48 adds a disposable in-memory SQLite read model. It keeps protected node fragments distinct, stores edges as first-class temporal records, validates permission-significant single-active histories before commit, and reruns subscriptions only after an atomic generation change. There is deliberately no public query method yet: FDN-53 must put the permission interceptor in front of execution before an application may receive rows.

The index is not durable. FDN-50 owns canonical Loro persistence and extraction; FDN-52 owns session-derived local encryption and any future encrypted SQLite cache. Until both exist, a workspace rebuilds this index from validated records rather than leaving readable graph data on disk.

The local Worker protocol is not the TypeScript–Rust sync wire. FDN-51 owns that separate contract.
