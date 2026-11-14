// A dropped && guard is test-only. Fixtures are bakery code written for these tests.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { diffDropsGuard } from "../bin/practice-replay.ts";
import { gradeTextFlip, replayDocument, seededIdiom } from "../lib/practicereplay.ts";
import { droppedGuardConjunct, gradeBehavior } from "../lib/specgrade.ts";

const bake = (body: string) => `export function bake(batch: { ok: boolean; hot: boolean }): boolean {\n  ${body}\n}\n`;
const FIX = bake("return batch.ok && batch.hot;");
const WEAK = bake("return batch.ok;");
const STRONGER = bake("return batch.ok && batch.hot && batch.ok !== batch.hot;");
const COUNT = (expr: string) => `export function tally(count: number): number {\n  return ${expr};\n}\n`;
const EITHER = (expr: string) => `export function serve(fresh: boolean, cached: boolean): boolean {\n  return ${expr};\n}\n`;

test("dropping an && conjunct is a broader predicate, and a strengthening is not", () => {
  assert.equal(droppedGuardConjunct(FIX, WEAK), true);
  assert.equal(droppedGuardConjunct(FIX, bake("return ready(batch);")), true);
  assert.equal(droppedGuardConjunct(FIX, STRONGER), false);
  assert.equal(droppedGuardConjunct(FIX, FIX), false);
  assert.equal(droppedGuardConjunct(COUNT("count + 1"), COUNT("count + 2")), false);
  assert.equal(droppedGuardConjunct(EITHER("fresh || cached"), EITHER("fresh")), false);
  const nestedFix = [
    "export function bake(batch: { ok: boolean; hot: boolean }): boolean {",
    "  function note(x: { left: boolean; right: boolean }): boolean { return x.left && x.right; }",
    "  return batch.ok && batch.hot;",
    "}",
  ].join("\n");
  const nestedWeak = [
    "export function bake(batch: { ok: boolean; hot: boolean }): boolean {",
    "  function note(x: { left: boolean; right: boolean }): boolean { return x.left; }",
    "  return batch.ok && batch.hot && x.left && x.right;",
    "}",
  ].join("\n");
  assert.equal(droppedGuardConjunct(nestedFix, nestedWeak), true);
});

test("a text flip that dropped a guard is not a pass, and one that kept it is", () => {
  const base = { scorable: true as const, core: "ok" as const, job: { status: "pass" as const, reason: "JOB_A_CANDIDATES:1" }, gatePass: true, beforeExit: 1, afterExit: 0 };
  assert.equal(gradeTextFlip({ ...base, dropsGuard: true }).reason, "VERIFIED_TEST_ONLY");
  assert.equal(gradeTextFlip({ ...base, dropsGuard: false }).status, "pass");
  assert.equal(gradeTextFlip({ ...base, dropsGuard: true, afterExit: 1 }).reason, "TEST_STILL_FAILS");
});

test("the spec grader refuses a broader predicate before it probes", () => {
  const write = (text: string) => {
    const root = mkdtempSync(join(tmpdir(), "peaceai-guard-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/oven.ts"), text);
    return root;
  };
  const candidate = write(WEAK);
  const fix = write(FIX);
  try {
    const grade = gradeBehavior({
      candidateRoot: candidate, fixRoot: fix, nodePath: process.execPath,
      target: { symbol: "bake", file: "src/oven.ts", form: "named", exportName: "bake", args: [[{ ok: true, hot: true }]] },
    });
    assert.equal(grade.behavior, "verified_test_only");
  } finally {
    rmSync(candidate, { recursive: true, force: true });
    rmSync(fix, { recursive: true, force: true });
  }
});

test("seeded idiom rows are excluded from credit, and a held-out row with the same sha is not", () => {
  const idiom = "enum-values" as const;
  const dev = { repo: "sindresorhus/is", split: "dev" as const, fixSha: "cb4ee0e92cd3bff8353bb6738bd1f54db87dc293", status: "pass" as const, reason: "GATE_PASS_AND_TEST", gap: false, understanding: "text" as const };
  const held = { ...dev, split: "held-out" as const, status: "fail" as const, reason: "VERIFIED_TEST_ONLY", gap: true };
  const other = { ...dev, fixSha: "a".repeat(40) };
  const defu = { repo: "unjs/defu", split: "dev" as const, fixSha: "11ba02213d4b1c6b02dd686041f75edc479c98e9", status: "pass" as const, reason: "GATE_PASS_AND_TEST", gap: false, understanding: "text" as const };
  assert.equal(seededIdiom(dev), idiom);
  assert.equal(seededIdiom(held), null);
  assert.equal(seededIdiom(other), null);
  assert.equal(seededIdiom(defu), "own-keys");
  const doc = replayDocument([dev, held, defu]);
  assert.deepEqual(doc.excludedFromCredit.map((row) => row.idiom).sort(), ["enum-values", "own-keys"]);
  assert.equal(doc.excludedFromCredit.every((row) => row.split === "dev"), true);
  assert.equal(doc.rows.find((row) => row.fixSha === dev.fixSha)?.excludedFromCredit, idiom);
  assert.equal("excludedFromCredit" in (doc.rows.find((row) => row.split === "held-out") ?? {}), false);
  assert.equal(doc.counts.text.dev.pass, 2);
  assert.equal(doc.creditCounts.text.dev.pass, 0);
});

test("a candidate diff that drops the fix's conjunct is reported from the two trees", () => {
  const repo = mkdtempSync(join(tmpdir(), "peaceai-guard-repo-"));
  const git = (...args: string[]) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  try {
    git("init", "-q");
    git("config", "user.email", "guard@example.com");
    git("config", "user.name", "guard");
    mkdirSync(join(repo, "src"));
    const file = join(repo, "src/oven.ts");
    writeFileSync(file, WEAK);
    git("add", "src/oven.ts");
    git("commit", "-q", "-m", "base");
    const base = git("rev-parse", "HEAD").stdout.trim();
    writeFileSync(file, FIX);
    git("add", "src/oven.ts");
    git("commit", "-q", "-m", "fix");
    const fix = git("rev-parse", "HEAD").stdout.trim();
    git("checkout", "-q", base);
    writeFileSync(file, WEAK.replace("return batch.ok;", "return batch.ok; // still one check"));
    const weakDiff = git("diff", "--", "src/oven.ts").stdout;
    assert.equal(diffDropsGuard(repo, base, fix, weakDiff), true);
    writeFileSync(file, FIX);
    const keepDiff = git("diff", "--", "src/oven.ts").stdout;
    assert.equal(diffDropsGuard(repo, base, fix, keepDiff), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
