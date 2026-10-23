// M101: template joins (n-ary string concat found by alignment) and str(number) in the derive DSL.
// Auditor #491 ruling: a DSL form is used only with >= DERIVE_FORM_BAR replaying upstream evidence entries; under the
// bar deriveProgram never builds it (refused, or the older forms only). The inference itself (templateFits with an
// explicit evidence count at the bar) is pinned here: every literal is cut from the outputs and checked by every
// example; two fitting templates are ambiguous; a literal with a backslash or control character is never cut.
// The digits gate (gateProblem): a written number needs 0, a negative, a 1-digit and a 4+-digit example (a falsy-zero
// case, Math.abs, padStart, toLocaleString).
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileProgram, DERIVE_FORM_BAR, deriveProgram, derivedExprProblem, evalProgram, gateProblem, TEMPLATE_FORM_EVIDENCE, templateFits, templateSize, type DeriveNode, type DeriveParam, type DeriveValue } from "../lib/derive.ts";
import { evalJs } from "../lib/derive-practice.ts";

const ON = { tmpl: DERIVE_FORM_BAR, str: DERIVE_FORM_BAR } as const;
const TMPL_ON = TEMPLATE_FORM_EVIDENCE.tmpl >= DERIVE_FORM_BAR;
const STR_ON = TMPL_ON && TEMPLATE_FORM_EVIDENCE.str >= DERIVE_FORM_BAR;
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
    const fits = templateFits(t.params.map(str), examples, ON);
    const nParts = (t.expr.match(/ \+ /g) ?? []).length + 1;
    if (nParts >= 3) {
      // with the forms at the bar, alignment finds exactly the upstream template
      assert.deepEqual(fits.map((f) => compileProgram(f, t.params)), [t.expr]);
      assert.equal(derivedExprProblem(t.expr, t.params), null);
    }
    const r = deriveProgram({ params: t.params.map(str), ret: "string", examples, budget: 100_000 });
    if (r.ok) {
      // whatever is derived is right on the examples' grid and is a template only when the form has its evidence
      if (!TMPL_ON) assert.ok(!JSON.stringify(r.fit.program).includes('"tmpl"'));
      for (const a of rows(t.params.length)) assert.equal(evalProgram(r.fit.program, a), t.f(...(a as string[])));
    }
    if (TMPL_ON) assert.equal(r.ok && r.fit.expr, t.expr);
  });
}

const NUMS = [0, 7, -3, 42, 123, 2026, 99999, -450];
const SEQ: DeriveNode = { op: "tmpl", parts: [{ op: "lit", v: "part-" }, { op: "param", i: 0 }, { op: "lit", v: "/" }, { op: "str", a: { op: "param", i: 1 } }, { op: "lit", v: ".json" }] };
const seqEx = (ns: number[]) => RICH.map((s, i) => ({ args: [s, ns[i % ns.length]!] as DeriveValue[], out: `part-${s}/${ns[i % ns.length]!}.json` }));
const seqIn = (ns: number[]) => ({ params: [str("name"), num("seq")], ret: "string" as const, examples: seqEx(ns), budget: 100_000 });

test("str(number): a number slot compiles as (\"\" + n); the alignment finds it with the forms at the bar", () => {
  assert.equal(compileProgram(SEQ, ["name", "seq"]), `"part-" + name + "/" + ("" + seq) + ".json"`);
  assert.deepEqual(templateFits([str("name"), num("seq")], seqEx(NUMS), ON).map((f) => compileProgram(f, ["name", "seq"])), [`"part-" + name + "/" + ("" + seq) + ".json"`]);
  // a str slot needs its own evidence: with templates on and str under the bar, the number is not written
  assert.deepEqual(templateFits([str("name"), num("seq")], seqEx(NUMS), { tmpl: DERIVE_FORM_BAR, str: DERIVE_FORM_BAR - 1 }), []);
  // under the bar nothing is built
  assert.deepEqual(templateFits([str("name"), num("seq")], seqEx(NUMS), { tmpl: DERIVE_FORM_BAR - 1, str: DERIVE_FORM_BAR }), []);
  assert.deepEqual(templateFits([num("n")], NUMS.map((n) => ({ args: [n], out: String(n) })), ON).map((f) => compileProgram(f, ["n"])), [`("" + n)`]);
  const r = deriveProgram(seqIn(NUMS));
  if (STR_ON) assert.equal(r.ok && r.fit.expr, `"part-" + name + "/" + ("" + seq) + ".json"`);
  else assert.equal(r.ok, false, "under the bar a written number is refused");
});

