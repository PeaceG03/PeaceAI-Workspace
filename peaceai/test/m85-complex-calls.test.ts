// M85 COMPLEX calls/callbacks (public-complex-calls-v1; stress gaps 6 / tasks C3, L4): the COMPLEX_FUNCTION engine
// with the optional pair calls "module-exported-pure" + callbacks "array-method-arrow" and for / for-of loops. The
// new body is vetted inside the whole target module, so it may call the module's own exported functions (each
// callee's body passing the same vocabulary, depth <= 2, no recursion), and may pass a one-parameter
// expression-bodied arrow to map/filter/some/every/find/findIndex. A task that needs neither is not_needed. Specs
// without the pair are unchanged (#219: module helpers stay uncallable, closures refused). Proposal; Job A only via
// the hash-pinned approved list.
import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { admitRules } from "../lib/approved.ts";
import { blockRefusal, CALLS_TRIGGER, COMPLEX_TRIGGER, loopPolicy, LOOP_TRIGGER, moduleFunctions, NOT_NEEDED, type CallCtx } from "../lib/learned-complex.ts";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { readManifestBytes } from "../lib/manifestparts.ts";
import { CALLS_PHRASING, isCallsSpec, isLoopSpec, phrasingFor, proposalBody } from "../lib/propose.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const SPEC = JSON.parse(read("peaceai/rules/learned/public-complex-calls-v1.json")) as RuleSpec;
const SHA = "b1fb4bdbb338c7d697bec62dfff109bfbf38fd3addb82fb27c1b5c8b41c71e21";
const COMPLEX = JSON.parse(read("peaceai/rules/learned/public-complex-function-v1.json")) as RuleSpec;
const LOOP = JSON.parse(read("peaceai/rules/learned/public-loop-function-v1.json")) as RuleSpec;
const MOD = [
  "export function pad2(n: number): string {",
  "  return String(n).padStart(2, \"0\");",
  "}",
  "export function clean(s: string): string {",
  "  return s.trim().toLowerCase();",
  "}",
  "function hidden(s: string): string {",
  "  return s;",
  "}",
  "let counter = 0;",
  "export function bump(n: number): number {",
  "  counter += n;",
  "  return counter;",
  "}",
  "export async function later(s: string): Promise<string> {",
  "  return s;",
  "}",
  "export function viaClean(s: string): string {",
  "  return clean(s);",
  "}",
  "",
].join("\n");
const files = [{ path: "src/a.ts", content: MOD }];
const run = (sig: string, body: string, checks: string, spec: RuleSpec = SPEC, head = "add complex function") => {
  const w: { reason?: string } = {};
  const e = applyRule(spec, `${head} ${sig} to src/a.ts with body:\n${body}\n${checks}`, files, undefined, undefined, w, () => false);
  return { e, r: w.reason };
};

// ---- wiring ----
test("spec: valid, hash pinned, both keys together, never with Date types; any listed approval pins the exact hash", () => {
  assert.ok(validateSpec(SPEC));
  assert.equal(specHash(SPEC), SHA);
  assert.equal(SPEC.kind, "COMPLEX_FUNCTION");
  assert.equal(SPEC.trigger, CALLS_TRIGGER);
  assert.ok(new RegExp(CALLS_TRIGGER, "i").test("add complex function f(s: string): string to src/a.ts with body:"));
  assert.ok(new RegExp(CALLS_TRIGGER, "i").test("add loop function f(s: string): string to src/a.ts with body:"));
  assert.ok(!new RegExp(CALLS_TRIGGER, "i").test("add date function f(s: string): string to src/a.ts with body:"));
  for (const t of [COMPLEX_TRIGGER, LOOP_TRIGGER]) assert.notEqual(CALLS_TRIGGER, t);
  assert.deepEqual(SPEC.params, { body: "bounded-block", callbacks: "array-method-arrow", calls: "module-exported-pure", grading: "self-fail-before-pass-after-and-stub", loops: ["counted-literal-or-length", "for-of-param"], params: "typed", placement: "end-of-module", returns: "annotated", test: "new-file" });
  const { calls: _c, ...noCalls } = SPEC.params; const { callbacks: _b, ...noCb } = SPEC.params;
  for (const p of [noCalls, noCb, { ...SPEC.params, calls: "any" }, { ...SPEC.params, callbacks: "any-closure" }, { ...SPEC.params, types: "primitive+date" }]) assert.ok(!validateSpec({ ...SPEC, params: p }), JSON.stringify(p));
  assert.ok(!validateSpec({ ...SPEC, minedFrom: "core", id: "core-complex-calls-v1" }));
  for (const s of [COMPLEX, LOOP]) assert.ok(validateSpec(s), s.id);
  const onMain = JSON.parse(read("peaceai/rules/approved.json")) as { rules: { id: string; sha256: string }[] };
  for (const r of onMain.rules.filter((x) => x.id === SPEC.id)) assert.equal(r.sha256, SHA, "a listed entry pins the exact spec hash");
  for (const p of ["peaceai/rules/learned/public-complex-calls-v1.json", "peaceai/rules/proposals/public-complex-calls-v1.json", "peaceai/rules/proposals/m85-complex-calls-evidence.json", "peaceai/test/m85-complex-calls.test.ts", "peaceai/test/fixtures/m85-calls/x.txt", "peaceai/spec/complex-calls-v1.md", "peaceai/lib/learned-complex.ts"]) assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
});

