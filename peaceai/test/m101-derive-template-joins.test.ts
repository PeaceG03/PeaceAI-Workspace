// M101: template joins (n-ary string concat found by alignment) and str(number) in the derive DSL.
// The 6 PeaceSTOCKS template-join functions of the M100 census derive from behavior (budget 100000); every literal
// is cut from the outputs and checked by every example; a written number needs a 1-digit and a 3+-digit example;
// two fitting templates are a refusal with a question; a literal with a backslash or control character is never cut.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileProgram, deriveProgram, derivedExprProblem, evalProgram, templateFits, templateSize, type DeriveNode, type DeriveParam, type DeriveValue } from "../lib/derive.ts";
import { evalJs } from "../lib/derive-practice.ts";

const str = (name: string): DeriveParam => ({ name, type: "string" });
const num = (name: string): DeriveParam => ({ name, type: "number" });
const RICH = ["2026-10-23", "Hello World", "a", "x7", " lead", "trail ", "ERR_42", "MiXeD", "q.r", "", "Zz 9", "1999-01-02"];
const SH = ["3f2a", "AbC 1", "", "deadbeef", " x-y ", "Q"];
const P4 = "permanent/ticker-reference-index/";
const CENSUS: { name: string; params: string[]; f: (...a: string[]) => string; expr: string }[] = [
  { name: "daily-bars-sidecar dayPrefix", params: ["sessionDate"], f: (d) => `permanent/daily-bars-sidecar/${d}`, expr: `"permanent/daily-bars-sidecar/" + sessionDate` },
  { name: "daily-reply-dust dayPrefix", params: ["sessionDate"], f: (d) => `permanent/daily-reply-dust/${d}`, expr: `"permanent/daily-reply-dust/" + sessionDate` },
  { name: "intraday-reply-dust sessionPrefix", params: ["sessionDate"], f: (d) => `permanent/intraday-reply-dust/${d}`, expr: `"permanent/intraday-reply-dust/" + sessionDate` },
  { name: "tickerReferenceBaseKey", params: ["asOf", "bodySha256"], f: (a, b) => `${P4}base-${a}-${b}.jsonl.zst`, expr: `"${P4}base-" + asOf + "-" + bodySha256 + ".jsonl.zst"` },
  { name: "tickerReferenceManifestArchiveKey", params: ["month", "sha256"], f: (a, b) => `${P4}manifest-${a}-${b}.json`, expr: `"${P4}manifest-" + month + "-" + sha256 + ".json"` },
  { name: "tickerReferenceUnverifiedManifestArchiveKey", params: ["sha256"], f: (a) => `${P4}manifest-unverified-${a}.json`, expr: `"${P4}manifest-unverified-" + sha256 + ".json"` },
];
const rows = (n: number) => (n === 1 ? RICH.map((s) => [s]) : RICH.flatMap((a, i) => [[a, SH[i % SH.length]!], [a, SH[(i + 3) % SH.length]!]]).slice(0, 24));

for (const t of CENSUS) {
  test(`census template join derives: ${t.name}`, () => {
    const examples = rows(t.params.length).map((a) => ({ args: a, out: t.f(...a) }));
    const r = deriveProgram({ params: t.params.map(str), ret: "string", examples, budget: 100_000 });
    assert.equal(r.ok && r.fit.expr, t.expr);
    if (r.ok) assert.equal(derivedExprProblem(r.fit.expr, t.params), null);
  });
}

const NUMS = [0, 7, -3, 42, 123, 2026, 99999, -450];
test("str(number): a number slot compiles as (\"\" + n) and needs a 1-digit and a 3+-digit example", () => {
  const f = (s: string, n: number) => `part-${s}/${n}.json`;
  const ex = (ns: number[]) => RICH.map((s, i) => ({ args: [s, ns[i % ns.length]!] as DeriveValue[], out: f(s, ns[i % ns.length]!) }));
  const r = deriveProgram({ params: [str("name"), num("seq")], ret: "string", examples: ex(NUMS), budget: 100_000 });
  assert.equal(r.ok && r.fit.expr, `"part-" + name + "/" + ("" + seq) + ".json"`);
  if (r.ok) assert.equal(derivedExprProblem(r.fit.expr, ["name", "seq"]), null);
  // only 3-digit numbers: a padded text (padStart) would look the same, so it is refused and asks at 7
  const three = deriveProgram({ params: [str("name"), num("seq")], ret: "string", examples: ex([100, 123, 250, 999, 404]), budget: 100_000 });
  assert.equal(!three.ok && `${three.reason}/${three.gate}/${three.param}`, "derive_under_specified/chars/seq");
  assert.ok(!three.ok && three.questions?.some((q) => q.at[1] === 7));
  // only 1- and 2-digit numbers: refused, asks at 123
  const small = deriveProgram({ params: [str("name"), num("seq")], ret: "string", examples: ex([0, 7, -3, 42, 5, 11]), budget: 100_000 });
  assert.equal(!small.ok && `${small.reason}/${small.gate}`, "derive_under_specified/chars");
  // a number alone: "" + n
  const alone = deriveProgram({ params: [num("n")], ret: "string", examples: NUMS.map((n) => ({ args: [n], out: String(n) })), budget: 100_000 });
  assert.equal(alone.ok && alone.fit.expr, `("" + n)`);
});

