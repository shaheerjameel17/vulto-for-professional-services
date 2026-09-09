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

Then:

- open **http://localhost:3100/sign-in** — the app's entry point. Creating an
  account and signing in exercises roster-web → tRPC/Better Auth → Drizzle →
  Postgres end to end (FDN-60).
- `curl http://localhost:3101/health` answers `{"api":"ok"}` — the API process
  is up independent of the browser.

`pnpm stack:down` stops the containers. `pnpm verify` runs what the pipeline will
run: format check, lint, typecheck, test.

### The sync engine

`services/sync-engine` carries the wire codec and the delta-sync relay from
FDN-51 — a real crate, not a stub. `curl localhost:8080/health` answers, and the
relay accepts authenticated device sessions and replays unacknowledged deltas.
The *substance still to come* is `VPS-A003`/`VPS-A004`'s: the full sync protocol,
key wrapping and permission-filtered relay. See
[`services/sync-engine/README.md`](../services/sync-engine/README.md).

**The first `pnpm stack:up` compiles the crate inside a container**, which now
takes a few minutes rather than seconds — FDN-51 gave it real dependencies. Once
the image is published to a registry the answer becomes pulling it rather than
building locally; until then the first build is a one-time cost.

---

## What is actually here

`VPS-A001` names ten services and applications. The substrate — the app, the API,
the graph schema, local persistence, auth, device identity, the sync relay — is
built. The remaining absences are each owned by an issue, recorded here so a
reader can tell a deliberate boundary from drift.

| Service | State | Owner |
|---|---|---|
| `apps/roster-web` | ✅ runs on the host — sign-in, sign-up, `/devices` | — |
| `services/api` | ✅ runs on the host — Better Auth, workspace sessions, device registry, tRPC | — |
| `packages/tokens`, `packages/ui` | ✅ consumed by the app | — |
| `packages/schema` | ✅ the canonical node/edge registry (~3,300 lines) | FDN-45 |
| `packages/graph` | ✅ Loro + SQLite-WASM Worker, local persistence, sealed store | FDN-50 / FDN-77 / FDN-84 |
| `services/sync-engine` | ✅ wire codec + delta-sync relay; A003/A004 protocol still deferred | FDN-51 |
| Authentication | ✅ account login, revocable workspace sessions, device identity + revocation | FDN-60 / FDN-63 |
| Privacy-tier partitioning, workspace key lifecycle | ✅ merged | FDN-52 |
| Postgres, Redis | ✅ containers, digest-pinned | — |
| `services/jobs` | ❌ absent | FDN-57 |
| `services/render` | ❌ absent | FDN-70 |
| `services/cross-tenant-aggregation` | ❌ absent — deliberately unscheduled until `VRS-F071` | FDN-82 |
| Synthetic fixtures | ❌ absent | FDN-55 |

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
control under time pressure is how it gets done badly, and because `A007-T19`
makes the development image the thing that satisfies `A001-T04`.

**Verified — `A007-T14`.** A fresh Codespace built clean from `main` and the
full checklist passed: `rustc`/`cargo` present, `docker` working via
`docker-outside-of-docker`, the stack up, and the end-to-end chain green. Six
defects were found and fixed getting here — F75 through F80 in
`Foundations_Findings.md` — none of which showed up until the devcontainer was
actually run.

**A forwarded port opening as private is expected, not a seventh defect.**
Codespaces forwards ports behind GitHub auth by default, so opening a forwarded
`:3100` URL for the first time in a browser can return a 401 until the port's
visibility is set to Public (or the browser is already authenticated to the
Codespace's GitHub org). Switch it back afterward — this is Codespaces' normal
port-auth behavior, not something this repository's configuration controls.

---

## Diagnostics harnesses

`apps/roster-web/src/app/*-diagnostics` are browser-only acceptance harnesses —
`device-store-diagnostics`, `graph-persistence-diagnostics`,
`graph-sync-diagnostics`, `worker-diagnostics`. They exist so Playwright can
drive the real Worker, sealed store and sync relay against real Postgres. Each
returns 404 unless its own env var is set (`VULTO_DEVICE_STORE_DIAGNOSTICS` or
`VULTO_WORKER_DIAGNOSTICS`), which only the browser test commands set — never
`pnpm dev`.

They are kept out of the production bundle: `next.config.ts` aliases each route's
client to nothing in the optimized build, and `scripts/artifact-check.mjs` fails
the build if any of them reaches a shipped chunk (FDN-91). The earlier standalone
`/diagnostics` route — an unauthenticated `SELECT now()` probe from before FDN-60
— has been deleted now that authentication exists and `/sign-in` plus
`/health` cover the same ground.
