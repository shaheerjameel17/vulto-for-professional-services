import path from "node:path";
import { defineConfig } from "@playwright/test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

export default defineConfig({
  testDir: "./browser-tests",
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    browserName: "chromium",
    headless: true,
  },
  webServer: {
    command: "VULTO_WORKER_DIAGNOSTICS=1 pnpm --filter roster-web dev",
    cwd: repositoryRoot,
    url: "http://127.0.0.1:3100/worker-diagnostics",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
