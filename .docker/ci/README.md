# The Vulto CI image

`VPS-A007`'s third image role — _"the toolchain each gate needs, pinned"_ —
built by FDN-55 Stage 2.

## What it carries

| Tool        | Version                                   | Why pinned                                                                                                                                                               |
| ----------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Debian base | `node:24.18.0-trixie-slim`, **by digest** | A007-T16 — a tag moves, a digest does not                                                                                                                                |
| Node        | 24.18.0                                   | matches `engines` and the devcontainer                                                                                                                                   |
| pnpm        | 9.15.9                                    | matches `packageManager`, pre-fetched into a shared `COREPACK_HOME`                                                                                                      |
| Rust        | 1.97.1 + `wasm32-unknown-unknown`         | matches `services/sync-engine`'s Dockerfile and `pg-tests.sh`; the multi-target build gate needs the wasm target (A007-T03, as corrected by F193 — native + wasm32 only) |
| Playwright  | 1.62.1 + Chromium + system deps           | matches the repo's `@playwright/test`; the browser suites run headless Chromium                                                                                          |

A gate that needs a **service** — Postgres for the integration and browser
suites, the Rust relay for the sync tests — gets it as a sibling container in
the workflow, never baked in here.

The Rust toolchain is on `PATH` through the image's `ENV`, which every
non-login shell inherits — including GitHub Actions' `shell: bash`
(`bash --noprofile --norc`). A **login** shell (`bash -l`) re-runs
`/etc/profile` and drops it; run gate scripts with a plain `bash script.sh`,
not `bash -l`.

## Building and pinning it

The image is built and pushed to GHCR by `.github/workflows/ci-image.yml`
whenever `.docker/ci/**` changes on `main` (or on a `workflow_dispatch`). The
workflows that consume it — `fast-lane.yml` and `slow-lane.yml` — reference it
**by digest**, held in one place (`.github/workflows/ci-image-ref.env`, read by
each lane's `resolve-image` job, which fails loudly if it is ever not a
digest). Bumping that digest is a deliberate reviewed PR — the same treatment
the Loro pin and the `docker-compose.yml` base images get: run `ci-image.yml`,
then paste the digest from its job summary into `ci-image-ref.env`.

Locally:

```bash
docker build -t vulto-ci:local -f .docker/ci/Dockerfile .
```

## Stage 2 proof — the fast lane runs identically in the image and on the host

Built `vulto-ci:local` from the digest-pinned base, then ran `pnpm verify`
(the Stage 1 fast lane) inside it against a fresh `pnpm install --frozen-lockfile`:

```
IN THE IMAGE                              ON THE HOST
conformance gate  6 pass / 2 todo         conformance gate  6 pass / 2 todo
arch:check        dormant (A001-T08)      arch:check        dormant (A001-T08)
@vulto/schema     29 tests / 2 todo       @vulto/schema     29 tests / 2 todo
@vulto/graph      271 tests               @vulto/graph      271 tests
turbo             10 tasks ok             turbo             10 tasks ok
pnpm verify       exit 0                  pnpm verify       exit 0
```

Identical. The image is a faithful environment for the fast lane, and the
digest pin makes that reproducible.

## Stage 3 — the CI lanes

| Workflow        | Trigger                             | Required      | What it runs                                                                                                                                                             |
| --------------- | ----------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fast-lane.yml` | every push, every PR                | yes           | `pnpm verify` in the CI image                                                                                                                                            |
| `slow-lane.yml` | every push to a PR branch, every PR | yes for merge | api integration (Postgres service), the three browser suites (matrix, shardable), `scripts/rust-multitarget.sh`, and the production build + `scripts/artifact-check.mjs` |
| `ci-image.yml`  | `.docker/ci/**` change              | —             | builds/publishes this image                                                                                                                                              |

The device-store browser matrix entry also carries the accessibility smoke pass
(`a11y-smoke.spec.ts`) — same 3-server harness, so no separate job.

`slow-lane.yml`'s **production-build** job blocks `fonts.googleapis.com` /
`fonts.gstatic.com` at `/etc/hosts` before `next build`, so a `next/font/google`
regression fails the build; then `scripts/artifact-check.mjs` fails it if any
diagnostics client reached a shipped chunk. Both were green once FDN-91 landed
the `next/font/local` fix and the `graph-sync-diagnostics` exclusion on `main`.
