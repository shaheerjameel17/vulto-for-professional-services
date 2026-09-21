import path from "node:path";
import { defineConfig } from "@playwright/test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
// The database Electric replicates: the local stack's `vulto`, migrated by `db:migrate`.
const databaseUrl = process.env.SYNC_BROWSER_DATABASE_URL ?? "postgres://vulto:vulto@localhost:5432/vulto";
const secret = "sync-browser-only-secret-longer-than-thirty-two-characters";
const electricUrl = process.env.ELECTRIC_URL ?? "http://localhost:5133";
const electricSecret = process.env.ELECTRIC_SECRET ?? "7410a5d35c4ace6ceceb2de9e5c0ac32";
const certificates = "/tmp/vulto-sync-browser";

// The tests import API internals to seed the database, so they need the same environment.
process.env.DATABASE_URL = databaseUrl;
process.env.BETTER_AUTH_SECRET = secret;
process.env.NODE_ENV = "test";
process.env.VULTO_KEY_PROVIDER = "local";
process.env.VULTO_LOCAL_ROOT_KEY = "D6QVNEsijEoJKnNdcu+/ez0N8rkLsdewyxeCwTYX7LA=";
process.env.API_ORIGIN = "https://localhost:3131";
process.env.WEB_ORIGIN = "https://localhost:3130";
process.env.AUTH_TRUSTED_ORIGINS = "https://localhost:3130";
process.env.PASSKEY_RP_ID = "localhost";
process.env.LOG_LEVEL = "silent";

export default defineConfig({
  testDir: "./sync-browser-tests",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: "https://localhost:3130",
    browserName: "chromium",
    headless: true,
    // Playwright's ignoreHTTPSErrors does not reach SharedWorker requests; this flag does (test certificates only).
    launchOptions: { args: ["--ignore-certificate-errors"] },
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @vulto/api start",
      cwd: repositoryRoot,
      url: "https://localhost:3131/health",
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: databaseUrl,
        BETTER_AUTH_SECRET: secret,
        NODE_ENV: "development",
        VULTO_KEY_PROVIDER: "local",
        VULTO_LOCAL_ROOT_KEY: "D6QVNEsijEoJKnNdcu+/ez0N8rkLsdewyxeCwTYX7LA=",
        ELECTRIC_URL: electricUrl,
        ELECTRIC_SECRET: electricSecret,
        API_ORIGIN: "https://localhost:3131",
        WEB_ORIGIN: "https://localhost:3130",
        AUTH_TRUSTED_ORIGINS: "https://localhost:3130",
        PASSKEY_RP_ID: "localhost",
        API_TLS_CERT_PATH: `${certificates}/cert.pem`,
        API_TLS_KEY_PATH: `${certificates}/key.pem`,
        API_PORT: "3131",
        API_HOST: "localhost",
        LOG_LEVEL: "warn",
      },
    },
    {
      command: `pnpm --filter roster-web exec next dev --port 3130 --experimental-https --experimental-https-key ${certificates}/key.pem --experimental-https-cert ${certificates}/cert.pem`,
      cwd: repositoryRoot,
      url: "https://localhost:3130/sign-in",
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        // The browser reaches the API through a proxy the tests can cut (helpers.ts).
        NEXT_PUBLIC_API_ORIGIN: "https://localhost:3132",
        VULTO_SYNC_HARNESS: "1",
      },
    },
  ],
});
