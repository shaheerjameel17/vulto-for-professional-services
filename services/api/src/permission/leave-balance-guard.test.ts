import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("VRS-F018 G05 source guard", () => {
  it("has no I/O or independent calendar-day arithmetic in the pure module", () => {
    for (const module of ["leave-balance", "toil"]) {
      const source = readFileSync(
        new URL(`../../../../packages/schema/src/${module}.ts`, import.meta.url),
        "utf8",
      );
      expect(source).not.toMatch(
        /86400000|86_400_000|getTime\s*\(|Date\.parse|setUTCDate|new Date|node:|fetch\s*\(|(?:from|import)\s*["'][^"']*(?:drizzle|postgres|sqlite|\/db|database)/,
      );
    }
  });
});
