# Stage 1 — Alignment, baseline and local stack

**Status:** COMPLETE
**Branch:** stage-1-alignment @ 0cfe953
**Linear issues:** FDN-102 (comment only)
**Date:** 2026-09-21

## 1. Summary
The local stack now runs Postgres with logical replication, Redis and Electric, and the Rust relay no longer builds by default. The baseline and the post-change results are identical and green. The history branches are now on GitHub. The CI Postgres change moved to Stage 6 by amendment (F203 closed).

## 2. Done-criteria checklist
- [x] `main`, `archive/local-first-e2e` and `fdn-68-audit-wip` exist on origin — evidence: `git ls-remote --heads origin` lists all three (pushed after the founder allowed it; the first attempt was refused).
- [x] `pnpm stack:up` starts Postgres, Redis and Electric, and does not build Rust — evidence: `pnpm stack:up` exit 0; `docker compose ps` lists electric, postgres, redis, all healthy; no sync-engine container.
- [x] `SHOW wal_level` returns `logical` — evidence: `docker compose exec postgres psql -U vulto -c "SHOW wal_level"` printed `logical`.
- [x] Electric's `/v1/health` responds from the host on port 5133 — evidence: `curl localhost:5133/v1/health` returned HTTP 200, `{"status":"active"}`.
- [x] Baseline of `pnpm verify` and `pnpm verify:full` recorded; neither worse — see section 6.
- [x] Step 3, CI mirror — not applicable: the amended brief removes it from Stage 1 and moves it to Stage 6 item 0 (F203 closed).

## 3. Spec clauses implemented
| Spec ID | Where implemented | Test proving it |
|---|---|---|
| A001-T02 (exact pins) | `docker-compose.yml` (Electric `1.8.1` by digest); recorded in `docs/Vulto_Specs/VPS-A001_Technology_Stack_and_Engineering_Foundations.md` "Sync client selection" | `docker compose config -q` exit 0; container starts from the digest |
| A003-T58 (Electric needs only PostgreSQL) | `docker-compose.yml` `electric` service | Health check above |

## 4. Files changed
```
 .env.example                                       | 10 +++++
 docker-compose.yml                                 | 52 +++++++++++++++++++---
 docs/Foundations_Findings.md                       | 13 ++++++
 ...Technology_Stack_and_Engineering_Foundations.md |  7 ++-
 turbo.json                                         |  8 +++-
 5 files changed, 83 insertions(+), 7 deletions(-)
```
(Output of `git diff --stat` before this report was added. `.env` was also appended locally; it is gitignored.)

## 5. Database changes
None. Postgres settings changed through container startup flags only.

## 6. Tests and gates
Baseline, before any change (`main`, clean tree):
- `pnpm install --frozen-lockfile` — exit 0, "Already up to date"
- `pnpm stack:up` — exit 0 (Postgres, Redis, sync-engine healthy)
- `pnpm verify` — exit 0; `Tasks: 10 successful, 10 total`, `Cached: 10 cached` (served from the turbo cache); graph 25 files / 302 tests passed; schema 33 passed, 2 todo
- `pnpm verify:full` — exit 0; adds `@vulto/api`: 1 file, 60 tests passed

After the change (`stage-1-alignment`):
- `pnpm install --frozen-lockfile` — exit 0
- `pnpm stack:up` — exit 0; postgres, redis, electric healthy
- `pnpm verify` — exit 0; `Tasks: 10 successful, 10 total`, `Cached: 5 cached` (turbo config changed, so this was a real run); graph 25 files / 302 tests; schema 33 passed, 2 todo
- `pnpm verify:full` — exit 0; `@vulto/api` 1 file / 60 tests passed
- `SHOW wal_level` → `logical`; `curl localhost:5133/v1/health` → 200

## 7. Micro-decisions
- Electric version is 1.8.1, the latest stable 1.x on Docker Hub on 2026-09-21 (1.8.0 released 2026-09-01, 1.8.1 on 2026-09-07).
- The Electric healthcheck uses `curl` (present in the image; `wget` is not).
- Local `ELECTRIC_SECRET` and `VULTO_LOCAL_ROOT_KEY` values were generated with `openssl` and are labeled local-only in `.env.example`.
- Vars were also appended to the gitignored local `.env`, since compose reads it.

## 8. Findings raised
- F203 — CI Postgres service container cannot take the replication flags. **Closed** by the 21 September amendment; built in Stage 6 item 0.

## 9. Deviations from this brief
- Step 1 was first refused by the permission classifier and completed after the founder allowed pushes.
- Step 3's CI half is not done, per the brief's amendment (F203).
- The `electric` service does not yet use the `vulto_electric` role or manual publication; the brief specifies `DATABASE_URL` with the `vulto` user for Stage 1, and Stage 6 changes it.

## 10. Known limitations and risks
- `pnpm stack:up` on a fresh clone needs `.env` copied from `.env.example` first, or `ELECTRIC_SECRET` is blank. The compose header says so.
- Electric connects as the superuser `vulto` for now.
- The `@electric-sql/client` pin is not yet recorded in VPS-A001; it is added in Stage 6 when the package is first installed.
- Baseline `verify` was cached, so its counts come from cache. The post-change run is a genuine execution with the same counts.

## 11. Readiness for the next stage
Yes. Stage 2 needs only Postgres and the repo as they are. Stage 6 item 0 builds the CI Postgres image.
