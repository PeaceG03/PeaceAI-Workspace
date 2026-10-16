import { test } from "node:test";
import assert from "node:assert/strict";
process.env.PEACEAI_COMPLEX_FUNCTION = "true"; // the flag defaults off; the engine tests below run with it on
import { applyComplexRule, COMPLEX_TRIGGER } from "../lib/learned-complex.ts";
const P = { body: "bounded-block", grading: "self-fail-before-pass-after-and-stub", loops: ["for-of-param", "counted-literal-or-length"], params: "typed", placement: "end-of-module", returns: "annotated", test: "new-file" };
const files = [{ path: "src/a.ts", content: "export const x = 1;\n" }];
const t = (body: string) => `add complex function monthsSpan(from: string, to: string): string[] to src/a.ts with body:\n${body}\n- monthsSpan("2026-09", "2026-11") equals ["2026-09", "2026-11"]`;
const ok = `const a = from.slice(0, 7);\nconst b = to.slice(0, 7);\nif (b < a) return [];\nif (a === b) return [a];\nreturn [a, b];`; // loop-free: loops are refused by name (loop_unsupported) until mined loop examples exist
test("builds a bounded multi-statement function", () => {
  const e = applyComplexRule(COMPLEX_TRIGGER, P, t(ok), files);
  assert.ok(e && e.content.includes("export function monthsSpan(from: string, to: string): string[]"));
});
for (const bad of ["while (true) {}\nreturn [];", "for (let i = 0; i < 1e9; i++) {}\nreturn [];", "const out: string[] = [];\nfor (const v of out) { out.push(v); }\nreturn out;", "return globalThis.x;", "const f = () => 1;\nreturn [];", "for (let j = 0; j < 3; j++) { j = 0; }\nreturn [];", "return [];"]) {
  test(`refuses ${JSON.stringify(bad.slice(0, 40))}`, () => assert.equal(applyComplexRule(COMPLEX_TRIGGER, P, t(bad), files), null));
}

import ts from "typescript";
import { blockRefusal, calledFunctions, stubForGrading } from "../lib/learned-complex.ts";
const why = (src: string, fn = "main") => {
  const sf = ts.createSourceFile("m.ts", src, ts.ScriptTarget.Latest, true);
  const f = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === fn)!;
  return blockRefusal(f.body!, new Set(f.parameters.map((p) => p.name.getText(sf))), sf);
};
const H = "export function inc(n: number): number { return n + 1; }\n";
test("option A: calls to vetted exported same-file functions", () => {
  assert.equal(why(H + "export function main(a: number): number {\n  const b = inc(a);\n  return inc(b);\n}\n"), null);
  const sf = ts.createSourceFile("m.ts", H + "export function main(a: number): number {\n  const b = inc(inc(a));\n  return b;\n}\n", ts.ScriptTarget.Latest, true);
  const f = sf.statements[1] as ts.FunctionDeclaration;
  assert.deepEqual(calledFunctions(f.body!, new Set(["a"]), sf), ["inc"]);
});
test("option A refusals: recursion, mutual recursion, depth over 2, non-exported, alias, namespace, method call", () => {
  assert.match(why("export function main(a: number): number {\n  const b = main(a);\n  return b;\n}\n") ?? "", /recursive/);
  assert.match(why("export function f(a: number): number {\n  const x = main(a);\n  return x;\n}\nexport function main(a: number): number {\n  const b = f(a);\n  return b;\n}\n") ?? "", /recursive/);
  assert.match(why("export function g(n: number): number { return n; }\nexport function f(n: number): number {\n  const x = g(n);\n  return x;\n}\nexport function h(n: number): number {\n  const y = f(n);\n  return y;\n}\nexport function main(a: number): number {\n  const b = h(a);\n  return b;\n}\n") ?? "", /depth/);
  assert.match(why("function inc(n: number): number { return n + 1; }\nexport function main(a: number): number {\n  const b = inc(a);\n  return b;\n}\n") ?? "", /not an exported/);
  assert.ok(why(H + "export function main(a: number): number {\n  const g = inc;\n  return g(a);\n}\n"), "alias");
  assert.ok(why('import * as m from "./m";\nexport function main(a: number): number {\n  const b = m.inc(a);\n  return b;\n}\n'), "namespace");
  assert.ok(why("export function main(a: string[]): number {\n  const b = a.map(String);\n  return b.length;\n}\n"), "method call outside vocab");
  assert.match(why("export function bad(n: number): number { while (n) {} return n; }\nexport function main(a: number): number {\n  const b = bad(a);\n  return b;\n}\n") ?? "", /bad:/);
});
test("option A throws: only a one-line `if (COND) throw new Error(\"literal\")`", () => {
  assert.equal(why('export function main(a: number): number {\n  if (a < 0) throw new Error("NEG");\n  return a;\n}\n'), null);
  for (const b of ['throw new Error("X");\n  return a;', 'if (a < 0) throw new Error(String(a));\n  return a;', 'if (a < 0) throw new TypeError("X");\n  return a;', 'if (a < 0) {\n    throw new Error("X");\n  }\n  return a;', 'if (a < 0) throw new Error("X"); else return 1;\n  return a;']) assert.ok(why(`export function main(a: number): number {\n  ${b}\n}\n`), b);
});
test("option A grading: stubs the function and every called helper the candidate added", () => {
  const src = H + "export function main(a: number): number {\n  const b = inc(a);\n  return b;\n}\n";
  const s = stubForGrading(src, "main", ["inc", "main"])!;
  assert.match(s, /function inc\(n: number\): number \{ return 0; \}/);
  assert.match(s, /function main\(a: number\): number \{ return 0; \}/);
  assert.match(stubForGrading(src, "main", ["main"])!, /return n \+ 1/, "pre-existing helper untouched");
});

