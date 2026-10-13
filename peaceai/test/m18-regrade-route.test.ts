// M18 (Auditor option b): a stale-base verdict posts a hash-pinned regrade request instead of a patch; the
// re-queued run re-applies exactly that diff onto the current head (plain apply, else refused), Job B grades it
// fresh, and the Results task record carries `regradeOf`. The old grade is never carried forward.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { APPROVED_SCHEMA } from "../lib/approved.ts";
import { validateSummary } from "../lib/gate.ts";
import { specHash, type RuleSpec } from "../lib/learned.ts";
import { FUNCTION_TRIGGER } from "../lib/learned-function.ts";
import { PEACE_AUTHOR } from "../lib/minetest.ts";
import { buildRecords } from "../lib/records.ts";
import { chosenMetaOf, parseRegradeComment, pendingRegrade, REGRADE_MARKER, regradeComment, regradeOf, validRegradeOf, type ChosenMeta } from "../lib/regrade.ts";
import { protectedReason } from "../lib/selfchange.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const A = "a".repeat(40), B = "b".repeat(40);
const DIFF = "diff --git a/src/x.ts b/src/x.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/x.ts\n@@ -0,0 +1 @@\n+export const x = 1;\n";
const META: ChosenMeta = { runId: "123", candidateId: "candidate-1", baseSha: A, transformations: ["LEARNED_ADD_FUNCTION"], operationId: "learned:public-add-function-v2@" + "c".repeat(64), selfGrade: true };

test("request: round-trips; tampered diff, bad meta, not-stale and oversized are refused", () => {
  const body = regradeComment(META, B, DIFF)!;
  assert.ok(body.startsWith(REGRADE_MARKER));
  const r = parseRegradeComment(body)!;
  assert.equal(r.diff, DIFF);
  assert.equal(r.newHead, B);
  assert.deepEqual(regradeOf(r), { runId: "123", candidateId: "candidate-1", oldBase: A, diffSha256: r.diffSha256 });
  assert.equal(parseRegradeComment(body.replace("export const x = 1;", "export const x = 2;")), null, "diff no longer matches its hash");
  assert.equal(parseRegradeComment(body.replace('"runId":"123"', '"runId":"12x"')), null);
  assert.equal(regradeComment(META, A, DIFF), null, "head == base is not stale");
  assert.equal(regradeComment(META, B, "x".repeat(70_000)), null);
  assert.equal(regradeComment({ ...META, candidateId: "c1" } as ChosenMeta, B, DIFF), null);
  assert.ok(regradeComment(META, B, "+```\n" + DIFF), "a diff containing a fence still round-trips");
  assert.equal(parseRegradeComment(regradeComment(META, B, "+```\n" + DIFF)!)!.diff, "+```\n" + DIFF);
});

test("pending: only the newest bot comment counts; a later review or refusal consumes it; others' comments ignored", () => {
  const req = { user: "github-actions[bot]", body: regradeComment(META, B, DIFF)! };
  assert.ok(pendingRegrade([req]));
  assert.ok(pendingRegrade([req, { user: "PeaceG03", body: "/verdict A right" }]));
  assert.equal(pendingRegrade([req, { user: "github-actions[bot]", body: "PeaceAI review. Each candidate..." }]), null);
  assert.equal(pendingRegrade([req, { user: "github-actions[bot]", body: "PeaceAI: no candidates generated for this task." }]), null);
  assert.equal(pendingRegrade([{ user: "PeaceG03", body: req.body }]), null, "only the workflow bot can request");
});

test("chosen meta from Results: selfGrade when graded against the task base, else fixSha", () => {
  const c = { id: "candidate-2", transformations: ["LEARNED_ADD_FUNCTION"], operationId: "learned:x@" + "d".repeat(64), testGrading: { fixSha: A } };
  assert.deepEqual(chosenMetaOf({ runId: "9", baseSha: A }, c), { runId: "9", candidateId: "candidate-2", baseSha: A, transformations: ["LEARNED_ADD_FUNCTION"], operationId: c.operationId, selfGrade: true });
  assert.equal(chosenMetaOf({ runId: "9", baseSha: A }, { ...c, testGrading: { fixSha: B } })!.fixSha, B);
  assert.equal("selfGrade" in chosenMetaOf({ runId: "9", baseSha: A }, { ...c, testGrading: null })!, false);
});

