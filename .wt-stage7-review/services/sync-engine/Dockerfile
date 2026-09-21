# syntax=docker/dockerfile:1
#
# Multi-stage, and two of the splits are load-bearing:
#
#   * A007-T17 forbids a service image containing a compiler or build toolchain.
#     The Rust toolchain exists only in the builder stages, all discarded.
#   * A003-T36+ (FDN-51) will give this crate real dependencies — Tokio, Axum,
#     a Postgres driver. cargo-chef splits a dependency-only compile (cached,
#     invalidated only by Cargo.toml / Cargo.lock) from the application compile,
#     so a cold `docker compose up` after a source-only edit does not recompile
#     the dependency graph. Founder ruling, FDN-51 Stage 0: do this now rather
#     than wait on FDN-55 registry / prebuilt-image work. While the crate is
#     still a std-only placeholder the recipe is nearly empty and the layering
#     is a no-op; it is in place so it starts paying off the day Stage 1 lands.
#
# Base images are pinned by digest, never by tag, per A007-T16. A tag moves; a
# digest does not.

FROM rust:1.97.1-slim-trixie@sha256:3b2879047d42784ca9403ad20c51ed3df361a50f1df96f5777d39b4e33aa65cd AS chef
RUN cargo install cargo-chef --version 0.1.68 --locked
WORKDIR /build

# Planner: read the manifest and lockfile, emit the dependency recipe. Nothing
# from this stage but recipe.json crosses into the builder.
FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo chef prepare --recipe-path recipe.json

# Builder: cook the dependencies as their own cached layer, then build the app.
FROM chef AS builder
COPY --from=planner /build/recipe.json recipe.json
RUN cargo chef cook --release --locked --recipe-path recipe.json
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

# Runtime. No cargo, no rustc, no source. A binary and its libc.
FROM debian:trixie-slim@sha256:3a39a0592364683e6bab97937b72cad5a8fa6dcbbee90edb3bb48c7f8e94f258

RUN useradd --system --uid 10001 --no-create-home vulto
COPY --from=builder /build/target/release/vulto-sync-engine /usr/local/bin/vulto-sync-engine

USER 10001
EXPOSE 8080
ENV SYNC_ENGINE_PORT=8080

ENTRYPOINT ["/usr/local/bin/vulto-sync-engine"]
