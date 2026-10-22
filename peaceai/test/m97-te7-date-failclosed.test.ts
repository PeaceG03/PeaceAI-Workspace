// Auditor #466 (4th review): FAIL-CLOSED Date use in the shared TEST_EXISTING walk (every version, v1-v7).
// (i) Allowlist: a Date-valued expression may only be the receiver of a listed zone-free method call, `!d`, a numeric
//     operator / relation / strict equality, a statement, a binding (local, non-exported), a for-of source, a whole
//     argument at a same-file parameter typed Date, or what the tested function returns (also inside a returned
//     literal). The `Date` global may only be `new Date(..)` / `Date.UTC(..)`. Anything else - join, toString,
//     templates, concat, String, map(String), Array.from, String.call, replace, padEnd, encodeURIComponent,
//     JSON.stringify, Reflect.apply, bracket access, `?.`, call / apply / bind, Object.assign - is refused.
// (ii) Provenance: `new Date(x)` takes a number, an ISO literal with Z / an offset or date-only, the tested function's
//     own never-written parameter, or `${p}T..Z` of one; Job A and Job B (dateArgProblem / dateTestProblem) then
//     require every test argument there to be such a literal (date-only for the template form).
// (iii) Backstop: Job B runs the real code once per EXISTING_TZ_RUNS zone (UTC, America/Denver, Asia/Tokyo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applyRule, type RuleSpec } from "../lib/learned.ts";
import { dateTestProblem, existingTargetRefusal, TEST_TARGET_DATE_LOCAL } from "../lib/learned-test-existing.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
type Files = Record<string, string>;
const P = JSON.parse(read("peaceai/test/m97-te7-date-failclosed.probes.json")) as {
  cases: Record<string, [Files, string]>; want: Record<string, Record<string, string>>; newlyRefused: string[]; auditor: string[]; variants: string[];
};
const VERS = ["v1", "v2", "v3", "v4", "v5", "v6", "v7"] as const;
const optsFor = (v: string, rd: { read: (rel: string) => string | null }): Record<string, unknown> =>
  ({ v1: { load: rd }, v2: { v2: rd }, v3: { v2: rd, dates: true }, v4: { v2: rd, v4: true }, v5: { v2: rd, v5: true }, v6: { v2: rd, v6: true }, v7: { v2: rd, v7: true } } as Record<string, Record<string, unknown>>)[v]!;
const verdicts = (files: Files, fn: string) => {
  const rd = { read: (rel: string) => files[rel] ?? null };
  return Object.fromEntries(VERS.map((v) => [v, existingTargetRefusal("src/a.ts", files["src/a.ts"]!, fn, optsFor(v, rd)) ?? "ok"]));
};
const allRefused = (r: Record<string, string>) => VERS.every((v) => r[v] !== "ok");
// Controls in Auditor's c9 file: UTC-only setters with toISOString / getTime (zone-free) on a tested-parameter string.
const CONTROLS = new Set(["c9:x_iso", "c9:x_setUTCplusLocal", "c9:p_localParse_v3", "c9:p_localParse"]);

test("Auditor #466 4th-review repros and the author's variants: verdicts pinned; every repro and variant refused under v1-v7", () => {
  assert.equal(Object.keys(P.cases).length, 277);
  for (const [k, [files, fn]] of Object.entries(P.cases)) assert.deepEqual(verdicts(files, fn), P.want[k], k);
  for (const k of P.auditor.filter((x) => !CONTROLS.has(x))) assert.ok(allRefused(P.want[k]!), k);
  for (const k of P.variants) assert.ok(allRefused(P.want[k]!), k);
  // Blocker 1 (Date to string), 2 (bracket access) and the zoneless-argument shapes, by name.
  for (const k of ["c8:d_arrJoin", "c8:d_concat", "c8:d_json", "c8:d_bracket", "c8:d_bracketVar", "c8:d_argDateParam", "c9:x_arrJoin", "c9:x_arrToString",
    "c9:x_arrTmpl", "c9:x_concat", "c9:x_mapStr", "c9:x_strCtorCall", "c9:x_replace", "c9:x_padEnd", "c9:x_encode", "c9:n_arrJoin", "c9:n_concat",
    "c9:n_bracketSet", "c9:n_bracketGet", "c9:n_arrMap", "c9:y_bracketV7", "c9:y_bracketGetV7"]) assert.ok(allRefused(P.want[k]!), k);
  assert.ok(P.variants.length >= 100);
});