// ---- M26 refresh: default-off flag, protected-path refusal, mined evidence (METHOD_GUARD #197 sourcing rules) ----
import { createHash as m26Hash } from "node:crypto";
import { readdirSync as m26Dir, readFileSync as m26Read } from "node:fs";
import { resolve as m26Resolve } from "node:path";
import { readManifestBytes as m26Manifest } from "../lib/manifestparts.ts";
import { COMPLEX_FUNCTION_FLAG, complexFunctionEnabled } from "../lib/learned-complex.ts";
import { PROTECTED_SELF as M26_PROTECTED } from "../lib/selfchange.ts";
const m26Root = m26Resolve(import.meta.dirname, "../..");
const ON = { [COMPLEX_FUNCTION_FLAG]: "true" };

test("flag: COMPLEX_FUNCTION is off unless PEACEAI_COMPLEX_FUNCTION is exactly \"true\"", () => {
  assert.equal(complexFunctionEnabled({}), false);
  assert.equal(complexFunctionEnabled({ PEACEAI_COMPLEX_FUNCTION: "1" }), false);
  assert.equal(complexFunctionEnabled({ PEACEAI_COMPLEX_FUNCTION: "TRUE" }), false);
  assert.equal(complexFunctionEnabled(ON), true);
  assert.equal(applyComplexRule(COMPLEX_TRIGGER, P, t(ok), files, undefined, {}), null, "off by default: no edit");
  assert.ok(applyComplexRule(COMPLEX_TRIGGER, P, t(ok), files, undefined, ON), "on: the same task passes");
});

test("refusal: a body outside the grammar is refused even with the flag on", () => {
  assert.equal(applyComplexRule(COMPLEX_TRIGGER, P, t("while (true) {}\nreturn [];"), files, undefined, ON), null);
});

for (const path of ["peaceai/lib/selfchange.ts", "peaceai/lib/learned-complex.ts", "peaceai/rules/x.ts", "peaceai/bin/leak-scan.ts", "peaceai/lib/target.ts"]) {
  test(`protected path refused: ${path}`, () => {
    assert.ok(M26_PROTECTED.some((x) => x.pattern.test(path)));
    const task = t(ok).replace("src/a.ts", path);
    assert.equal(applyComplexRule(COMPLEX_TRIGGER, P, task, [{ path, content: "export const x = 1;\n" }], undefined, ON), null);
  });
}

