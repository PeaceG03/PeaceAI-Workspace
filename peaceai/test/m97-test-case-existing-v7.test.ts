// M97 TEST_EXISTING v7 target (public-test-case-existing-v7): characterization tests for existing exported functions
// with the global Map / ReadonlyMap / Set / ReadonlySet in the signature (string / number keys only; checks pass and
// expect `new Map([..])` / `new Set([..])` literals), or a `void` return (checks: `throws CODE` or `is undefined`, at
// least one `throws`). v1-v6 targets stay with v1-v6 (not_needed). A target only v7 accepts gets the v7 hardening: no
// write through a fresh copy, no escaping module container, and the v6 closure lessons (load-time reach, non-.ts
// imports, require / dynamic import, import-back) plus no global or prototype patch in the relative import closure.
// Job B re-checks under v7 and re-checks the graded test source (voidTestProblem, mapSetTestProblem).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { admitRules } from "../lib/approved.ts";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { stubAll } from "../lib/learned-function.ts";
import { isMapSetLiteral, MAX_COLLECTION_ENTRIES } from "../lib/learned-test.ts";
import { existingTargetAnalysisForEvidence, existingTargetRefusal, mapSetTestProblem, TEST_CHECK_REFUSED, TEST_EXISTING_TRIGGER, TEST_EXISTING_VOCAB, TEST_TARGET_IMPURE, TEST_TARGET_IO, TEST_TARGET_SIGNATURE, V7_COLLECTIONS, voidTarget, voidTestProblem } from "../lib/learned-test-existing.ts";
import { readManifestBytes } from "../lib/manifestparts.ts";
import { phrasingFor } from "../lib/propose.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";
import ts from "typescript";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const SPEC = JSON.parse(read("peaceai/rules/learned/public-test-case-existing-v7.json")) as RuleSpec;
const V1 = JSON.parse(read("peaceai/rules/learned/public-test-case-existing-v1.json")) as RuleSpec;
const V6 = JSON.parse(read("peaceai/rules/learned/public-test-case-existing-v6.json")) as RuleSpec;
const SHA = "719f792af9fd16a0cea96218ddac9c43727e5c0c4a64e485e9dd07e5d2b66410";

const A = [
  "export function index(m: ReadonlyMap<string, string>, ids: readonly string[]): Map<string, string> { const s = new Set(ids); return new Map([...m.entries()].filter(([id]) => s.has(id)).map(([id, v]) => [v, id])); }",
  "export function tally(xs: readonly string[]): Map<string, number> { const m = new Map<string, number>(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return m; }",
  "export function sorted(s: ReadonlySet<number>): number[] { return [...s].sort((a, b) => a - b); }",
  "export function pages(m: ReadonlyMap<string, ReadonlySet<number>>): number { let n = 0; for (const v of m.values()) n += v.size; return n; }",
  "export function sizeOr(m: Map<string, number> = new Map()): number { return m.size; }",
  "export interface Ref { symbol: string; pages: ReadonlySet<number> }",
  "export function withPage(refs: readonly Ref[], p: number): Ref[] { return refs.filter((r) => r.pages.has(p)); }",
  "export function requireCode(code: string): void { if (!/^[A-Z]{2,8}$/.test(code)) throw new Error(\"BAD_CODE\"); }",
  "export function plain(x: number): number { return x + 1; }",
  "export function codeOf(error: unknown): string { return error instanceof Error ? error.message : \"UNKNOWN\"; }",
  // negatives
  "export function objKey(m: Map<{ id: string }, number>): number { return m.size; }",
  "export function fnKey(m: Map<() => void, number>): number { return m.size; }",
  "export function arrKey(m: Map<string[], number>): number { return m.size; }",
  "export function setOfObjects(s: Set<{ a: number }>): number { return s.size; }",
  "export function weak(m: WeakMap<object, number>): number { return 1; }",
  "export function anyMap(m: Map<string, any>): number { return m.size; }",
  "export function writesParam(m: Map<string, number>): number { m.set(\"x\", 1); return m.size; }",
  "export function clearsParam(s: Set<number>): number { s.clear(); return 0; }",
  "export function deepThroughCopy(m: ReadonlyMap<string, { n: number }>): number { const c = [...m.values()]; c[0]!.n = 1; return c.length; }",
  "export function pushThroughCopy(m: ReadonlyMap<string, number[]>): number { const c = [...m.values()]; c[0]!.push(1); return c.length; }",
  "export function pushThroughMapCopy(m: ReadonlyMap<string, number[]>): number { const c = new Map(m); c.get(\"a\")!.push(1); return c.size; }",
  "export function elemClear(m: Map<string, number>): number { m[\"clear\"](); return 0; }",
  "export function aliasSet(m: Map<string, number>): number { const f = m.set; f.call(m, \"x\", 1); return m.size; }",
  "export function destructAdd(s: Set<number>): number { const { add } = s; add.call(s, 1); return s.size; }",
  "export function dynamicKeyCall(m: Map<string, number>, k: \"clear\" | \"keys\"): number { m[k](); return m.size; }",
  "export function viaSetProtoApply(s: Set<number>): number { Set.prototype.add.apply(s, [1]); return s.size; }",
  "export function viaMapProto(m: ReadonlyMap<string, number>): number { Map.prototype.clear.call(m); return 0; }",
  "export function retMapNever(x: string): Map<string, never> { return new Map(); }",
  "let STATE: string[] = [];",
  "export function recordsState(x: string): void { STATE.push(x); }",
  "export function writesEnvVoid(k: string): void { process.env[k] = \"1\"; }",
  "export function assertsStr(x: string | number): asserts x is string { if (typeof x !== \"string\") throw new Error(\"NOT_STRING\"); }",
  "export function never_(x: string): never { throw new Error(x); }",
  "export function voidReadsClock(x: number): void { if (x > Date.now()) throw new Error(\"FUTURE\"); }",
  "",
].join("\n");
const FILES = [{ path: "src/a.ts", content: A }];
const rd = { read: (rel: string) => FILES.find((f) => f.path === rel)?.content ?? null };
const v6 = { v2: rd, v6: true };
const v7 = { v2: rd, v7: true };
const isTest = (p: string) => /\.test\.ts$/.test(p);
const run = (fn: string, checks: string, spec: RuleSpec = SPEC, files = FILES) => {
  const w: { reason?: string } = {};
  const e = applyRule(spec, `add a characterization test for ${fn} in src/a.ts\n${checks}`, files, isTest, undefined, w, () => false);
  return { e: e as { path: string; content: string } | null, r: w.reason };
};
const filesOf = (o: Record<string, string>) => Object.entries(o).map(([path, content]) => ({ path, content }));
const refusal = (files: { path: string; content: string }[], fn: string, opts: Record<string, unknown> = {}) =>
  existingTargetRefusal("src/a.ts", files.find((f) => f.path === "src/a.ts")!.content, fn, { v2: { read: (rel: string) => files.find((f) => f.path === rel)?.content ?? null }, v7: true, repo: files, ...opts });

test("spec: valid, hash pinned, v6 params except the target, the v1 trigger; any listed approval pins the exact hash", () => {
  assert.ok(validateSpec(SPEC));
  assert.equal(specHash(SPEC), SHA);
  assert.equal(SPEC.trigger, TEST_EXISTING_TRIGGER);
  assert.deepEqual(SPEC.params, { ...V1.params, target: "exported-pure-function-v7" });
  assert.deepEqual(V6.params, { ...V1.params, target: "exported-pure-function-v6" }, "v6 is unchanged");
  assert.equal(specHash(V6), "256f7b3260433df204c8498773e40c7e0986192c096940dcd44787dc19b0c195", "the v6 hash is unchanged");
  assert.deepEqual([...TEST_EXISTING_VOCAB.target], ["exported-pure-function", "exported-pure-function-v2", "exported-pure-function-v3", "exported-pure-function-v4", "exported-pure-function-v5", "exported-pure-function-v6", "exported-pure-function-v7"]);
  assert.ok(!validateSpec({ ...SPEC, params: { ...SPEC.params, target: "exported-pure-function-v8" } }));
  // Lesson (M85/M87/M88/M90/M91/M93): never assert the rule is absent from approved.json; any listed entry must pin this exact hash.
  const onMain = JSON.parse(read("peaceai/rules/approved.json")) as { rules: { id: string; sha256: string }[] };
  for (const r of onMain.rules.filter((x) => x.id === SPEC.id)) assert.equal(r.sha256, SHA, "a listed entry pins the exact spec hash");
  assert.match(phrasingFor(SPEC), /characteri[sz]ation/);
  for (const p of ["peaceai/rules/learned/public-test-case-existing-v7.json", "peaceai/rules/proposals/public-test-case-existing-v7.json", "peaceai/rules/proposals/m97-test-case-existing-v7-evidence.json", "peaceai/test/m97-test-case-existing-v7.test.ts", "peaceai/test/fixtures/m97-te7/x.txt", "peaceai/spec/test-case-existing-v7.md", "peaceai/lib/learned-test-existing.ts", "peaceai/lib/learned-test.ts", "peaceai/bin/test-candidates.ts"]) assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
  const list = (sha: string) => ({ ok: true as const, list: { schema: "peaceai-approved-rules:v1", rules: [{ id: SPEC.id, sha256: sha, source: "workspace" }] } as never });
  assert.equal(admitRules([SPEC], list(SHA))[0]!.decision, "APPROVED");
  assert.equal(admitRules([SPEC], list("0".repeat(64)))[0]!.decision, "HASH_CHANGED");
});

