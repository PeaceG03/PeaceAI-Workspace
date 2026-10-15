// M59: when the approved learned rules make no candidate, the run says why: each matching rule's reason code,
// e.g. `unsafe_condition: limit`. Reasons carry rule ids, fixed codes and identifiers only (never contents).
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { admitRules, loadApprovedList } from "../lib/approved.ts";
import { applyRule } from "../lib/learned.ts";
import { unknownNames, type Refusal } from "../lib/learned-guard.ts";
import { nlDecision } from "../lib/nlparse.ts";
import { cleanRefusals, formatRefusals, noCandidateComment } from "../lib/refusal-reason.ts";

const repo = join(import.meta.dirname, "../..");
const dir = join(repo, "peaceai/rules/learned");
const specs = readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
const approved = admitRules(specs, loadApprovedList(join(repo, "peaceai/rules/approved.json"))).filter((a) => a.decision === "APPROVED" && a.spec).map((a) => a.spec!);
const kinds = new Set(approved.map((s) => s.kind));
const isTest = (p: string) => p.endsWith(".test.ts");
const SECRET_LINE = '  const token = "ghp_DO_NOT_LEAK";';
const SRC = [
  "export function eligibilityForBarCount(barCount: number): string {",
  SECRET_LINE,
  '  if (barCount < 1) return "LEVEL_0";',
  '  if (barCount < 20) return "LEVEL_1";',
  '  return "LEVEL_3";',
  "}",
  "",
].join("\n");
const files = [{ path: "src/universe.ts", content: SRC }];
const body = (cond: string, fn = "eligibilityForBarCount") =>
  `Target: PeaceG03/PeaceSTOCKS\n\nguard \`${fn}\` in \`src/universe.ts\` at the top: throw INVALID_BAR_COUNT when ${cond}\n- \`${fn}(-1)\` throws INVALID_BAR_COUNT\n- \`${fn}(20)\` is \`"LEVEL_1"\`\n`;

/** What generate.ts does: run every approved rule, keep the reasons of the ones that matched and refused. */
function refusals(cond: string, fn?: string) {
  const d = nlDecision({ title: "[scanner] guard", body: body(cond, fn) }, undefined, kinds, null);
  assert.equal(d.status, "canonical", JSON.stringify(d));
  const objective = (d as { objective: string }).objective;
  const out: { id: string; reason: string }[] = [];
  let made = 0;
  for (const s of approved) {
    const why: Refusal = {};
    if (applyRule(s, objective, files, isTest, undefined, why)) made += 1;
    else if (why.reason) out.push({ id: s.id, reason: why.reason });
  }
  return { made, line: formatRefusals(out) };
}

test("#191: `limit` is reported as unsafe_condition: limit by top-v1, with no candidate", () => {
  const r = refusals("!Number.isInteger(limit) || limit < 0");
  assert.equal(r.made, 0);
  assert.equal(r.line, "public-throw-guard-top-v1=unsafe_condition: limit");
});

test("other refusal reasons: unknown function, several unknown names, disallowed call; a good task has none", () => {
  assert.equal(refusals("barCount < 0", "nope").line, "public-throw-guard-top-v1=function_not_found");
  assert.equal(refusals("limit < 0 || max > barCount").line, "public-throw-guard-top-v1=unsafe_condition: limit,max");
  assert.equal(refusals("eval(barCount)").line, "public-throw-guard-top-v1=unsafe_condition: eval");
  const ok = refusals("!Number.isInteger(barCount) || barCount < 0");
  assert.equal(ok.made, 1);
  assert.equal(ok.line, "");
});

test("unknownNames: free names only (no property names, no allowed built-ins), sorted, max 5", () => {
  const e = (s: string) => (ts.createSourceFile("c.ts", `(${s});`, ts.ScriptTarget.Latest, true).statements[0] as ts.ExpressionStatement).expression;
  assert.deepEqual(unknownNames(e("!Number.isInteger(x) || y.length > 0 || x.size < z"), new Set(["x"])), ["y", "z"]);
  assert.deepEqual(unknownNames(e("a<0||b<0||c<0||d<0||e<0||f<0||g<0"), new Set()), ["a", "b", "c", "d", "e"]);
});

test("reasons never carry file contents or arbitrary text", () => {
  for (const cond of ["limit < 0", "eval(barCount)"]) assert.ok(!refusals(cond).line.includes("ghp_"), "no file contents");
  assert.deepEqual(cleanRefusals([{ id: "x-v1", reason: 'leak: "ghp_abc"\nmore' }, { id: "../etc", reason: "function_not_found" }]), [{ id: "x-v1", reason: "refused" }]);
  assert.equal(formatRefusals([]), "");
  assert.match(noCandidateComment("public-throw-guard-top-v1=unsafe_condition: limit"), /refused it: `public-throw-guard-top-v1=unsafe_condition: limit`\./);
  assert.equal(noCandidateComment("x=`$(id)`"), noCandidateComment(""), "unsafe line dropped");
  assert.equal(noCandidateComment(""), "PeaceAI: no candidates generated for this task. The attempt was recorded. Rephrase the issue, then remove `peaceai:failed` to retry.");
});

test("peace-task wiring: output declared, passed by env (never inlined in run), comment via body file", () => {
  const wf = readFileSync(join(repo, ".github/workflows/peace-task.yml"), "utf8");
  assert.match(wf, /rule_refusals: \$\{\{ steps\.generate\.outputs\.rule_refusals \}\}/);
  assert.match(wf, /RULE_REFUSALS: \$\{\{ needs\.generate\.outputs\.rule_refusals \}\}/);
  assert.match(wf, /peaceai\/bin\/no-candidate-comment\.ts/);
  assert.ok(!/run:[^\n]*\$\{\{[^}]*rule_refusals/.test(wf) && !/^\s+[^#\n]*gh issue comment[^\n]*\$\{\{/m.test(wf), "no expression inside a run script");
  const gen = readFileSync(join(repo, "peaceai/bin/generate.ts"), "utf8");
  assert.match(gen, /writeOutput\(\{ rule_refusals: refusalLine \}\)/);
});