// ---- Job A in regrade mode (generate.ts), with a fake kernel and a local approved list.
const P2 = { body: "single-return", grading: "self-fail-before-pass-after", params: "typed", placement: "end-of-module-or-new-module", returns: "annotated", test: "new-file" };
const SPEC: RuleSpec = { schema: "peaceai-learned-rule:v1", id: "public-add-function-v2", kind: "ADD_FUNCTION", minedFrom: "public", minerVersion: "peaceai-miner:v2", shape: "PURE_FUNCTION", trigger: FUNCTION_TRIGGER, params: P2, evidence: { hunks: 1, commits: 1, files: 1, repos: ["PeaceG03/PeaceSTOCKS"] } };
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=PeaceG03", "-c", `user.email=${PEACE_AUTHOR}`, ...a], { cwd, encoding: "utf8" }).trim();
function jobA(opts: { moveSameFile?: boolean; approved?: boolean; notStale?: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), "m18-"));
  const ws = join(dir, "ws");
  mkdirSync(join(ws, "src"), { recursive: true });
  writeFileSync(join(ws, "src/lib.ts"), "export function scale(a: number, b: number): number {\n  return a * b;\n}\n");
  git(ws, "init", "-q", "-b", "main"); git(ws, "add", "-A"); git(ws, "commit", "-qm", "base");
  const base = git(ws, "rev-parse", "HEAD");
  // The chosen candidate (built on base): append pad2 to lib.ts + a new test.
  writeFileSync(join(ws, "src/lib.ts"), readFileSync(join(ws, "src/lib.ts"), "utf8") + "\nexport function pad2(n: number): string {\n  return String(n).padStart(2, \"0\");\n}\n");
  writeFileSync(join(ws, "src/lib.pad2.test.ts"), 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { pad2 } from "./lib";\ntest("p", () => { assert.equal(pad2(7), "07"); });\n');
  git(ws, "add", "-N", "src/lib.pad2.test.ts");
  const diff = git(ws, "diff", "--no-color", "--full-index", "--no-renames") + "\n";
  git(ws, "reset", "-q", "--hard"); git(ws, "clean", "-fdq");
  if (!opts.notStale) {
    if (opts.moveSameFile) writeFileSync(join(ws, "src/lib.ts"), readFileSync(join(ws, "src/lib.ts"), "utf8") + "\nexport function other(n: number): number {\n  return n;\n}\n");
    else writeFileSync(join(ws, "src/other.ts"), "export const o = 1;\n");
    git(ws, "add", "-A"); git(ws, "commit", "-qm", "main moved");
  }
  const head = git(ws, "rev-parse", "HEAD");
  const meta: ChosenMeta = { runId: "77", candidateId: "candidate-1", baseSha: base, transformations: ["LEARNED_ADD_FUNCTION"], operationId: `learned:${SPEC.id}@${specHash(SPEC)}`, selfGrade: true };
  const body = regradeComment(meta, opts.notStale ? "e".repeat(40) : head, diff)!;
  const req = parseRegradeComment(body)!;
  const reqFile = join(dir, "req.json");
  writeFileSync(reqFile, JSON.stringify(req));
  const rules = join(dir, "rules"); mkdirSync(rules);
  writeFileSync(join(rules, `${SPEC.id}.json`), JSON.stringify(SPEC));
  const list = join(dir, "approved.json");
  const entry = { id: SPEC.id, sha256: specHash(SPEC), source: "workspace", approval: { url: "https://github.com/PeaceG03/PeaceAI-Workspace/issues/101#issuecomment-1", commentId: 1, issue: 101, repo: "PeaceG03/PeaceAI-Workspace", author: "PeaceG03", approvedAt: "2026-10-13T17:39:00Z" } };
  writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: opts.approved === false ? [] : [entry] }));
  const kernel = join(dir, "k.cjs");
  writeFileSync(kernel, 'const c=require("node:crypto");exports.NATIVE_CODE_SYNTHESIS_PROTOCOL_VERSION="x";exports.sourceFingerprint=(p,t)=>c.createHash("sha256").update(p+"\\0"+t).digest("hex");exports.PeaceAINativeCodeSynthesizer=class{synthesize(){throw new Error("synthesis must not run in regrade mode")}};exports.parsePlanSteps=()=>null;');
  const out = join(dir, "out");
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
  const r = spawnSync(tsx, [join(repo, "peaceai/bin/generate.ts")], {
    cwd: repo, encoding: "utf8",
    env: { ...env, PEACEAI_NL_PARSE: "off", PEACEAI_KERNEL_BUNDLE: kernel, PEACEAI_OUT_DIR: out, PEACEAI_WORKSPACE_DIR: ws, PEACEAI_TARGET: "PeaceG03/PeaceAI-Workspace", ISSUE_NUMBER: "105", ISSUE_TITLE: "[test] regrade", ISSUE_BODY: "add function `pad2(n: number): string` to `src/lib.ts` returning String(n)", PEACEAI_RULES_DIR: rules, PEACEAI_APPROVED_LIST: list, PEACEAI_REGRADE_FILE: reqFile },
  });
  const summary = existsSync(join(out, "summary.json")) ? JSON.parse(readFileSync(join(out, "summary.json"), "utf8")) : null;
  const rg = existsSync(join(out, "regrade.json")) ? JSON.parse(readFileSync(join(out, "regrade.json"), "utf8")) : null;
  const cand = summary?.candidates[0] ? readFileSync(join(out, summary.candidates[0].file), "utf8") : null;
  rmSync(dir, { recursive: true, force: true });
  return { r, summary, rg, cand, diff, base, head, req };
}