test("target: Map / Set signatures and void returns pass under v7 only; v1-v6 still refuse them; v7 keeps every v6 target", () => {
  for (const fn of ["index", "tally", "sorted", "pages", "sizeOr", "withPage", "requireCode"]) {
    assert.equal(existingTargetRefusal("src/a.ts", A, fn, v7), null, `v7 ${fn}`);
    assert.equal(existingTargetRefusal("src/a.ts", A, fn, v6), TEST_TARGET_SIGNATURE, `v6 ${fn}`);
    assert.notEqual(existingTargetRefusal("src/a.ts", A, fn, { v2: rd, v5: true }), null, `v5 ${fn}`);
    assert.notEqual(existingTargetRefusal("src/a.ts", A, fn, { v2: rd }), null, `v2 ${fn}`);
    assert.notEqual(existingTargetRefusal("src/a.ts", A, fn), null, `v1 ${fn}`);
  }
  for (const fn of ["plain", "codeOf"]) assert.equal(existingTargetRefusal("src/a.ts", A, fn, v7), null, `v7 keeps ${fn}`);
  assert.deepEqual([...V7_COLLECTIONS].sort(), ["Map", "ReadonlyMap", "ReadonlySet", "Set"]);
  assert.ok(voidTarget(A, "requireCode") && !voidTarget(A, "plain") && !voidTarget(A, "assertsStr"));
});

test("target negatives under v7: object / function / array keys, Set of objects, WeakMap, any, never; param writes; writes through copies; prototype patches; void with module state, env or clock", () => {
  const want: Record<string, string> = {
    objKey: TEST_TARGET_SIGNATURE, fnKey: TEST_TARGET_SIGNATURE, arrKey: TEST_TARGET_SIGNATURE, setOfObjects: TEST_TARGET_SIGNATURE, weak: TEST_TARGET_SIGNATURE, anyMap: TEST_TARGET_SIGNATURE, retMapNever: TEST_TARGET_SIGNATURE,
    writesParam: TEST_TARGET_IMPURE, clearsParam: TEST_TARGET_IMPURE, deepThroughCopy: TEST_TARGET_IMPURE, pushThroughCopy: TEST_TARGET_IMPURE, pushThroughMapCopy: TEST_TARGET_IMPURE,
    viaMapProto: TEST_TARGET_IMPURE, elemClear: TEST_TARGET_IMPURE, aliasSet: TEST_TARGET_IMPURE, destructAdd: TEST_TARGET_IMPURE, dynamicKeyCall: TEST_TARGET_IMPURE, viaSetProtoApply: TEST_TARGET_IMPURE,
    recordsState: TEST_TARGET_IMPURE, writesEnvVoid: TEST_TARGET_IO, assertsStr: TEST_TARGET_SIGNATURE, never_: TEST_TARGET_SIGNATURE, voidReadsClock: "test_target_date_local",
  };
  for (const [fn, r] of Object.entries(want)) assert.equal(existingTargetRefusal("src/a.ts", A, fn, v7), r, fn);
  // A prototype patch anywhere in the module (here inside the target itself) refuses every v7 target of the module.
  for (const [fn, body] of [["patchesProto", "Map.prototype.get = () => 1;"], ["definesProto", 'Object.defineProperty(Set.prototype, "has", { value: () => true });']] as const) {
    const mod = `export function ${fn}(m: ReadonlyMap<string, number>): number { ${body} return m.size; }\nexport function other(s: ReadonlySet<number>): number { return s.size; }\n`;
    assert.equal(existingTargetRefusal("src/b.ts", mod, fn, { v2: { read: () => null }, v7: true }), TEST_TARGET_IMPURE, fn);
    assert.equal(existingTargetRefusal("src/b.ts", mod, "other", { v2: { read: () => null }, v7: true }), TEST_TARGET_IMPURE, `${fn}: other`);
  }
  // A module-local or imported Map / Set is not the global one.
  const shadowed = 'import { Map } from "immutable";\nexport function f(m: Map<string, number>): number { return m.size; }\n';
  assert.equal(existingTargetRefusal("src/b.ts", shadowed, "f", { v2: { read: () => null }, v7: true }), TEST_TARGET_SIGNATURE);
  const localSet = "type Set<T> = { items: T[] };\nexport function f(s: Set<number>): number { return s.items.length; }\n";
  assert.equal(existingTargetRefusal("src/b.ts", localSet, "f", { v2: { read: () => null }, v7: true }), TEST_TARGET_SIGNATURE);
  // The v7 copy rule applies to targets only v7 accepts: v1-v6 targets keep their analysis (and their accept sets).
  const v4Copy = "export function bump(xs: readonly { n: number }[]): number { const c = xs.slice(); c[0]!.n = 2; return c.length; }\n";
  const r4 = existingTargetRefusal("src/b.ts", v4Copy, "bump", { v2: { read: () => null }, v4: true });
  assert.equal(existingTargetRefusal("src/b.ts", v4Copy, "bump", { v2: { read: () => null }, v7: true }), r4, "v7 answers a v6-accepted or v6-refused-by-body target exactly as v6");
});

