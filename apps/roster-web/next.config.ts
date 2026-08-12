import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // packages/tokens and packages/ui are owned and versioned in this
  // repository, per VPS-A001, and ship as source rather than as a build.
  transpilePackages: ["@vulto/tokens", "@vulto/ui", "@vulto/api"],

  async rewrites() {
    /*
     * /diagnostics is development scaffolding: it reaches Postgres with no
     * permission context, because authentication is FDN-60's and does not
     * exist yet. Shipping an unauthenticated database probe to production
     * would be exactly the precedent its own source disclaims.
     *
     * Off unless explicitly asked for. `pnpm dev` sets it; a production build
     * does not, and the route 404s there.
     */
    if (process.env.VULTO_DIAGNOSTICS === "1") return [];
    return {
      beforeFiles: [{ source: "/diagnostics", destination: "/404" }],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
