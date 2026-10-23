// M100: the derive family census classifies multi-statement bodies and ranks against the official builder-log coverage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { classifyBody, officialUncovered } from "../lib/derive-family-census.ts";
import { coverageReport } from "../../builder-log/coverage.ts";
import { LOG_PATH } from "../../builder-log/check.ts";

const cls = (src: string) => {
  const sf = ts.createSourceFile("x.ts", src, ts.ScriptTarget.Latest, true);
  const fn = sf.statements[0] as ts.FunctionDeclaration;
  return classifyBody(fn, new Set(fn.parameters.map((p) => (p.name as ts.Identifier).text)));
};

test("classifies multi-statement bodies by the smallest family", () => {
  assert.equal(cls("function f(x: number): number { return Math.min(100, Math.max(0, x)); }"), "family-1");
  assert.equal(cls("function f(v: number): number { return v >= 0 ? v * 2 : -v * 2 - 1; }"), "piecewise");
  assert.equal(cls("function f(d: number): boolean { if (d < 0) throw new Error(\"X\"); return d === 0 || d === 6; }"), "bool-combos");
  assert.equal(cls("function f(n: number): boolean { return n < 10 || n > 50; }"), "outside-range");
  assert.equal(cls("function f(a: string, b: string): number { if (a < b) return -1; if (a > b) return 1; return 0; }"), "NEW if-return-chains");
  assert.equal(cls("function f(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }"), "NEW if-return-chains");
  assert.equal(cls("function f(d: string): string { const p = \"x\"; return `${p}/${d}`; }"), "NEW template-joins");
  assert.equal(cls("function f(s: string): string { switch (s) { case \"a\": return \"A\"; default: return \"\"; } }"), "NEW lookup-switch");
  assert.equal(cls("function f(s: string): string { return s.trim().toUpperCase(); }"), "NEW string-methods");
  assert.equal(cls("function f(v: number): number { return Math.round(v * K) / K; }"), "NEW number-format");
  assert.equal(cls("function f(k: string): boolean { return ks.includes(k); }"), "out-of-scope"); // closure receiver
  assert.equal(cls("function f(n: number): number { let t = 0; for (let i = 0; i < n; i++) t += i; return t; }"), "out-of-scope");
});

test("the official uncovered rows are exactly coverage.ts's all-time denominator minus numerator", () => {
  const log = readFileSync(LOG_PATH, "utf8");
  const onMain = () => true;
  const o = officialUncovered(log, "2026-10-23", onMain);
  const r = coverageReport(log, "2026-10-23", { onMain });
  assert.equal(o.total, r.allTime.builderTasks);
  assert.equal(o.total - o.uncovered.length, r.allTime.peaceaiAble);
  assert.ok(o.uncovered.every((e) => e.by === "Builder"));
});
