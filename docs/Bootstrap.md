# Bootstrap

How to get Vulto running locally, and what exists to run.

This is the documented path `VPS-A001`'s acceptance criterion refers to: *a new
frontend or API engineer clones the repository, follows the documented setup, and
runs the frontend, the API and a local Postgres end to end without installing
Rust.*

---

## What you need

| | Version | Why pinned |
|---|---|---|
| Node | `24.18.0` | `.nvmrc`, and `engines` refuses anything else |
| pnpm | `9.15.9` | `packageManager`, enforced by corepack |
| Docker | any recent | runs Postgres, Redis and the sync engine |

**You do not need Rust.** That is `A001-T04`, and it is a MUST rather than a
convenience. The one Rust service in this repository builds inside a container.

---

## The path

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm stack:up        # Postgres, Redis, sync-engine — containers
pnpm dev             # roster-web on :3100, api on :3101 — host
```

Then open **http://localhost:3100/diagnostics**. Three lines, all green, is a
proven chain: roster-web → tRPC → Fastify → Drizzle → Postgres.

`pnpm stack:down` stops the containers. `pnpm verify` runs what the pipeline will
run: format check, lint, typecheck, test.

### The sync engine is a placeholder

`curl localhost:8080/health` answers, and that is all it does. It has no sync
logic. See [`services/sync-engine/README.md`](../services/sync-engine/README.md)
for why it exists now and what it is proving.

**The first `pnpm stack:up` compiles Rust inside a container**, which takes a few
seconds for a dependency-free placeholder. When FDN-51 gives that crate real
content this becomes minutes, and the answer changes to pulling a published image
rather than building locally. That is a recorded scope boundary, not a
performance regression.

---

## What is actually here

`VPS-A001` names ten services and applications. Three run. The rest are absent,
and each absence is owned by an issue — recorded here so a reader can tell a
deliberate boundary from drift.

| Service | State | Owner |
|---|---|---|
| `apps/roster-web` | ✅ runs on the host | — |
| `services/api` | ✅ runs on the host, one procedure | — |
| `packages/tokens`, `packages/ui` | ✅ consumed by the app | — |
| `packages/schema` | ⬜ **empty placeholder**, buildable | FDN-45 |
| `services/sync-engine` | ⬜ **placeholder**, containerized, no sync logic | FDN-51 |
| Postgres, Redis | ✅ containers, digest-pinned | — |
| `services/jobs` | ❌ absent | FDN-57 |
| `services/render` | ❌ absent | FDN-70 |
| `services/cross-tenant-aggregation` | ❌ absent, **and no issue exists for it** | unowned |
| Synthetic fixtures | ❌ absent | FDN-55 |
| Authentication | ❌ absent | FDN-60 |

`services/cross-tenant-aggregation` is the one with no owner. `VPS-A001` names it
as the single deliberate exception to the per-workspace model, and `A001-T08`
gives it hard isolation requirements. Nothing schedules it. That is worth someone
noticing rather than discovering.

### `A007-T18` is not satisfied

> `docker compose` MUST bring up the full local stack, with synthetic fixtures,
> in one command.

It does not. Three services and the fixture generator do not exist. The gap is
recorded as **F71** in [`Foundations_Findings.md`](./Foundations_Findings.md)
rather than left for a reader to infer from a short compose file.

---

## Codespaces

`A007-T14` requires development in Codespaces for **any person with repository
access who is not an owner of the company**. No such person exists yet, so the
founder develops locally against a private repository on a full-disk-encrypted
device. **This is a condition, not a phase** — it changes the day someone who is
not an owner is given access.

`.devcontainer/` is built now rather than then, because retrofitting a security
control under time pressure is how it gets done badly, and because `A007-T19`
makes the development image the thing that satisfies `A001-T04`.

**It is unverified.** See FDN-47 for the steps to verify it.

---

## `/diagnostics`

Development scaffolding. Not in the sidebar, not in the command palette, and
rewritten to a 404 unless `VULTO_DIAGNOSTICS=1` — which `pnpm dev` sets and a
production build does not.

**Unreachable in production is not the same as absent.** `next build` still
compiles the route; the rewrite makes it unroutable. That is stated rather than
glossed because it queries a database with no permission context, and the durable
answer is deleting it once FDN-60 lands.

It reads no workspace data and touches no graph node: `system.status` runs
`SELECT now()`. Authentication does not exist yet, and **this route must not be
cited later as evidence that unauthenticated data paths are acceptable.** They are
not. `VPS-A004`'s interceptor is the only place access is decided, and the first
route that reads workspace data needs FDN-60 and `VPS-A004` before it.
