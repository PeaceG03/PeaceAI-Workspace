// M17 (Auditor): Job B harness for ADD_FUNCTION. A candidate whose new test also passes with the function body
// stubbed is REJECTED_PASSES_WITH_STUB (not eligible); a good one COUNTS with stubFails=true; a new-module
// candidate COUNTS too. A hand-edited result claiming COUNTS with stubFails=false is rejected by the validator.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { APPROVED_SCHEMA } from "../lib/approved.ts";
import { applyRule, specHash, type RuleSpec } from "../lib/learned.ts";
import { FUNCTION_TRIGGER } from "../lib/learned-function.ts";
import { PEACE_AUTHOR } from "../lib/minetest.ts";
import { buildRecords } from "../lib/records.ts";
import { validateResults, validTestGrading } from "../lib/results.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=PeaceG03", "-c", `user.email=${PEACE_AUTHOR}`, ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const P2 = { body: "single-return", grading: "self-fail-before-pass-after", params: "typed", placement: "end-of-module-or-new-module", returns: "annotated", test: "new-file" };
const spec: RuleSpec = {
  schema: "peaceai-learned-rule:v1", id: "public-add-function-v2", kind: "ADD_FUNCTION", minedFrom: "public", minerVersion: "peaceai-miner:v2", shape: "PURE_FUNCTION",
  trigger: FUNCTION_TRIGGER, params: P2, evidence: { hunks: 1, commits: 1, files: 1, repos: ["PeaceG03/PeaceSTOCKS"] },
};
const LIB = "export function scale(value: number, factor: number): number {\n  return value * factor;\n}\n";
const TSCONFIG = JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, allowImportingTsExtensions: true }, include: ["src"] });
const entry = { id: spec.id, sha256: specHash(spec), source: "workspace", approval: { url: "https://github.com/PeaceG03/PeaceAI-Workspace/issues/40#issuecomment-123", commentId: 123, issue: 40, repo: "PeaceG03/PeaceAI-Workspace", author: "PeaceG03", approvedAt: "2026-10-11T00:00:00Z" } };

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "m17h-"));
  const ws = join(dir, "ws");
  mkdirSync(join(ws, "src"), { recursive: true });
  writeFileSync(join(ws, "src/lib.ts"), LIB);
  writeFileSync(join(ws, "src/base.test.ts"), 'import test from "node:test";\ntest("base", () => {});\n');
  writeFileSync(join(ws, "tsconfig.json"), TSCONFIG);
  writeFileSync(join(ws, ".gitignore"), "node_modules\n");
  symlinkSync(join(repo, "node_modules"), join(ws, "node_modules"));
  git(ws, "init", "-q", "-b", "main"); git(ws, "add", "-A"); git(ws, "commit", "-qm", "base");
  const baseSha = git(ws, "rev-parse", "HEAD").trim();
  const candidate = (task: string) => {
    const e = applyRule(spec, task, [{ path: "src/lib.ts", content: LIB }, { path: "src/base.test.ts", content: "" }], (p) => /\.test\.ts$/.test(p))!;
    assert.ok(e, task);
    writeFileSync(join(ws, e.path), e.content);
    for (const x of e.extra!) writeFileSync(join(ws, x.path), x.content);
    git(ws, "add", "-N", "--", ...(e.create ? [e.path] : []), ...e.extra!.map((x) => x.path));
    const d = git(ws, "diff", "--no-color", "--full-index", "--no-renames");
    git(ws, "reset", "-q", "--hard"); git(ws, "clean", "-fdq");
    return d;
  };
  return { dir, ws, baseSha, candidate };
}

