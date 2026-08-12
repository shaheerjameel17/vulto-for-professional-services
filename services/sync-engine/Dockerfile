# syntax=docker/dockerfile:1
#
# Two stages, and the split is a specification requirement rather than an
# optimization: A007-T17 forbids a service image containing a compiler or build
# toolchain. The Rust toolchain exists only in `builder`, which is discarded.
#
# Base images are pinned by digest, never by tag, per A007-T16. A tag moves; a
# digest does not.

FROM rust:1.97.1-slim-trixie@sha256:3b2879047d42784ca9403ad20c51ed3df361a50f1df96f5777d39b4e33aa65cd AS builder

WORKDIR /build
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
