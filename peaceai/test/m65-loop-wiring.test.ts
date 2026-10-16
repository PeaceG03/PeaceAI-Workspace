// M65 wiring: public-loop-function-v1 (LOOP_FUNCTION, kind COMPLEX_FUNCTION) in Job A's rule step, admitted only via
// the hash-pinned approved list; the dev path (applyComplexRule) needs PEACEAI_COMPLEX_FUNCTION and PEACEAI_LOOP_FUNCTION.
// Auditor follow-up (#218): PARAM.length bounds/starts only on string- or array-typed parameters.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { admitRules } from "../lib/approved.ts";
import { applyComplexRule, LOOP_FUNCTION_FLAG, LOOP_TRIGGER, LOOP_UNBOUNDED, LOOP_WHILE_UNSUPPORTED } from "../lib/learned-complex.ts";
import { applyRule, specHash, type RuleSpec } from "../lib/learned.ts";
import { isLoopSpec, phrasingFor, proposalBody, parseMarker, parseSpecBlock } from "../lib/propose.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const SPEC = JSON.parse(read("peaceai/rules/learned/public-loop-function-v1.json")) as RuleSpec;
const SHA = "d01626560b33dbc88bd12e7375f3e003b32f1059677b2dfeb69920e231cc2512";
const files = [{ path: "src/a.ts", content: "export const x = 1;\n" }];
const t = (sig: string, body: string, check: string) => `add loop function ${sig} to src/a.ts with body:\n${body}\n${check}`;
const job = (objective: string) => { const w: { reason?: string } = {}; const e = applyRule(SPEC, objective, files, undefined, undefined, w, () => false); return { e, r: w.reason }; };
const sum = t("sumAll(xs: number[]): number", "let s = 0;\nfor (let i = 0; i < xs.length; i++) {\ns += xs[i];\n}\nreturn s;", "- sumAll([1, 2, 3]) is 6");

test("Job A: admitted only with the exact hash; builds once admitted with no dev flag", () => {
  assert.equal(specHash(SPEC), SHA);
  const list = (sha: string) => ({ ok: true as const, list: { schema: "peaceai-approved-rules:v1", rules: [{ id: SPEC.id, sha256: sha, source: "workspace" }] } as never });
  assert.equal(admitRules([SPEC], list(SHA))[0]!.decision, "APPROVED");
  assert.equal(admitRules([SPEC], list("0".repeat(64)))[0]!.decision, "HASH_CHANGED");
  assert.equal(admitRules([SPEC], { ok: true, list: { schema: "peaceai-approved-rules:v1", rules: [] } as never })[0]!.decision, "NOT_APPROVED");
  const onMain = JSON.parse(read("peaceai/rules/approved.json")) as { rules: { id: string }[] };
  for (const r of onMain.rules.filter((x) => x.id === SPEC.id) as { id: string; sha256: string }[]) assert.equal(r.sha256, SHA, "listed only with its exact hash (Peace /approve-rule, #220)");
  const saved = { c: process.env.PEACEAI_COMPLEX_FUNCTION, l: process.env[LOOP_FUNCTION_FLAG] };
  delete process.env.PEACEAI_COMPLEX_FUNCTION; delete process.env[LOOP_FUNCTION_FLAG];
  try {
    const { e, r } = job(sum);
    assert.ok(e, r);
    assert.match(e!.content, /export function sumAll\(xs: number\[\]\): number/);
    assert.equal(job(t("w(n: number): number", "let i = 0;\nwhile (i < 3) {\ni += 1;\n}\nreturn i + n;", "- w(1) is 4")).r, LOOP_WHILE_UNSUPPORTED);
  } finally {
    if (saved.c !== undefined) process.env.PEACEAI_COMPLEX_FUNCTION = saved.c;
    if (saved.l !== undefined) process.env[LOOP_FUNCTION_FLAG] = saved.l;
  }
});