test("Job A regrade: clean re-apply on the new head -> exactly that candidate (same diff), baseSha = new head, regrade.json", () => {
  const { r, summary, rg, cand, diff, base, head } = jobA({});
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /regrade=applied of_run=77 candidate=candidate-1/);
  assert.equal(summary.baseSha, head);
  assert.notEqual(head, base);
  assert.equal(summary.candidates.length, 1);
  assert.equal(cand, diff, "byte-identical candidate");
  assert.equal(summary.candidates[0].selfGrade, true);
  assert.ok(validateSummary(summary, { learned: new Map([[SPEC.id, specHash(SPEC)]]), lmModels: new Set() }));
  assert.ok(validRegradeOf(rg));
  assert.equal(rg.oldBase, base);
});

test("Job A regrade refusals: does not apply cleanly, rule no longer approved, not stale -> 0 candidates, no regrade.json", () => {
  for (const [opts, why] of [[{ moveSameFile: true }, "does-not-apply-cleanly"], [{ approved: false }, "rule-not-approved"], [{ notStale: true }, "not-stale"]] as const) {
    const { r, summary, rg } = jobA(opts);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`regrade=refused reason=${why}`));
    assert.equal(summary.candidates.length, 0);
    assert.equal(rg, null);
  }
});

test("Results: the task record carries regradeOf; the grade is the fresh one from this attempt's Job B", () => {
  const regOf = { runId: "77", candidateId: "candidate-1", oldBase: A, diffSha256: "f".repeat(64) };
  const s = [{ id: "candidate-1", file: "candidates/candidate-1.diff", transformations: ["LEARNED_ADD_FUNCTION"], operationId: "learned:x", diffBytes: 1, diffLines: 1, selfGrade: true as const }];
  const res = [{ id: "candidate-1", diffBytes: 1, diffLines: 1, applied: true, typecheckPassed: true, originalSuitePassed: true, newTestsPassed: true, newTestFiles: 1, testGrading: { fixSha: B, afterFix: true, beforeFix: false, verdict: "COUNTS" as const, reason: null, stubFails: true } }];
  const rec = buildRecords({ issue: 105, runId: "88", recordedAt: "2026-10-13T18:00:00Z", baseSha: B, title: "[test] r", body: "x", regradeOf: regOf }, s, res, "seed");
  assert.deepEqual(rec.task.regradeOf, regOf);
  assert.equal(rec.task.baseSha, B);
  assert.equal(rec.ranking.candidates[0]!.eligible, true, "graded COUNTS against the NEW base");
  const stale = buildRecords({ issue: 105, runId: "88", recordedAt: "2026-10-13T18:00:00Z", baseSha: B, title: "[test] r", body: "x", regradeOf: regOf }, s, [{ ...res[0]!, testGrading: { ...res[0]!.testGrading, fixSha: A } }], "seed");
  assert.equal(stale.ranking.candidates[0]!.eligible, false, "a grade against the OLD base is never accepted");
});

