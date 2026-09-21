# syntax=docker/dockerfile:1
#
# The Vulto CI image — VPS-A007's third image role ("the toolchain each gate
# needs, pinned"), FDN-55 Stage 2.
#
# One image carries every toolchain the pipeline runs: Node, pnpm, the Rust
# toolchain with the wasm32 target, and Chromium with its system dependencies
# for the Playwright suites. A gate that needs a service — Postgres, the relay
# — gets it as a sibling container in the workflow, not baked in here
# (A007-T17's spirit: no more in the image than the gate needs).
#
# The base is pinned by digest, never a tag, per A007-T16. Updating it is a
# deliberate reviewed PR — the same treatment the Loro version pin and the
# docker-compose base images get. The digest below is `node:24.18.0-trixie-slim`;
# trixie (Debian 13) matches services/sync-engine and the devcontainer.
FROM node:24.18.0-trixie-slim@sha256:ae91dcc111a68c9d2d81ff2a17bda61be126426176fde6fe7d08ab13b7f50573

# `git` for actions/checkout; `curl`/`ca-certificates`/`build-essential`/`pkg-config`
# for the rustup install and the Rust linker. Everything else Playwright pulls
# via `install --with-deps` below.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       git curl ca-certificates build-essential pkg-config xz-utils \
  && rm -rf /var/lib/apt/lists/*

# pnpm, pinned to the version `packageManager` declares. corepack is bundled
# with the Node image. `COREPACK_HOME` is a shared, world-readable path so the
# pre-fetched 9.15.9 is visible to the non-root `ci` user too, not just root —
# otherwise the first `pnpm` call in the container re-downloads it.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    COREPACK_HOME=/usr/local/corepack
RUN corepack enable \
  && corepack prepare pnpm@9.15.9 --activate \
  && chmod -R a+rX "$COREPACK_HOME" \
  && pnpm --version

# The Rust toolchain, pinned to the version A001 records and the sync-engine
# Dockerfile / pg-tests script already use (1.97.1). `minimal` profile — the
# gate needs rustc, cargo and the wasm32 target, not clippy or docs.
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --profile minimal --default-toolchain 1.97.1 --no-modify-path \
  && rustup target add wasm32-unknown-unknown \
  && rustc --version && cargo --version \
  # Also on PATH for a login shell, not only the ENV above — some CI runners
  # source /etc/profile before a step.
  && printf 'export PATH=/usr/local/cargo/bin:$PATH\n' > /etc/profile.d/rust.sh

# Chromium and its system libraries, pinned to the repo's Playwright version.
# `PLAYWRIGHT_BROWSERS_PATH` fixes the download location so the image layer is
# stable and the workflow does not re-download at run time.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx --yes playwright@1.62.1 install --with-deps chromium \
  && rm -rf /root/.npm

# A non-root user, so a bind-mounted checkout is not owned by root on the host
# and the container matches GitHub Actions' `runner` conventions.
RUN useradd --create-home --shell /bin/bash --uid 1001 ci
USER ci
WORKDIR /workspace

# The image self-documents what it carries.
RUN echo "vulto-ci: node $(node --version), pnpm $(pnpm --version), $(rustc --version), playwright 1.62.1 (chromium)"
