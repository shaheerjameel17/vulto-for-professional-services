# `@vulto/graph`

The device-side half of Vulto's data architecture (`VPS-A003`, `VPS-A001`).
PostgreSQL is the source of truth; this package is the fast, permission-filtered
cache of it that runs in the browser, with optimistic writes that queue while
offline.

Its public surface, exported from `@vulto/graph`:

- `createGraphClient({ workspaceId, userId, apiOrigin })` returning
  `{ query, subscribe, mutate, protectedRead, prefetchProtected, syncStatus, signOut }`;
- the typed query plans (`graphQuerySchema`, `parseGraphQuery`) and their results;
- the optimistic mutators that mirror the server's named mutations.

Everything runs in a worker (a SharedWorker where available, a dedicated worker
under a Web Lock otherwise), never on the main thread. Inside `src/sync-client/`:

| Piece                                  | What it does                                                                                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shape-source.ts`                      | Subscribes to the API's two shape endpoints through Electric's client and turns the stream, including audience move-outs, into cache changes             |
| `cache.ts`, `database.ts`, `schema.ts` | The wa-sqlite database, one per `(workspace, person)`. Replicated tables are versioned apart from the outbox, which a cache version change never touches |
| `outbox.ts`, `engine.ts`               | Named mutations queued while offline, uploaded in order, retried with backoff, reverted and surfaced if the server refuses them                          |
| `query.ts`                             | The typed query layer, with recursive traversal as a recursive CTE                                                                                       |
| `protected-store.ts`                   | Tier 1 and Tier 2 values, in memory only; nothing protected is ever written to the device                                                                |
| `erasure.ts`                           | Sign-out and revocation erase every cache; a delete that cannot finish is finished before anything else opens                                            |

The device holds Tier 0 rows only, exactly the rows the server's sync audience
names for that person. Nothing here decides who may read what.

The browser suite that exercises all of this against real Postgres and Electric
is `sync-browser-tests/`, run with `pnpm test:sync-browser`.
