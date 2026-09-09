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
      // FDN-51 Stage 4a: the real relay, against the same test database. A
      // browser page over HTTPS may still open `ws://localhost` — loopback is
      // a potentially-trustworthy origin, so this is not mixed content.
      //
      // `--release`: the backlog-replay stress cases push hundreds of deltas
      // through the relay's per-delta verification, and a debug build of that
      // path is slow enough to time out on a constrained CI runner (~2 of 520
      // deltas in 90s). Release costs one extra compile, then caches.
      command:
        "cargo run --release --quiet --manifest-path services/sync-engine/Cargo.toml",
      cwd: repositoryRoot,
      url: "http://localhost:3112/health",
      reuseExistingServer: false,
      timeout: 420_000,
      env: {
        DATABASE_URL: databaseUrl,
        SYNC_ENGINE_HOST: "127.0.0.1",
        SYNC_ENGINE_PORT: "3112",
        // Short so the two-tab eviction/handover case does not wait 10s.
        SYNC_REVALIDATION_SECS: "3",
        RUST_LOG: "warn",
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
        NEXT_PUBLIC_SYNC_RELAY_URL: "ws://localhost:3112/sync",
        VULTO_DEVICE_STORE_DIAGNOSTICS: "1",
      },
    },
  ],
});