test("protected set covers the M26 proofs, evidence and fixtures", () => {
  for (const p of ["peaceai/test/m26-complex-function.test.ts", "peaceai/rules/proposals/m26-complex-function-evidence.json", "peaceai/test/fixtures/m26/a.txt"]) assert.ok(M26_PROTECTED.some((x) => x.pattern.test(p)), p);
});

type M26Ex = { repo: string; commit: string; path: string; sha256: string; fn: string; line: number; statements: number; license: string; licenseSha256: string; fixture: string; fileBlob: string };
const m26Ev = JSON.parse(m26Read(m26Resolve(m26Root, "peaceai/rules/proposals/m26-complex-function-evidence.json"), "utf8")) as { bar: number; manifestSha256: string; examples: M26Ex[] };
const m26Pins = JSON.parse(m26Read(m26Resolve(m26Root, "peaceai/rules/proposals/m45-example-repos.json"), "utf8")) as { repos: { name: string; commit: string; licenseSha256: string }[] };
const gitBlob = (b: Buffer) => m26Hash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");

test("evidence: bar is 10 and at least 10 distinct examples from pinned example-only repos (no nuxt/turborepo)", () => {
  assert.equal(m26Ev.bar, 10);
  assert.ok(m26Ev.examples.length >= m26Ev.bar);
  assert.equal(new Set(m26Ev.examples.map((e) => `${e.repo}:${e.path}`)).size, m26Ev.examples.length);
  for (const e of m26Ev.examples) {
    assert.ok(!["nuxt/nuxt", "vercel/turborepo"].includes(e.repo));
    const pin = m26Pins.repos.find((r) => r.name === e.repo);
    assert.ok(pin, `${e.repo} is pinned`);
    assert.equal(e.commit, pin!.commit); assert.equal(e.licenseSha256, pin!.licenseSha256);
  }
});

test("evidence: every fixture is blob-pinned, <= 64 KB, and its function replays through the COMPLEX grammar", () => {
  for (const e of m26Ev.examples) {
    const b = m26Read(m26Resolve(m26Root, e.fixture));
    assert.ok(b.length <= 65536, e.fixture);
    assert.equal(gitBlob(b), e.fileBlob, e.fixture);
    assert.equal(m26Hash("sha256").update(b).digest("hex"), e.sha256);
    assert.ok(e.fixture.endsWith(`${e.repo.replace("/", "__")}-${e.fileBlob.slice(0, 12)}.txt`));
    const sf = ts.createSourceFile("f.ts", b.toString("utf8"), ts.ScriptTarget.Latest, true);
    const fn = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === e.fn);
    assert.ok(fn?.body, `${e.fn} in ${e.fixture}`);
    assert.equal(sf.getLineAndCharacterOfPosition(fn!.getStart(sf)).line + 1, e.line);
    assert.equal(fn!.body!.statements.length, e.statements);
    assert.ok(e.statements >= 2 && e.statements <= 20);
    assert.equal(blockRefusal(fn!.body!, new Set(fn!.parameters.map((p) => p.name.getText(sf))), sf), null, `${e.repo} ${e.fn}`);
  }
});

test("evidence: no LICENSE text committed; fixtures dir holds exactly the evidence fixtures", () => {
  const dir = m26Resolve(m26Root, "peaceai/test/fixtures/m26");
  const listed = new Set(m26Ev.examples.map((e) => e.fixture.split("/").pop()));
  for (const f of m26Dir(dir)) { assert.ok(listed.has(f), f); assert.ok(!/licen[cs]e/i.test(f)); }
});

