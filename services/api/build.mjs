// FDN-55 Stage 4a — bundle the API server into a single file that plain `node`
// runs, so the service image needs no compiler or transpiler (A007-T17).
//
// The repo is bundler-first: every consumer (tsx, next, vitest/vite) compiles
// the TypeScript at load time. There is no `tsc` emit step and the shared
// tsconfig is `noEmit` + `moduleResolution: "bundler"`. This mirrors that —
// esbuild bundles the first-party TypeScript (`src/**` and `@vulto/schema`),
// and every third-party runtime dependency stays external and is installed
// into the image's `node_modules` by `pnpm deploy --prod`.
//
// Run by `pnpm --filter @vulto/api build` and by the Dockerfile's builder
// stage — the same command in both places, so the local build and the image
// build produce the same bytes.

import { build } from "esbuild";

// Bundling Fastify / Better Auth / drizzle / postgres is fragile (plugin
// autoloading, dynamic requires); they stay as runtime deps in `node_modules`,
// installed into the image by `pnpm deploy --prod`.
//
// NOT external, so they are inlined into the single file: the first-party
// TypeScript (`src/**`, `@vulto/schema`) and `zod` — which `@vulto/schema`
// pulls but this package does not declare directly, and which bundles cleanly
// (pure JS, no native binding). `loro-crdt` is listed because `@vulto/schema`
// declares it; it is not imported at runtime today, so it never enters the
// graph — if that changes, the build smoke test fails on a missing module and
// it becomes a declared `@vulto/api` dependency.
const external = [
  "fastify",
  "@fastify/cors",
  "@trpc/server",
  "better-auth",
  "@better-auth/passkey",
  "drizzle-orm",
  "postgres",
  "loro-crdt",
];

await build({
  entryPoints: ["src/server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: "dist/server.mjs",
  external,
  logLevel: "info",
  // `import.meta.url` in the output resolves to dist/server.mjs — env.ts's
  // `.env` lookup then points at a file that does not exist in the container,
  // which is the case env.ts already handles (try/catch around loadEnvFile).
  banner: {
    js: "// @vulto/api — bundled by services/api/build.mjs (FDN-55 Stage 4a). Do not edit.",
  },
});
