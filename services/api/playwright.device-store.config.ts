import path from "node:path";
import { defineConfig } from "@playwright/test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn84_browser";
const secret = "fdn84-browser-only-secret-longer-than-thirty-two-characters";

export default defineConfig({
  testDir: "./browser-tests-device-store",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "https://localhost:3110",
    browserName: "chromium",
    headless: true,
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @vulto/api start",
      cwd: repositoryRoot,
      url: "https://localhost:3111/health",
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: databaseUrl,
        BETTER_AUTH_SECRET: secret,
        API_ORIGIN: "https://localhost:3111",
        WEB_ORIGIN: "https://localhost:3110",
        AUTH_TRUSTED_ORIGINS: "https://localhost:3110",
        PASSKEY_RP_ID: "localhost",
        API_TLS_CERT_PATH: "/tmp/vulto-fdn84-browser/cert.pem",
        API_TLS_KEY_PATH: "/tmp/vulto-fdn84-browser/key.pem",
        API_PORT: "3111",
        API_HOST: "localhost",
        LOG_LEVEL: "warn",
      },
    },
    {
      command:
        "pnpm --filter roster-web exec next dev --port 3110 --experimental-https --experimental-https-key /tmp/vulto-fdn84-browser/key.pem --experimental-https-cert /tmp/vulto-fdn84-browser/cert.pem",
      cwd: repositoryRoot,
      url: "https://localhost:3110/sign-in",
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_API_ORIGIN: "https://localhost:3111",
        VULTO_DEVICE_STORE_DIAGNOSTICS: "1",
      },
    },
  ],
});
