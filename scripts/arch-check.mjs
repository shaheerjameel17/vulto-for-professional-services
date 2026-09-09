#!/usr/bin/env node
//
// FDN-55 Stage 1 — architecture assertions that have no package to live in
// as an ESLint rule.
//
// Today there is exactly one: A001-T08's isolation constraint on
// `services/cross-tenant-aggregation`. That service does not exist yet
// (FDN-82 / F73 carries the decision to defer it to VRS-F071), so this check
// is dormant — but it is written now, per founder ruling, because "must not
// share a database" is the kind of constraint that is satisfied by accident
// while the service is absent and then violated by a convenience import the
// day someone builds it.
//
// When the service exists, this fails the build if anything under it reaches
// for the per-workspace data path.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const CROSS_TENANT_DIR = "services/cross-tenant-aggregation";

// Import specifiers that mean "you are now sharing the per-workspace data
// path" — the exact thing A001-T08 forbids.
const FORBIDDEN = [
  /from\s+["'].*services\/api\/src\/db(\.js)?["']/,
  /from\s+["']@vulto\/api["']/,
  /from\s+["']drizzle-orm["']/,
  /from\s+["']postgres["']/,
  /from\s+["']@vulto\/api\/auth["']/,
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(path);
  }
  return out;
}

let dirExists = false;
try {
  dirExists = statSync(CROSS_TENANT_DIR).isDirectory();
} catch {
  dirExists = false;
}

if (!dirExists) {
  process.stdout.write(
    `  ✓ ${CROSS_TENANT_DIR} not present — A001-T08 isolation assertion is armed and dormant\n`,
  );
  process.exit(0);
}

const violations = [];
for (const file of walk(CROSS_TENANT_DIR)) {
  const text = readFileSync(file, "utf8");
  text.split("\n").forEach((line, i) => {
    if (FORBIDDEN.some((re) => re.test(line))) {
      violations.push(`    ${file}:${i + 1}  ${line.trim()}`);
    }
  });
}

if (violations.length > 0) {
  process.stderr.write(
    [
      "",
      `  ✗ A001-T08 — ${CROSS_TENANT_DIR} must not share a database, connection pool`,
      "    or process boundary with per-workspace data paths. Found:",
      "",
      ...violations,
      "",
      "    It receives only anonymized, pre-bucketed contributions over an",
      "    explicit boundary. See VRS-F071's Technical Architecture section.",
      "",
    ].join("\n") + "\n",
  );
  process.exit(1);
}

process.stdout.write(`  ✓ ${CROSS_TENANT_DIR} — A001-T08 isolation holds\n`);
process.exit(0);
