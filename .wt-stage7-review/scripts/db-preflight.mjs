#!/usr/bin/env node
//
// FDN-55 Stage 1. Fail fast, with one actionable line, when a gate that needs
// Postgres is run without Postgres up.
//
// `pnpm verify` is hermetic and never calls this. The integration and
// browser gates do, so a `pnpm verify:full` or a bare `pnpm --filter @vulto/api
// test` on a machine with no stack running stops here — before vitest boots,
// before Better Auth connects — with the fix, not with an ECONNREFUSED stack
// trace from three layers down.

import net from "node:net";

// The same default `services/api/vitest.config.ts` uses, so the message names
// the URL the tests will actually try.
const url =
  process.env.DATABASE_URL ?? "postgres://vulto:vulto@localhost:5432/vulto_fdn60_test";

let host = "localhost";
let port = 5432;
try {
  const parsed = new URL(url);
  host = parsed.hostname || host;
  port = Number(parsed.port) || port;
} catch {
  // Keep the defaults; the connect attempt below is what actually matters.
}

const TIMEOUT_MS = 2000;

function reachable() {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(TIMEOUT_MS);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

if (await reachable()) {
  process.exit(0);
}

process.stderr.write(
  [
    "",
    `  ✗ Postgres is not reachable at ${host}:${port}`,
    `    (${url})`,
    "",
    "    This gate needs the local stack. Start it with:",
    "",
    "        pnpm stack:up",
    "",
    "    First run also needs the test database migrated:",
    "",
    "        DATABASE_URL=<url> pnpm --dir services/api exec drizzle-kit migrate --config drizzle.config.ts",
    "",
  ].join("\n") + "\n",
);
process.exit(1);