test("workflows: verdict patch route checks staleness before building; build/check only when not stale; Job A reads the request", () => {
  const v = readFileSync(join(repo, ".github/workflows/peace-verdict.yml"), "utf8");
  const i = v.indexOf("name: Stale-base check"), j = v.indexOf("name: Build the format-patch");
  assert.ok(i > 0 && j > i);
  assert.match(v.slice(j, j + 200), /if: steps\.stale\.outputs\.stale == 'false'/);
  assert.match(v, /name: Check the patch and write the comment\n\s+id: body\n\s+if: steps\.stale\.outputs\.stale == 'false'/);
  assert.match(v, /chosen\/chosen\.json/);
  const t = readFileSync(join(repo, ".github/workflows/peace-task.yml"), "utf8");
  assert.ok(t.indexOf("regrade-fetch.ts") > 0 && t.indexOf("regrade-fetch.ts") < t.indexOf("peaceai/bin/generate.ts"));
  assert.match(t, /PEACEAI_REGRADE_FILE=/);
});

test("protected (M18): the regrade route", () => {
  for (const f of ["peaceai/lib/regrade.ts", "peaceai/bin/verdict-stale.ts", "peaceai/bin/regrade-fetch.ts", "peaceai/bin/record-task.ts", "peaceai/bin/record-verdict.ts", "peaceai/bin/gate.ts", "peaceai/bin/regate.ts", "peaceai/bin/generate.ts", ".github/workflows/peace-verdict.yml"])
    assert.notEqual(protectedReason(f), null, f);
});

// ---- Auditor confirmations (M18)
import { regradeMismatch } from "../lib/regrade.ts";
import { createHash } from "node:crypto";

test("record fields are exactly runId, candidateId, oldBase, diffSha256; a mismatched record is rejected", () => {
  const diff = DIFF;
  const ok = { runId: "77", candidateId: "candidate-1", oldBase: A, diffSha256: createHash("sha256").update(diff).digest("hex") };
  const summary = { baseSha: B, candidates: [{ id: "candidate-1", file: "candidates/candidate-1.diff" }] };
  const of = () => diff;
  assert.equal(regradeMismatch(ok, summary, of), null);
  assert.match(regradeMismatch({ ...ok, diffSha256: "0".repeat(64) }, summary, of)!, /diff hash/);
  assert.match(regradeMismatch({ ...ok, oldBase: B }, summary, of)!, /old base equals/);
  assert.match(regradeMismatch(ok, { ...summary, candidates: [...summary.candidates, { id: "candidate-2", file: "candidates/candidate-2.diff" }] }, of)!, /exactly one/);
  assert.match(regradeMismatch({ ...ok, extra: 1 }, summary, of)!, /schema/);
  assert.match(regradeMismatch({ runId: "77", candidateId: "candidate-1", oldBase: A }, summary, of)!, /schema/);
});

