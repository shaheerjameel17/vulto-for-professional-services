#!/usr/bin/env node
//
// FDN-55 Stage 1 — architecture assertions that have no package to live in
// as an ESLint rule.
//
// Two rules live here.
//
//   1. A001-T08's isolation constraint on `services/cross-tenant-aggregation`.
//      That service does not exist yet (FDN-82 / F73 carries the decision to
//      defer it to VRS-F071), so this check is dormant — but it is written
//      now, per founder ruling, because "must not share a database" is the
//      kind of constraint that is satisfied by accident while the service is
//      absent and then violated by a convenience import the day someone
//      builds it.
//
//   2. The graph store's import boundary (Stage 2, A003-T52). Only the
//      graph, permission, mutations, protected, audience and jobs folders of
//      `services/api/src` may import `graph/store`, and only
//      `graph/membership-projection.ts` may name the authority that lets a
//      `User` row be written (F204).
//
//   4. Graph writes (Stage 4, A003-T52). Only the mutation pipeline
//      (`services/api/src/mutations`) and the graph module's own founding and
//      membership code may call the store's write functions, and nothing
//      outside `services/api/src/graph` may write `graph_nodes` or
//      `graph_edges` through Drizzle. Test files are exempt.
//
//   5. Cryptography (Stage 5, A003-T73, A007-T08). Only
//      `crypto/aws-kms-key-provider.ts` may import the AWS KMS SDK, and the
//      field-decryption function (`crypto/decrypt`) may be imported only from
//      `protected/read.ts`, `jobs/principal.ts`, `protected/erasure.ts` and the
//      `crypto` folder itself.
//
//   3. The audit journal table (Stage 3, F198). Only `services/api/src/audit`
//      and `db.ts` may import `audit/schema`, so `appendAudit` is the one
//      writer of an AuditEntry.
//
// Both run from the current working directory, so a test can point the check
// at a temporary tree by running it there.
//

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";

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

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

let failed = false;

// ── Rule 1: A001-T08 ────────────────────────────────────────────────────────

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

if (!isDirectory(CROSS_TENANT_DIR)) {
  process.stdout.write(
    `  ✓ ${CROSS_TENANT_DIR} not present — A001-T08 isolation assertion is armed and dormant\n`,
  );
} else {
  const violations = [];
  for (const file of walk(CROSS_TENANT_DIR)) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (FORBIDDEN.some((re) => re.test(line))) {
          violations.push(`    ${file}:${i + 1}  ${line.trim()}`);
        }
      });
  }
  if (violations.length > 0) {
    failed = true;
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
  } else {
    process.stdout.write(`  ✓ ${CROSS_TENANT_DIR} — A001-T08 isolation holds\n`);
  }
}

// ── Rule 2: the graph store boundary ────────────────────────────────────────

const API_SRC = "services/api/src";
const STORE = `${API_SRC}/graph/store`;
const KMS_HOME = `${API_SRC}/crypto/aws-kms-key-provider.ts`;
const DECRYPT = `${API_SRC}/crypto/decrypt`;
const DECRYPT_IMPORTERS = new Set([
  `${API_SRC}/protected/read.ts`,
  `${API_SRC}/jobs/principal.ts`,
  `${API_SRC}/protected/erasure.ts`,
]);
const AUDIT_SCHEMA = `${API_SRC}/audit/schema`;
const AUTHORITY_HOMES = new Set([
  `${API_SRC}/graph/store.ts`,
  `${API_SRC}/graph/membership-projection.ts`,
]);
const STORE_IMPORTERS = [
  "graph",
  "permission",
  "mutations",
  "protected",
  "audience",
  "jobs",
].map((folder) => `${API_SRC}/${folder}/`);
const STORE_WRITES =
  /\b(insertNode|insertUserNode|insertEdge|updateNodeFields|softDeleteNode|closeEdge)\b/;
const SPECIFIER =
  /(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)["']([^"']+)["']/g;

