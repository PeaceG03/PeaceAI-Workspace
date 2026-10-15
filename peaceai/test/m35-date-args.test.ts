// M35: Date arguments in learned test checks (ADD_TEST_CASE spec with `args: date-literal`). Proposal, off until approved.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { applyRule, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { checkRoot, isDateLiteral, TEST_TRIGGER } from "../lib/learned-test.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const load = (id: string) => JSON.parse(readFileSync(join(repo, "peaceai/rules/learned", `${id}.json`), "utf8")) as RuleSpec;
const V1 = load("public-test-case-v1");
const DT = load("public-test-case-dateargs-v1");
const LIB = 'export function expectedLatest(now: Date): string {\n  return now.toISOString().slice(0, 10);\n}\nexport function overlap(a: Date[], b: Date[]): boolean {\n  return a.some((x) => b.some((y) => +x === +y));\n}\n';
const files = [{ path: "src/days.ts", content: LIB }];
const task = (line: string) => `add a test for \`expectedLatest\` in \`src/days.ts\`: date args\n${line}\nFix: ${"a".repeat(40)}`;
const expr = (t: string) => { const sf = ts.createSourceFile("e.ts", `(${t});`, ts.ScriptTarget.Latest, true); return ((sf.statements[0] as ts.ExpressionStatement).expression as ts.ParenthesizedExpression).expression; };
const run = (spec: RuleSpec, line: string) => applyRule(spec, task(line), files);

test("spec: validates, public, plain v1 params + args date-literal; not approved (off)", () => {
  assert.ok(validateSpec(DT));
  assert.equal(DT.trigger, TEST_TRIGGER);
  const { args, ...rest } = DT.params;
  assert.equal(args, "date-literal");
  assert.deepEqual(rest, V1.params);
  assert.ok(!validateSpec({ ...DT, params: { ...DT.params, args: "dates" } }));
  const approved = JSON.parse(readFileSync(join(repo, "peaceai/rules/approved.json"), "utf8"));
  assert.ok(!approved.rules.some((r: { id: string }) => r.id === DT.id), "off until Peace approves");
});

test("isDateLiteral: one short plain string literal only", () => {
  for (const ok of ['new Date("2026-10-11T13:00:00Z")', 'new Date("2021-01-01")', 'new Date("2026-01-10T12:00:00.000Z")', 'new Date("2026-10-11T13:00+02:00")', 'new Date("2024-02-29")']) assert.ok(isDateLiteral(expr(ok)), ok);
  for (const bad of ['new Date(0)', 'new Date("a", "b")', 'new Date()', 'new Date(`2021`)', 'new Date("2021\\u0041")', `new Date("${"1".repeat(33)}")`, 'new Date("a;b")', 'new Date<any>("2021")', 'new Foo("2021")', 'Date("2021")']) assert.ok(!isDateLiteral(expr(bad)), bad);
});

test("Auditor #152 follow-up: ISO date-only or Z/offset date-times only", () => {
  for (const bad of ['new Date("invalid")', 'new Date("2026-10-11T13:00:00")', 'new Date("2026-10-11 13:00:00Z")', 'new Date("Oct 11 2026")', 'new Date("2026-1-1")', 'new Date("2026-02-30")', 'new Date("2023-02-29")', 'new Date("2026-13-01")', 'new Date("2026-10-11T24:00Z")', 'new Date("2026-10-11T13:60Z")', 'new Date("2026-10-11T13:00+15:00")', 'new Date("2026-10-11T13:00+0200")', 'new Date("+002026-10-11")', 'new Date("2026")', 'new Date("2026-10")', 'new Date("2026-10-11Z")']) assert.ok(!isDateLiteral(expr(bad)), bad);
});

test("Auditor #154 nit: years 0000-0099 validated as themselves, not as 1900-1999", () => {
  for (const ok of ["0000-02-29", "0004-02-29", "0096-02-29", "0054-02-18", "0400-02-29", "2000-02-29"]) assert.ok(isDateLiteral(expr(`new Date("${ok}")`)), ok);
  for (const bad of ["0001-02-29", "0100-02-29", "0099-02-29", "1900-02-29", "0003-02-29"]) assert.ok(!isDateLiteral(expr(`new Date("${bad}")`)), bad);
});

test("checkRoot: Date only as a call argument, and only with dates on", () => {
  assert.equal(checkRoot(expr('expectedLatest(new Date("2026-10-11"))'), true), "expectedLatest");
  assert.equal(checkRoot(expr('overlap([new Date("2021-01-01")], [])'), true), "overlap");
  assert.equal(checkRoot(expr('expectedLatest(new Date("2026-10-11"))')), null, "plain specs unchanged");
  assert.equal(checkRoot(expr('new Foo(new Date("2021"))'), true), null, "not as a new-argument");
  assert.equal(checkRoot(expr('x[new Date("2021")]'), true), null, "not as an index");
  assert.equal(checkRoot(expr('expectedLatest(new Date(Date.now()))'), true), null);
  assert.equal(checkRoot(expr('expectedLatest({ __proto__: new Date("2021-01-01") })'), true), "expectedLatest", "root only; objects are refused by objectArgsReason in buildTestEdit");
});

test("buildTestEdit: date spec builds a test for a Date-argument task; plain v1 still refuses it; date spec skips plain tasks", () => {
  const line = '- `expectedLatest(new Date("2026-10-11T13:00:00Z"))` is "2026-10-11"';
  const r = run(DT, line);
  assert.ok(r && r.create, "date spec builds");
  const body = JSON.stringify(r);
  assert.ok(body.includes(String.raw`assert.equal(expectedLatest(new Date(\"2026-10-11T13:00:00Z\")), \"2026-10-11\");`), body.slice(0, 300));
  assert.equal(run(V1, line), null, "plain v1 still refuses Date args");
  assert.equal(run(DT, '- `expectedLatest("x")` is "x"'), null, "no Date arg: left to the plain specs");
  assert.equal(run(DT, '- `expectedLatest({ __proto__: new Date("2026-10-11") })` is "x"'), null, "__proto__ refused");
  assert.equal(run(DT, '- `expectedLatest(new Date("2026-10-11"))` is new Date("2026-10-11")'), null, "Date never an expected value");
});

test("evidence: >= 10 distinct fitting lines, each tagged with provenance", () => {
  const ev = JSON.parse(readFileSync(join(repo, "peaceai/rules/evidence/public-test-case-dateargs-v1.json"), "utf8"));
  assert.equal(ev.rule, DT.id);
  assert.ok(ev.counted >= 10 && ev.entries.length === ev.counted);
  assert.equal(new Set(ev.entries.map((e: { repo: string; line: string }) => e.repo + "\n" + e.line)).size, ev.counted);
  for (const e of ev.entries) {
    assert.equal(e.origin, "external");
    assert.match(e.commit, /^[0-9a-f]{40}$/); assert.match(e.fileSha256, /^[0-9a-f]{64}$/);
    assert.ok(["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause"].includes(e.license));
    assert.match(e.line, /new Date\(["'][^"']+["']\)/);
  }
  assert.equal(DT.evidence.hunks, ev.counted);
});