test("evidence: no overlap with the training corpus or ext-manifest d4399d79", () => {
  const buf = m26Manifest(m26Resolve(m26Root, "peaceai/model"), "ext-manifest");
  assert.equal(m26Hash("sha256").update(buf).digest("hex"), m26Ev.manifestSha256);
  assert.ok(m26Ev.manifestSha256.startsWith("d4399d79"));
  const repos = new Set<string>(); const shas = new Set<string>();
  for (const l of buf.toString("utf8").split("\n")) if (l.trim()) { const r = JSON.parse(l) as { repo?: string; sha256?: string }; if (r.repo) repos.add(r.repo); if (r.sha256) shas.add(r.sha256); }
  const corpus = JSON.parse(m26Read(m26Resolve(m26Root, "peaceai/model/ext-corpus.json"), "utf8")) as { repos: { name: string }[] };
  for (const r of corpus.repos) repos.add(r.name);
  assert.ok(repos.size > 10);
  for (const e of m26Ev.examples) { assert.ok(!repos.has(e.repo), e.repo); assert.ok(!shas.has(e.sha256), e.path); }
});

// ---- Auditor #135: plain paths only; Architect: loops refused by name ----
import { LOOP_UNSUPPORTED, plainPath as complexPlainPath } from "../lib/learned-complex.ts";
for (const path of ["../a.ts", "/tmp/a.ts", "src/../a.ts"]) {
  test(`non-plain target path refused: ${path}`, () => {
    assert.equal(applyComplexRule(COMPLEX_TRIGGER, P, t(ok).replace("src/a.ts", path), [{ path, content: "export const x = 1;\n" }], undefined, ON), null);
  });
  test(`non-plain generated test path refused: ${path}`, () => {
    // the generated test lands next to the target, so its path inherits the non-plain segments
    const task = t(ok).replace("src/a.ts", path);
    const e = applyComplexRule(COMPLEX_TRIGGER, P, task, [{ path, content: "export const x = 1;\n" }], () => false, ON);
    assert.equal(e, null);
    // the same check guards the generated test path: what the test builder would emit next to this target is refused
    assert.equal(complexPlainPath(path.replace(/\.ts$/, ".monthsspan-0000000.test.ts")), false);
    assert.equal(complexPlainPath(path), false);
    const good = applyComplexRule(COMPLEX_TRIGGER, P, t(ok), files, undefined, ON);
    assert.ok(good && good.extra.every((x) => !x.path.startsWith("/") && !x.path.split("/").some((s) => s === "" || s === "." || s === "..")));
  });
}
const loopForms: Record<string, string> = {
  for: "const out: string[] = [];\nfor (let i = 0; i < 3; i++) { out.push(from); }\nreturn out;",
  "for-of": "const out: string[] = [];\nfor (const c of from) { out.push(c); }\nreturn out;",
  "for-in": "const out: string[] = [];\nfor (const k in [from]) { out.push(k); }\nreturn out;",
  while: "const out: string[] = [];\nwhile (out.length < 2) { out.push(to); }\nreturn out;",
  do: "const out: string[] = [];\ndo { out.push(to); } while (out.length < 2);\nreturn out;",
};
for (const [form, body] of Object.entries(loopForms)) {
  test(`loop refused with loop_unsupported: ${form}`, () => {
    const sf = ts.createSourceFile("f.ts", `function f(from: string, to: string): string[] {\n${body}\n}`, ts.ScriptTarget.Latest, true);
    const fn = sf.statements[0] as ts.FunctionDeclaration;
    assert.equal(blockRefusal(fn.body!, new Set(["from", "to"]), sf), LOOP_UNSUPPORTED);
    assert.equal(applyComplexRule(COMPLEX_TRIGGER, { ...P, loops: ["none"] }, t(body), files, undefined, ON), null); // M64: loops run only when the spec lists them (see m64-loop-function.test.ts)
  });
}

