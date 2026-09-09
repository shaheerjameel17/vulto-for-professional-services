#!/usr/bin/env bash
#
# FDN-55 Stage 3 — VPS-A007 gate 6 / A007-T03 (as corrected by F193): the
# sync-engine `[lib]` compiles for every target that has a consumer, on every
# change. A partial build is a failure.
#
#   * native server binary + [lib]  — `cargo build --release --locked`
#   * wasm32-unknown-unknown [lib]   — zero-dependency by construction (F188)
#
# The native mobile FFI target is deferred (F193) until React Native work
# consumes it; it is not built here.
#
# `cargo test` runs the wire-vector round-trip and unit tests. The
# real-Postgres relay tests are a separate gate (`pnpm test:sync-engine`).

set -euo pipefail

MANIFEST="services/sync-engine/Cargo.toml"

echo "── native (server binary + lib) ─────────────────────────────"
cargo build --release --locked --manifest-path "$MANIFEST"

echo
echo "── wasm32-unknown-unknown (lib only, must stay zero-dependency) ──"
cargo build --release --locked --lib \
  --target wasm32-unknown-unknown \
  --manifest-path "$MANIFEST"

echo
echo "── cargo test (wire vectors + units, no Postgres) ───────────"
cargo test --locked --manifest-path "$MANIFEST"

echo
echo "  ✓ native + wasm32 both build; tests pass"
