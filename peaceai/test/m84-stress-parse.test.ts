// M84 (stress test v1, notes/stress-v1): parser fixes found by the stress run. No rule, vocabulary or grading change:
// - issue cleaning kept deleting an HTML comment inside a quoted expected value (task M2), which made Job A write a
//   wrong expectation (Job B caught it); a comment inside a quote on its line is now task data;
// - check bullets read `is [..]` / `is {..}` as the existing deepEqual check (tasks C3, L4), and NaN / Infinity /
//   -Infinity as literal values (task G1).
import assert from "node:assert/strict";
import test from "node:test";
import { cleanIssueText, insideQuote } from "../lib/taskmap.ts";
import { parseTestTask, buildTestEdit } from "../lib/learned-test.ts";

const clean = (body: string) => cleanIssueText({ title: "T", body });
const HEAD = String.raw`^add (?:a )?test for (?<symbol>[A-Za-z_$][\w$]*) in (?<file>[\w./-]+\.ts)(?: ?: (?<title>[^\n]{1,120}?))?$`;
const FIX = "Fix: " + "a".repeat(40);
const PARAMS = { assert: "node:assert/strict-default", checks: ["equal", "deepEqual", "throws"], framework: "node:test-default", grading: "fail-before-pass-after", matcher: "regex", maxLines: "12", placement: "new-file" };
const FILES = [{ path: "src/a.ts", content: "export function f(x: number): number[] { return [x]; }\nexport function g(x: number): number { return x; }\n" }];

test("an HTML comment inside a quoted literal survives cleaning; a bare one is still removed", () => {
  const out = clean("guard `alertMarker` in `src/t.ts` with a method: throw K when key.startsWith(' ')\n- `alertMarker('a')` is `'<!-- scanner-alert-key: a -->'`\n<!-- hidden note -->");
  assert.ok(out.includes("'<!-- scanner-alert-key: a -->'"), out);
  assert.ok(!out.includes("hidden note"), out);
  assert.ok(!clean('a "x" <!-- y --> b').includes("y"));
  assert.ok(clean('- f() is "<!-- z -->"').includes('"<!-- z -->"'));
});

test("a comment spanning lines is never kept, even when a quote is open", () => {
  assert.ok(!clean("- f() is '<!-- a\nb -->'").includes("<!--"));
});

test("insideQuote: per line, either quote kind, closed quotes do not count", () => {
  assert.equal(insideQuote("x 'a' <", 6), false);
  assert.equal(insideQuote("x 'a <", 5), true);
  assert.equal(insideQuote('say "it\'s <', 10), true);
  assert.equal(insideQuote("'open\nnext <", 11), false);
});

test("`is [..]` reads as deepEqual and builds assert.deepEqual", () => {
  const t = parseTestTask(HEAD, ["add a test for f in src/a.ts", "- f(1) is [1]", "- g(2) is 2", FIX].join("\n"))!;
  assert.deepEqual(t.checks.map((c) => c.kind), ["deepEqual", "equal"]);
  const e = buildTestEdit(PARAMS, t, FILES)!;
  assert.ok(e.content.includes("assert.deepEqual(f(1), [1]);"), e.content);
});

test("NaN, Infinity and -Infinity are literal values in calls and expectations", () => {
  const t = parseTestTask(HEAD, ["add a test for g in src/a.ts", "- g(NaN) is NaN", "- g(-Infinity) is -Infinity", "- g(Infinity) throws BAD_X", FIX].join("\n"))!;
  assert.ok(t, "parsed");
  const e = buildTestEdit(PARAMS, t, FILES)!;
  assert.ok(e.content.includes("assert.equal(g(NaN), NaN);") && e.content.includes("assert.equal(g(-Infinity), -Infinity);"), e.content);
});

test("still refused: other identifiers as values, `is` with a non-literal", () => {
  assert.equal(parseTestTask(HEAD, ["add a test for g in src/a.ts", "- g(1) is foo", FIX].join("\n")), null);
  const t = parseTestTask(HEAD, ["add a test for g in src/a.ts", "- g(x) is 1", FIX].join("\n"))!;
  assert.equal(buildTestEdit(PARAMS, t, FILES), null);
  const u = parseTestTask(HEAD, ["add a test for f in src/a.ts", "- f(1) is [x]", FIX].join("\n"))!;
  assert.equal(buildTestEdit(PARAMS, u, FILES), null);
});