test("dev path: loops need both PEACEAI_COMPLEX_FUNCTION and PEACEAI_LOOP_FUNCTION exactly \"true\"", () => {
  const p = SPEC.params as Record<string, string | string[]>;
  assert.equal(applyComplexRule(LOOP_TRIGGER, p, sum, files, undefined, {}), null);
  assert.equal(applyComplexRule(LOOP_TRIGGER, p, sum, files, undefined, { PEACEAI_COMPLEX_FUNCTION: "true" }), null);
  assert.equal(applyComplexRule(LOOP_TRIGGER, p, sum, files, undefined, { PEACEAI_COMPLEX_FUNCTION: "true", PEACEAI_LOOP_FUNCTION: "1" }), null);
  assert.ok(applyComplexRule(LOOP_TRIGGER, p, sum, files, undefined, { PEACEAI_COMPLEX_FUNCTION: "true", PEACEAI_LOOP_FUNCTION: "true" }));
});

test("Auditor follow-up: .length bound/start only on string or array params; refused on a number or boolean param", () => {
  for (const [sig, call] of [["f(s: string): number", "f(\"abc\")"], ["f(xs: number[]): number", "f([1, 2, 3])"], ["f(xs: readonly string[]): number", "f([\"a\", \"b\", \"c\"])"]] as const) {
    const name = sig.slice(2, sig.indexOf(":"));
    assert.ok(job(t(sig, `let c = 0;\nfor (let i = 0; i < ${name}.length; i++) {\nc += 1;\n}\nreturn c;`, `- ${call} is 3`)).e, sig);
    assert.ok(job(t(sig, `let c = 0;\nfor (let i = ${name}.length; i < 9; i++) {\nc += 1;\n}\nreturn c;`, `- ${call} is 6`)).e, `${sig} start`);
  }
  for (const sig of ["f(n: number): number", "f(b: boolean): number"]) {
    const name = sig.slice(2, 3);
    assert.equal(job(t(sig, `let c = 0;\nfor (let i = 0; i < ${name}.length; i++) {\nc += 1;\n}\nreturn c;`, "- f(3) is 0")).r, LOOP_UNBOUNDED, `${sig} bound`);
    assert.equal(job(t(sig, `let c = 0;\nfor (let i = ${name}.length; i < 9; i++) {\nc += 1;\n}\nreturn c;`, "- f(3) is 0")).r, LOOP_UNBOUNDED, `${sig} start`);
  }
});

test("proposal: loop phrasing and description, marker and spec block carry the exact hash", () => {
  assert.ok(isLoopSpec(SPEC));
  assert.ok(!isLoopSpec(JSON.parse(read("peaceai/rules/learned/public-complex-function-v1.json")) as RuleSpec));
  assert.match(phrasingFor(SPEC), /^add loop function/);
  const body = proposalBody({ spec: SPEC, sha256: SHA, stats: { shape: "COMPLEX_FUNCTION" as never, covered: null, hunks: 10, commits: 4, files: 10, examples: [], styles: {} } }, []);
  assert.deepEqual(parseMarker(body), { id: SPEC.id, sha256: SHA, source: "public" });
  assert.equal(specHash(parseSpecBlock(body) as RuleSpec), SHA);
  assert.match(body, /loop_while_unsupported/);
  assert.doesNotMatch(body, /Every loop form is refused/);
});

test("wiring proofs are protected", () => {
  assert.ok(PROTECTED_SELF.some((x) => x.pattern.test("peaceai/test/m65-loop-wiring.test.ts")));
});

test("Auditor #219 note: a loop function cannot call a same-file helper (body_refused), even an exported pure one", () => {
  const withHelper = [{ path: "src/a.ts", content: "export function dbl(n: number): number {\n  return n + n;\n}\n" }];
  const w: { reason?: string } = {};
  const task = t("sumDbl(xs: number[]): number", "let s = 0;\nfor (const x of xs) {\ns += dbl(x);\n}\nreturn s;", "- sumDbl([1, 2]) is 6");
  assert.equal(applyRule(SPEC, task, withHelper, undefined, undefined, w, () => false), null);
  assert.equal(w.reason, "body_refused");
  const env = { PEACEAI_COMPLEX_FUNCTION: "true", [LOOP_FUNCTION_FLAG]: "true" };
  assert.equal(applyComplexRule(LOOP_TRIGGER, SPEC.params as Record<string, string | string[]>, task, withHelper, undefined, env), null);
  assert.ok(applyComplexRule(LOOP_TRIGGER, SPEC.params as Record<string, string | string[]>, task.replace("s += dbl(x);", "s += x + x;"), withHelper, undefined, env), "same loop without the call builds");
  assert.match(read("peaceai/lib/learned-complex.ts"), /No helper calls \(Auditor #219 note\)/);
});