// Map / Set specific attacks on module state and the import closure (v7 hardening). Each was accepted by the v7
// widening alone (signature + purity walk) before the hardening.
const HARD: Record<string, { fn: string; want: string; files: Record<string, string> }> = {
  memoCache: { fn: "look", want: TEST_TARGET_IMPURE, files: { "src/a.ts": "const CACHE = new Map<string, number>();\nexport function look(keys: ReadonlySet<string>): number { let n = 0; for (const k of keys) { if (!CACHE.has(k)) CACHE.set(k, k.length); n += CACHE.get(k)!; } return n; }\n" } },
  aliasWriter: { fn: "look", want: TEST_TARGET_IMPURE, files: { "src/a.ts": "const CACHE = new Map<string, number>([[\"a\", 1]]);\nfunction warm(): void { const c = CACHE; c.set(\"b\", 2); }\nexport function look(keys: ReadonlySet<string>): number { let n = 0; for (const k of keys) n += CACHE.get(k) ?? 0; return n; }\nexport function boot(): void { warm(); }\n" } },
  returnsShared: { fn: "table", want: TEST_TARGET_IMPURE, files: { "src/a.ts": "const TABLE = new Map<string, number>([[\"a\", 1]]);\nexport function table(k: string): ReadonlyMap<string, number> { return k ? TABLE : new Map(); }\n" } },
  passesShared: { fn: "look", want: TEST_TARGET_IMPURE, files: { "src/a.ts": "const SEEN = new Set<string>();\nfunction note(s: Set<string>): void { s.add(\"x\"); }\nexport function look(keys: ReadonlySet<string>): number { return [...keys].filter((k) => SEEN.has(k)).length; }\nexport function mark(): void { note(SEEN); }\n" } },
  exportsShared: { fn: "look", want: TEST_TARGET_IMPURE, files: { "src/a.ts": "const SEEN = new Set<string>([\"a\"]);\nexport { SEEN };\nexport function look(keys: ReadonlySet<string>): number { return [...keys].filter((k) => SEEN.has(k)).length; }\n" } },
  patchInSideEffectImport: { fn: "pages", want: TEST_TARGET_IMPURE, files: { "src/a.ts": 'import "./polyfill";\nexport function pages(m: ReadonlyMap<string, ReadonlySet<number>>): number { let n = 0; for (const v of m.values()) n += v.size; return n; }\n', "src/polyfill.ts": "Set.prototype.has = function () { return true; };\nexport {};\n" } },
  patchInUnreachedFn: { fn: "pages", want: TEST_TARGET_IMPURE, files: { "src/a.ts": 'import { k } from "./b";\nexport function pages(m: ReadonlyMap<string, ReadonlySet<number>>): number { return m.size + k; }\n', "src/b.ts": "export const k = 1;\nexport function later(): void { Object.setPrototypeOf(Map.prototype, null); }\n" } },
  globalThisMap: { fn: "pages", want: TEST_TARGET_IMPURE, files: { "src/a.ts": 'import "./g";\nexport function pages(m: ReadonlyMap<string, number>): number { return m.size; }\n', "src/g.ts": "(globalThis as { Map: unknown }).Map = class {};\nexport {};\n" } },
  importBack: { fn: "pages", want: TEST_TARGET_IMPURE, files: { "src/a.ts": 'import { k } from "./b";\nexport function pages(m: ReadonlyMap<string, number>): number { return m.size + k; }\n', "src/b.ts": 'import { pages } from "./a";\nexport const k = 1;\nexport function again(): number { return pages(new Map()); }\n' } },
  mjsSideEffect: { fn: "pages", want: TEST_TARGET_IO, files: { "src/a.ts": 'import "./c.mjs";\nexport function pages(m: ReadonlyMap<string, number>): number { return m.size; }\n', "src/c.mjs": "Map.prototype.get = () => 1;\n" } },
  jsNoTs: { fn: "pages", want: TEST_TARGET_IO, files: { "src/a.ts": 'import "./c.js";\nexport function pages(m: ReadonlyMap<string, number>): number { return m.size; }\n', "src/c.js": "Map.prototype.get = () => 1;\n" } },
  requireAtLoad: { fn: "pages", want: TEST_TARGET_IO, files: { "src/a.ts": 'import { k } from "./b";\nexport function pages(m: ReadonlyMap<string, number>): number { return m.size + k; }\n', "src/b.ts": 'declare const require: (s: string) => unknown;\nexport const k = 1;\nexport const LATE = require("./c.cjs");\n' } },
  // Auditor #466 (3rd review): the load-time call of a user function is refused first by the fail-closed load allowlist.
  dynamicImportAtLoad: { fn: "pages", want: TEST_TARGET_IMPURE, files: { "src/a.ts": 'import { k } from "./b";\nexport function pages(m: ReadonlyMap<string, number>): number { return m.size + k; }\n', "src/b.ts": 'function boot(): unknown { return import("./c"); }\nexport const k = 1;\nexport const READY = boot();\n', "src/c.ts": "export const z = 1;\n" } },
  // Auditor #466 (3rd review): the load-time call of a user function is refused first by the fail-closed load allowlist.
  dynamicImportViaImportedFn: { fn: "pages", want: TEST_TARGET_IMPURE, files: { "src/a.ts": 'import { k } from "./b";\nexport function pages(m: ReadonlyMap<string, number>): number { return m.size + k; }\n', "src/b.ts": 'import { loader } from "./c";\nexport const k = 1;\nexport const READY = loader();\n', "src/c.ts": 'export function loader(): unknown { return import("./d"); }\n', "src/d.ts": "export const z = 1;\n" } },
  importEquals: { fn: "pages", want: TEST_TARGET_IO, files: { "src/a.ts": 'import { k } from "./b";\nexport function pages(m: ReadonlyMap<string, number>): number { return m.size + k; }\n', "src/b.ts": 'import fs = require("fs");\nexport const k = 1;\nexport function f(): unknown { return fs; }\n' } },
  fakeMainGuard: { fn: "pages", want: TEST_TARGET_IO, files: { "src/a.ts": 'function here(): string { return import.meta.url; }\nif (import.meta.url === here()) { void import("./cli"); }\nexport function pages(m: ReadonlyMap<string, number>): number { return m.size; }\n', "src/cli.ts": "export const z = 1;\n" } },
  orMainGuard: { fn: "pages", want: TEST_TARGET_IO, files: { "src/a.ts": 'import { pathToFileURL } from "node:url";\nif (process.argv[1] || import.meta.url === pathToFileURL(process.argv[1]!).href) { void import("./cli"); }\nexport function pages(m: ReadonlyMap<string, number>): number { return m.size; }\n', "src/cli.ts": "export const z = 1;\n" } },
};
const SOFT: Record<string, { fn: string; files: Record<string, string> }> = {
  readOnlyTable: { fn: "look", files: { "src/a.ts": "const TABLE = new Map<string, number>([[\"a\", 1], [\"b\", 2]]);\nexport function look(keys: ReadonlySet<string>): number { let n = 0; for (const k of keys) n += TABLE.get(k) ?? 0; return n + TABLE.size + [...TABLE].length; }\n" } },
  copyThenWriteCopy: { fn: "merged", files: { "src/a.ts": "export function merged(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): Map<string, number> { const c = new Map(a); for (const [k, v] of b) c.set(k, (c.get(k) ?? 0) + v); return c; }\n" } },
  dynamicImportUnreached: { fn: "pages", files: { "src/a.ts": 'import { k } from "./b";\nexport function pages(m: ReadonlyMap<string, number>): number { return m.size + k; }\n', "src/b.ts": 'export const k = 1;\nexport async function later(): Promise<unknown> { return import("./c"); }\n', "src/c.ts": "export const z = 1;\n" } },
  realMainGuard: { fn: "pages", files: { "src/a.ts": 'import { pathToFileURL } from "node:url";\nexport function pages(m: ReadonlyMap<string, number>): number { return m.size; }\nasync function main(): Promise<number> { await import("./cli"); process.exitCode = 0; return 0; }\nif (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { void main(); }\n', "src/cli.ts": "export const z = 1;\n" } },
  jsSpecifierToTs: { fn: "pages", files: { "src/a.ts": 'import { k } from "./b.js";\nexport function pages(m: ReadonlyMap<string, number>): number { return m.size + k; }\n', "src/b.ts": "export const k = 1;\n" } },
  classMethodImport: { fn: "pages", files: { "src/a.ts": 'import { k } from "./b";\nexport function pages(m: ReadonlyMap<string, number>): number { return m.size + k; }\n', "src/b.ts": 'export const k = 1;\nexport class Store { async open(): Promise<unknown> { return import("./c"); } }\n', "src/c.ts": "export const z = 1;\n" } },
};
test("v7 hardening: shared module containers, global / prototype patches anywhere in the closure, import-back, non-.ts imports and load-time loads are refused; read-only use and unreached code are kept", () => {
  for (const [k, c] of Object.entries(HARD)) {
    const files = filesOf(c.files);
    assert.equal(refusal(files, c.fn), c.want, `re-check ${k}`);
    const ck = c.fn === "look" ? '- look(new Set(["a"])) is 1' : c.fn === "table" ? '- table("a") is new Map([["a", 1]])' : "- pages(new Map()) is 0";
    const r = run(c.fn, ck, SPEC, files);
    assert.equal(r.e, null, `Job A ${k}`);
    assert.equal(r.r, c.want, `Job A reason ${k}`);
  }
  for (const [k, c] of Object.entries(SOFT)) assert.equal(refusal(filesOf(c.files), c.fn), null, `kept ${k}`);
});

test("Job A: Map / Set literals in checks and expected values; one candidate; v6 refuses the target by name", () => {
  const i = run("index", '- index(new Map([["s1", "AAA"], ["s2", "BBB"]]), ["s1"]) is new Map([["AAA", "s1"]])\n- index(new Map(), []) is new Map()');
  assert.ok(i.e, i.r);
  assert.match(i.e!.content, /^import \{ index \} from "\.\/a";$/m);
  assert.match(i.e!.content, /assert\.deepEqual\(index\(new Map\(\[\["s1", "AAA"\], \["s2", "BBB"\]\]\), \["s1"\]\), new Map\(\[\["AAA", "s1"\]\]\)\);/);
  assert.ok(run("tally", '- tally(["a", "b", "a"]) is new Map([["a", 2], ["b", 1]])').e);
  assert.ok(run("sorted", "- sorted(new Set([3, 1, 2])) is [1, 2, 3]").e);
  assert.ok(run("pages", '- pages(new Map([["a", new Set([1, 2])], ["b", new Set([3])]])) is 3').e);
  assert.ok(run("withPage", '- withPage([{ symbol: "A", pages: new Set([1]) }, { symbol: "B", pages: new Set([2]) }], 2) is [{ symbol: "B", pages: new Set([2]) }]').e);
  assert.equal(run("plain", "- plain(1) is 2").r, "not_needed", "a v1 target");
  assert.equal(run("codeOf", '- codeOf("x") is "UNKNOWN"').r, "not_needed", "a v6 target");
  assert.equal(run("index", '- index(new Map([["a", "b"]]), ["a"]) is new Map([["b", "a"]])', V6).r, TEST_TARGET_SIGNATURE, "v6 refuses v7 targets by name");
  // The `is new Map(..)` line is read by the shared check grammar, but only the v7 args mode renders it.
  assert.equal(run("codeOf", '- codeOf("x") is new Map()', V6).r, "test_refused");
});