test("a padded number (padStart, outside the DSL) is never derived", () => {
  const f = (n: number) => `seq-${String(n).padStart(3, "0")}`;
  const r = deriveProgram({ params: [num("n")], ret: "string", examples: NUMS.map((n) => ({ args: [n], out: f(n) })), budget: 100_000 });
  assert.equal(r.ok, false);
});

test("two fitting templates (the examples never tell a from b) are a refusal, never a pick", () => {
  const vals = ["Ab 1", "", "x-y", "Q", " z ", "MiXeD_9"];
  const examples = vals.map((v) => ({ args: [v, v], out: `k/${v}-${v}.json` }));
  const fits = templateFits([str("a"), str("b")], examples);
  assert.ok(fits.length >= 2, "a-a, a-b, b-a and b-b all fit");
  const r = deriveProgram({ params: [str("a"), str("b")], ret: "string", examples, budget: 100_000 });
  assert.equal(r.ok, false);
  // one example where a and b differ settles it
  const r2 = deriveProgram({ params: [str("a"), str("b")], ret: "string", examples: [...examples, ...[["p", "Z q"], ["", "7"], ["Hello World", ""]].map(([a, b]) => ({ args: [a!, b!], out: `k/${a}-${b}.json` }))], budget: 100_000 });
  assert.equal(r2.ok && r2.fit.expr, `"k/" + a + "-" + b + ".json"`);
});

test("templateFits: literals are cut from the outputs and checked on every example; unsafe literals are never cut", () => {
  const ex = RICH.map((s) => ({ args: [s], out: `a\\b/${s}/x` }));
  assert.deepEqual(templateFits([str("s")], ex), []);
  const tab = RICH.map((s) => ({ args: [s], out: `a\tb/${s}/x` }));
  assert.deepEqual(templateFits([str("s")], tab), []);
  const ok = RICH.map((s) => ({ args: [s], out: `L-${s}-R` }));
  const fits = templateFits([str("s")], ok);
  assert.equal(fits.length, 1);
  assert.deepEqual(fits[0], { op: "tmpl", parts: [{ op: "lit", v: "L-" }, { op: "param", i: 0 }, { op: "lit", v: "-R" }] });
  assert.equal(templateSize(fits[0] as Extract<DeriveNode, { op: "tmpl" }>), 2);
  // one example that breaks the template: no fit
  assert.deepEqual(templateFits([str("s")], [...ok, { args: ["zz"], out: "L-zz-R!" }]), []);
  // two-part joins stay the binary concat's (no template of fewer than 3 parts without a number)
  assert.deepEqual(templateFits([str("s")], RICH.map((s) => ({ args: [s], out: `P${s}` }))), []);
});

test("template and str: evalProgram, evalJs and the compiled expression agree", () => {
  const node: DeriveNode = { op: "tmpl", parts: [{ op: "str", a: { op: "param", i: 1 } }, { op: "lit", v: "/" }, { op: "param", i: 0 }, { op: "str", a: { op: "param", i: 1 } }] };
  const expr = compileProgram(node, ["s", "n"]);
  assert.equal(expr, `("" + n) + "/" + s + ("" + n)`);
  const fn = new Function("s", "n", `return ${expr};`) as (s: string, n: number) => string;
  for (const s of ["", "a b", "\"q\""]) for (const n of [-12, 0, 5, 1234]) {
    assert.equal(evalProgram(node, [s, n]), `${n}/${s}${n}`);
    assert.equal(evalJs(node, [s, n]), `${n}/${s}${n}`);
    assert.equal(fn(s, n), `${n}/${s}${n}`);
  }
});
