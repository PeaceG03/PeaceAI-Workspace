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
import { scanText } from "../lib/leak.ts";
import { allowedName, cleanRefusals, formatRefusals, NO_CANDIDATE_TEXT, noCandidateComment } from "../lib/refusal-reason.ts";

const repo = join(import.meta.dirname, "../..");
const dir = join(repo, "peaceai/rules/learned");
const specs = readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
const approved = admitRules(specs, loadApprovedList(join(repo, "peaceai/rules/approved.json"))).filter((a) => a.decision === "APPROVED" && a.spec).map((a) => a.spec!);
const kinds = new Set(approved.map((s) => s.kind));
// The loop rule's entry appears only once public-loop-function-v1 is approved (#220/#221); the same expectations hold either way.
const LOOP = approved.some((s) => s.id === "public-loop-function-v1") ? "public-loop-function-v1=task_unparsed; " : "";
// #234: expected refusal lines derive from approved.json, so they hold with and without each pending approval
// (e.g. public-import-edit-v2). Every approved rule but top-v1 reports task_unparsed; top-v1 reports `top` (omitted when
// it built a candidate). Rules that never report on a guard task (add-function, test-case, ...) are not listed.
// #273 prep: the four un-drop rules (env-fix, loop-function-v2, tsconfig-script, workflow-job) report task_unparsed on a guard task too.
// #320: public-env-fix-v2 (approved as 6fade25) reports task_unparsed on a guard task like env-fix v1.
// M74 (#338/#342): public-date-function-v1 (COMPLEX_FUNCTION, own "add date function" trigger) reports task_unparsed too.
// M85 (#380): public-complex-calls-v1 reports task_unparsed on a guard task (its trigger is "add complex function"),
// so once that approval is on the list it takes a slot in the capped line and env-fix-v2 drops off the end.
// #614: public-derive-wire-v2 (EXISTING_EDIT, own "retry a failing call" / "record a failing call" trigger) reports a real
// reason, wire_trigger, on a guard task, so once its approval (#613) is on the list it sorts before every task_unparsed entry
// and the last task_unparsed entry drops off the capped line. Rules listed in REASON report that code instead of task_unparsed.
// Entries sort by id, real reasons before task_unparsed, and formatRefusals keeps at most MAX_ENTRIES=5 (intentional truncation).
const REASON = new Map<string, string>([["public-derive-wire-v2", "wire_trigger"]]);
const REPORTING = new Set(["public-complex-calls-v1", "public-complex-function-v1", "public-date-function-v1", "public-derive-wire-v2", "public-env-fix-v1", "public-env-fix-v2", "public-import-edit-v2", "public-loop-function-v1", "public-loop-function-v2", "public-method-guard-v1", "public-throw-guard-top-v1", "public-throw-guard-v1", "public-tsconfig-script-v1", "public-workflow-job-v1"]);
const expected = (top: string | null) =>
  approved.map((s) => s.id).filter((id) => REPORTING.has(id)).sort()
    .flatMap((id) => (id === "public-throw-guard-top-v1" ? (top === null ? [] : [`${id}=${top}`]) : [`${id}=${REASON.get(id) ?? "task_unparsed"}`]))
    .sort((a, b) => Number(a.endsWith("=task_unparsed")) - Number(b.endsWith("=task_unparsed"))) // real reasons first (stable)
    .slice(0, 5).join("; ");
const isTest = (p: string) => p.endsWith(".test.ts");
const SRC = [
  "export function eligibilityForBarCount(barCount: number): string {",
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
  // Non-matching kinds report task_unparsed so RULE_REFUSALS / the comment show every refusal.
  assert.equal(r.line, expected("unsafe_condition: limit"));
});

test("other refusal reasons: unknown function, several unknown names, disallowed call; a good task has none", () => {
  assert.equal(refusals("barCount < 0", "nope").line, expected("function_not_found"));
  assert.equal(refusals("limit < 0 || max > barCount").line, expected("unsafe_condition: limit,max"));
  assert.equal(refusals("eval(barCount)").line, expected("unsafe_condition: eval"));
  const ok = refusals("!Number.isInteger(barCount) || barCount < 0");
  assert.equal(ok.made, 1);
  // Top-v1 produced a candidate; other kinds still report task_unparsed (trigger mismatch).
  assert.equal(ok.line, expected(null));
});

test("unknownNames: free names only (no property names, no allowed built-ins), sorted, max 5", () => {
  const e = (s: string) => (ts.createSourceFile("c.ts", `(${s});`, ts.ScriptTarget.Latest, true).statements[0] as ts.ExpressionStatement).expression;
  assert.deepEqual(unknownNames(e("!Number.isInteger(x) || y.length > 0 || x.size < z"), new Set(["x"])), ["y", "z"]);
  assert.deepEqual(unknownNames(e("a<0||b<0||c<0||d<0||e<0||f<0||g<0"), new Set()), ["a", "b", "c", "d", "e"]);
});