// ---- M26 wiring: COMPLEX_FUNCTION in RULE_KINDS, Job A applyRule and nlparse; approval only with the exact hash ----
import { applyRule as m26ApplyRule, RULE_KINDS as M26_KINDS, specHash as m26SpecHash, validateSpec as m26Validate, type RuleSpec as M26Spec } from "../lib/learned.ts";
const COMPLEX_SPEC = JSON.parse(m26Read(m26Resolve(m26Root, "peaceai/rules/learned/public-complex-function-v1.json"), "utf8")) as M26Spec;
const COMPLEX_SHA = "e0ff5c68586d04d5366d204e2cd7956236891b4d7ad3dc2dbb69888859bcc7d3";

test("wiring: learned spec valid, hash pinned, kind wired, nlparse knows the trigger; approval only with the exact hash", () => {
  assert.ok(M26_KINDS.includes("COMPLEX_FUNCTION" as never));
  assert.ok(m26Validate(COMPLEX_SPEC));
  assert.equal(m26SpecHash(COMPLEX_SPEC), COMPLEX_SHA);
  assert.deepEqual((COMPLEX_SPEC.params as { loops: string[] }).loops, ["none"]);
  assert.equal(COMPLEX_SPEC.trigger, COMPLEX_TRIGGER);
  assert.ok(m26Read(m26Resolve(m26Root, "peaceai/lib/nlparse.ts"), "utf8").includes("COMPLEX_TRIGGER"));
  const list = JSON.parse(m26Read(m26Resolve(m26Root, "peaceai/rules/approved.json"), "utf8")) as { rules: { id: string; sha256: string }[] };
  for (const r of list.rules.filter((x) => x.id === "public-complex-function-v1")) assert.equal(r.sha256, COMPLEX_SHA, "approved only with its exact hash");
  const rec = JSON.parse(m26Read(m26Resolve(m26Root, "peaceai/rules/proposals/public-complex-function-v1.json"), "utf8")) as { status: string; learned: string; evidence: { examples: number; bar: number } };
  assert.match(rec.status, /^proposal-off/);
  assert.equal(rec.evidence.examples, m26Ev.examples.length);
  assert.ok(rec.evidence.examples >= rec.evidence.bar);
  assert.ok(!validFor({ ...COMPLEX_SPEC, params: { ...COMPLEX_SPEC.params, loops: [] } }), "empty loops list refused");
  assert.ok(!validFor({ ...COMPLEX_SPEC, minedFrom: "core" }), "public-mined only");
});
const validFor = (s: unknown) => m26Validate(s);

test("Job A (applyRule, no flag needed once admitted): builds; refuses loops, non-plain and protected paths by name", () => {
  const why = (objective: string, fs = files) => { const w: { reason?: string } = {}; const e = m26ApplyRule(COMPLEX_SPEC, objective, fs, undefined, undefined, w, () => false); return { e, r: w.reason }; };
  const env = process.env.PEACEAI_COMPLEX_FUNCTION; delete process.env.PEACEAI_COMPLEX_FUNCTION;
  try {
    assert.ok(why(t(ok)).e, "builds without the dev flag");
    for (const body of Object.values(loopForms)) assert.equal(why(t(body)).r, LOOP_UNSUPPORTED);
    for (const p of ["../a.ts", "/tmp/a.ts", "src/../a.ts"]) assert.equal(why(t(ok).replace("src/a.ts", p), [{ path: p, content: "export const x = 1;\n" }]).r, "path_not_plain");
    assert.equal(why(t(ok).replace("src/a.ts", "peaceai/lib/target.ts"), [{ path: "peaceai/lib/target.ts", content: "export const x = 1;\n" }]).r, "protected_path");
    assert.equal(why("add complex function nope").r, "task_unparsed");
  } finally { if (env !== undefined) process.env.PEACEAI_COMPLEX_FUNCTION = env; }
});

test("learned spec, proposal record and the all-kinds new-test-path proofs are protected", () => {
  for (const p of ["peaceai/rules/learned/public-complex-function-v1.json", "peaceai/rules/proposals/public-complex-function-v1.json", "peaceai/test/m26-new-test-path.test.ts"]) assert.ok(M26_PROTECTED.some((x) => x.pattern.test(p)), p);
});
