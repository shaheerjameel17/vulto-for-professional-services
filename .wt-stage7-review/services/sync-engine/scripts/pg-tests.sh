#!/usr/bin/env bash
#
# FDN-51 Stage 2b — run the real-Postgres relay tests (`tests/relay_pg.rs`)
# inside the pinned Rust container. A001-T04: no host Rust toolchain.
#
# Prerequisites, both handled by `pnpm test:sync-engine`:
#   - the compose stack is up  (`pnpm stack:up`)
#   - the test database exists and is migrated  (`pretest:sync-engine`)
#
# The container reaches the host-published Postgres at host.docker.internal;
# `--add-host` makes that resolve on Linux too (Docker Desktop already provides it).

set -euo pipefail

crate_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="rust:1.97.1-slim-trixie@sha256:3b2879047d42784ca9403ad20c51ed3df361a50f1df96f5777d39b4e33aa65cd"
database_url="${SYNC_ENGINE_CONTAINER_DATABASE_URL:-postgres://vulto:vulto@host.docker.internal:5432/vulto_fdn51_sync}"

exec docker run --rm \
  --add-host host.docker.internal:host-gateway \
  -v "${crate_dir}:/build" \
  -v vulto-cargo-registry:/usr/local/cargo/registry \
  -e DATABASE_URL="${database_url}" \
  -w /build \
  "${image}" \
  cargo test --locked --test relay_pg -- --ignored --test-threads=1