test("Job A negatives: non-literal, object / function / array keys, repeated keys, spread, holes, type arguments, WeakMap, Set of objects, too many entries or too deep", () => {
  const bad = [
    '- index(new Map([[{ id: "x" }, "A"]]), []) is new Map()',
    '- index(new Map([[() => 1, "A"]]) as never, []) is new Map()',
    '- index(new Map([[["k"], "A"]]) as never, []) is new Map()',
    '- index(new Map([["a", "A"], ["a", "B"]]), ["a"]) is new Map([["A", "a"]])',
    '- index(new Map([...[["a", "A"]]]), ["a"]) is new Map()',
    '- index(new Map([["a", "A"], , ["b", "B"]]), ["a"]) is new Map()',
    '- index(new Map<string, string>([["a", "A"]]), ["a"]) is new Map()',
    '- index(new Map(Object.entries({ a: "A" })), ["a"]) is new Map()',
    '- index(new WeakMap() as never, []) is new Map()',
    '- index(new Map, []) is new Map()',
    '- index(new Map([["a", "A", "x"]]), ["a"]) is new Map()',
    '- sorted(new Set([{ a: 1 }]) as never) is []',
    '- sorted(new Set([1, 1])) is [1]',
    `- sorted(new Set([${Array.from({ length: MAX_COLLECTION_ENTRIES + 1 }, (_, i) => i).join(", ")}])) is []`,
    '- pages(new Map([["a", new Map([["b", new Map([["c", new Set([1])]])]])]]) as never) is 0',
  ];
  for (const c of bad) assert.equal(run(c.slice(2, c.indexOf("(")), c).e, null, c);
  for (const c of bad.slice(0, 3)) assert.equal(run("index", c).r, TEST_CHECK_REFUSED, c);
  // Expected values get the same literal grammar.
  for (const c of ['- tally(["a"]) is new Map([[{ k: 1 }, 1]])', '- tally(["a"]) is new Map([["a", 1], ["a", 1]])', '- tally(["a"]) is new Map<string, number>([["a", 1]])', '- tally(["a"]) is new WeakMap()'])
    assert.equal(run("tally", c).e, null, c);
  assert.ok(isMapSetLiteral(ts.factory.createNewExpression(ts.factory.createIdentifier("Set"), undefined, [])));
});

test("Job A: a void target's checks are throws or is undefined, at least one throws; anything else is test_check_refused", () => {
  const ok = run("requireCode", '- requireCode("ab") throws BAD_CODE\n- requireCode("AB") is undefined');
  assert.ok(ok.e, ok.r);
  assert.match(ok.e!.content, /assert\.throws\(\(\) => requireCode\("ab"\), \/BAD_CODE\/\);/);
  assert.match(ok.e!.content, /assert\.equal\(requireCode\("AB"\), undefined\);/);
  assert.ok(run("requireCode", '- requireCode("") throws BAD_CODE').e);
  assert.equal(run("requireCode", '- requireCode("AB") is undefined').r, TEST_CHECK_REFUSED, "no throws: only the stub's value would fail");
  assert.equal(run("requireCode", '- requireCode("ab") throws BAD_CODE\n- requireCode("AB") is 1').r, TEST_CHECK_REFUSED);
  assert.equal(run("requireCode", '- requireCode("ab") throws BAD_CODE\n- requireCode("AB") is null').r, TEST_CHECK_REFUSED);
  assert.equal(run("requireCode", '- requireCode("ab") throws BAD_CODE\n- requireCode("AB") equals []').r, TEST_CHECK_REFUSED);
  assert.equal(run("requireCode", '- requireCode("ab") throws BAD_CODE', V6).r, TEST_TARGET_SIGNATURE, "v6 refuses a void target");
});

test("Job B: the graded test source is re-checked (void call forms, Map / Set literals), not only the task text", () => {
  const head = 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { requireCode } from "./a";\n';
  assert.equal(voidTestProblem(A, "requireCode", `${head}test("t", () => {\n  assert.throws(() => requireCode("ab"), /BAD_CODE/);\n  assert.equal(requireCode("AB"), undefined);\n});\n`), null);
  const bad = [
    'test("t", () => {\n  assert.equal(requireCode("AB"), undefined);\n});\n',
    'test("t", () => {\n  assert.throws(() => requireCode("ab"), /BAD_CODE/);\n  assert.deepEqual(requireCode("AB"), {});\n});\n',
    'test("t", () => {\n  assert.throws(() => requireCode("ab"), /BAD_CODE/);\n  assert.notEqual(requireCode("AB"), 1);\n});\n',
    'test("t", () => {\n  assert.throws(() => { requireCode("ab"); requireCode("AB"); }, /BAD_CODE/);\n});\n',
    'test("t", () => {\n  assert.throws(() => requireCode("ab"), /BAD_CODE/);\n  const r = requireCode;\n  r("x");\n});\n',
    'test("t", () => {\n  assert.throws(() => requireCode("ab"), /BAD_CODE/);\n  assert.equal(requireCode("AB"), undefined, "m");\n});\n',
  ];
  for (const t of bad) assert.equal(voidTestProblem(A, "requireCode", head + t), "void-check-not-throws-or-undefined", t);
  assert.equal(voidTestProblem(A, "plain", "plain(1);\n"), null, "not void: nothing to check");
  assert.equal(mapSetTestProblem('assert.deepEqual(index(new Map([["a", "b"]]), ["a"]), new Map([["b", "a"]]));\n'), null);
  for (const t of ["const m = new Map();\nm.set({}, 1);\n", 'const s = new Set([1]);\nassert.equal(sorted(s), [1]);\n', 'const o = { m: new Map([["a", 1]]) };\n', 'assert.deepEqual(index(new Map([[{}, "b"]]) as never, []), new Map());\n', "assert.ok(Map.groupBy);\n", "assert.ok(new WeakMap());\n", "const M = Map;\nassert.ok(new M());\n", 'assert.ok(new Set([1, 1]));\n'])
    assert.equal(mapSetTestProblem(t), "map-set-not-literal", t);
  const tc = read("peaceai/bin/test-candidates.ts");
  assert.match(tc, /function gradeExisting\([^)]*v2 = false, v3 = false, v4 = false, v5 = false, v6 = false, v7 = false\): TestGrading/);
  assert.match(tc, /existing-v6@"\) \|\| candidate\.operationId\.startsWith\("learned:public-test-case-existing-v7@"\)\), typeof candidate\.operationId === "string" && candidate\.operationId\.startsWith\("learned:public-test-case-existing-v7@"\)\);/);
  assert.match(tc, /dates: v3, v4, v5, v6, v7 \} : \{ load: \{ read: \(rel\) => \(scope\.isSource\(rel\) && !scope\.isTest\(rel\) \? regular\(rel\) : null\) \} \}\) !== null\) return ungradable\("not-test-only"\);\n  if \(v6 && envArgProblem\(real, fn, test\) !== null\) return ungradable\("not-test-only"\);\n  if \(v7 && \(voidTestProblem\(real, fn, test\) !== null \|\| mapSetTestProblem\(test\) !== null\)\) return ungradable\("not-test-only"\);/);
  assert.match(tc, /stubAll\(real, \[fn\], v2\)/);
});

