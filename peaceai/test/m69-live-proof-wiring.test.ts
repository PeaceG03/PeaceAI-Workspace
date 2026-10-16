// M69: live-proof wiring fixes (proofs #304-#307 on PeaceSTOCKS, Oct 16). Each test reproduces one live failure:
// #304 a binary "*" in a while-loop body was stripped by cleanIssueText (edit_refused);
// #305 ENV_FIX edits carried no selfGrade, so Job A dropped them silently (no candidate, no refusal reason);
// #306 WORKFLOW_JOB never saw workflow files or package.json in Job A (target_missing);
// #307 a stripped trailing backtick left "src/x.ts " before the line end, so the TSCONFIG_SCRIPT trigger failed (NO_FAMILY).
// Synthetic fixtures only (no PeaceSTOCKS source), except the m67 PeaceSTOCKS workflow fixture already in this repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applyRule, type RuleSpec } from "../lib/learned.ts";
import { cleanIssueText } from "../lib/taskmap.ts";
import { nlDecision } from "../lib/nlparse.ts";
import { APPROVED_SCHEMA } from "../lib/approved.ts";
import { checkCandidateScope } from "../lib/scope.ts";
import { parseDiff } from "../lib/diff.ts";
import { loadTargets, scopeOf } from "../lib/target.ts";

const repo = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(repo, p), "utf8");
const tsx = join(repo, "node_modules/.bin/tsx");
const spec = (id: string) => JSON.parse(read(`peaceai/rules/learned/${id}.json`)) as RuleSpec;
const NOTE = "(Live proof of an approved rule. MECHANISM PROOF ONLY. Does NOT count toward coverage: no builder-log coverage line.)";
const issue = (line: string) => ({ title: "PeaceAI live proof: x", body: `Target: PeaceG03/PeaceSTOCKS\n\n${line}\n\n${NOTE}\n` });

test("#304: a binary `*` in a while-loop body survives cleanIssueText; title and trailing note are tolerated", () => {
  const line = "add while loop function `countWholeHours(ms: number): number` to `src/a.ts` with body:\nlet h = 0;\nlet t = 0;\nwhile (h < 168) {\nif (ms < (h + 1) * 3600000) break;\nt += 1;\nh += 1;\n}\nreturn t;\n- countWholeHours(7200000) is 2";
  const w: { reason?: string } = {};
  const e = applyRule(spec("public-loop-function-v2"), cleanIssueText(issue(line)), [{ path: "src/a.ts", content: "export const x = 1;\n" }], (p) => p.endsWith(".test.ts"), undefined, w, () => false);
  assert.ok(e, w.reason);
  assert.match(e!.content, /\(h \+ 1\) \* 3600000/);
  // Markdown emphasis and bullets are still dropped.
  assert.equal(cleanIssueText({ title: "", body: "**bold** and *em*\n* bullet\n  * nested" }), "bold and em\n bullet\n nested");
});

test("#307: a trailing backtick no longer leaves a space before the line end; the typecheck-script wording is canonical with a note", () => {
  const line = "add typecheck script `typecheck:scanner` with new `tsconfig.scanner.json` checking only `src/scanner.ts`";
  assert.ok(!/ $/m.test(cleanIssueText(issue(line))));
  const d = nlDecision(issue(line), undefined, new Set(["TSCONFIG_SCRIPT"]));
  assert.equal(d.status, "canonical");
});

function fakeKernel(dir: string): string {
  const file = join(dir, "fake-kernel.cjs");
  writeFileSync(file, `const crypto = require("node:crypto");
exports.NATIVE_CODE_SYNTHESIS_PROTOCOL_VERSION = "x";
exports.sourceFingerprint = (p, c) => crypto.createHash("sha256").update(p + "\\0" + c).digest("hex");
exports.PeaceAINativeCodeSynthesizer = class { synthesize() { return { status: "INSUFFICIENT" }; } };
exports.parsePlanSteps = () => null;
`);
  return file;
}
const SIM = ".github/workflows/tenmin-mode-sim.yml";
const PKG = '{\n  "name": "x",\n  "private": true,\n  "scripts": {\n    "typecheck": "tsc -p tsconfig.json --noEmit",\n    "test": "tsx --test src/*.test.ts"\n  }\n}\n';
const TSC = JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ["src/**/*.ts"] }, null, 2) + "\n";
const LIB = 'export function requireStore(env: NodeJS.ProcessEnv): boolean {\n  return env.SYN_REQUIRE_STORE === "1";\n}\nexport function strictNot(env: NodeJS.ProcessEnv): boolean {\n  return env.SYN_REQUIRE_STORE !== "1";\n}\n';
const RULES = ["public-env-fix-v1", "public-workflow-job-v1", "public-tsconfig-script-v1"];

