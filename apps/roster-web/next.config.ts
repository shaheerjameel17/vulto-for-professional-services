import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // packages/tokens and packages/ui are owned and versioned in this
  // repository, per VPS-A001, and ship as source rather than as a build.
  transpilePackages: ["@vulto/tokens", "@vulto/ui"],
};

export default nextConfig;
