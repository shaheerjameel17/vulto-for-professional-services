import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

/**
 * Stage 6 sync browser suite setup: local TLS material, and a check that the
 * stack the suite needs is actually up. The suite runs against the real
 * database Electric replicates (`vulto`), which `pnpm stack:up` starts and
 * `pnpm --filter @vulto/api db:migrate` migrates.
 */
const certificateDirectory = "/tmp/vulto-sync-browser";
const certificatePath = `${certificateDirectory}/cert.pem`;
const keyPath = `${certificateDirectory}/key.pem`;

mkdirSync(certificateDirectory, { recursive: true });
if (!existsSync(certificatePath) || !existsSync(keyPath)) {
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certificatePath,
      "-days",
      "7",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { timeout: 30_000 },
  );
}

const electric = process.env.ELECTRIC_URL ?? "http://localhost:5133";
try {
  const response = await fetch(`${electric}/v1/health`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
} catch (error) {
  console.error(
    `Electric is not reachable at ${electric} (${String(error)}). Start the stack with: pnpm stack:up`,
  );
  process.exit(1);
}
console.log("Sync browser suite: local TLS material ready and Electric is up.");
