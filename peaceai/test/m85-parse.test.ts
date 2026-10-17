// M85 (stress test v1, tasks C4 and D2): two parser fixes, no rule, vocabulary or grading change:
// - issue cleaning dropped every backtick, which destroyed a template literal in a function body (C4); a one-line
//   backtick span that holds a `${...}` substitution is now kept as code;
// - a check bullet `is new Date("ISO")` reads as deepEqual, rendered only for a DATE function whose declared return is
//   Date (D2, builder-only `expected: date-literal`); ADD_TEST_CASE specs keep refusing Date expected values (M35).
import assert from "node:assert/strict";
import test from "node:test";
import { cleanIssueText } from "../lib/taskmap.ts";
import { parseTestTask, buildTestEdit } from "../lib/learned-test.ts";
import { applyRule, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..", "..");
const load = (id: string) => JSON.parse(readFileSync(join(repo, "peaceai/rules/learned", `${id}.json`), "utf8")) as RuleSpec;

const clean = (body: string) => cleanIssueText({ title: "T", body });
const HEAD = String.raw`^add (?:a )?test for (?<symbol>[A-Za-z_$][\w$]*) in (?<file>[\w./-]+\.ts)(?: ?: (?<title>[^\n]{1,120}?))?$`;
const FIX = "Fix: " + "a".repeat(40);
const PARAMS = { assert: "node:assert/strict-default", checks: ["equal", "deepEqual", "throws"], framework: "node:test-default", grading: "fail-before-pass-after", matcher: "regex", maxLines: "12", placement: "new-file" };
const FILES = [{ path: "src/a.ts", content: "export function d(x: number): Date { return new Date(x); }\n" }];

test("a template literal with a substitution keeps its backticks; Markdown code spans still lose theirs", () => {
  const out = clean("add function `f` in `src/a.ts`\n  return `${a}-${b}`;\n- `f('x')` is `'x'`");
  assert.ok(out.includes("return `${a}-${b}`;"), out);
  assert.ok(out.includes("add function f in src/a.ts"), out);
  assert.ok(out.includes("f('x') is 'x'"), out);
});

test("a backtick span with no substitution, or one spanning lines, is still Markdown", () => {
  assert.ok(!clean("x `plain` y").includes("`"));
  assert.ok(!clean("x `${a}\nb` y").includes("`"));
  // The private-use placeholder cannot be smuggled in to forge a kept backtick.
  assert.ok(!clean("x \uE000a\uE000 y").includes("`"));
  assert.ok(!clean("x \uE000a\uE000 y").includes("\uE000"));
});

test("`is new Date(\"ISO\")` reads as deepEqual; built only with the builder-only expected key", () => {
  const t = parseTestTask(HEAD, ["add a test for d in src/a.ts", '- d(0) is `new Date("1970-01-01T00:00:00Z")`', FIX].join("\n"))!;
  assert.deepEqual(t.checks.map((c) => c.kind), ["deepEqual"]);
  assert.equal(buildTestEdit(PARAMS, t, FILES), null, "plain test params still refuse a Date expected value");
  const e = buildTestEdit({ ...PARAMS, expected: "date-literal" }, t, FILES)!;
  assert.ok(e.content.includes('assert.deepEqual(d(0), new Date("1970-01-01T00:00:00Z"));'), e.content);
});

test("still refused: a non-ISO or computed Date as expected value", () => {
  for (const v of ['new Date("tomorrow")', "new Date(Date.now())", 'new Date("2026-01-01T00:00:00")']) {
    const t = parseTestTask(HEAD, ["add a test for d in src/a.ts", `- d(0) is ${v}`, FIX].join("\n"));
    assert.ok(t === null || buildTestEdit({ ...PARAMS, expected: "date-literal" }, t, FILES) === null, v);
  }
});

test("a learned ADD_TEST_CASE spec cannot carry the expected key", () => {
  const v1 = load("public-test-case-v1");
  assert.equal(validateSpec(v1), true);
  assert.equal(validateSpec({ ...v1, params: { ...v1.params, expected: "date-literal" } }), false);
});

test("DATE function with a Date return writes a Date expectation; a string-returning one still refuses it", () => {
  const spec = load("public-date-function-v1");
  const files = [{ path: "src/a.ts", content: "export const one = 1;\n" }];
  const mk = (ret: string, check: string) => [`add date function shift(d: Date, n: number): ${ret} to src/a.ts with body:`, ret === "Date" ? "return new Date(d.getTime() + n);" : "return d.getTime() + n;", check].join("\n");
  const r = applyRule(spec, mk("Date", '- shift(new Date("2026-01-01T00:00:00Z"), 1000) is new Date("2026-01-01T00:00:01Z")'), files);
  assert.ok(r && JSON.stringify(r).includes(String.raw`assert.deepEqual(shift(new Date(\"2026-01-01T00:00:00Z\"), 1000), new Date(\"2026-01-01T00:00:01Z\"));`), JSON.stringify(r)?.slice(0, 400));
  assert.equal(applyRule(spec, mk("number", '- shift(new Date("2026-01-01T00:00:00Z"), 1000) is new Date("2026-01-01T00:00:01Z")'), files), null);
});
