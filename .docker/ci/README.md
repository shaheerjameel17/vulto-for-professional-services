# The Vulto CI image

`VPS-A007`'s third image role — _"the toolchain each gate needs, pinned"_ —
built by FDN-55 Stage 2.

## What it carries

| Tool | Version | Why pinned |
|---|---|---|
| Debian base | `node:24.18.0-trixie-slim`, **by digest** | A007-T16 — a tag moves, a digest does not |
| Node | 24.18.0 | matches `engines` and the devcontainer |
| pnpm | 9.15.9 | matches `packageManager`, pre-fetched into a shared `COREPACK_HOME` |
| Rust | 1.97.1 + `wasm32-unknown-unknown` | matches `services/sync-engine`'s Dockerfile and `pg-tests.sh`; the multi-target build gate needs the wasm target (A007-T03, as corrected by F193 — native + wasm32 only) |
| Playwright | 1.62.1 + Chromium + system deps | matches the repo's `@playwright/test`; the browser suites run headless Chromium |

A gate that needs a **service** — Postgres for the integration and browser
suites, the Rust relay for the sync tests — gets it as a sibling container in
the workflow, never baked in here.

## Building and pinning it

The image is built and pushed by `.github/workflows/ci-image.yml` whenever
`.docker/ci/**` changes on `main`. The workflows that consume it reference it
**by digest**, held in one place (`.github/workflows/ci.yml`'s `CI_IMAGE`
env), and bumping that digest is a deliberate reviewed PR — the same treatment
the Loro pin and the `docker-compose.yml` base images get.

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
