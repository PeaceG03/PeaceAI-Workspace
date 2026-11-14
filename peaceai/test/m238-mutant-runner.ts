// One weakening-guard case set against a mutant of specgrade.ts or practicereplay.ts.
import assert from "node:assert/strict";
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
  const dev = { repo: "sindresorhus/is", split: "dev", fixSha: "cb4ee0e92cd3bff8353bb6738bd1f54db87dc293", status: "pass", reason: "GATE_PASS_AND_TEST", gap: false, understanding: "text" };
  const held = { ...dev, split: "held-out" };
  const defu = { repo: "unjs/defu", split: "dev", fixSha: "11ba02213d4b1c6b02dd686041f75edc479c98e9", status: "pass", reason: "GATE_PASS_AND_TEST", gap: false, understanding: "text" };
  check("dev-only", () => { assert.equal(mod.seededIdiom(held), null); });
  check("seed-sha", () => {
    assert.equal(mod.seededIdiom(dev), "enum-values");
    assert.equal(mod.seededIdiom({ ...dev, fixSha: "a".repeat(40) }), null);
    const doc = mod.replayDocument([dev, held, defu]);
    assert.deepEqual(doc.excludedFromCredit.map((row: { idiom: string }) => row.idiom).sort(), ["enum-values", "own-keys"]);
    assert.equal(doc.creditCounts.text.dev.pass, 0);
  });
  const row = { scorable: true, core: "ok", job: { status: "pass", reason: "JOB_A_CANDIDATES:1" }, gatePass: true, beforeExit: 1, afterExit: 0 };
  check("text-cap", () => {
    assert.equal(mod.textFlipVerdict(true, false), "verified_test_only");
    assert.equal(mod.gradePracticeRow({ ...row, behavior: mod.textFlipVerdict(true, false) }).reason, "VERIFIED_TEST_ONLY");
  });
  check("probe-agree", () => {
    assert.equal(mod.textFlipVerdict(true, true), "verified_test_only");
    assert.notEqual(mod.gradePracticeRow({ ...row, behavior: mod.textFlipVerdict(true, true) }).status, "pass");
  });
}

process.stdout.write(JSON.stringify({ failed, crashed }) + "\n");
