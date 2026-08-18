import path from "node:path";
import { defineConfig } from "@playwright/test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const databaseUrl =
  process.env.FDN77_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn77_browser";
const secret = "fdn77-browser-only-secret-longer-than-thirty-two-characters";

export default defineConfig({
  testDir: "./browser-tests",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "https://localhost:3120",
    browserName: "chromium",
    headless: true,
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @vulto/api start",
      cwd: repositoryRoot,
      url: "https://localhost:3121/health",
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: databaseUrl,
        BETTER_AUTH_SECRET: secret,
        API_ORIGIN: "https://localhost:3121",
        WEB_ORIGIN: "https://localhost:3120",
        AUTH_TRUSTED_ORIGINS: "https://localhost:3120",
        PASSKEY_RP_ID: "localhost",
        API_TLS_CERT_PATH: "/tmp/vulto-fdn77-browser/cert.pem",
        API_TLS_KEY_PATH: "/tmp/vulto-fdn77-browser/key.pem",
        API_PORT: "3121",
        API_HOST: "localhost",
        LOG_LEVEL: "warn",
      },
    },
    {
      command:
        "pnpm --filter roster-web exec next dev --port 3120 --experimental-https --experimental-https-key /tmp/vulto-fdn77-browser/key.pem --experimental-https-cert /tmp/vulto-fdn77-browser/cert.pem",
      cwd: repositoryRoot,
      url: "https://localhost:3120/sign-in",
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_API_ORIGIN: "https://localhost:3121",
        VULTO_WORKER_DIAGNOSTICS: "1",
      },
    },
  ],
});
