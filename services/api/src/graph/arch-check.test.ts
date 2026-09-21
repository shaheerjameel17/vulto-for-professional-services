import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../../../../scripts/arch-check.mjs", import.meta.url),
);
const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Runs the real check against a throwaway tree containing only `files`. */
function archCheck(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "vulto-arch-"));
  temps.push(root);
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: "utf8" });
}

const STORE = "services/api/src/graph/store.ts";
// Assembled here so this file does not itself name the identifier the rule guards.
const AUTHORITY = ["grantMembership", "ProjectionAuthority"].join("");

describe("arch-check — the graph store import boundary", () => {
  it("fails when a file outside the allowed folders imports the store", () => {
    const result = archCheck({
      [STORE]: "export const x = 1;\n",
      "services/api/src/auth/rogue.ts":
        'import { x } from "../graph/store.js";\nvoid x;\n',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("A003-T52");
    expect(result.stderr).toContain("services/api/src/auth/rogue.ts");
  });

  it("catches a dynamic import and a top-level file too", () => {
    const dynamic = archCheck({
      [STORE]: "export const x = 1;\n",
      "services/api/src/routes/late.ts": 'const s = await import("../graph/store");\n',
    });
    expect(dynamic.status).toBe(1);
    const topLevel = archCheck({
      [STORE]: "export const x = 1;\n",
      "services/api/src/server.ts": 'import "./graph/store.js";\n',
    });
    expect(topLevel.status).toBe(1);
  });

  it("passes for every allowed folder", () => {
    const files: Record<string, string> = { [STORE]: "export const x = 1;\n" };
    for (const folder of [
      "graph",
      "permission",
      "mutations",
      "protected",
      "audience",
      "jobs",
    ]) {
      const spec = folder === "graph" ? "./store.js" : "../graph/store.js";
      files[`services/api/src/${folder}/user.ts`] =
        `import { x } from "${spec}";\nvoid x;\n`;
    }
    const result = archCheck(files);
    expect(result.status, result.stderr).toBe(0);
  });

  it("fails when anything but the membership projection names the User authority", () => {
    const bad = archCheck({
      [STORE]: `export const ${AUTHORITY} = () => 1;\n`,
      "services/api/src/graph/other.ts": `${AUTHORITY}();\n`,
    });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("F204");
    const good = archCheck({
      [STORE]: `export const ${AUTHORITY} = () => 1;\n`,
      "services/api/src/graph/membership-projection.ts": `${AUTHORITY}();\n`,
    });
    expect(good.status, good.stderr).toBe(0);
  });

  it("passes on the real repository", () => {
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
  });
});