test("reasons never echo secrets typed into the issue condition, or arbitrary text", () => {
  // Fake credentials typed into the ISSUE CONDITION itself (the only user text a reason can echo).
  // Every bypass Auditor found on 1103251 must print the code alone; `limit` on its own stays printed.
  const CODE = expected("unsafe_condition");
  // fake(prefix, body): every fake credential is joined at runtime so no whole token literal is in this file.
  const fake = (prefix: string, body: string) => [prefix, body].join("");
  const BODY = fake("A1b2C3d4E5f6", "G7h8I9j0K1l2M3n4O5p6Q7r8");
  const GHP = fake("gh" + "p_", BODY);
  const AKIA = fake("AK" + "IA", "IOSFODNN7EXAMPLE");
  const HEX31 = fake("deadbeefcafebabe", "0123456789abcde"); // 31 hex chars (one under the old 32-char rule)
  const HIGH = fake("qZ7xR2mK9vL4pW8n", "B3tY6hJ1cF5dG0sA"); // 32-char high-entropy string
  assert.equal(HEX31.length, 31);
  assert.equal(HIGH.length, 32);
  const T = {
    akiaLower: fake("ak" + "ia", "iosfodnn7example"),
    akiaMixed: fake("Ak" + "IA", "IOSFODNN7EXAMPLE"),
    asia: fake("AS" + "IA", "IOSFODNN7EXAMPLE"),
    glpatU: fake("gl" + "pat_", "xYz12AbC34dEf56GhI78"),
    skLive: fake("sk" + "_live_", "51HxYz2eZvKYlo2C"),
    skProjU: fake("sk" + "_proj_", "aB3dE5gH7jK9mN1pQ3"),
    npm: fake("np" + "m_", "aB3dE5gH7jK9mN1pQ3sT5vW7"),
    gDollar: fake("g$" + "hp_", "A1b2C3d4E5f6G7h8"),
    glpatD: fake("gl" + "pat-", "xYz12AbC34dEf56GhI78"),
    skProjD: fake("sk" + "-proj-", "aB3dE5gH7jK9mN1pQ3"),
    xoxbD: fake("xo" + "xb-", "1234-5678-aBcDeFgHiJkL"),
    gho: fake("gh" + "o_", "x1"), ghPat: fake("git" + "hub_pat_", "x1"), xoxbU: fake("xo" + "xb_", "1"),
  };
  const conditions: [string, string][] = [
    ["31-char hex", `${HEX31} < 0`],
    ["split ghp,<body>", `ghp < 0 || ${BODY} < 0`],
    ["lowercase akia", `${T.akiaLower} < 0`],
    ["mixed-case AkIA", `${T.akiaMixed} < 0`],
    ["ASIA key", `${T.asia} < 0`],
    ["glpat_", `${T.glpatU} < 0`],
    ["sk_live_", `${T.skLive} < 0`],
    ["sk_proj_", `${T.skProjU} < 0`],
    ["npm_", `${T.npm} < 0`],
    ["g$hp_", `${T.gDollar} < 0`],
    ["glpat- (split)", `${T.glpatD} < 0`],
    ["sk-proj- (split)", `${T.skProjD} < 0`],
    ["xoxb- (split)", `${T.xoxbD} < 0`],
    ["32-char high entropy", `${HIGH} < 0`],
    ["ghp_ with limit", `${GHP} < 0 || limit < 0`],
    ["AKIA with limit", `${AKIA} > barCount || limit < 0`],
  ];
  const skipped: string[] = [];
  for (const [what, cond] of conditions) {
    const d = nlDecision({ title: "[scanner] guard", body: body(cond) }, undefined, kinds, null);
    if (d.status !== "canonical") { skipped.push(what); continue; } // refused before any rule ran: nothing can be echoed
    const r = refusals(cond);
    assert.equal(r.made, 0, what);
    assert.equal(r.line, CODE, `${what}: code only, got ${r.line}`);
    const c = noCandidateComment(r.line);
    assert.deepEqual(scanText(c), [], what);
  }
  assert.deepEqual(skipped, [], "every bypass reaches the rule (none hidden by the parser)");
  // The same tokens handed straight to the sanitizer (covers forms the parser never lets through).
  for (const tok of [HEX31, HIGH, GHP, BODY, AKIA, ...Object.values(T), "aBCDEfoo", "abcdefghijklmnopqrstuvwxy"]) {
    for (const reason of [`unsafe_condition: ${tok}`, `unsafe_condition: limit,${tok}`, `unsafe_condition: ghp,${tok}`]) {
      assert.ok(["unsafe_condition", "refused"].includes(cleanRefusals([{ id: "x-v1", reason }])[0]!.reason), reason); // code only
      assert.equal(noCandidateComment(`x-v1=${reason}`), NO_CANDIDATE_TEXT, reason);
    }
  }
  assert.equal(refusals("!Number.isInteger(limit) || limit < 0").line, expected("unsafe_condition: limit"), "limit still printed");
  for (const ok of ["limit", "maxBars", "maxBarCountLimit", "aBCDe"]) assert.ok(allowedName(ok), ok);
  for (const bad of ["Limit", "aBCDEf", "lim1t", "a_b", "abcdefghijklmnopqrstuvwxy", "aBcDeFgHiJkL", "maxBarCountLimitValueX"]) assert.ok(!allowedName(bad), bad);
  assert.deepEqual(cleanRefusals([{ id: "x-v1", reason: `leak: "${fake("gh" + "p_", "abc")}"\nmore` }, { id: "../etc", reason: "function_not_found" }]), [{ id: "x-v1", reason: "refused" }]);
  assert.equal(formatRefusals([]), "");
  assert.match(noCandidateComment("public-throw-guard-top-v1=unsafe_condition: limit"), /refused it: `public-throw-guard-top-v1=unsafe_condition: limit`\./);
  assert.equal(noCandidateComment("x=`$(id)`"), noCandidateComment(""), "unsafe line dropped");
  assert.equal(NO_CANDIDATE_TEXT, "PeaceAI: no candidates generated for this task. The attempt was recorded. Rephrase the issue, then remove `peaceai:failed` to retry.");
});