test("blocker 1 and 2 by construction: Date to string in every form, bracket access, and the dynamic call forms", () => {
  const forms = [
    "[new Date(s)].join()", "String(new Date(s))", "`${new Date(s)}`", "''.concat(new Date(s) as any)", "[new Date(s)].map(String)[0]!",
    "Array.from([new Date(s)], String)[0]!", "String.call(null, new Date(s))", "'x'.replace('x', new Date(s) as any)", "''.padEnd(1, new Date(s) as any)",
    "encodeURIComponent(new Date(s) as any)", "JSON.stringify(new Date(s))", "JSON.stringify({ d: new Date(s) })", "new Date(s)['toString']()",
    "String(new Date(s)['getHours']())", "String(Reflect.apply(Date.prototype.getHours, new Date(s), []))", "String(new Date(s)?.getHours())",
    "String(new Date(s).getHours.call(new Date(s)))", "String(new Date(s).getHours.bind(new Date(s))())", "String(Object.assign({}, { d: new Date(s) }).d)",
  ];
  for (const e of forms) {
    const r = verdicts({ "src/a.ts": `export function f(s: string): string { return ${e}; }\n` }, "f");
    assert.ok(allRefused(r), `${e} ${JSON.stringify(r)}`);
  }
  for (const k of ["setDate", "setHours", "getHours", "getDate", "toString", "toLocaleString"]) {
    const r = verdicts({ "src/a.ts": `export function f(s: string): number { const d = new Date(s); return Number(d["${k}"](2)); }\n` }, "f");
    for (const v of VERS) assert.equal(r[v], TEST_TARGET_DATE_LOCAL, `${k} ${v}`);
  }
});

test("blocker 3: a Date-reaching string must be provably zoned; the target accepts only a tested parameter, held by Job A / Job B", () => {
  const SPEC = JSON.parse(read("peaceai/rules/learned/public-test-case-existing-v1.json")) as RuleSpec;
  const jobA = (src: string, checks: string) => {
    const w: { reason?: string } = {};
    const e = applyRule(SPEC, `add a characterization test for f in src/a.ts\n${checks}`, [{ path: "src/a.ts", content: src }], (p: string) => /\.test\.ts$/.test(p), undefined, w, () => false);
    return { e, r: w.reason };
  };
  const getTime = "export function f(s: string): number { return new Date(s).getTime(); }\n";
  assert.equal(jobA(getTime, '- f("2024-03-04T00:00") is 1709510400000').e, null, "zoneless text: read in local time");
  assert.equal(jobA(getTime, '- f("March 4, 2024") is 1709510400000').e, null, "non-ISO text");
  assert.ok(jobA(getTime, '- f("2024-03-04T00:00:00Z") is 1709510400000').e, "ISO with Z");
  assert.ok(jobA(getTime, '- f("2024-03-04T00:00:00+00:00") is 1709510400000').e, "ISO with an offset");
  assert.ok(jobA(getTime, '- f("2024-03-04") is 1709510400000').e, "date-only (UTC by the spec)");
  const tpl = "export function f(s: string): number { return new Date(`${s}T00:00:00Z`).getTime(); }\n";
  assert.ok(jobA(tpl, '- f("2024-03-04") is 1709510400000').e, "template: a date-only argument");
  assert.equal(jobA(tpl, '- f("2024-03-04T00:00:00Z") is 1709510400000').e, null, "template: anything but date-only");
  // Not provable: a helper's parameter, a field, a re-entered tested function, a union with Date, a module value.
  for (const src of [
    "function h(x: string): number { return new Date(x).getTime(); }\nexport function f(s: string): number { return h(s); }\n",
    "export function f(o: { s: string }): number { return new Date(o.s).getTime(); }\n",
    "export function f(s: string, n: number): number { if (n > 0) return f(s + \"T00:00\", n - 1); return new Date(s).getTime(); }\n",
    "export function f(s: Date | string): number { return new Date(s).getTime(); }\n",
    "const S = \"2024-03-04T00:00\";\nexport function f(): number { return new Date(S).getTime(); }\n",
    "export function f(s: string): number { const t = s; return new Date(t).getTime(); }\n",
    "export function f(s: string): number { s = s.trim(); return new Date(s).getTime(); }\n",
  ]) assert.ok(allRefused(verdicts({ "src/a.ts": src }, "f")), src);
});

