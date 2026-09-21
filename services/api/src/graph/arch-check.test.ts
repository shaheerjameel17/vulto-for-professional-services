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

  it("fails when anything but the audit module imports the journal table (F198)", () => {
    // Specifiers are assembled at runtime so this file does not itself match the rule.
    const dir = "../audit";
    const bad = archCheck({
      "services/api/src/audit/schema.ts": "export const auditJournal = 1;\n",
      "services/api/src/routes/rogue.ts": `import { auditJournal } from "${dir}/schema.js";\nvoid auditJournal;\n`,
    });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("F198");
    const good = archCheck({
      "services/api/src/audit/schema.ts": "export const auditJournal = 1;\n",
      "services/api/src/audit/journal.ts":
        'import { auditJournal } from "./schema.js";\nvoid auditJournal;\n',
      "services/api/src/db.ts": `import * as a from "./audit/${"schema"}.js";\nvoid a;\n`,
    });
    expect(good.status, good.stderr).toBe(0);
  });

  it("fails when anything but the pipeline writes the graph (A003-T52)", () => {
    // Identifiers are assembled at runtime so this file does not match the rule itself.
    const writer = ["insert", "Node"].join("");
    const drizzleWrite = `db.${["insert"].join("")}(${["graph", "Nodes"].join("")})`;
    const storeSource = `export const ${writer} = () => 1;\n`;
    const viaStore = archCheck({
      [STORE]: storeSource,
      "services/api/src/permission/rogue.ts": `import { ${writer} } from "../graph/store.js";\nvoid ${writer};\n`,
    });
    expect(viaStore.status).toBe(1);
    expect(viaStore.stderr).toContain("mutation pipeline");
    const viaDrizzle = archCheck({
      [STORE]: storeSource,
      "services/api/src/routes/rogue.ts": `${drizzleWrite};\n`,
    });
    expect(viaDrizzle.status).toBe(1);
    const allowed = archCheck({
      [STORE]: storeSource,
      "services/api/src/mutations/pipeline.ts": `import { ${writer} } from "../graph/store.js";\nvoid ${writer};\n`,
      "services/api/src/graph/founding.ts": `import { ${writer} } from "./store.js";\nvoid ${writer};\n`,
      "services/api/src/permission/reads.test.ts": `import { ${writer} } from "../graph/store.js";\nvoid ${writer};\n`,
    });
    expect(allowed.status, allowed.stderr).toBe(0);
  });

  it("fails when anything but the KMS provider imports the AWS SDK, or an unlisted module reaches decrypt", () => {
    // Specifiers are assembled at runtime so this file does not match the rule itself.
    const sdk = ["@aws-sdk", "client-kms"].join("/");
    const decrypt = ["../crypto", "decrypt.js"].join("/");
    const sdkBad = archCheck({
      "services/api/src/routes/rogue.ts": `import { KMSClient } from "${sdk}";\nvoid KMSClient;\n`,
    });
    expect(sdkBad.status).toBe(1);
    expect(sdkBad.stderr).toContain("A007-T08");
    const decryptBad = archCheck({
      "services/api/src/crypto/decrypt.ts": "export const decryptFragment = () => 1;\n",
      "services/api/src/routes/rogue.ts": `import { decryptFragment } from "${decrypt}";\nvoid decryptFragment;\n`,
    });
    expect(decryptBad.status).toBe(1);
    const good = archCheck({
      "services/api/src/crypto/decrypt.ts": "export const decryptFragment = () => 1;\n",
      "services/api/src/crypto/aws-kms-key-provider.ts": `import { KMSClient } from "${sdk}";\nvoid KMSClient;\n`,
      "services/api/src/protected/read.ts": `import { decryptFragment } from "${decrypt}";\nvoid decryptFragment;\n`,
      "services/api/src/protected/erasure.ts": `import { decryptFragment } from "${decrypt}";\nvoid decryptFragment;\n`,
      "services/api/src/jobs/principal.ts": `import { decryptFragment } from "${decrypt}";\nvoid decryptFragment;\n`,
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
