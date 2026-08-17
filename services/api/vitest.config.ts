import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["src/**/*.test.ts"],
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://vulto:vulto@localhost:5432/vulto_fdn60_test",
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ??
        "fdn60-test-only-secret-that-is-longer-than-thirty-two-chars",
      API_ORIGIN: process.env.API_ORIGIN ?? "http://localhost:3101",
      WEB_ORIGIN: process.env.WEB_ORIGIN ?? "http://localhost:3100",
      AUTH_TRUSTED_ORIGINS: process.env.AUTH_TRUSTED_ORIGINS ?? "http://localhost:3100",
      PASSKEY_RP_ID: process.env.PASSKEY_RP_ID ?? "localhost",
      LOG_LEVEL: "silent",
    },
  },
});