test("Job A: admitted only with the exact hash", () => {
  const list = (sha: string, source = "workspace") => ({ ok: true as const, list: { schema: "peaceai-approved-rules:v1", rules: [{ id: SPEC.id, sha256: sha, source }] } as never });
  assert.equal(admitRules([SPEC], list(SHA))[0]!.decision, "APPROVED");
  assert.equal(admitRules([SPEC], list("0".repeat(64)))[0]!.decision, "HASH_CHANGED");
  assert.equal(admitRules([SPEC], list(SHA, "results"))[0]!.decision, "NOT_APPROVED");
  assert.equal(admitRules([{ ...SPEC, params: { ...SPEC.params, calls: "x" } }], list(SHA))[0]!.decision, "SPEC_INVALID");
});

test("propose: own phrasing and description; not taken for a loop spec", () => {
  assert.ok(isCallsSpec(SPEC) && !isCallsSpec(LOOP) && !isCallsSpec(COMPLEX));
  assert.ok(isLoopSpec(SPEC), "it carries loops too; the calls phrasing wins");
  assert.equal(phrasingFor(SPEC), CALLS_PHRASING);
  const body = proposalBody({ spec: SPEC, sha256: SHA, stats: { shape: "COMPLEX_CALLS" as never, covered: null, hunks: 11, commits: 3, files: 10, examples: [], styles: {} } }, []);
  assert.match(body, /vetted inside the whole target module/);
});

// ---- positives ----
const ok: [string, string, string, string, string?][] = [
  ["helper call in a for-of loop (stress L4)", "padAll(values: readonly number[]): string[]", "const out: string[] = [];\nfor (const v of values) {\nout.push(pad2(v));\n}\nreturn out;", '- padAll([1, 12]) equals ["01", "12"]', "add loop function"],
  ["arrow callback (stress C3)", "splitList(csv: string): string[]", 'if (csv.trim() === "") return [];\nreturn csv.split(",").map((s) => s.trim());', '- splitList("a, b") equals ["a", "b"]'],
  ["helper call inside a callback", "cleanAll(xs: string[]): string[]", "const n = xs.length;\nreturn n === 0 ? [] : xs.map((x) => clean(x));", '- cleanAll([" A "]) equals ["a"]'],
  ["typed callback parameter, filter + some", "longOnes(xs: string[]): boolean", "const ys = xs.filter((x: string) => x.length > 2);\nreturn ys.some((y) => y.startsWith(\"a\"));", '- longOnes(["abc", "b"]) is true'],
  ["template literal with a helper call", "label(h: number, m: number): string", "const hh = pad2(h);\nreturn `${hh}:${pad2(m)}`;", '- label(5, 30) is "05:30"'],
  ["callee calling a callee (depth 2)", "twice(s: string): string", "const a = viaClean(s);\nreturn a + a;", '- twice(" X ") is "xx"'],
];
for (const [name, sig, body, checks, head] of ok) test(`builds: ${name}`, () => {
  const { e, r } = run(sig, body, checks, SPEC, head);
  assert.ok(e, `${name}: ${r}`);
  assert.equal(e!.extra!.length, 1);
  assert.ok(e!.content.startsWith(MOD), "the module is kept byte for byte; the function is appended");
});

