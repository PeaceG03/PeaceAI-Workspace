// M47 proposal proofs: throw-guard function-top placement (off until approved).
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyGuardRule, GUARD_TOP_TRIGGER, GUARD_TRIGGER } from "../lib/learned-guard.ts";
import { specFileText, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { cleanIssueText } from "../lib/taskmap.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const repo = join(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const TOP = JSON.parse(read("peaceai/rules/learned/public-throw-guard-top-v1.json")) as RuleSpec;
const V1 = JSON.parse(read("peaceai/rules/learned/public-throw-guard-v1.json")) as RuleSpec;
const SRC = 'export function eligibility(barCount: number): string {\n  if (barCount <= 0) return "LEVEL_0";\n  if (barCount < 20) return "LEVEL_1";\n  return "LEVEL_3";\n}\n';
const files = [{ path: "src/u.ts", content: SRC }];
const isTest = (p: string) => p.endsWith(".test.ts");
const task = (top: boolean) => cleanIssueText({ title: "t", body: `guard \`eligibility\` in \`src/u.ts\`${top ? " at the top" : ""}: throw INVALID_BAR_COUNT when !Number.isInteger(barCount) || barCount < 0\n- \`eligibility(-1)\` throws INVALID_BAR_COUNT\n- \`eligibility(20)\` is \`"LEVEL_3"\`` });

test("spec is valid, canonical, differs from v1 only in id/shape/miner/trigger/placement/evidence, and is NOT approved", () => {
  assert.ok(validateSpec(TOP));
  assert.equal(read("peaceai/rules/learned/public-throw-guard-top-v1.json"), specFileText(TOP));
  assert.equal(TOP.trigger, GUARD_TOP_TRIGGER);
  assert.deepEqual({ ...TOP.params, placement: "function-entry" }, V1.params);
  assert.equal(TOP.params.placement, "function-top");
  assert.ok(!read("peaceai/rules/approved.json").includes("public-throw-guard-top-v1"));
  assert.ok(!validateSpec({ ...TOP, params: { ...TOP.params, placement: "function-end" } }), "unknown placement refused");
});

test("function-top puts the guard first, ahead of the early returns (#166 shape)", () => {
  const e = applyGuardRule(TOP.trigger, TOP.params, task(true), files, isTest);
  assert.ok(e);
  const body = e!.content.split("\n");
  assert.equal(body[1], '  if (!Number.isInteger(barCount) || barCount < 0) throw new Error("INVALID_BAR_COUNT");');
  assert.equal(body[2], '  if (barCount <= 0) return "LEVEL_0";');
  assert.equal(e!.extra.length, 1);
});

test("v1 is unchanged: it still places after the leading exits, and the phrasings never cross", () => {
  const e = applyGuardRule(V1.trigger, V1.params, task(false), files, isTest);
  assert.ok(e);
  assert.ok(e!.content.indexOf("INVALID_BAR_COUNT") > e!.content.indexOf('return "LEVEL_1"'));
  assert.equal(applyGuardRule(V1.trigger, V1.params, task(true), files, isTest), null, "v1 ignores the top phrasing");
  assert.equal(applyGuardRule(TOP.trigger, TOP.params, task(false), files, isTest), null, "top ignores the v1 phrasing");
  assert.notEqual(GUARD_TRIGGER, GUARD_TOP_TRIGGER);
});

test("function-top keeps v1's refusals (unsafe or non-parameter conditions, wrong code)", () => {
  const T = (cond: string, call = "- `eligibility(-1)` throws INVALID_BAR_COUNT") => cleanIssueText({ title: "t", body: `guard eligibility in src/u.ts at the top: throw INVALID_BAR_COUNT when ${cond}\n${call}` });
  for (const t of [T("limit < 0"), T("barCount.valueOf() < 0"), T("(() => true)()"), T("true"), T("barCount < 0", "- `eligibility(-1)` throws OTHER"), T("barCount < 0", "- `eligibility(1)` is 1")])
    assert.equal(applyGuardRule(TOP.trigger, TOP.params, t, files, isTest), null, t);
});

test("evidence: 10+ external first-statement guards ahead of an early return, each in the #148 manifest with its sha256", () => {
  const ev = JSON.parse(read("peaceai/rules/proposals/m47-guard-top-evidence.json"));
  const man = new Map(read("peaceai/model/ext-manifest.jsonl").trim().split("\n").slice(1).map((l) => JSON.parse(l)).map((e: { repo: string; path: string; sha256: string; license: string }) => [`${e.repo}/${e.path}`, e]));
  assert.ok(ev.examples.length >= 10 && ev.counts.topGuardThenEarlyReturn >= 10);
  for (const x of ev.examples as { repo: string; path: string; sha256: string }[]) {
    const m = man.get(`${x.repo}/${x.path}`);
    assert.ok(m, `${x.repo}/${x.path} not in manifest`);
    assert.equal(m!.sha256, x.sha256);
    assert.ok(!m!.license.startsWith("owner:"), "external only");
  }
  assert.deepEqual(TOP.evidence.repos, [...new Set((ev.examples as { repo: string }[]).map((x) => x.repo))].sort());
});

test("spec, evidence and this test are protected; spec md pinned", () => {
  for (const p of ["peaceai/spec/throw-guard-top-v1.md", "peaceai/test/m47-guard-top.test.ts", "peaceai/rules/learned/public-throw-guard-top-v1.json", "peaceai/rules/proposals/m47-guard-top-evidence.json", "peaceai/lib/learned-guard.ts"])
    assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
  assert.equal(createHash("sha256").update(read("peaceai/spec/throw-guard-top-v1.md")).digest("hex"), SPEC_SHA);
});
const SPEC_SHA = "46b4b51a19555d1cb4a259f87a3f6dcfead32a0027c669ea5dd82764d7bf6f11";
