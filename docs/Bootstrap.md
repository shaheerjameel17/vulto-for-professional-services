# Bootstrap

How to get Vulto running locally, and what exists to run.

This is the documented path `VPS-A001`'s acceptance criterion refers to: _a new
frontend or API engineer clones the repository, follows the documented setup, and
runs the frontend, the API and a local Postgres end to end with Node, pnpm and
Docker alone._

---

## What you need

|         | Version   | Why pinned                                                     |
| ------- | --------- | -------------------------------------------------------------- |
| Node    | `24.18.0` | `.nvmrc`, and `engines` refuses anything else                  |
| pnpm    | `9.15.9`  | `packageManager`, enforced by corepack                         |
| Docker  | any recent | runs Postgres (with logical replication), Redis and Electric |

That is the whole toolchain. The repository is TypeScript only; there is no
Rust anywhere in it (`CLAUDE.md`).

---

## The path

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm stack:up                         # Postgres, Redis, Electric — containers
pnpm --filter @vulto/api db:migrate   # the schema, and the Electric role's password
pnpm dev                              # roster-web on :3100, api on :3101 — host
```

Then:

- open **http://localhost:3100/sign-in** — the app's entry point. Creating an
  account and signing in exercises roster-web → tRPC/Better Auth → Drizzle →
  Postgres end to end.
- `curl http://localhost:3101/health` answers `{"api":"ok"}` — the API process
  is up independent of the browser.
- `curl http://localhost:5133/v1/health` answers once Electric is connected to
  Postgres as its own read-only role.

`pnpm stack:down` stops the containers. `pnpm verify` is the fast gate the
pipeline runs on every push; `pnpm verify:full` adds the API integration suite
and is what to run before pushing (see [`CONTRIBUTING.md`](../CONTRIBUTING.md)).

### How the pieces fit

PostgreSQL is the single source of truth (`VPS-A003`). `services/api` is the only
writer, through named mutations. **Electric** replicates each person's permitted
Tier 0 rows out of Postgres, through the API's authenticated shape proxy, to the
sync client in `packages/graph`, which keeps them in a SQLite database in the
browser and queues writes made offline. Tier 1 and Tier 2 values are encrypted
in Postgres under keys in a key provider (an environment key locally, AWS KMS in
production) and are only ever fetched, in memory, through the audited
`protected.read`.

### The browser suites

They run against the real stack, so bring it up first (`pnpm stack:up`):

```bash
pnpm test:sync-browser   # the sync client in real Chromium, Postgres and Electric
pnpm test:auth-browser   # sign-in, passkeys and the accessibility smoke pass
```

The sync suite drives `/sync-harness`, a route that exists only when
`VULTO_SYNC_HARNESS=1` (set by that suite's config, never by `pnpm dev`). It is
kept out of the production bundle: `next.config.ts` aliases its client to nothing
in the optimized build, and `scripts/artifact-check.mjs` fails the build if it
reaches a shipped chunk (FDN-91).

---

## What is actually here

`VPS-A001` names ten services and applications. The substrate — the app, the API,
the graph schema, the server graph and interceptor, field-level encryption, the
audience and shape proxy, the device cache — is built. The remaining absences
are each owned by an issue, recorded here so a reader can tell a deliberate
boundary from drift.

| Service                             | State                                                                                                     | Owner                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------ |
| `apps/roster-web`                   | ✅ runs on the host — sign-in, sign-up, `/devices`                                                        | —                        |
| `services/api`                      | ✅ runs on the host — Better Auth, workspace sessions, device registry, tRPC, the shape proxy             | —                        |
| `packages/tokens`, `packages/ui`    | ✅ consumed by the app                                                                                    | —                        |
| `packages/schema`                   | ✅ the canonical node/edge registry, the policy table and the named mutations                             | FDN-45                   |
| `packages/graph`                    | ✅ the device cache, outbox and typed query layer (wa-sqlite)                                             | FDN-99 / FDN-101         |
| Postgres, Redis, Electric           | ✅ containers, digest-pinned                                                                              | —                        |
| `services/jobs`                     | ❌ absent                                                                                                 | FDN-57                   |
| `services/render`                   | ❌ absent                                                                                                 | FDN-70                   |
| `services/cross-tenant-aggregation` | ❌ absent — deliberately unscheduled until `VRS-F071`                                                     | FDN-82                   |
| Synthetic fixtures                  | ❌ absent                                                                                                 | FDN-55                   |

`services/cross-tenant-aggregation` is `VPS-A001`'s single deliberate exception to
the per-workspace model, with hard isolation requirements in `A001-T08`. It is
not built and not scheduled — the decision to leave it until `VRS-F071` (the
first feature that needs it) is recorded on **FDN-82**, which stays open as the
carrier for that question rather than being closed as "won't do".

### `A007-T18` is not satisfied

> `docker compose` MUST bring up the full local stack, with synthetic fixtures,
> in one command.

It does not. `services/jobs`, `services/render` and the fixture generator do not
exist. The gap is recorded as **F71** in
[`Foundations_Findings.md`](./Foundations_Findings.md) rather than left for a
reader to infer from a short compose file.

---

## Codespaces

`A007-T14` requires development in Codespaces for **any person with repository
access who is not an owner of the company**. No such person exists yet, so the
founder develops locally against a private repository on a full-disk-encrypted
device. **This is a condition, not a phase** — it changes the day someone who is
not an owner is given access.

`.devcontainer/` is built now rather than then, because retrofitting a security
control under time pressure is how it gets done badly.

**A forwarded port opening as private is expected, not a defect.** Codespaces
forwards ports behind GitHub auth by default, so opening a forwarded `:3100` URL
for the first time in a browser can return a 401 until the port's visibility is
set to Public (or the browser is already authenticated to the Codespace's GitHub
org). Switch it back afterward — this is Codespaces' normal port-auth behavior,
not something this repository's configuration controls.