// ---- refusals ----
const bad: [string, string, string, string][] = [
  ["neither calls nor callbacks", "f(s: string): string", "const t = s.trim();\nreturn t;", NOT_NEEDED],
  ["non-exported helper", "f(s: string): string", "const t = hidden(s);\nreturn t;", "body_refused"],
  ["impure helper (module state)", "f(n: number): number", "const t = bump(n);\nreturn t;", "body_refused"],
  ["async helper", "f(s: string): string", "const t = later(s);\nreturn s;", "body_refused"],
  ["recursion", "f(n: number): number", "if (n < 1) return 0;\nreturn f(n - 1);", "body_refused"],
  ["arrow outside a callback position", "f(s: string): string", "const g = (x: string) => x;\nreturn g(s);", "body_refused"],
  ["arrow with a block body", "f(xs: string[]): string[]", "const n = xs.length;\nreturn xs.map((x) => { return x; });", "body_refused"],
  ["nested arrow", "f(xs: string[]): boolean", "const n = xs.length;\nreturn xs.some((x) => xs.some((y) => y === x));", "body_refused"],
  ["two-parameter callback", "f(xs: string[]): string[]", "const n = xs.length;\nreturn xs.map((x, i) => x + i);", "body_refused"],
  ["callback on a method outside the list (reduce)", "f(xs: number[]): number", "const n = xs.length;\nreturn xs.reduce((a) => a, 0);", "body_refused"],
  ["optional-call callback", "f(xs: string[]): string[]", "const n = xs.length;\nreturn xs?.map((x) => x);", "body_refused"],
  ["async arrow (named by the loop spec)", "f(xs: string[]): boolean", "const n = xs.length;\nreturn xs.some(async (x) => x === \"a\");", "loop_async"],
  ["callback parameter shadows a parameter", "f(xs: string[]): string[]", "const n = xs.length;\nreturn xs.map((xs) => xs);", "body_refused"],
  ["reserved placeholder name", "f(xs: string[]): string[]", "const __peaceaiCb = xs;\nreturn xs.map((x) => x);", "body_refused"],
  ["while loop (not in this spec)", "f(n: number): number", "let i = 0;\nwhile (i < 3) {\ni += 1;\n}\nreturn pad2(n).length + i;", "loop_while_unsupported"],
];
for (const [name, sig, body, code] of bad) test(`refused (${code}): ${name}`, () => {
  const { e, r } = run(sig, body, sig.includes("xs:") ? '- f(["a"]) is true' : sig.includes("n:") ? "- f(1) is 1" : '- f("a") is "a"');
  assert.equal(e, null, name);
  assert.equal(r, code, name);
});

test("specs without the pair are unchanged: module helpers and arrow callbacks stay refused", () => {
  assert.equal(run("splitList(csv: string): string[]", 'const t = csv.trim();\nreturn t.split(",").map((s) => s.trim());', '- splitList("a,b") equals ["a", "b"]', COMPLEX).e, null);
  assert.equal(run("padAll(values: readonly number[]): string[]", "const out: string[] = [];\nfor (const v of values) {\nout.push(pad2(v));\n}\nreturn out;", '- padAll([1]) equals ["01"]', LOOP, "add loop function").e, null);
});