test("dateTestProblem (Job B): string arguments at Date-reaching indices must be zoned ISO literals; Date literals only at Date parameters", () => {
  const m = "export function f(s: string, d: Date, n: number): number { return new Date(s).getTime() + d.getTime() + n; }\n";
  const t = (body: string) => dateTestProblem(m, "f", `import { f } from "./a";\n${body}\n`, "f");
  assert.equal(t('assert.equal(f("2024-03-04T00:00:00Z", new Date("2024-03-04"), 1), 0);'), null);
  assert.notEqual(t('assert.equal(f("2024-03-04T00:00", new Date("2024-03-04"), 1), 0);'), null, "zoneless");
  assert.notEqual(t('const s = "2024-03-04T00:00:00Z";\nassert.equal(f(s, new Date("2024-03-04"), 1), 0);'), null, "not a literal");
  assert.notEqual(t('assert.equal(f(...(["2024-03-04Z"] as [string]), new Date("2024-03-04"), 1), 0);'), null, "spread");
  assert.notEqual(t('const g = f;\nassert.equal(g("2024-03-04T00:00", new Date("2024-03-04"), 1), 0);'), null, "aliased");
  assert.notEqual(t('assert.equal(f("2024-03-04T00:00:00Z", new Date("2024-03-04T00:00"), 1), 0);'), null, "zoneless Date literal");
  assert.notEqual(t('assert.equal(f("2024-03-04T00:00:00Z", new Date("2024-03-04"), new Date("2024-03-04") as any), 0);'), null, "Date at a non-Date index");
  assert.notEqual(t('const d = new Date("2024-03-04");\nassert.equal(f("2024-03-04T00:00:00Z", d, 1), 0);'), null, "bound Date");
  assert.equal(t('assert.deepEqual(new Map([["a", 1]]), new Map([["a", 1]]));\nassert.equal(f("2024-03-04Z" === "" ? "" : "2024-03-04", new Date("2024-03-04"), 1), 0);') === null, false);
  const arr = "export function f(ds: readonly Date[]): number { let t = 0; for (const d of ds) t += d.getTime(); return t; }\n";
  assert.equal(dateTestProblem(arr, "f", 'import { f } from "./a";\nassert.equal(f([new Date("2024-03-04"), new Date("2024-03-05T00:00:00Z")]), 0);\n', "f"), null, "Date[] of literals");
  assert.notEqual(dateTestProblem(arr, "f", 'import { f } from "./a";\nassert.equal(f([new Date("2024-03-04T00:00")]), 0);\n', "f"), null);
  const noDate = "export function f(m: Map<string, number>): number { return m.size; }\n";
  assert.equal(dateTestProblem(noDate, "f", 'import { f } from "./a";\nassert.equal(f(new Map([["a", 1]])), 1);\n', "f"), null, "new Map is not a Date");
});

test("backstop (iii): Job B runs the real code under UTC, America/Denver and Asia/Tokyo; a zone-dependent test fails one", () => {
  const tc = read("peaceai/bin/test-candidates.ts");
  assert.match(tc, /export const EXISTING_TZ_RUNS = \["UTC", "America\/Denver", "Asia\/Tokyo"\] as const;/);
  const g = tc.slice(tc.indexOf("function gradeExisting("), tc.indexOf("/**\n * M13: grading of a learned guard"));
  assert.match(g, /for \(const tz of EXISTING_TZ_RUNS\) if \(!runExistingTests\(tree, newTests, reads, false, tz\)\.ok\) return ungradable\("real-not-stable"\);/);
  // What the backstop catches: Auditor's blocker-3 shape passes under UTC and fails under the other two zones.
  const dir = mkdtempSync(join(tmpdir(), "m97tz-"));
  try {
    const file = join(dir, "z.test.mjs");
    writeFileSync(file, 'import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("z", () => { assert.equal(new Date("2024-03-04T00:00").getTime(), 1709510400000); });\n');
    const ok = (tz: string) => spawnSync(process.execPath, ["--test", file], { env: { PATH: process.env.PATH ?? "", TZ: tz }, encoding: "utf8" }).status === 0;
    assert.deepEqual(["UTC", "America/Denver", "Asia/Tokyo"].map(ok), [true, false, false]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
