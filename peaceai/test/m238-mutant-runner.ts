// One weakening-guard case set against a mutant of specgrade.ts or practicereplay.ts.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const mod = await import(pathToFileURL(process.argv[2]!).href);
const suite = process.argv[3]!;
const failed: string[] = [];
const crashed: string[] = [];

function check(id: string, run: () => void): void {
  try { run(); } catch (e) {
    const top = e instanceof Error ? (e.stack ?? "").split("\n").find((l) => l.trim().startsWith("at ")) ?? "" : "";
    if (e instanceof assert.AssertionError || !top.includes("mutant-")) failed.push(id);
    else crashed.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const bake = (body: string) => `export function bake(batch: { ok: boolean; hot: boolean }): boolean {\n  ${body}\n}\n`;
const fix = bake("return batch.ok && batch.hot;");
const weak = bake("return batch.ok;");
const nestedFix = "export function bake(batch: { ok: boolean; hot: boolean }): boolean {\n  function note(x: { left: boolean; right: boolean }): boolean { return x.left && x.right; }\n  return batch.ok && batch.hot;\n}\n";
const nestedWeak = "export function bake(batch: { ok: boolean; hot: boolean }): boolean {\n  function note(x: { left: boolean; right: boolean }): boolean { return x.left; }\n  return batch.ok && batch.hot && x.left && x.right;\n}\n";

if (suite === "grade") {
  check("and-only", () => { assert.equal(mod.droppedGuardConjunct(fix, weak), true); });
  check("and-width", () => { assert.equal(mod.droppedGuardConjunct("export function tally(count: number): number { return count + 1; }\n", "export function tally(count: number): number { return count + 2; }\n"), false); });
  check("fn-name", () => { assert.equal(mod.droppedGuardConjunct(fix, weak), true); });
  check("nested", () => { assert.equal(mod.droppedGuardConjunct(nestedFix, nestedWeak), true); });
  check("candidate-operands", () => { assert.equal(mod.droppedGuardConjunct(fix, weak), true); });
  check("operand-kept", () => { assert.equal(mod.droppedGuardConjunct(fix, fix), false); });
  check("or-kept", () => { assert.equal(mod.droppedGuardConjunct("export function serve(fresh: boolean, cached: boolean): boolean { return fresh || cached; }\n", "export function serve(fresh: boolean, cached: boolean): boolean { return fresh; }\n"), false); });
}

if (suite === "report") {
  const dev = { repo: "sindresorhus/is", split: "dev", fixSha: "cb4ee0e92cd3bff8353bb6738bd1f54db87dc293" };
  const held = { ...dev, split: "held-out" };
  check("dev-only", () => { assert.equal(mod.seededIdiom(held), null); });
  check("seed-sha", () => { assert.equal(mod.seededIdiom(dev), "enum-values"); assert.equal(mod.seededIdiom({ ...dev, fixSha: "a".repeat(40) }), null); });
  const diff = ["+++ b/src/oven.ts", "+++ b/test/oven.ts", "+++ b/__tests__/oven.ts", "+++ b/src/oven.test.ts", ""].join("\n");
  check("path-filter", () => { assert.deepEqual(mod.sourcePaths(diff), ["src/oven.ts"]); });
  check("text-probe", () => { assert.equal(mod.textProbeVerdict({ behavior: "verified_test_only", compared: 2 }), "verified_test_only"); });
  check("probe-cap", () => { assert.equal(mod.textProbeVerdict({ behavior: "diff_unavailable", compared: 0 }), "verified_test_only"); });
  check("text-wire", () => { assert.equal(mod.textFlipBehavior(true, { behavior: "verified_test_only", compared: 2 }), "verified_test_only"); });
}

process.stdout.write(JSON.stringify({ failed, crashed }) + "\n");