if (!isDirectory(API_SRC)) {
  process.stdout.write(
    `  ✓ ${API_SRC} not present — graph store boundary not applicable\n`,
  );
} else {
  const storeViolations = [];
  const authorityViolations = [];
  const auditViolations = [];
  const writeViolations = [];
  const cryptoViolations = [];
  for (const raw of walk(API_SRC)) {
    const file = raw.split(sep).join("/");
    const text = readFileSync(raw, "utf8");
    const allowedImporter = STORE_IMPORTERS.some((prefix) => file.startsWith(prefix));
    if (!allowedImporter) {
      text.split("\n").forEach((line, i) => {
        for (const match of line.matchAll(SPECIFIER)) {
          const specifier = match[1];
          if (!specifier.startsWith(".")) continue;
          const resolved = normalize(join(dirname(file), specifier))
            .split(sep)
            .join("/")
            .replace(/\.(js|ts)$/, "");
          if (resolved === STORE) {
            storeViolations.push(`    ${file}:${i + 1}  ${line.trim()}`);
          }
        }
      });
    }
    if (!file.startsWith(`${API_SRC}/audit/`) && file !== `${API_SRC}/db.ts`) {
      text.split("\n").forEach((line, i) => {
        for (const match of line.matchAll(SPECIFIER)) {
          const specifier = match[1];
          if (!specifier.startsWith(".")) continue;
          const resolved = normalize(join(dirname(file), specifier))
            .split(sep)
            .join("/")
            .replace(/\.(js|ts)$/, "");
          if (resolved === AUDIT_SCHEMA) {
            auditViolations.push(`    ${file}:${i + 1}  ${line.trim()}`);
          }
        }
      });
    }
    text.split("\n").forEach((line, i) => {
      for (const match of line.matchAll(SPECIFIER)) {
        const specifier = match[1];
        if (specifier.startsWith("@aws-sdk/client-kms") && file !== KMS_HOME) {
          cryptoViolations.push(`    ${file}:${i + 1}  ${line.trim()}`);
        }
        if (!specifier.startsWith(".")) continue;
        const resolved = normalize(join(dirname(file), specifier))
          .split(sep)
          .join("/")
          .replace(/\.(js|ts)$/, "");
        if (
          resolved === DECRYPT &&
          !DECRYPT_IMPORTERS.has(file) &&
          !file.startsWith(`${API_SRC}/crypto/`)
        ) {
          cryptoViolations.push(`    ${file}:${i + 1}  ${line.trim()}`);
        }
      }
    });
    const isTest = /\.test\.ts$/.test(file) || file.endsWith("/test-support.ts");
    if (!isTest && !file.startsWith(`${API_SRC}/graph/`)) {
      const inPipeline = file.startsWith(`${API_SRC}/mutations/`);
      text.split("\n").forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (/\.(insert|update|delete)\(\s*graph(Nodes|Edges)\b/.test(line)) {
          writeViolations.push(`    ${file}:${i + 1}  ${line.trim()}`);
        } else if (!inPipeline && STORE_WRITES.test(line)) {
          writeViolations.push(`    ${file}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    if (
      !AUTHORITY_HOMES.has(file) &&
      text.includes("grantMembershipProjectionAuthority")
    ) {
      authorityViolations.push(`    ${file}`);
    }
  }
  if (storeViolations.length > 0) {
    failed = true;
    process.stderr.write(
      [
        "",
        "  ✗ A003-T52 — graph/store may be imported only from the graph, permission,",
        "    mutations, protected, audience and jobs folders of services/api/src. Found:",
        "",
        ...storeViolations,
        "",
        "    Go through the mutation pipeline; nothing else writes the graph.",
        "",
      ].join("\n") + "\n",
    );
  }
  if (authorityViolations.length > 0) {
    failed = true;
    process.stderr.write(
      [
        "",
        "  ✗ F204 — grantMembershipProjectionAuthority may be named only in",
        "    graph/store.ts and graph/membership-projection.ts. Found:",
        "",
        ...authorityViolations,
        "",
      ].join("\n") + "\n",
    );
  }
  if (writeViolations.length > 0) {
    failed = true;
    process.stderr.write(
      [
        "",
        "  ✗ A003-T52 — the graph is written only by the mutation pipeline. Found:",
        "",
        ...writeViolations,
        "",
        "    Define a named mutation in packages/schema instead.",
        "",
      ].join("\n") + "\n",
    );
  }
  if (cryptoViolations.length > 0) {
    failed = true;
    process.stderr.write(
      [
        "",
        "  ✗ A003-T73 / A007-T08 — only crypto/aws-kms-key-provider.ts may import the KMS SDK, and",
        "    crypto/decrypt only protected/read.ts, jobs/principal.ts and protected/erasure.ts. Found:",
        "",
        ...cryptoViolations,
        "",
      ].join("\n") + "\n",
    );
  }
  if (auditViolations.length > 0) {
    failed = true;
    process.stderr.write(
      [
        "",
        "  ✗ F198 — audit/schema may be imported only from services/api/src/audit and db.ts;",
        "    appendAudit is the only writer of an AuditEntry. Found:",
        "",
        ...auditViolations,
        "",
      ].join("\n") + "\n",
    );
  }
  if (
    storeViolations.length === 0 &&
    authorityViolations.length === 0 &&
    auditViolations.length === 0 &&
    writeViolations.length === 0 &&
    cryptoViolations.length === 0
  ) {
    process.stdout.write(`  ✓ ${STORE} — import boundary holds\n`);
  }
}

process.exit(failed ? 1 : 0);