// ---- mined evidence ----
type Ex = { repo: string; commit: string; path: string; fn: string; line: number; exported: boolean; calls: string[]; callback: boolean; plainRefusal: string; sha256: string; license: string; licenseSha256: string; fileBlob: string; fixture: string };
const EV = JSON.parse(read("peaceai/rules/proposals/m85-complex-calls-evidence.json")) as { bar: number; manifestSha256: string; pins: string; examples: Ex[]; peace: { repo: string; checkedAt: string; fits: number }[] };
const gitBlob = (b: Buffer) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
const TYPES = /^(?:readonly )?(?:string|number|boolean)(?:\[\])?$/;
test("evidence: bar met; every fixture blob-pinned; each function passes the extended vocabulary, uses it, and the plain one refuses it", () => {
  assert.ok(EV.examples.length >= EV.bar && EV.bar >= 10);
  assert.equal(new Set(EV.examples.map((e) => `${e.repo}:${e.path}:${e.fn}`)).size, EV.examples.length);
  const pol = loopPolicy(["for-of-param", "counted-literal-or-length"]);
  for (const e of EV.examples) {
    const b = readFileSync(resolve(root, e.fixture));
    assert.ok(b.length <= 65536, e.fixture);
    assert.equal(gitBlob(b), e.fileBlob, e.fixture);
    assert.equal(createHash("sha256").update(b).digest("hex"), e.sha256);
    assert.ok(e.fixture.endsWith(`${e.repo.replace("/", "__")}-${e.fileBlob.slice(0, 12)}.txt`));
    const sf = ts.createSourceFile(e.path, b.toString("utf8"), ts.ScriptTarget.Latest, true);
    const mod = moduleFunctions(sf);
    const fd = mod.get(e.fn)!;
    assert.ok(fd?.body && fd.type && TYPES.test(fd.type.getText(sf)), e.fn);
    const names = new Set(fd.parameters.map((x) => { assert.ok(ts.isIdentifier(x.name) && x.type && TYPES.test(x.type.getText(sf))); return (x.name as ts.Identifier).text; }));
    const ctx: CallCtx = { module: mod, stack: [], called: new Set(), loops: pol, callbacks: true, usedCallback: { v: false } };
    assert.equal(blockRefusal(fd.body, names, sf, ctx), null, `${e.repo} ${e.fn}`);
    assert.deepEqual([...ctx.called].sort(), e.calls, e.fn);
    assert.equal(ctx.usedCallback!.v, e.callback, e.fn);
    assert.ok(e.calls.length > 0 || e.callback, e.fn);
    const alone = ts.createSourceFile("f.ts", fd.getText(sf), ts.ScriptTarget.Latest, true);
    const afd = alone.statements[0] as ts.FunctionDeclaration;
    assert.equal(blockRefusal(afd.body!, names, alone, { module: moduleFunctions(alone), stack: [], called: new Set(), loops: pol }), e.plainRefusal, e.fn);
    assert.notEqual(e.plainRefusal, null);
  }
});
test("evidence: licenses from the m45 pins by hash only; fixtures dir holds exactly the evidence fixtures", () => {
  const pins = (JSON.parse(read(EV.pins)) as { repos: { name: string; commit: string; spdx: string; licenseSha256: string }[] }).repos;
  for (const e of EV.examples) {
    const pin = pins.find((p) => p.name === e.repo)!;
    assert.ok(pin, e.repo);
    assert.equal(pin.commit, e.commit); assert.equal(pin.licenseSha256, e.licenseSha256); assert.equal(pin.spdx, e.license);
    assert.ok(["MIT", "Apache-2.0", "BSD-3-Clause", "ISC"].includes(e.license));
  }
  const listed = new Set(EV.examples.map((e) => e.fixture.split("/").pop()));
  const have = readdirSync(resolve(root, "peaceai/test/fixtures/m85-calls"));
  for (const f of have) { assert.ok(listed.has(f), f); assert.ok(!/licen[cs]e/i.test(f)); }
  assert.equal(have.length, listed.size);
});
test("evidence: no overlap with the training corpus or the ext-manifest; Peace's public repos checked first and not counted", () => {
  const buf = readManifestBytes(resolve(root, "peaceai/model"), "ext-manifest");
  assert.equal(createHash("sha256").update(buf).digest("hex"), EV.manifestSha256);
  const repos = new Set<string>(); const shas = new Set<string>();
  for (const l of buf.toString("utf8").split("\n")) if (l.trim()) { const r = JSON.parse(l) as { repo?: string; sha256?: string }; if (r.repo) repos.add(r.repo); if (r.sha256) shas.add(r.sha256); }
  for (const r of (JSON.parse(read("peaceai/model/ext-corpus.json")) as { repos: { name: string }[] }).repos) repos.add(r.name);
  for (const e of EV.examples) { assert.ok(!repos.has(e.repo), e.repo); assert.ok(!shas.has(e.sha256), e.path); assert.ok(!e.repo.startsWith("PeaceG03/")); }
  assert.deepEqual(EV.peace.map((p) => p.repo).sort(), ["PeaceG03/PeaceAI-Workspace", "PeaceG03/PeaceSTOCKS"]);
  for (const p of EV.peace) { assert.ok(repos.has(p.repo), `${p.repo} is in the corpus manifest`); assert.match(p.checkedAt, /^[0-9a-f]{40}$/); }
  const rec = JSON.parse(read("peaceai/rules/proposals/public-complex-calls-v1.json")) as { status: string; learned: string; evidence: { examples: number; bar: number; repos: number; qualifies: boolean } };
  assert.match(rec.status, /^proposal-off/);
  assert.equal(rec.learned, "peaceai/rules/learned/public-complex-calls-v1.json");
  assert.equal(rec.evidence.examples, EV.examples.length);
  assert.equal(rec.evidence.repos, new Set(EV.examples.map((e) => e.repo)).size);
  assert.ok(rec.evidence.examples >= rec.evidence.bar && rec.evidence.qualifies);
  assert.deepEqual(SPEC.evidence.repos, [...new Set(EV.examples.map((e) => e.repo))].sort());
  assert.equal(SPEC.evidence.hunks, EV.examples.length);
});
