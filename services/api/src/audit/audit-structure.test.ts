import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
function files(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    return entry.isDirectory()
      ? files(path)
      : path.endsWith(".ts") && !path.endsWith(".test.ts")
        ? [path]
        : [];
  });
}

it("permits retained journal updates only in the pseudonymizer, no deletes, and only architecture-approved schema imports", () => {
  const violations: string[] = [];
  for (const file of files(root)) {
    const name = relative(root, file);
    const source = readFileSync(file, "utf8");
    if (
      /\.update\s*\(\s*auditJournal\b/.test(source) &&
      name !== "audit/pseudonymizer.ts"
    )
      violations.push(`${name}: retained journal update outside pseudonymizer`);
    if (/\.delete\s*\(\s*auditJournal\b/.test(source))
      violations.push(`${name}: retained journal deletion`);
    for (const match of source.matchAll(
      /(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)["']([^"']+)["']/g,
    )) {
      const specifier = match[1]!;
      if (!specifier.startsWith(".")) continue;
      const resolved = normalize(join(dirname(file), specifier)).replace(
        /\.(js|ts)$/,
        "",
      );
      if (
        resolved === join(root, "audit/schema") &&
        !name.startsWith("audit/") &&
        name !== "db.ts"
      )
        violations.push(`${name}: audit/schema import outside architecture allowlist`);
    }
  }
  expect(
    violations,
    "Audit journal is append-only: remove every forbidden write/import; only actor pseudonymization may update retained entries.",
  ).toEqual([]);
});
