// Auditor #466 (3rd review): FAIL-CLOSED allowlists in the shared TEST_EXISTING walk (v1-v7).
// - Load time: every top-level statement of every module in the relative import closure must be an allowlisted kind
//   (imports / exports of declarations, function / inert class / type / interface / types-only namespace, an enum with
//   primitive initializers, a variable whose initializer runs no user code, a leading "use strict", the main guard).
//   Any other statement - a block, try, for, if, expression statement, a call of user code - is refused.
// - Module state: a module const the walk reaches must have a stateless initializer (primitives, a regex literal or
//   `new RegExp(lit, lit)` without g / y, data literals, a short list of data statics / methods, a read-only
//   `new Map` / `new Set`); a helper-built RegExp or iterator is state.
// - RegExp: any reference to the RegExp global other than calling it is refused (legacy statics RegExp.$1 /
//   lastMatch / RegExp["$_"]), as is any `.constructor` / `["constructor"]` access (getPrototypeOf / __proto__ /
//   constructor.prototype / "".constructor patches).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyRule, type RuleSpec } from "../lib/learned.ts";
import { existingTargetAnalysisForEvidence, existingTargetRefusal, TEST_TARGET_IMPURE, TEST_TARGET_IO } from "../lib/learned-test-existing.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
type Files = Record<string, string>;
const P = JSON.parse(read("peaceai/test/m97-te7-failclosed.probes.json")) as { cases: Record<string, [Files, string]>; want: Record<string, Record<string, string>>; newlyRefused: string[] };
const VERS = ["v1", "v2", "v3", "v4", "v5", "v6", "v7"] as const;
const optsFor = (v: string, rd: { read: (rel: string) => string | null }): Record<string, unknown> =>
  ({ v1: { load: rd }, v2: { v2: rd }, v3: { v2: rd, dates: true }, v4: { v2: rd, v4: true }, v5: { v2: rd, v5: true }, v6: { v2: rd, v6: true }, v7: { v2: rd, v7: true } } as Record<string, Record<string, unknown>>)[v]!;
const verdicts = (files: Files, fn: string) => {
  const rd = { read: (rel: string) => files[rel] ?? null };
  return Object.fromEntries(VERS.map((v) => [v, existingTargetRefusal("src/a.ts", files["src/a.ts"]!, fn, optsFor(v, rd)) ?? "ok"]));
};
const one = (src: string, fn = "f", sib: Files = {}) => verdicts({ "src/a.ts": src, ...sib }, fn);
const allRefused = (r: Record<string, string>) => VERS.every((v) => r[v] !== "ok");

test("Auditor #466 probes c1-c7 + variants: every verdict per version is pinned; the newly refused ones are refused under v1-v7", () => {
  assert.equal(Object.keys(P.cases).length, 159);
  assert.equal(P.newlyRefused.length, 35);
  for (const [k, [files, fn]] of Object.entries(P.cases)) assert.deepEqual(verdicts(files, fn), P.want[k], k);
  for (const k of P.newlyRefused) assert.ok(allRefused(P.want[k]!), k);
  // Auditor's three blocking items are all in the newly refused set.
  for (const k of ["c4:blkDirect7", "c4:tryDirect7", "c4:forDirect7", "c4:blkHelper7", "c4:blkForEach7", "c4:sibBlkHelper7", "c4:getProtoOfInst", "c4:instProtoAccess", "c4:instConstructor", "c4:strLitCtor", "c6:rxFromFn", "c6:rxFromFnFlag", "c6:iterViaFn", "c7:rxStatic1", "c7:rxLastMatch", "c7:rxStaticEl", "c7:rxStatic7"])
    assert.ok(P.newlyRefused.includes(k) || allRefused(P.want[k]!), k);
  for (const k of Object.keys(P.cases).filter((x) => /^c[4-7]:/.test(x) && !/Ok$/.test(x) && x !== "c5:spreadInto")) assert.ok(allRefused(P.want[k]!), `${k} refused everywhere`);
});

