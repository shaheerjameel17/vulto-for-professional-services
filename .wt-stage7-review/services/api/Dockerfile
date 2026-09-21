# syntax=docker/dockerfile:1
#
# The Vulto API service image — FDN-55 Stage 4a.
#
# Multi-stage, and the split is A007-T17: the runtime stage carries a built
# artifact and its runtime, and no compiler or transpiler. `services/api` has
# no `tsc` emit (the repo is bundler-first), so the builder stage bundles the
# server with esbuild — the same `pnpm --filter @vulto/api build` a developer
# runs — into one file that plain `node` executes.
#
# Base image pinned by digest, never a tag (A007-T16) — the same
# node:24.18.0-trixie-slim the CI image is built on.
#
# Build context is the repository root:
#   docker build -f services/api/Dockerfile -t vulto-api:local .

# ── builder ─────────────────────────────────────────────────────────────────
FROM node:24.18.0-trixie-slim@sha256:ae91dcc111a68c9d2d81ff2a17bda61be126426176fde6fe7d08ab13b7f50573 AS builder

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 COREPACK_HOME=/usr/local/corepack
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /repo

# Manifests first, so the dependency install layer caches across source edits.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/schema/package.json packages/schema/
COPY services/api/package.json services/api/
RUN pnpm install --frozen-lockfile --filter "@vulto/api..."

# First-party sources.
COPY tsconfig.base.json ./
COPY packages/schema packages/schema
COPY services/api services/api

# Bundle to services/api/dist/server.mjs, then produce a self-contained
# production node_modules.
#
#   --prod         no devDependencies (no esbuild, tsx, typescript, drizzle-kit)
#   --no-optional  no optionalDependencies and no optional peers — Better Auth
#                  declares `next`, `react`, `vitest` etc. as optional peers, and
#                  because roster-web resolves `next` in the workspace, a plain
#                  deploy drags Next.js + its swc binaries (~430 MB) into an API
#                  image. The server never calls Better Auth's Next helpers.
RUN pnpm --filter @vulto/api build \
 && pnpm --filter @vulto/api deploy --prod --no-optional /out \
 && cp -r services/api/dist /out/dist

# ── runtime ─────────────────────────────────────────────────────────────────
FROM node:24.18.0-trixie-slim@sha256:ae91dcc111a68c9d2d81ff2a17bda61be126426176fde6fe7d08ab13b7f50573

RUN useradd --system --uid 10001 --no-create-home vulto
WORKDIR /app

COPY --from=builder --chown=10001:10001 /out/node_modules ./node_modules
COPY --from=builder --chown=10001:10001 /out/dist ./dist

USER 10001

# The service binds all interfaces inside the container; the platform maps it.
# DATABASE_URL and BETTER_AUTH_SECRET have no default (services/api/src/env.ts)
# and are supplied by the deployment — not baked here.
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=3101
EXPOSE 3101

ENTRYPOINT ["node", "dist/server.mjs"]