test("peace-task wiring: output declared, passed by env (never inlined in run), comment via body file", () => {
  const wf = readFileSync(join(repo, ".github/workflows/peace-task.yml"), "utf8");
  assert.match(wf, /rule_refusals: \$\{\{ steps\.generate\.outputs\.rule_refusals \}\}/);
  assert.match(wf, /RULE_REFUSALS: \$\{\{ needs\.generate\.outputs\.rule_refusals \}\}/);
  assert.match(wf, /peaceai\/bin\/no-candidate-comment\.ts/);
  assert.ok(!/run:[^\n]*\$\{\{[^}]*rule_refusals/.test(wf) && !/^\s+[^#\n]*gh issue comment[^\n]*\$\{\{/m.test(wf), "no expression inside a run script");
  const why = wf.slice(wf.indexOf("- name: Say why no candidate was made"));
  const fb = why.slice(why.indexOf("- name: Fallback no-candidate comment"));
  assert.match(fb, /if: always\(\) && env\.NL_REASON == '' && env\.NO_CANDIDATES == 'true' && steps\.why_post\.outcome != 'success'/);
  assert.ok(fb.split("\n- ")[0]!.includes(NO_CANDIDATE_TEXT.replace(/`/g, "\\`")), "fallback posts the fixed text without checkout/npm/tsx");
  const fbRun = fb.slice(fb.indexOf("run: |"), fb.indexOf("\n      - ", 5));
  assert.ok(fbRun.includes("gh issue comment") && !/tsx|npm|node_modules/.test(fbRun), "fallback needs no tooling");
  const postRun = why.slice(why.indexOf("run: |"), why.indexOf("\n      - ", 5));
  assert.match(postRun, /--body-file "\$RUNNER_TEMP\/no-candidate\.md"\n\s+touch "\$RUNNER_TEMP\/no-candidate-posted"/, "marker written right after a successful post");
  assert.ok(fbRun.indexOf('if [ -e "$RUNNER_TEMP/no-candidate-posted" ]; then exit 0; fi') >= 0 && fbRun.indexOf("no-candidate-posted") < fbRun.indexOf("gh issue comment"), "fallback skips when the marker exists");
  const gen = readFileSync(join(repo, "peaceai/bin/generate.ts"), "utf8");
  assert.match(gen, /writeOutput\(\{ rule_refusals: refusalLine \}\)/);
});

test("Auditor hardening (#223): a listed public-loop-function-v1 entry admits as APPROVED, so a tampered sha fails m59 itself", () => {
  const listed = (JSON.parse(readFileSync(join(repo, "peaceai/rules/approved.json"), "utf8")) as { rules: { id: string }[] }).rules.filter((r) => r.id === "public-loop-function-v1");
  const decisions = admitRules(specs, loadApprovedList(join(repo, "peaceai/rules/approved.json"))).filter((a) => a.spec?.id === "public-loop-function-v1").map((a) => a.decision);
  if (listed.length === 0) { assert.ok(!decisions.includes("APPROVED"), "not listed: never APPROVED"); assert.equal(LOOP, ""); return; }
  assert.equal(listed.length, 1, "listed once");
  assert.deepEqual(decisions, ["APPROVED"], "a listed loop rule must admit (exact sha)");
  assert.notEqual(LOOP, "");
});

test("real reasons are ordered before task_unparsed, so truncation never drops one", () => {
  const list = ["a-v1", "b-v1", "c-v1", "d-v1", "e-v1"].map((id) => ({ id, reason: "task_unparsed" }));
  list.push({ id: "z-v1", reason: "function_not_found" }, { id: "y-v1", reason: "unsafe_condition: limit" });
  assert.equal(formatRefusals(list), "z-v1=function_not_found; y-v1=unsafe_condition: limit; a-v1=task_unparsed; b-v1=task_unparsed; c-v1=task_unparsed");
  assert.equal(formatRefusals([{ id: "a-v1", reason: "task_unparsed" }, { id: "b-v1", reason: "loop_async" }]), "b-v1=loop_async; a-v1=task_unparsed");
});