test("controls stay accepted: read-only Map / Set use, regex without g / y, a function-local RegExp, plain data", () => {
  for (const k of ["c1:mapValuesFresh", "c1:weakMapMemo", "c1:literalKeys", "c3:envMapOk", "c3:sharedMapSiblingNoMut", "c5:itemsSliceOk", "c5:spreadInto", "c5:rxPlainOk", "c5:rxNewLitOk", "c5:rxInFnLocalOk"]) assert.equal(P.want[k]!.v7, "ok", k);
  for (const k of ["extra:regexNewNoFlag", "extra:pureStr"]) assert.ok(VERS.every((v) => P.want[k]![v] === "ok"), k);
});

test("load-time allowlist: statement kinds", () => {
  const body = "export function f(s: string): string { return s.trim(); }\n";
  for (const [why, pre] of [
    ["if", 'if (true) { String.prototype.trim = () => "X"; }\n'],
    ["try", "try { (globalThis as any).x = 1; } catch {}\n"],
    ["for", "for (const p of [String.prototype]) (p as any).trim = () => \"X\";\n"],
    ["block", "{ const q = 1; }\n"],
    ["expression call", "function h(): number { return 1; }\nh();\n"],
    ["const = user call", "function h(): number { return 1; }\nexport const READY = h();\n"],
    ["const = clock", "const t = Date.now();\n"],
    ["export default call", "function h(): number { return 1; }\nexport default h();\n"],
    ["label", "x: for (;;) break x;\n"],
  ] as const) assert.ok(allRefused(one(pre + body)), why);
  for (const [why, pre] of [
    ["use strict", '"use strict";\n'],
    ["enum", "export enum E { A = 1, B = \"b\" }\n"],
    ["types", "export type T = string;\nexport interface I { a: number }\ndeclare const X: number;\n"],
    ["data consts", 'const A = [1, 2] as const;\nconst O = Object.freeze({ a: "x" });\nconst S = ["a", "b"].join(",");\nconst R = /a+/i;\n'],
    ["inert class", "export class K { constructor(readonly n: number) {} get m(): number { return this.n; } }\n"],
    ["export default data", 'export default { a: 1 };\n'],
  ] as const) assert.equal(one(pre + body).v2, "ok", why);
});

test("module state: helper-built RegExp / iterator consts are state; a sibling's top-level helper call is refused at load", () => {
  const mk = 'function mk(f: string): RegExp { return new RegExp("a", f); }\nconst RX = mk("g");\nexport function f(s: string): boolean { return RX.test(s); }\n';
  assert.ok(allRefused(one(mk)));
  const it = 'const S = new Set(["a"]);\nfunction mk2(): IterableIterator<string> { return S.values(); }\nconst IT = mk2();\nexport function f(s: string): string { return s + (IT.next().value ?? ""); }\n';
  assert.ok(allRefused(one(it)));
  const sib = { "src/b.ts": 'function install(): void { (String.prototype as any).trim = () => "X"; }\nif (true) install();\nexport const K = "k";\n' };
  assert.ok(allRefused(one('import { K } from "./b";\nexport function f(s: string): string { return s.trim() + K; }\n', "f", sib)));
});

test("RegExp member access and .constructor are refused anywhere the walk goes", () => {
  for (const src of [
    'export function f(s: string): string { /a(b)/.test(s); return RegExp.$1; }\n',
    'export function f(s: string): string { /a/.test(s); return (RegExp as any).lastMatch; }\n',
    'export function f(s: string): string { /a/.test(s); return (RegExp as any)["$_"]; }\n',
    'const R = RegExp;\nexport function f(s: string): string { return (R as any).$1 + s; }\n',
    'export function f(s: string): string { return ("" as any).constructor.prototype.trim.call(s); }\n',
    'export function f(s: string): boolean { return s.constructor === String; }\n',
    'export function f(s: string): boolean { return (s as any)["constructor"] === String; }\n',
  ]) assert.ok(allRefused(one(src)), src);
  assert.equal(one('export function f(s: string): boolean { return new RegExp("a", "i").test(s); }\n').v2, "ok");
});

