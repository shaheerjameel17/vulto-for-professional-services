import { describe, expect, it } from "vitest";
import {
  currentWriteScope,
  recordWrite,
  runInWriteScope,
  withoutWriteScope,
} from "./write-log.js";

describe("scoped graph write log", () => {
  it("is absent outside a scope and deduplicates writes inside it", async () => {
    recordWrite("outside");
    expect(currentWriteScope()).toBeUndefined();
    await runInWriteScope(async () => {
      recordWrite("one");
      recordWrite("one");
      expect([...currentWriteScope()!]).toEqual(["one"]);
      await withoutWriteScope(async () => {
        recordWrite("delivery");
      });
      expect([...currentWriteScope()!]).toEqual(["one"]);
    });
    expect(currentWriteScope()).toBeUndefined();
  });
  it("isolates concurrent async flows", async () => {
    const run = (id: string) =>
      runInWriteScope(async () => {
        recordWrite(id);
        await Promise.resolve();
        return [...currentWriteScope()!];
      });
    expect(await Promise.all([run("a"), run("b")])).toEqual([["a"], ["b"]]);
  });
});