function runJobA(line: string) {
  const dir = mkdtempSync(join(tmpdir(), "m69-"));
  const ws = join(dir, "ws");
  mkdirSync(join(ws, "src"), { recursive: true });
  mkdirSync(join(ws, ".github/workflows"), { recursive: true });
  writeFileSync(join(ws, "src/lib.ts"), LIB);
  writeFileSync(join(ws, "src/scanner.ts"), "export const s = 1;\n");
  writeFileSync(join(ws, "package.json"), PKG);
  writeFileSync(join(ws, "tsconfig.json"), TSC);
  writeFileSync(join(ws, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(join(ws, SIM), read("peaceai/test/fixtures/m67/peacestocks/w-tenmin-mode-sim.yml"));
  const g = (...a: string[]) => execFileSync("git", ["-C", ws, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" });
  g("init", "-q"); g("add", "-A"); g("commit", "-qm", "base");
  const rules = join(dir, "rules");
  mkdirSync(rules);
  const onMain = (JSON.parse(read("peaceai/rules/approved.json")) as { rules: { id: string }[] }).rules;
  const entries = RULES.map((id) => { writeFileSync(join(rules, `${id}.json`), JSON.stringify(spec(id))); return onMain.find((r) => r.id === id)!; });
  const list = join(dir, "approved.json");
  writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: entries }));
  const out = join(dir, "out");
  const t = issue(line);
  const r = spawnSync(tsx, [join(repo, "peaceai/bin/generate.ts")], {
    cwd: repo, encoding: "utf8",
    env: { ...process.env, PEACEAI_NL_PARSE: "on", PEACEAI_KERNEL_BUNDLE: fakeKernel(dir), PEACEAI_OUT_DIR: out, PEACEAI_WORKSPACE_DIR: ws, PEACEAI_TARGET: "PeaceG03/PeaceSTOCKS", ISSUE_NUMBER: "9", ISSUE_TITLE: t.title, ISSUE_BODY: t.body, PEACEAI_RULES_DIR: rules, PEACEAI_APPROVED_LIST: list },
  });
  const summary = existsSync(join(out, "summary.json")) ? JSON.parse(readFileSync(join(out, "summary.json"), "utf8")) : null;
  const diff = summary?.candidates?.[0] ? readFileSync(join(out, summary.candidates[0].file), "utf8") : "";
  const base = new Set(g("ls-files").split("\n").filter(Boolean));
  rmSync(dir, { recursive: true, force: true });
  return { r, summary, diff, base };
}
const STOCKS = scopeOf(loadTargets().targets["PeaceG03/PeaceSTOCKS"]!);

test("#305: Job A turns an ENV_FIX edit into a self-graded candidate (was silently dropped)", () => {
  const { r, summary, diff, base } = runJobA("make env `SYN_REQUIRE_STORE` strict in `src/lib.ts` as a flag");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(summary.candidates.length, 1, r.stdout);
  assert.deepEqual(summary.candidates[0].transformations, ["LEARNED_ENV_FIX"]);
  assert.equal(summary.candidates[0].selfGrade, true);
  assert.deepEqual(checkCandidateScope(parseDiff(diff), base, STOCKS), []);
});

test("#306: Job A gives WORKFLOW_JOB the opted-in workflow and package.json; one job block, target-suite graded", () => {
  const { r, summary, diff, base } = runJobA(`add workflow job \`suite\` to \`${SIM}\` running \`pnpm run test\` as step \`Test suite\``);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(summary.candidates.length, 1, r.stdout);
  assert.deepEqual(summary.candidates[0].transformations, ["LEARNED_WORKFLOW_JOB"]);
  assert.equal(summary.candidates[0].selfGrade, undefined);
  assert.deepEqual(parseDiff(diff).map((f) => f.newPath), [SIM]);
  assert.deepEqual(checkCandidateScope(parseDiff(diff), base, STOCKS), []);
  // A workflow outside the target's workflowPattern is still not shown to the rule.
  const off = runJobA("add workflow job `suite` to `.github/workflows/tests.yml` running `pnpm run test`");
  assert.equal(off.summary.candidates.length, 0);
});

test("#307: Job A gives TSCONFIG_SCRIPT package.json + root tsconfig on a tsconfigScript target; one new tsconfig", () => {
  const { r, summary, diff, base } = runJobA("add typecheck script `typecheck:scanner` with new `tsconfig.scanner.json` checking only `src/scanner.ts`");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(summary.candidates.length, 1, r.stdout);
  assert.deepEqual(summary.candidates[0].transformations, ["LEARNED_TSCONFIG_SCRIPT"]);
  assert.deepEqual(parseDiff(diff).map((f) => [f.newPath, f.isNew]).sort(), [["package.json", false], ["tsconfig.scanner.json", true]]);
  assert.deepEqual(checkCandidateScope(parseDiff(diff), base, STOCKS), []);
});
