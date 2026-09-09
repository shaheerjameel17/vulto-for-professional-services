import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // packages/tokens, packages/ui and packages/graph are owned and versioned in this
  // repository, per VPS-A001, and ship as source rather than as a build.
  transpilePackages: ["@vulto/tokens", "@vulto/ui", "@vulto/api", "@vulto/graph"],

  webpack(config, { dev }) {
    if (!dev) {
      // Each browser-only diagnostics harness imports its client from a
      // sibling `./<route>-diagnostics-client` module; in the optimized build
      // that import resolves to nothing, so the client — and the ~50 kB of
      // Worker/relay code it pulls — never enters a production chunk. The page
      // itself still compiles and still 404s behind its env gate.
      //
      // This list is enforced, not trusted: `scripts/artifact-check.mjs`
      // derives the expected set from the routes that exist and fails the
      // build if any diagnostics client reaches a shipped chunk (FDN-91).
      config.resolve.alias = {
        ...config.resolve.alias,
        "./device-store-diagnostics-client$": false,
        "./graph-persistence-diagnostics-client$": false,
        "./graph-sync-diagnostics-client$": false,
        "./worker-diagnostics-client$": false,
      };
    }
    return config;
  },
};

export default nextConfig;