test("gate rejects a regrade.json that does not match its candidate", () => {
  const { r, summary } = jobA({});
  assert.equal(r.status, 0);
  const dir = mkdtempSync(join(tmpdir(), "m18g-"));
  mkdirSync(join(dir, "candidates"));
  writeFileSync(join(dir, "candidates", "candidate-1.diff"), DIFF);
  writeFileSync(join(dir, "summary.json"), JSON.stringify({ ...summary, candidates: [{ ...summary.candidates[0], diffBytes: DIFF.length }] }));
  writeFileSync(join(dir, "regrade.json"), JSON.stringify({ runId: "77", candidateId: "candidate-1", oldBase: A, diffSha256: "0".repeat(64) }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
  const core = join(dir, "..", `${dir.split("/").pop()}-core`);
  mkdirSync(core); git(core, "init", "-q"); writeFileSync(join(core, "x.txt"), "x\n"); git(core, "add", "-A"); git(core, "commit", "-qm", "c");
  const g = spawnSync(tsx, [join(repo, "peaceai/bin/gate.ts")], { cwd: repo, encoding: "utf8", env: { ...env, PEACEAI_OUT_DIR: dir, PEACEAI_CORE_DIR: core } });
  assert.notEqual(g.status, 0);
  assert.match(g.stdout, /GATE FAIL regrade record diff hash does not match the candidate/);
  rmSync(dir, { recursive: true, force: true });
});

test("pre-#106 / old-format regrades are refused: invalid request -> 0 candidates; Builder apply refuses a stale base", () => {
  const old = { user: "github-actions[bot]", body: "<!-- peaceai-regrade-request:v0 -->\nplease regrade run 1 candidate-1" };
  assert.equal(pendingRegrade([old]), "invalid");
  const broken = { user: "github-actions[bot]", body: regradeComment(META, B, DIFF)!.replace("export const x = 1;", "export const x = 9;") };
  assert.equal(pendingRegrade([broken]), "invalid", "hash mismatch is not a fresh task either");
  // generate.ts refuses the invalid marker regrade-fetch writes for it.
  const dir = mkdtempSync(join(tmpdir(), "m18i-"));
  const ws = join(dir, "ws"); mkdirSync(join(ws, "src"), { recursive: true });
  writeFileSync(join(ws, "src/lib.ts"), "export const a = 1;\n");
  git(ws, "init", "-q", "-b", "main"); git(ws, "add", "-A"); git(ws, "commit", "-qm", "base");
  const req = join(dir, "req.json"); writeFileSync(req, JSON.stringify({ schema: "peaceai-regrade-request:invalid" }));
  const kernel = join(dir, "k.cjs");
  writeFileSync(kernel, 'exports.NATIVE_CODE_SYNTHESIS_PROTOCOL_VERSION="x";exports.sourceFingerprint=()=>"x";exports.PeaceAINativeCodeSynthesizer=class{synthesize(){throw new Error("no")}};exports.parsePlanSteps=()=>null;');
  const list = join(dir, "approved.json"); writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [] }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
  const r = spawnSync(tsx, [join(repo, "peaceai/bin/generate.ts")], { cwd: repo, encoding: "utf8", env: { ...env, PEACEAI_NL_PARSE: "off", PEACEAI_KERNEL_BUNDLE: kernel, PEACEAI_OUT_DIR: join(dir, "out"), PEACEAI_WORKSPACE_DIR: ws, PEACEAI_TARGET: "PeaceG03/PeaceAI-Workspace", ISSUE_NUMBER: "1", ISSUE_TITLE: "[test] x", ISSUE_BODY: "x", PEACEAI_APPROVED_LIST: list, PEACEAI_RULES_DIR: join(dir, "none"), PEACEAI_REGRADE_FILE: req } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /regrade=refused reason=invalid-request/);
  assert.equal(JSON.parse(readFileSync(join(dir, "out", "summary.json"), "utf8")).candidates.length, 0);
  rmSync(dir, { recursive: true, force: true });
  // Builder side: the box-side (M16) local regrade is gone; a stale base is refused outright.
  const apply = readFileSync(join(repo, "peaceai/bin/apply-verdict-patch.ts"), "utf8");
  assert.match(apply, /if \(head !== baseSha\)\n\s+die\(`stale base:/);
  assert.doesNotMatch(apply, /rebaseAndRegrade\(/);
});

test("the two new generate.ts writes reach Results only through record-task.ts in the landing step", () => {
  const gen = readFileSync(join(repo, "peaceai/bin/generate.ts"), "utf8");
  assert.ok(gen.includes('writeFileSync(join(outDir, "candidates", "candidate-1.diff"), req.diff);'));
  assert.ok(gen.includes('writeFileSync(join(outDir, "regrade.json"), JSON.stringify(regradeOf(req)) + "\\n");'));
  // Who reads regrade.json: gate (validate), regate (validate + copy to the final dir), record-task (record).
  const readers = ["peaceai/bin/gate.ts", "peaceai/bin/regate.ts", "peaceai/bin/record-task.ts"];
  for (const f of readers) assert.match(readFileSync(join(repo, f), "utf8"), /regrade\.json/, f);
  for (const f of ["peaceai/bin/test-candidates.ts", "peaceai/bin/record-verdict.ts", "peaceai/bin/results-write.sh", "peaceai/lib/store.ts"]) assert.doesNotMatch(readFileSync(join(repo, f), "utf8"), /regrade\.json/, f);
  // record-task writes only through store.writeNew (task.json carries regradeOf), and it runs only inside
  // the workflow's results-write.sh landing step.
  const rt = readFileSync(join(repo, "peaceai/bin/record-task.ts"), "utf8");
  assert.doesNotMatch(rt, /writeFileSync\(/);
  assert.match(rt, /writeNew\(join\(dir, "task\.json"\), stableJson\(records\.task\)\)/);
  const wf = readFileSync(join(repo, ".github/workflows/peace-task.yml"), "utf8");
  assert.equal([...wf.matchAll(/record-task\.ts/g)].length, 1);
  assert.match(wf, /results-write\.sh "task #\$ISSUE_NUMBER run \$GITHUB_RUN_ID" \\\n\s+\.\/node_modules\/\.bin\/tsx peaceai\/bin\/record-task\.ts/);
});