test("stub, iteration order and shared instances: node:assert/strict compares Map / Set by content; the stub's value never equals a Map, a Set or undefined; each check builds its own literal", () => {
  // Iteration order: deepEqual on Map / Set ignores insertion order, so an expected literal's order cannot make a
  // check pass or fail; order-dependent results (arrays built by iterating) see the literal's insertion order, fixed text.
  assert.deepEqual(new Map([["a", 1], ["b", 2]]), new Map([["b", 2], ["a", 1]]));
  assert.deepEqual(new Set([1, 2]), new Set([2, 1]));
  assert.throws(() => assert.deepEqual(new Map([["a", 1]]), new Map([["a", 2]])));
  assert.throws(() => assert.deepEqual(new Map([["1", 1]]), new Map([[1, 1]])), "string and number keys differ");
  assert.deepEqual([...new Map([["b", 1], ["a", 2]]).keys()], ["b", "a"]);
  // The v2 object-aware stub returns `{}`: never deep-equal to a Map / Set (even empty) nor to undefined.
  const st = stubAll(A, ["index", "requireCode"], true);
  assert.ok(st && !st.throws && /export function index\(m: ReadonlyMap<string, string>, ids: readonly string\[\]\): Map<string, string> \{ __peaceaiStubRan\(\); return \(\{\} as never\); \}/.test(st.content));
  assert.ok(/export function requireCode\(code: string\): void \{ __peaceaiStubRan\(\); return \(\{\} as never\); \}/.test(st.content));
  assert.throws(() => assert.deepEqual({}, new Map()));
  assert.throws(() => assert.deepEqual({}, new Set()));
  assert.throws(() => assert.equal({}, undefined));
  // Shared instances: a check may pass only literals, so no Map object is shared between two calls or two checks.
  assert.equal(run("index", "- index(M, []) is new Map()").r, TEST_CHECK_REFUSED);
  const two = run("tally", '- tally(["a"]) is new Map([["a", 1]])\n- tally(["a"]) is new Map([["a", 1]])');
  assert.ok(two.e);
  assert.equal((two.e!.content.match(/new Map\(/g) ?? []).length, 2, "each check has its own literal");
});

// ---- mined evidence ----
type Pin = { path: string; fileBlob: string; sha256: string; fixture: string; repo: string; commit: string };
type Ex = Pin & { module: string; fn: string; signature: string; v1Refusal: string; v2Refusal: string; v3Refusal: string; v4Refusal: string; v5Refusal: string; v6Refusal: string; siblings: Pin[]; license: string; licenseSha256: string };
const EV = JSON.parse(read("peaceai/rules/proposals/m97-test-case-existing-v7-evidence.json")) as { bar: number; manifestSha256: string; examples: Ex[]; peace: { repo: string; checkedAt: string; counted: number }[] };
const gitBlob = (b: Buffer) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
const pinned = (p: { fixture: string; fileBlob: string; sha256: string }) => {
  const b = readFileSync(resolve(root, p.fixture));
  assert.ok(b.length <= 65536, p.fixture);
  assert.equal(gitBlob(b), p.fileBlob, p.fixture);
  assert.equal(createHash("sha256").update(b).digest("hex"), p.sha256, p.fixture);
  return b.toString("utf8");
};
test("evidence: bar met; every module and sibling blob-pinned; v1-v6 refuse and v7 accepts each on the pinned text", () => {
  assert.ok(EV.examples.length >= EV.bar && EV.bar >= 10);
  assert.equal(new Set(EV.examples.map((e) => `${e.repo}\0${e.module}\0${e.fn}`)).size, EV.examples.length);
  const perRepo = new Map<string, number>();
  for (const e of EV.examples) perRepo.set(e.repo, (perRepo.get(e.repo) ?? 0) + 1);
  assert.ok([...perRepo.values()].every((n) => n <= 3), "at most 3 per repo");
  let coll = 0, voids = 0;
  for (const e of EV.examples) {
    const text = pinned(e);
    const sibs = new Map(e.siblings.map((s) => [s.path, pinned(s)]));
    const rd = { read: (rel: string) => sibs.get(rel) ?? null };
    assert.equal(existingTargetAnalysisForEvidence(e.module, text, e.fn), e.v1Refusal, `${e.repo} ${e.fn} v1`);
    assert.equal(existingTargetAnalysisForEvidence(e.module, text, e.fn, { v2: rd }), e.v2Refusal, `${e.repo} ${e.fn} v2`);
    assert.equal(existingTargetAnalysisForEvidence(e.module, text, e.fn, { v2: rd, dates: true }), e.v3Refusal, `${e.repo} ${e.fn} v3`);
    assert.equal(existingTargetAnalysisForEvidence(e.module, text, e.fn, { v2: rd, v4: true }), e.v4Refusal, `${e.repo} ${e.fn} v4`);
    assert.equal(existingTargetAnalysisForEvidence(e.module, text, e.fn, { v2: rd, v5: true }), e.v5Refusal, `${e.repo} ${e.fn} v5`);
    assert.equal(existingTargetAnalysisForEvidence(e.module, text, e.fn, { v2: rd, v6: true }), e.v6Refusal, `${e.repo} ${e.fn} v6`);
    for (const r of [e.v1Refusal, e.v2Refusal, e.v3Refusal, e.v4Refusal, e.v5Refusal, e.v6Refusal]) assert.notEqual(r, null);
    assert.equal(existingTargetAnalysisForEvidence(e.module, text, e.fn, { v2: rd, v7: true }), null, `${e.repo} ${e.fn} v7`);
    // v7 differs from v6 only by Map / Set types and a void return: the signature shows one.
    assert.match(e.signature, /\b(?:Readonly)?(?:Map|Set)<|\): void$/, e.fn);
    if (/\b(?:Readonly)?(?:Map|Set)</.test(e.signature)) coll++; else voids++;
  }
  assert.ok(coll >= 3 && voids >= 3, "both widenings are evidenced");
});
test("evidence: licenses by hash in THIRD_PARTY_NOTICES; fixtures dir holds exactly the evidence fixtures", () => {
  const notices = read("THIRD_PARTY_NOTICES");
  const listed = new Set<string>();
  for (const e of EV.examples) {
    assert.ok(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"].includes(e.license), e.repo);
    assert.ok(notices.includes(`repo: ${e.repo}\nlicense: ${e.license} (`) && notices.includes(`sha256 of trimmed text ${e.licenseSha256})`), e.repo);
    for (const p of [e, ...e.siblings]) { assert.ok(notices.includes(` ${p.fixture}\n`), p.fixture); listed.add(p.fixture.split("/").pop()!); }
  }
  const have = readdirSync(resolve(root, "peaceai/test/fixtures/m97-te7"));
  for (const f of have) assert.ok(listed.has(f), f);
  assert.equal(have.length, listed.size);
});
test("evidence: no overlap with the training corpus or the ext-manifest; Peace's repos checked first and not counted", () => {
  const buf = readManifestBytes(resolve(root, "peaceai/model"), "ext-manifest");
  assert.equal(createHash("sha256").update(buf).digest("hex"), EV.manifestSha256);
  const repos = new Set<string>(); const shas = new Set<string>();
  for (const l of buf.toString("utf8").split("\n")) if (l.trim()) { const r = JSON.parse(l) as { repo?: string; sha256?: string }; if (r.repo) repos.add(r.repo); if (r.sha256) shas.add(r.sha256); }
  for (const r of (JSON.parse(read("peaceai/model/ext-corpus.json")) as { repos: { name: string }[] }).repos) repos.add(r.name);
  for (const e of EV.examples) { assert.ok(!repos.has(e.repo), e.repo); for (const p of [e, ...e.siblings]) assert.ok(!shas.has(p.sha256), p.fixture); assert.ok(!e.repo.startsWith("PeaceG03/")); }
  for (const p of EV.peace) { assert.ok(repos.has(p.repo)); assert.equal(p.counted, 0); assert.match(p.checkedAt, /^[0-9a-f]{40}$/); }
  const rec = JSON.parse(read("peaceai/rules/proposals/public-test-case-existing-v7.json")) as { status: string; evidence: { examples: number; repos: number; bar: number; qualifies: boolean } };
  assert.match(rec.status, /^proposal-off/);
  assert.equal(rec.evidence.examples, EV.examples.length);
  assert.equal(rec.evidence.repos, new Set(EV.examples.map((e) => e.repo)).size);
  assert.ok(rec.evidence.qualifies && rec.evidence.examples >= rec.evidence.bar);
  assert.deepEqual(SPEC.evidence.repos, [...new Set(EV.examples.map((e) => e.repo))].sort());
});

// ---- Auditor #466: the shared purity walk (every version) ----
// Each row: [kind, fn, files, the refusal under v1..v7 ("ok" = accepted)]. NEG rows were accepted by at least one
// version at 26d5677 (the holes: a module write through a fresh-by-method-name alias such as `H.concat()` returning
// `STORE.items`, module RegExp / iterator state, global patches through aliases or side-effect imports, writes through
// a shallow copy, `return T.m`); KEPT rows were already refused and stay refused; OK rows are the controls.
const A466: Record<string, ["NEG" | "KEPT" | "OK", string, Record<string, string>, string[]]> = {
  "storeItemsAlias": ["NEG", "f", {"src/a.ts": "const STORE = { items: [] as number[] };\nconst H = { slice: (): number[] => STORE.items };\nexport function f(m: ReadonlyMap<string, number>): number { const c = H.slice(); c.push(1); return c.length + m.size; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "storeItemsAliasArr": ["NEG", "f", {"src/a.ts": "const STORE = { items: [] as number[] };\nconst H = { slice: (): number[] => STORE.items };\nexport function f(m: readonly number[]): number { const c = H.slice(); c.push(1); return c.length + m.length; }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "condInit": ["NEG", "f", {"src/a.ts": "const ARR: number[] = true ? [] : [];\nconst H = { slice: (): number[] => ARR };\nexport function f(m: ReadonlySet<number>): number { const c = H.slice(); c.push(1); return c.length + m.size; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "mapValuesFresh": ["OK", "f", {"src/a.ts": "const T = new Map<string, number[]>([[\"a\", []]]);\nexport function f(m: ReadonlyMap<string, number>): number { const c = T.get(\"a\")!.map((x) => x); return c.length; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "ok"]],
  "mapGetMethodAlias": ["NEG", "f", {"src/a.ts": "const T = { a: [] as number[] };\nconst H = { values: () => T.a };\nexport function f(s: ReadonlySet<string>): number { const c = H.values(); return s.size; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "voidStore": ["NEG", "f", {"src/a.ts": "const STORE = { items: [] as string[] };\nconst H = { concat: (): string[] => STORE.items };\nexport function f(x: string): void { const c = H.concat(); c.push(x); if (c.length > 2) throw new Error(\"FULL\"); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "voidMutatesArg": ["KEPT", "f", {"src/a.ts": "export function f(m: Map<string, number>): void { if (m.size > 2) throw new Error(\"BIG\"); m.set(\"x\", 1); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "voidGlobalThis": ["KEPT", "f", {"src/a.ts": "export function f(x: string): void { (globalThis as any).y = x; if (!x) throw new Error(\"E\"); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_io"]],
  "voidConsole": ["KEPT", "f", {"src/a.ts": "export function f(x: string): void { if (!x) throw new Error(\"E\"); console.log(x); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_io"]],
  "voidRandom": ["KEPT", "f", {"src/a.ts": "export function f(x: number): void { if (x > Math.random()) throw new Error(\"E\"); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "asyncVoid": ["KEPT", "f", {"src/a.ts": "export async function f(x: number): Promise<void> { if (x) throw new Error(\"E\"); }"}, ["test_target_async", "test_target_async", "test_target_async", "test_target_async", "test_target_async", "test_target_async", "test_target_async"]],
  "gen": ["KEPT", "f", {"src/a.ts": "export function* f(x: number): Generator<number> { yield x; }"}, ["test_target_async", "test_target_async", "test_target_async", "test_target_async", "test_target_async", "test_target_async", "test_target_async"]],
  "mapDefaultEnv": ["KEPT", "f", {"src/a.ts": "export function f(m: Map<string, string> = new Map(Object.entries(process.env) as [string,string][])): number { return m.size; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_io"]],
  "mapDefaultLit": ["OK", "f", {"src/a.ts": "export function f(m: ReadonlyMap<string, string> = new Map([[\"a\",\"b\"]])): number { return m.size; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "ok"]],
  "weakMapMemo": ["OK", "f", {"src/a.ts": "const CACHE = new WeakMap<object, number>();\nexport function f(m: ReadonlyMap<string, number>): number { return m.size; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "ok"]],
  "memoMap": ["KEPT", "f", {"src/a.ts": "const CACHE = new Map<string, number>();\nexport function f(m: ReadonlyMap<string, number>, k: string): number { const v = CACHE.get(k); if (v !== undefined) return v; const r = m.size; CACHE.set(k, r); return r; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "retModuleMap": ["KEPT", "f", {"src/a.ts": "const T = new Map<string, number>([[\"a\", 1]]);\nexport function f(s: ReadonlySet<string>): ReadonlyMap<string, number> { return T; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "retModuleMapInner": ["NEG", "f", {"src/a.ts": "const T = { m: new Map<string, number>([[\"a\", 1]]) };\nexport function f(s: ReadonlySet<string>): ReadonlyMap<string, number> { return T.m; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "nanKey": ["OK", "f", {"src/a.ts": "export function f(s: ReadonlySet<number>): boolean { return s.has(NaN); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "ok"]],
  "objKeyViaAlias": ["KEPT", "f", {"src/a.ts": "type K = { a: number };\nexport function f(m: Map<K, number>): number { return m.size; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature"]],
  "literalKeys": ["OK", "f", {"src/a.ts": "export function f(m: Map<\"a\" | \"b\", number>): number { return m.size; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "ok"]],
  "symbolKey": ["KEPT", "f", {"src/a.ts": "export function f(m: Map<symbol, number>): number { return m.size; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature"]],
  "mapSubclassRet": ["KEPT", "f", {"src/a.ts": "class M2 extends Map<string, number> {}\nexport function f(s: ReadonlySet<string>): Map<string, number> { return new M2(); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "mapGroupBy": ["OK", "f", {"src/a.ts": "export function f(xs: readonly string[]): Map<number, string[]> { return Map.groupBy(xs, (x) => x.length); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "ok"]],
  "setIterOrderDep": ["OK", "f", {"src/a.ts": "export function f(s: ReadonlySet<string>): string { return [...s].join(\",\"); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "ok"]],
  "sortInPlaceParamCopy": ["OK", "f", {"src/a.ts": "export function f(s: ReadonlySet<string>): string[] { const a = [...s]; a.sort(); return a; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "ok"]],
  "forEachMutateParamVal": ["KEPT", "f", {"src/a.ts": "export function f(m: ReadonlyMap<string, { n: number }>): number { m.forEach((v) => { v.n++; }); return m.size; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "forOfMutateParamVal": ["KEPT", "f", {"src/a.ts": "export function f(m: ReadonlyMap<string, { n: number }>): number { for (const [, v] of m) v.n = 2; return m.size; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "destructMutate": ["KEPT", "f", {"src/a.ts": "export function f(m: ReadonlyMap<string, { n: number }>): number { const [[, v]] = [...m]; v.n = 3; return m.size; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "objectAssignFresh": ["KEPT", "f", {"src/a.ts": "export function f(m: ReadonlyMap<string, { n: number }>): number { const c = [...m.values()]; const o = c[0]!; o.n = 1; return 1; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "spreadAliasMut": ["KEPT", "f", {"src/a.ts": "export function f(m: ReadonlyMap<string, number[]>): number { const c = [...m.values()]; const [first] = c; first!.push(1); return 1; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "fillParam": ["KEPT", "f", {"src/a.ts": "export function f(m: ReadonlyMap<string, number[]>): number { for (const v of m.values()) v.fill(0); return 1; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "getterArgsRead": ["OK", "f", {"src/a.ts": "export function f(m: ReadonlyMap<string, { readonly n: number }>): number { let s = 0; for (const v of m.values()) s += v.n; return s; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "ok"]],
  "voidNeverThrows": ["OK", "f", {"src/a.ts": "export function f(x: number): void { const y = x + 1; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "ok"]],
  "structuredClone": ["KEPT", "f", {"src/a.ts": "export function f(m: ReadonlyMap<string, number>): Map<string, number> { return structuredClone(m) as Map<string,number>; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "dateInVoid": ["OK", "f", {"src/a.ts": "export function f(x: string): void { if (new Date(x).getTime() > 0) throw new Error(\"E\"); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "ok"]],
  "dateLocalVoid": ["KEPT", "f", {"src/a.ts": "export function f(x: string): void { if (new Date(x).getHours() > 0) throw new Error(\"E\"); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_date_local"]],
  "errorStackVoid": ["NEG", "f", {"src/a.ts": "export function f(x: string): void { const e = new Error(x); if (e.stack!.length > 5) throw e; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "captureStack": ["NEG", "f", {"src/a.ts": "export function f(x: string): void { const o = {}; Error.captureStackTrace(o); throw new Error(x); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "prepareStackTrace": ["KEPT", "f", {"src/a.ts": "export function f(x: string): void { Error.stackTraceLimit = 0; throw new Error(x); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "regexLastIndex": ["KEPT", "f", {"src/a.ts": "const R = /a/g;\nexport function f(s: ReadonlySet<string>): number { let n = 0; for (const x of s) if (R.test(x)) n++; return n; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "regexLastIndexInFn": ["NEG", "g", {"src/a.ts": "export function f(s: ReadonlySet<string>): number { return s.size; }\nconst R2 = new RegExp(\"a\", \"g\");\nexport function g(s: ReadonlySet<string>): number { let n = 0; for (const x of s) if (R2.test(x)) n++; return n; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "regexLiteralInFnPassed": ["KEPT", "f", {"src/a.ts": "const RX = { r: /a/g };\nexport function f(s: ReadonlySet<string>): number { let n = 0; for (const x of s) if (RX.r.test(x)) n++; return n; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "storeAliasArrStr": ["NEG", "f", {"src/a.ts": "const STORE = { items: [] as string[] };\nconst H = { slice: (): string[] => STORE.items };\nexport function f(x: string): number { const c = H.slice(); c.push(x); return c.length; }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "regexNewG": ["NEG", "f", {"src/a.ts": "const R2 = new RegExp(\"a\", \"g\");\nexport function f(x: string): boolean { return R2.test(x); }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "storeFnMethod": ["NEG", "f", {"src/a.ts": "const ITEMS: string[] = [];\nfunction slice(): string[] { return ITEMS; }\nconst H = { slice };\nexport function f(x: string): number { const c = H.slice(); c.push(x); return c.length; }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "envRecMap": ["KEPT", "f", {"src/a.ts": "export function f(m: ReadonlyMap<string, number>, env: NodeJS.ProcessEnv = process.env): number { return m.size > 0 ? f(new Map(), undefined) : (env.A ? 1 : 0); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_io"]],
  "envVoidRec": ["KEPT", "f", {"src/a.ts": "export function f(n: number, env: NodeJS.ProcessEnv = process.env): void { if (n > 0) f(n - 1); if (env.A) throw new Error(\"A\"); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_io"]],
  "envMapOk": ["OK", "f", {"src/a.ts": "export function f(m: ReadonlyMap<string, number>, env: NodeJS.ProcessEnv = process.env): number { return env.A ? m.size : 0; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "ok"]],
  "importBackMap": ["KEPT", "f", {"src/a.ts": "import { g } from \"./b.ts\";\nexport function f(s: ReadonlySet<string>): number { return g(s.size); }", "src/b.ts": "import { f } from \"./a.ts\";\nexport function g(n: number): number { return n; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "sharedMapSibling": ["KEPT", "f", {"src/a.ts": "import { T } from \"./b.ts\";\nexport function f(s: ReadonlySet<string>): number { return T.get(\"a\") ?? s.size; }", "src/b.ts": "export const T = new Map<string, number>();\nexport function put(k: string): void { T.set(k, 1); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "sharedMapSiblingNoMut": ["OK", "f", {"src/a.ts": "import { T } from \"./b.ts\";\nexport function f(s: ReadonlySet<string>): number { return T.get(\"a\") ?? s.size; }", "src/b.ts": "export const T = new Map<string, number>([[\"a\", 1]]);"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "ok"]],
  "siblingStoreItems": ["NEG", "f", {"src/a.ts": "import { H } from \"./b.ts\";\nexport function f(s: ReadonlySet<string>): number { const c = H.slice(); c.push(\"x\"); return c.length; }", "src/b.ts": "const S = { items: [] as string[] };\nexport const H = { slice: (): string[] => S.items };"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "nsImportSlice": ["KEPT", "f", {"src/a.ts": "import * as lib from \"./b.ts\";\nexport function f(s: ReadonlySet<string>): number { const c = lib.slice(); c.push(\"x\"); return c.length; }", "src/b.ts": "const ITEMS: string[] = [];\nexport function slice(): string[] { return ITEMS; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "mjsImport": ["KEPT", "f", {"src/a.ts": "import { g } from \"./b.mjs\";\nexport function f(s: ReadonlySet<string>): number { return s.size; }", "src/b.mjs": "globalThis.Map = class {};"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_io"]],
  "sideEffImport": ["KEPT", "f", {"src/a.ts": "import \"./b.ts\";\nexport function f(s: ReadonlySet<string>): number { return s.size; }", "src/b.ts": "Set.prototype.has = () => true;"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "sideEffDefineGlobal": ["NEG", "f", {"src/a.ts": "import \"./b.ts\";\nexport function f(s: ReadonlySet<string>): boolean { return s.has(\"q\"); }", "src/b.ts": "const P = Set.prototype; P.has = () => true;"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "patchViaAlias": ["KEPT", "f", {"src/a.ts": "const P = Set.prototype as any;\nP.has = () => true;\nexport function f(s: ReadonlySet<string>): boolean { return s.has(\"q\"); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "patchViaObjAlias": ["NEG", "f", {"src/a.ts": "const O = Object;\nO.defineProperty(Set.prototype, \"has\", { value: () => true });\nexport function f(s: ReadonlySet<string>): boolean { return s.has(\"q\"); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "patchViaReflectAlias": ["KEPT", "f", {"src/a.ts": "const R = Reflect;\nR.set(Map.prototype, \"get\", () => 1);\nexport function f(s: ReadonlyMap<string, number>): number { return s.get(\"q\") ?? 0; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "v1TopPatch": ["NEG", "f", {"src/a.ts": "String.prototype.trim = function () { return \"x\"; };\nexport function f(s: string): string { return s.trim(); }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "v1TopPatchAlias": ["NEG", "f", {"src/a.ts": "const P = String.prototype as any;\nP.trim = () => \"x\";\nexport function f(s: string): string { return s.trim(); }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "sideEffSib": ["NEG", "f", {"src/a.ts": "import \"./b.ts\";\nexport function f(s: string): string { return s.trim(); }", "src/b.ts": "String.prototype.trim = function () { return \"x\"; };"}, ["test_target_io", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "namedSibPatch": ["KEPT", "f", {"src/a.ts": "import { K } from \"./b.ts\";\nexport function f(s: string): string { return s.trim() + K; }", "src/b.ts": "export const K = \"k\";\nconst P = String.prototype as any;\nP.trim = () => \"x\";"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "namedSibPatchObj": ["NEG", "f", {"src/a.ts": "import { K } from \"./b.ts\";\nexport function f(s: string): string { return s.trim() + K; }", "src/b.ts": "export const K = \"k\";\nconst O = Object;\nO.defineProperty(String.prototype, \"trim\", { value: () => \"x\" });"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "iterMod": ["NEG", "f", {"src/a.ts": "const IT = [\"a\", \"b\"].values();\nexport function f(s: string): string { const r = IT.next(); return r.done ? s : String(r.value); }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "iterSpread": ["NEG", "f", {"src/a.ts": "const IT = [\"a\", \"b\"].values();\nexport function f(s: string): number { return [...IT].length + s.length; }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "regexCompile": ["NEG", "f", {"src/a.ts": "const R = /a/;\nexport function f(s: string): boolean { R.compile(\"b\"); return R.test(s); }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "regexNewNoFlag": ["OK", "f", {"src/a.ts": "const R = new RegExp(\"^a$\");\nexport function f(s: string): boolean { return R.test(s); }"}, ["ok", "ok", "ok", "ok", "ok", "ok", "ok"]],
  "regexNewFromG": ["KEPT", "f", {"src/a.ts": "const R = new RegExp(/a/g);\nexport function f(s: string): boolean { return R.test(s); }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "regexLitPlain": ["OK", "f", {"src/a.ts": "const R = /^a$/;\nexport function f(s: string): boolean { return R.test(s); }"}, ["ok", "ok", "ok", "ok", "ok", "ok", "ok"]],
  "objLitFresh": ["NEG", "f", {"src/a.ts": "const STORE: string[] = [];\nexport function f(s: string): number { const o = { slice: (): string[] => STORE }; const c = o.slice(); c.push(s); return c.length; }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "assignSliceFresh": ["NEG", "f", {"src/a.ts": "const STORE: string[] = [];\nexport function f(s: string): number { const o: any = {}; o.slice = (): string[] => STORE; const c = o.slice(); c.push(s); return c.length; }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "fnPropSlice": ["NEG", "f", {"src/a.ts": "const STORE: string[] = [];\nfunction g(): void {}\n(g as any).slice = (): string[] => STORE;\nexport function f(s: string): number { const c = (g as any).slice(); c.push(s); return c.length; }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "errStack": ["NEG", "f", {"src/a.ts": "export function f(s: string): number { return new Error(s).stack!.length; }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "okSplitPush": ["OK", "f", {"src/a.ts": "export function f(s: string): number { const c = s.split(\",\"); c.push(\"x\"); return c.length; }"}, ["ok", "ok", "ok", "ok", "ok", "ok", "ok"]],
  "okObjKeysMap": ["OK", "f", {"src/a.ts": "export function f(s: string): number { const o: Record<string, number> = {}; o[s] = 1; const c = Object.keys(o).map((k) => k); c.push(\"z\"); return c.length; }"}, ["ok", "ok", "ok", "ok", "ok", "ok", "ok"]],
  "shallowDeepWrite": ["NEG", "f", {"src/a.ts": "const T = [{ n: 0 }];\nexport function f(x: number): number { const c = T.slice(); c[0]!.n += x; return c[0]!.n; }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "bagViaHelperParam": ["NEG", "f", {"src/a.ts": "const STORE: string[] = [];\nconst H = { slice: (): string[] => STORE };\nfunction h(o: { slice(): string[] }): number { const c = o.slice(); c.push(\"x\"); return c.length; }\nexport function f(x: string): number { return h(H) + x.length; }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "bagViaCallback": ["NEG", "f", {"src/a.ts": "const STORE: string[] = [];\nconst H = { slice: (): string[] => STORE };\nexport function f(x: string): number { return [H].map((o) => { const c = o.slice(); c.push(x); return c.length; })[0]!; }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "bagGetter": ["NEG", "f", {"src/a.ts": "const STORE: string[] = [];\nconst H = { get slice() { return (): string[] => STORE; } };\nexport function f(x: string): number { const c = H.slice(); c.push(x); return c.length; }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "bagProto": ["NEG", "f", {"src/a.ts": "const STORE: string[] = [];\nconst H = { __proto__: { slice: (): string[] => STORE } } as unknown as { slice(): string[] };\nexport function f(x: string): number { const c = H.slice(); c.push(x); return c.length; }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "bagComputed": ["NEG", "f", {"src/a.ts": "const STORE: string[] = [];\nconst K = \"slice\";\nconst H = { [K]: (): string[] => STORE } as { slice(): string[] };\nexport function f(x: string): number { const c = H.slice(); c.push(x); return c.length; }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "bagFromEntries": ["NEG", "f", {"src/a.ts": "const STORE: string[] = [];\nconst H = Object.fromEntries([[\"slice\", (): string[] => STORE]]) as { slice(): string[] };\nexport function f(x: string): number { const c = H.slice(); c.push(x); return c.length; }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "bagElemAssign": ["KEPT", "f", {"src/a.ts": "const STORE: string[] = [];\nconst H: Record<string, () => string[]> = {};\nconst K = \"slice\";\nH[K] = () => STORE;\nexport function f(x: string): number { const c = H.slice!(); c.push(x); return c.length; }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "bagSiblingFn": ["NEG", "f", {"src/a.ts": "import { slice } from \"./b.ts\";\nconst H = { slice };\nexport function f(x: string): number { const c = H.slice(); c.push(x); return c.length; }", "src/b.ts": "const ITEMS: string[] = [];\nexport function slice(): string[] { return ITEMS; }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "bagSiblingVoid": ["NEG", "f", {"src/a.ts": "import { H } from \"./b.ts\";\nexport function f(x: string): void { const c = H.concat(); c.push(x); if (c.length > 2) throw new Error(\"FULL\"); }", "src/b.ts": "const S = { items: [] as string[] };\nexport const H = { concat: (): string[] => S.items };"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "bagMapSet": ["KEPT", "f", {"src/a.ts": "const STORE: string[] = [];\nconst H = { values: (): Set<string> => SS };\nconst SS = new Set<string>();\nexport function f(m: ReadonlyMap<string, number>): number { const c = H.values(); c.add(\"x\"); return c.size + m.size; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "bagTopIf": ["NEG", "f", {"src/a.ts": "const STORE: string[] = [];\nfunction g(): void {}\nif (STORE.length === 0) (g as unknown as { slice: () => string[] }).slice = () => STORE;\nexport function f(x: string): number { const c = (g as unknown as { slice: () => string[] }).slice(); c.push(x); return c.length; }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "okRealConcat": ["OK", "f", {"src/a.ts": "const M = new Map<string, string[]>([[\"a\", []]]);\nexport function f(x: string): number { const c = M.get(\"a\")!.concat(); c.push(x); return c.length; }"}, ["ok", "ok", "ok", "ok", "ok", "ok", "ok"]],
  "rxCallG": ["NEG", "f", {"src/a.ts": "const R = RegExp(\"a\", \"g\");\nexport function f(x: string): boolean { return R.test(x); }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "rxSrcConst": ["NEG", "f", {"src/a.ts": "const SRC = \"a\";\nconst R = new RegExp(SRC);\nexport function f(x: string): boolean { return R.test(x); }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "rxFlagsConst": ["NEG", "f", {"src/a.ts": "const FL = \"g\";\nconst R = new RegExp(\"a\", FL);\nexport function f(x: string): boolean { return R.test(x); }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "rxNested": ["NEG", "f", {"src/a.ts": "const T = { r: new RegExp(\"a\", \"y\") };\nexport function f(x: string): boolean { return T.r.test(x); }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "rxSibling": ["NEG", "f", {"src/a.ts": "import { R } from \"./b.ts\";\nexport function f(x: string): boolean { return R.test(x); }", "src/b.ts": "export const R = new RegExp(\"a\", \"g\");"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "rxInFnOk": ["OK", "f", {"src/a.ts": "export function f(x: string): boolean { return new RegExp(\"a\", \"g\").test(x); }"}, ["ok", "ok", "ok", "ok", "ok", "ok", "ok"]],
  "iterNested": ["NEG", "f", {"src/a.ts": "const T = { it: new Set([\"a\"]).values() };\nexport function f(x: string): number { return [...T.it].length + x.length; }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "patchDestructProto": ["KEPT", "f", {"src/a.ts": "const { prototype: P } = Set;\n(P as any).has = () => true;\nexport function f(s: ReadonlySet<string>): boolean { return s.has(\"q\"); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "patchLetAlias": ["KEPT", "f", {"src/a.ts": "let O: ObjectConstructor;\nO = Object;\nO.defineProperty(Set.prototype, \"has\", { value: () => true });\nexport function f(s: ReadonlySet<string>): boolean { return s.has(\"q\"); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "patchCall": ["KEPT", "f", {"src/a.ts": "Object.defineProperty.call(null, Set.prototype, \"has\", { value: () => true });\nexport function f(s: ReadonlySet<string>): boolean { return s.has(\"q\"); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "patchReflectElem": ["KEPT", "f", {"src/a.ts": "Reflect[\"set\"](Map.prototype, \"get\", () => 1);\nexport function f(s: ReadonlyMap<string, number>): number { return s.get(\"q\") ?? 0; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "patchFnAlias": ["KEPT", "f", {"src/a.ts": "const d = Object.defineProperty;\nd(Set.prototype, \"has\", { value: () => true });\nexport function f(s: ReadonlySet<string>): boolean { return s.has(\"q\"); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "patchComma": ["KEPT", "f", {"src/a.ts": "(0, Object.defineProperty)(Set.prototype, \"has\", { value: () => true });\nexport function f(s: ReadonlySet<string>): boolean { return s.has(\"q\"); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "patchAssign": ["KEPT", "f", {"src/a.ts": "Object.assign(Set.prototype, { has: () => true });\nexport function f(s: ReadonlySet<string>): boolean { return s.has(\"q\"); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "patchGlobalThisChain": ["KEPT", "f", {"src/a.ts": "(globalThis as any).Set.prototype.has = () => true;\nexport function f(s: ReadonlySet<string>): boolean { return s.has(\"q\"); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_io"]],
  "patchGAlias": ["KEPT", "f", {"src/a.ts": "const G = globalThis as any;\nG.Map = class {};\nexport function f(s: ReadonlyMap<string, number>): number { return s.size; }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
  "patchSibAlias": ["NEG", "f", {"src/a.ts": "import \"./b.ts\";\nexport function f(s: string): string { return s.trim(); }", "src/b.ts": "const O = Object;\nO.defineProperty(String.prototype, \"trim\", { value: () => \"x\" });"}, ["test_target_io", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "patchStrV1": ["NEG", "f", {"src/a.ts": "const P = String.prototype;\n(P as any).trim = () => \"x\";\nexport function f(s: string): string { return s.trim(); }"}, ["test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure", "test_target_impure"]],
  "patchUnreachedFn": ["KEPT", "f", {"src/a.ts": "function never(): void { (Set.prototype as any).has = () => true; }\nexport function f(s: ReadonlySet<string>): boolean { return s.has(\"q\"); }"}, ["test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_signature", "test_target_impure"]],
};
test("Auditor #466: module state through fresh aliases, module RegExp / iterator state, aliased or side-effect global patches and shallow-copy writes are refused under every version; the controls stay accepted", () => {
  const ver = (rd: { read: (rel: string) => string | null }): (Record<string, unknown> | undefined)[] => [undefined, { v2: rd }, { v2: rd, dates: true }, { v2: rd, v4: true }, { v2: rd, v5: true }, { v2: rd, v6: true }, { v2: rd, v7: true }];
  let neg = 0;
  for (const [k, [kind, fn, files, want]] of Object.entries(A466)) {
    const rd = { read: (rel: string) => files[rel] ?? null };
    const repo = Object.entries(files).map(([path, content]) => ({ path, content })); // Auditor (c): the case's whole repo
    const got = ver(rd).map((o) => existingTargetRefusal("src/a.ts", files["src/a.ts"]!, fn, { ...o, repo } as never) ?? "ok");
    assert.deepEqual(got, want, k);
    if (kind === "NEG") { neg++; assert.ok(want.every((r) => r !== "ok"), `${k} refused everywhere`); }
    if (kind === "OK") assert.ok(want.includes("ok"), k);
  }
  assert.ok(neg >= 40);
});

test("Auditor #466 Job A repros: the fresh-alias store write and the module /g RegExp give no candidate", () => {
  const store = 'const STORE = { items: [] as string[] };\nconst H = { concat: (): string[] => STORE.items };\nexport function f(x: string): void { const c = H.concat(); c.push(x); if (c.length > 2) throw new Error("FULL"); }\n';
  const r1 = run("f", '- f("a") is undefined\n- f("b") is undefined\n- f("c") throws FULL', SPEC, [{ path: "src/a.ts", content: store }]);
  assert.equal(r1.e, null);
  assert.equal(r1.r, TEST_TARGET_IMPURE);
  const rx = 'const R2 = new RegExp("a", "g");\nexport function g(s: ReadonlySet<string>): number { let n = 0; for (const x of s) if (R2.test(x)) n++; return n; }\n';
  const r2 = run("g", '- g(new Set(["a"])) is 1\n- g(new Set(["a"])) is 0', SPEC, [{ path: "src/a.ts", content: rx }]);
  assert.equal(r2.e, null);
  assert.equal(r2.r, TEST_TARGET_IMPURE);
  // The same store under v1 (a plain string parameter and return): refused too.
  const v1 = 'const STORE = { items: [] as string[] };\nconst H = { concat: (): string[] => STORE.items };\nexport function f(x: string): number { const c = H.concat(); c.push(x); return c.length; }\n';
  assert.equal(existingTargetRefusal("src/a.ts", v1, "f"), TEST_TARGET_IMPURE);
});
