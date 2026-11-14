// One weakening-guard case set against a mutant of specgrade.ts or practicereplay.ts.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

if (suite === "replay") {
  const row = { scorable: true, core: "ok", job: { status: "pass", reason: "JOB_A_CANDIDATES:1" }, gatePass: true, beforeExit: 1, afterExit: 0 };
  check("row-behavior", () => {
    assert.equal(mod.finishTextRow(true, { behavior: "verified_test_only", compared: 2 }, row).reason, "VERIFIED_TEST_ONLY");
  });
  const repo = mkdtempSync(join(tmpdir(), "peaceai-replay-mut-"));
  const git = (...args: string[]) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  try {
    git("init", "-q");
    git("config", "user.email", "guard@example.com");
    git("config", "user.name", "guard");
    mkdirSync(join(repo, "src"));
    mkdirSync(join(repo, "test"));
    const fixSource = "export function isPositive(value: unknown): boolean { return typeof value === \"number\" && value > 0; }\nexport function isClass(value: unknown): boolean { return typeof value === \"function\" && value.toString().startsWith(\"class\"); }\n";
    const baseSource = `${fixSource}// base\n`;
    const testText = "import assert from \"node:assert/strict\";\nimport { isPositive, isClass } from \"../src/predicates.ts\";\nassert.equal(isPositive(1), true);\nfor (const value of [class {}, function () {}]) { assert.equal(isClass(value), true); }\n";
    writeFileSync(join(repo, "src/predicates.ts"), baseSource);
    writeFileSync(join(repo, "test/predicates.test.ts"), testText);
    git("add", ".");
    git("commit", "-q", "-m", "base");
    const base = git("rev-parse", "HEAD").stdout.trim();
    writeFileSync(join(repo, "src/predicates.ts"), fixSource);
    git("add", "src/predicates.ts");
    git("commit", "-q", "-m", "fix");
    const fix = git("rev-parse", "HEAD").stdout.trim();
    git("checkout", "-q", base);
    writeFileSync(join(repo, "src/predicates.ts"), fixSource.replace(" && value.toString().startsWith(\"class\")", ""));
    const weakDiff = git("diff", "--", "src/predicates.ts").stdout;
    git("checkout", "-q", "-f", base);
    const grade = (diff: string, fixSha: string) => mod.gradeTextCandidate({
      repoDir: repo, baseSha: base, fixSha, diff, testFile: "test/predicates.test.ts",
      sourcePattern: "^src/.*\\.ts$", nodePath: process.execPath,
    });
    check("changed-cover", () => { assert.equal(grade(weakDiff, fix).behavior, "verified_test_only"); });
    git("checkout", "-q", base);
    writeFileSync(join(repo, "src/oven.ts"), "export const label = \"cold\";\nexport function warm(n: number): boolean { return n > 0; }\n");
    writeFileSync(join(repo, "test/oven.test.ts"), "import \"../src/oven.ts\";\n");
    git("add", ".");
    git("commit", "-q", "-m", "label");
    const labelBase = git("rev-parse", "HEAD").stdout.trim();
    writeFileSync(join(repo, "src/oven.ts"), "export const label = \"warm\";\nexport function warm(n: number): boolean { return n > 0; }\n");
    const labelDiff = git("diff", "--", "src/oven.ts").stdout;
    git("add", "src/oven.ts");
    git("commit", "-q", "-m", "relabel");
    const labelFix = git("rev-parse", "HEAD").stdout.trim();
    check("no-targets", () => {
      const empty = mod.gradeTextCandidate({
        repoDir: repo, baseSha: labelBase, fixSha: labelFix, diff: labelDiff, testFile: "test/oven.test.ts",
        sourcePattern: "^src/.*\\.ts$", nodePath: process.execPath,
      });
      assert.notEqual(empty.behavior, "verified_strict");
      assert.notEqual(mod.finishTextRow(true, empty, row).reason, "GATE_PASS_AND_TEST");
    });
    check("unavailable", () => {
      const missing = mod.gradeTextCandidate({
        repoDir: repo, baseSha: labelBase, fixSha: "0".repeat(40), diff: labelDiff, testFile: "test/oven.test.ts",
        sourcePattern: "^src/.*\\.ts$", nodePath: process.execPath,
      });
      assert.notEqual(missing.behavior, "verified_strict");
      assert.notEqual(mod.finishTextRow(true, missing, row).reason, "GATE_PASS_AND_TEST");
    });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

process.stdout.write(JSON.stringify({ failed, crashed }) + "\n");