function grade(fx: ReturnType<typeof fixture>, diffs: string[]) {
  const inDir = join(fx.dir, "in");
  mkdirSync(join(inDir, "candidates"), { recursive: true });
  const candidates = diffs.map((d, i) => {
    writeFileSync(join(inDir, "candidates", `candidate-${i + 1}.diff`), d);
    return { id: `candidate-${i + 1}`, file: `candidates/candidate-${i + 1}.diff`, transformations: ["LEARNED_ADD_FUNCTION"], operationId: `learned:${spec.id}@${specHash(spec)}`, diffBytes: d.length, diffLines: 5, selfGrade: true as const };
  });
  const summary = { schema: "peaceai-workspace-candidates:v1", taskId: "workspace-issue-9", baseSha: fx.baseSha, candidates };
  writeFileSync(join(inDir, "summary.json"), JSON.stringify(summary));
  const list = join(fx.dir, "approved.json");
  writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [entry] }));
  const resultsFile = join(fx.dir, "out", "results.json");
  mkdirSync(join(fx.dir, "out"), { recursive: true });
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
  const r = spawnSync(tsx, [join(repo, "peaceai/bin/test-candidates.ts")], {
    cwd: repo, encoding: "utf8",
    env: { ...env, PEACEAI_IN_DIR: inDir, PEACEAI_RESULTS_FILE: resultsFile, PEACEAI_WORKSPACE_DIR: fx.ws, PEACEAI_TARGET: "PeaceG03/PeaceAI-Workspace", PEACEAI_SANDBOX_USER: "", PEACEAI_REQUIRE_SANDBOX: "", PEACEAI_APPROVED_LIST: list },
  });
  assert.equal(r.status, 0, r.stderr);
  const results = JSON.parse(readFileSync(resultsFile, "utf8"));
  assert.ok(validateResults(results));
  return { file: results, results: results.results, summary };
}

test("Job B: good append COUNTS (stubFails=true); stub-satisfied test is REJECTED_PASSES_WITH_STUB; new module COUNTS", () => {
  const fx = fixture();
  try {
    const good = fx.candidate("add function `pct(x: number, n: number): number` to `src/lib.ts` returning Math.round(x / n * 100)\n- `pct(1, 4)` is 25");
    const weak = fx.candidate("add function `isTwo(s: string): boolean` to `src/lib.ts` returning s.length === 2\n- `isTwo(\"abc\")` is false");
    const mod = fx.candidate("add function `pad2(n: number): string` to `src/pad.ts` returning String(n).padStart(2, \"0\")\n- `pad2(7)` is \"07\"");
    const { file, results, summary } = grade(fx, [good, weak, mod]);
    assert.deepEqual(results[0].testGrading, { fixSha: fx.baseSha, afterFix: true, beforeFix: false, verdict: "COUNTS", reason: null, stubFails: true });
    assert.deepEqual(results[1].testGrading, { fixSha: fx.baseSha, afterFix: true, beforeFix: false, verdict: "REJECTED_PASSES_WITH_STUB", reason: null, stubFails: false });
    assert.deepEqual(results[2].testGrading, { fixSha: fx.baseSha, afterFix: true, beforeFix: false, verdict: "COUNTS", reason: null, stubFails: true });
    const rec = buildRecords({ issue: 9, runId: "1", recordedAt: "2026-10-13T00:00:00Z", baseSha: fx.baseSha, title: "[test] f", body: "x" }, summary.candidates, results, "seed");
    assert.equal(rec.ranking.candidates[0]!.eligible, true);
    assert.equal(rec.ranking.candidates[1]!.eligible, false);
    assert.equal(rec.ranking.candidates[1]!.rejectReason, "test-grading");
    assert.equal(rec.ranking.candidates[2]!.eligible, true);

    // Hand-edited verdicts the validator must reject.
    const forged = structuredClone(file);
    forged.results[1].testGrading.verdict = "COUNTS"; // stubFails stays false
    assert.equal(validateResults(forged), false, "COUNTS with stubFails=false");
    const forged2 = structuredClone(file);
    forged2.results[0].testGrading.stubFails = false; // verdict stays COUNTS
    assert.equal(validateResults(forged2), false, "stubFails flipped to false under COUNTS");
    const forged3 = structuredClone(file);
    forged3.results[0].testGrading.stubFails = "false";
    assert.equal(validateResults(forged3), false, "non-boolean stubFails");
    assert.equal(validTestGrading(forged.results[1].testGrading), false);
  } finally { rmSync(fx.dir, { recursive: true, force: true }); }
});

test("protected (M17): generate.ts and the Job B check files", async () => {
  const { protectedReason } = await import("../lib/selfchange.ts");
  for (const f of ["peaceai/bin/generate.ts", "peaceai/bin/test-candidates.ts", "peaceai/bin/regate.ts", "peaceai/lib/records.ts", "peaceai/lib/rank.ts", "peaceai/lib/results.ts", "peaceai/lib/gate.ts", "peaceai/lib/diff.ts", "peaceai/lib/learned-function.ts", "peaceai/lib/rebase.ts"])
    assert.notEqual(protectedReason(f), null, f);
});