test("digits gate: a written number needs 0, a negative, a 1-digit and a 4+-digit example; asks at 0 / -7 / 7 / 1234", () => {
  assert.equal(gateProblem(seqIn(NUMS), SEQ, 3), null);
  // only 3-digit numbers: a falsy-zero case, Math.abs, padStart(3) or a grouped text would look the same
  const three = gateProblem(seqIn([100, 123, 250, 999, 404]), SEQ, 3);
  assert.equal(three && `${three.gate}/${three.param}`, "chars/seq");
  assert.deepEqual(three?.at?.map((a) => a[1]), [0, -7, 7, 1234]);
  // no 0 (upstream grid-js/gridjs px: `if (!width) return ""`): asks at 0
  const zero = gateProblem(seqIn([7, -3, 42, 1234]), SEQ, 3);
  assert.deepEqual(zero && [zero.gate, zero.at?.map((a) => a[1])], ["chars", [0]]);
  // no negative (Math.abs would look the same): asks at -7
  const neg = gateProblem(seqIn([0, 7, 42, 1234]), SEQ, 3);
  assert.deepEqual(neg && [neg.gate, neg.at?.map((a) => a[1])], ["chars", [-7]]);
  // 1- to 3-digit numbers: a grouped text (toLocaleString) would look the same: asks at 1234
  const small = gateProblem(seqIn([0, 7, -3, 42, 5, 11, 123, 999]), SEQ, 3);
  assert.equal(small && `${small.gate}/${small.param}`, "chars/seq");
  assert.deepEqual(small?.at?.map((a) => a[1]), [1234]);
  const loc = (n: number) => n.toLocaleString("en-US");
  assert.notEqual(loc(1234), String(1234));
  for (const n of [0, 7, -3, 42, 5, 11, 123, 999]) assert.equal(loc(n), String(n));
});

test("a padded number (padStart, outside the DSL) is never derived", () => {
  const f = (n: number) => `seq-${String(n).padStart(3, "0")}`;
  const r = deriveProgram({ params: [num("n")], ret: "string", examples: NUMS.map((n) => ({ args: [n], out: f(n) })), budget: 100_000 });
  assert.equal(r.ok, false);
});

test("two fitting templates (the examples never tell a from b) are a refusal, never a pick", () => {
  const vals = ["Ab 1", "", "x-y", "Q", " z ", "MiXeD_9"];
  const examples = vals.map((v) => ({ args: [v, v], out: `k/${v}-${v}.json` }));
  const fits = templateFits([str("a"), str("b")], examples, ON);
  assert.ok(fits.length >= 2, "a-a, a-b, b-a and b-b all fit");
  const r = deriveProgram({ params: [str("a"), str("b")], ret: "string", examples, budget: 100_000 });
  assert.equal(r.ok, false);
  // one example where a and b differ settles it
  const r2 = deriveProgram({ params: [str("a"), str("b")], ret: "string", examples: [...examples, ...[["p", "Z q"], ["", "7"], ["Hello World", ""]].map(([a, b]) => ({ args: [a!, b!], out: `k/${a}-${b}.json` }))], budget: 100_000 });
  if (TMPL_ON) assert.equal(r2.ok && r2.fit.expr, `"k/" + a + "-" + b + ".json"`);
  else if (r2.ok) assert.ok(!JSON.stringify(r2.fit.program).includes('"tmpl"'));
});

test("templateFits: literals are cut from the outputs and checked on every example; unsafe literals are never cut", () => {
  const ex = RICH.map((s) => ({ args: [s], out: `a\\b/${s}/x` }));
  assert.deepEqual(templateFits([str("s")], ex, ON), []);
  const tab = RICH.map((s) => ({ args: [s], out: `a\tb/${s}/x` }));
  assert.deepEqual(templateFits([str("s")], tab, ON), []);
  const ok = RICH.map((s) => ({ args: [s], out: `L-${s}-R` }));
  const fits = templateFits([str("s")], ok, ON);
  assert.deepEqual(templateFits([str("s")], ok), TMPL_ON ? fits : [], "the recorded counts gate the default");
  assert.equal(fits.length, 1);
  assert.deepEqual(fits[0], { op: "tmpl", parts: [{ op: "lit", v: "L-" }, { op: "param", i: 0 }, { op: "lit", v: "-R" }] });
  assert.equal(templateSize(fits[0] as Extract<DeriveNode, { op: "tmpl" }>), 2);
  // one example that breaks the template: no fit
  assert.deepEqual(templateFits([str("s")], [...ok, { args: ["zz"], out: "L-zz-R!" }], ON), []);
  // two-part joins stay the binary concat's (no template of fewer than 3 parts without a number)
  assert.deepEqual(templateFits([str("s")], RICH.map((s) => ({ args: [s], out: `P${s}` })), ON), []);
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

test("templateFits: an empty slot text in the pivot is placed once per position, never looped on (miner hang)", () => {
  // every example has a = "": indexOf("", i) clamps i to the length, so the old loop never ended
  const rows = [["", "", ""], ["", "", "abc"], ["", "a", "Hello"], ["", "ab", "x y"], ["", "abc", ""], ["", "abc", "hello world"]];
  const ex = rows.map((a) => ({ args: a, out: `${a[0]}:${a[1]}@${a[2]}` }));
  const t = Date.now();
  const fits = templateFits([str("a"), str("b"), str("c")], ex, ON).map((f) => compileProgram(f, ["a", "b", "c"]));
  assert.ok(Date.now() - t < 5000);
  assert.ok(fits.includes(`a + ":" + b + "@" + c`) && fits.includes(`":" + b + "@" + c`), JSON.stringify(fits));
});
