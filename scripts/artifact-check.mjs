#!/usr/bin/env node
//
// FDN-91 — the production-artifact check.
//
// Every browser-only diagnostics harness under apps/roster-web/src/app must
// stay OUT of the shipped bundle. next.config.ts does that by aliasing each
// route's `./<route>-client` import to nothing in the optimized build. That
// list is hand-maintained, and a missing fourth entry (graph-sync) shipped a
// ~50 kB chunk across an FDN-52 checkpoint that claimed to have verified the
// artifact was clean (F192).
//
// This check removes the trust. It derives what must be excluded from the
// routes that actually exist, so a newly added diagnostics route is caught by
// default — not by someone remembering to update a list.
//
//   1. Structural — every `*-diagnostics` route that imports a `./*-client`
//      module must have that module in next.config.ts's alias exclusion list.
//   2. Artifact — no diagnostics `window` global, and no unchecked-mutation
//      client factory, may appear in a built production chunk.
//
// Run after `next build` in apps/roster-web. Not part of hermetic `pnpm
// verify` (it needs a real build); it runs in FDN-55's slow lane after the
// production build, and locally via `pnpm --filter roster-web build && node
// scripts/artifact-check.mjs`.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const APP_DIR = "apps/roster-web/src/app";
const NEXT_CONFIG = "apps/roster-web/next.config.ts";
const CHUNK_DIRS = [
  "apps/roster-web/.next/static/chunks",
  "apps/roster-web/.next/server/app",
];

/** Recursively collect files matching `test(path)`. */
function walk(dir, test, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, test, out);
    else if (test(path)) out.push(path);
  }
  return out;
}

const fail = (lines) => {
  process.stderr.write(["", ...lines, ""].join("\n") + "\n");
  process.exit(1);
};

// ── 1. Which routes are diagnostics routes, and what does each import ─────────

const diagnosticsRoutes = readdirSync(APP_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /diagnostics/.test(e.name))
  .map((e) => e.name)
  .sort();

const nextConfig = readFileSync(NEXT_CONFIG, "utf8");
const clientImport = /from\s+["'](\.\/[\w-]*client)["']/g;

const structuralProblems = [];

for (const route of diagnosticsRoutes) {
  let page;
  try {
    page = readFileSync(join(APP_DIR, route, "page.tsx"), "utf8");
  } catch {
    structuralProblems.push(
      `  ${route}/ has no page.tsx — a diagnostics folder that is not a route?`,
    );
    continue;
  }

  const imports = [...page.matchAll(clientImport)].map((m) => m[1]);
  if (imports.length === 0) {
    structuralProblems.push(
      `  ${route}/page.tsx does not import a "./*-client" module — its implementation is inline and will ship. Split the client out (so it can be aliased) or delete the route.`,
    );
    continue;
  }
  for (const spec of imports) {
    // The page imports "./x-client"; the webpack alias key is "./x-client$".
    const wanted = `"${spec}$": false`;
    if (!nextConfig.includes(wanted)) {
      structuralProblems.push(
        `  ${route}: next.config.ts is missing \`${wanted}\` — this route's client will be bundled into production.`,
      );
    }
  }
}

if (structuralProblems.length > 0) {
  fail([
    "  ✗ diagnostics route(s) not excluded from the production build:",
    "",
    ...structuralProblems,
    "",
    `  Add the alias to ${NEXT_CONFIG}'s \`config.resolve.alias\` block.`,
  ]);
}

// ── 2. Forbidden symbols, derived from the diagnostics client sources ────────

const forbidden = new Set(["createUncheckedLocalGraphClient"]);
for (const route of diagnosticsRoutes) {
  let client;
  try {
    client = readFileSync(join(APP_DIR, route, `${route}-client.tsx`), "utf8");
  } catch {
    continue;
  }
  for (const [, id] of client.matchAll(/window\.(__vulto[A-Za-z0-9]+)\b/g)) {
    forbidden.add(id);
  }
}

// ── 3. Walk the built chunks ────────────────────────────────────────────────

const chunks = CHUNK_DIRS.flatMap((dir) => walk(dir, (p) => p.endsWith(".js")));
if (chunks.length === 0) {
  fail([
    `  ✗ no built chunks under ${CHUNK_DIRS.join(" or ")}`,
    "    run `pnpm --filter roster-web build` first",
  ]);
}

const hits = [];
for (const file of chunks) {
  const text = readFileSync(file, "utf8");
  for (const needle of forbidden) {
    if (text.includes(needle)) hits.push(`    ${needle}  in  ${file}`);
  }
}

if (hits.length > 0) {
  fail([
    "  ✗ production artifact contains a diagnostics or test-only symbol:",
    "",
    ...hits,
    "",
    "  A diagnostics client is being compiled into a shipped chunk. Confirm its",
    `  "./*-client" import is aliased to false in ${NEXT_CONFIG} for the`,
    "  non-dev build (see FDN-91).",
  ]);
}

process.stdout.write(
  `  ✓ ${chunks.length} production chunks clean · ${diagnosticsRoutes.length} diagnostics routes, all excluded · guarded symbols: ${[...forbidden].sort().join(", ")}\n`,
);