test("v1 without the tree fails closed on any relative import; Job A and Job B give v1 the tree for the load check", () => {
  assert.equal(existingTargetRefusal("src/a.ts", 'import { K } from "./b";\nexport function f(s: string): string { return s + K; }\n', "f"), TEST_TARGET_IMPURE);
  assert.equal(existingTargetRefusal("src/a.ts", 'import { K } from "pkg";\nexport function f(s: string): string { return s; }\n', "f"), TEST_TARGET_IO);
  const tc = read("peaceai/bin/test-candidates.ts");
  assert.match(tc, /: \{ load: \{ read: \(rel\) => \(scope\.isSource\(rel\) && !scope\.isTest\(rel\) \? regular\(rel\) : null\) \} \}\) !== null\) return ungradable\("not-test-only"\)/);
  const lib = read("peaceai/lib/learned-test-existing.ts");
  assert.match(lib, /v2 \? \{ v2: sib, dates: v3, v4, v5, v6, v7 \} : \{ load: sib \}\);/);
  // The evidence-only analysis is never a gate: only the evidence tests call it.
  assert.ok(!/existingTargetAnalysisForEvidence/.test(tc));
  assert.equal((lib.match(/existingTargetAnalysisForEvidence/g) ?? []).length, 1, "declared once, never called in the library");
});

test("Auditor #466 Job A repros (e2e: a test that passed twice): no candidate under v7, v5 and v1", () => {
  const isTest = (p: string) => /\.test\.ts$/.test(p);
  const go = (id: string, key: string, checks: string) => {
    const spec = JSON.parse(read(`peaceai/rules/learned/${id}.json`)) as RuleSpec;
    const [files] = P.cases[key]!;
    const w: { reason?: string } = {};
    const e = applyRule(spec, `add a characterization test for f in src/a.ts\n${checks}`, Object.entries(files).map(([path, content]) => ({ path, content })), isTest, undefined, w, () => false);
    return { e, r: w.reason };
  };
  for (const [id, key, checks] of [
    ["public-test-case-existing-v7", "c4:blkHelper7", '- f(new Set(["a"])) is "0"\n- f(new Set(["a"])) is "1"'],
    ["public-test-case-existing-v5", "c4:blkDirect1", '- f(" a ") is "0"\n- f(" a ") is "1"'],
    ["public-test-case-existing-v1", "c4:blkDirect1", '- f(" a ") is "0"\n- f(" a ") is "1"'],
  ] as const) {
    const r = go(id, key, checks);
    assert.equal(r.e, null, `${id} ${key}`);
    assert.equal(r.r, TEST_TARGET_IMPURE, `${id} ${key}`);
  }
});

// The pinned public evidence fixtures pin the target module and the siblings the analysis follows, not every module
// in their load closure, so the fail-closed load allowlist refuses some of them (an unpinned relative import or a
// package import is unseen code). The evidence tests replay existingTargetAnalysisForEvidence; the full-engine counts
// are pinned here so any drift is visible. Bar is 10 for every version.
test("full-engine evidence replay counts (reported, not a gate)", () => {
  const V: [string, string, Record<string, unknown> | null, number][] = [
    ["v1", "m80-test-case-existing-evidence.json", null, 7], ["v2", "m85-test-case-existing-v2-evidence.json", {}, 6],
    ["v3", "m88-test-case-existing-v3-evidence.json", { dates: true }, 5], ["v4", "m90-test-case-existing-v4-evidence.json", { v4: true }, 7],
    ["v5", "m91-test-case-existing-v5-evidence.json", { v5: true }, 4], ["v6", "m93-test-case-existing-v6-evidence.json", { v6: true }, 11],
    ["v7", "m97-test-case-existing-v7-evidence.json", { v7: true }, 14],
  ];
  for (const [v, f, o, want] of V) {
    const EV = JSON.parse(read(`peaceai/rules/proposals/${f}`)) as { examples: { module: string; fn: string; fixture: string; siblings?: { path: string; fixture: string }[] }[] };
    let full = 0;
    for (const e of EV.examples) {
      const text = read(e.fixture);
      const sibs = new Map((e.siblings ?? []).map((s) => [s.path, read(s.fixture)]));
      const rd = { read: (rel: string) => sibs.get(rel) ?? null };
      const opts = o ? { v2: rd, ...o } : { load: rd };
      const r = existingTargetRefusal(e.module, text, e.fn, opts);
      if (r === null) full++;
      // Whatever the full engine refuses beyond the analysis is a refusal, never an acceptance.
      if (existingTargetAnalysisForEvidence(e.module, text, e.fn, opts) !== null) assert.notEqual(r, null);
    }
    assert.equal(full, want, `${v} full-engine accepted`);
  }
});
