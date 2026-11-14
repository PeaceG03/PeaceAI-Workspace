// M168 behavior cases for repair-v2 (peaceai/lib/editpropose.ts, repairProposer({ v2: true })), as data so
// m168-mutation.test.ts can replay them against each mutant. Each case throws (node:assert) on failure.
// Every fixture is a tiny synthetic repo written for these tests (none is modeled on a dev-split task's code, no
// PeaceSTOCKS shape); every admitted condition has at least two different code shapes, and every m168 guard has a
// refused near miss. The "tests" are an in-process oracle (the edited module is transpiled and called), so these
// cases run anywhere; the real-loop case lives in m168-repair-v2.test.ts.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { openRepo } from "../lib/codesearch.ts";
import type * as Prop from "../lib/editpropose.ts";

export interface Libs { prop: typeof Prop }
export interface Ctx { base: string }
export interface Case { id: string; run: (l: Libs, ctx: Ctx) => void }

export function setup(): Ctx { return { base: mkdtempSync(join(tmpdir(), "peaceai-m168-")) }; }
export function teardown(ctx: Ctx): void { rmSync(ctx.base, { recursive: true, force: true }); }

let n = 0;
function repoDir(ctx: Ctx, files: Record<string, string>): string {
  const d = join(ctx.base, `r${n++}`);
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), c); }
  return d;
}
const tsFiles = (d: string, files: Record<string, string>) => Object.keys(files).filter((p) => /\.tsx?$/.test(p)).sort().map((p) => ({ path: p, content: readFileSync(join(d, p), "utf8") }));

/** Loads a transpiled module (CommonJS, relative requires resolved among the given files) in a fresh context. */
function load(m: ReadonlyMap<string, string>, path: string, seen = new Map<string, Record<string, unknown>>()): Record<string, unknown> {
  if (seen.has(path)) return seen.get(path)!;
  const js = ts.transpileModule(m.get(path)!, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  seen.set(path, mod.exports);
  const req = (spec: string) => {
    const base = dirname(path);
    const want = join(base, spec).replace(/\.js$/, "");
    const hit = [...m.keys()].find((k) => k.replace(/\.ts$/, "") === want);
    if (!hit) throw new Error(`no module ${spec}`);
    return load(m, hit, seen);
  };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: req }, { timeout: 1000 });
  return mod.exports;
}
/** An oracle: each check gets the module's exports and returns true when that "test" passes. */
type Check = (x: Record<string, any>) => boolean;
const oracle = (path: string, checks: readonly Check[]) => (m: ReadonlyMap<string, string>): number => {
  let x: Record<string, any>;
  try { x = load(m, path); } catch { return 0; }
  let ok = 0;
  for (const c of checks) { try { if (c(x)) ok++; } catch { /* a failing test */ } }
  return ok;
};

interface Sim { proposals: Prop.RepairEdit[][]; result: "pass" | "NO_EDIT" | "NO_MORE_EDITS" | "limit"; attempts: number }
/** The loop in miniature (as in m152): prepare on the repo, then propose / apply / test / feed back, up to max. */
function simulate(l: Libs, d: string, files: Record<string, string>, request: string, test: (m: ReadonlyMap<string, string>) => number, total: number, v2 = true, max = 20): Sim {
  const p = l.prop.repairProposer({ v2 });
  p.prepare(openRepo(d), { request, failing: [] });
  const fs = tsFiles(d, files);
  const orig = new Map(fs.map((f) => [f.path, f.content]));
  const basePass = test(orig);
  const baseline = { total, passing: basePass, failing: total - basePass };
  const feedback: Prop.RepairFeedback[] = [];
  const proposals: Prop.RepairEdit[][] = [];
  for (let attempt = 1; attempt <= max; attempt++) {
    const r = p.next({ files: fs, attempt, feedback, baseline });
    if ("refuse" in r) return { proposals, result: r.refuse, attempts: attempt - 1 };
    proposals.push(r.edits);
    const m = new Map(orig);
    for (const e of r.edits) m.set(e.path, e.content);
    const pass = test(m);
    if (pass === total) return { proposals, result: "pass", attempts: attempt };
    feedback.push({ attempt, codes: ["TEST_FAIL"], failing: [], tests: { total, passedByPeaceAI: pass } });
  }
  return { proposals, result: "limit", attempts: max };
}

/** The idiom templates one snippet gives (all of it one site). */
function idioms(l: Libs, text: string): { template: string; text: string }[] {
  const site = { path: "src/x.ts", name: "x", start: 0, end: text.length, tier: 0 };
  return l.prop.idiomMutationsIn(l.prop.parseSource("src/x.ts", text), site, 0).map((m) => ({ template: m.template, text: m.text }));
}
const none = (l: Libs, template: string, snippets: string[]) => {
  for (const s of snippets) assert.deepEqual(idioms(l, s).filter((m) => m.template === template), [], `${template} fired on: ${s}`);
};
/** Admits by simulate: the run passes, and the passing edit came from the expected idiom (its text is in it). */
function admits(l: Libs, ctx: Ctx, files: Record<string, string>, request: string, path: string, checks: Check[], expect: RegExp): Sim {
  const d = repoDir(ctx, files);
  const t = oracle(path, checks);
  assert.ok(t(new Map(Object.entries(files))) < checks.length, "the fixture is not broken");
  const s = simulate(l, d, files, request, t, checks.length);
  assert.equal(s.result, "pass");
  assert.match(s.proposals.at(-1)!.map((e) => e.content).join("\n"), expect);
  return s;
}

// ---- fixtures (synthetic)
const REGISTRY = "export class Registry {\n  items: { id: number }[] = [];\n  add(id: number) { this.items.push({ id }); return this; }\n  remove(id: number) {\n    this.items.filter((x) => x.id !== id);\n    return this;\n  }\n}\nexport const ids = (r: Registry) => r.items.map((x) => x.id);\n";
const TAGS = "export function normalizeTag(raw: string): string {\n  let tag = raw;\n  tag.trim();\n  return tag.toLowerCase();\n}\n";
const CAPITAL = "export function isCapital(ch: string): boolean {\n  if (ch.length !== 1) return false;\n  return ch.toUpperCase() === ch;\n}\nexport function capitals(s: string): number {\n  let n = 0;\n  for (const c of s) if (isCapital(c)) n++;\n  return n;\n}\n";
const LOWERCASE = "export class Glyph {\n  constructor(readonly text: string) {}\n  isLower(): boolean {\n    return this.text === this.text.toLowerCase();\n  }\n}\nexport const lowerCount = (s: string) => [...s].filter((c) => new Glyph(c).isLower()).length;\n";
const DESCRIBE = "export function describeValue(v: unknown): string {\n  if (v && typeof v !== \"object\") return \"prim:\" + String(v);\n  return \"obj:\" + JSON.stringify(v);\n}\n";
const LEAVES = "export function leafValues(v: unknown, out: unknown[] = []): unknown[] {\n  if (typeof v !== \"object\" && v) { out.push(v); return out; }\n  if (v) for (const k of Object.keys(v)) leafValues((v as Record<string, unknown>)[k], out);\n  return out;\n}\n";
const SETTINGS = "export function withDefaults(user: Record<string, unknown>, defaults: Record<string, unknown>): Record<string, unknown> {\n  const out: Record<string, unknown> = Object.assign({}, user);\n  for (const k in defaults) if (!(k in out)) out[k] = defaults[k];\n  return out;\n}\n";
const OPTIONS = "export function buildOptions(base: object, patch: object): Record<string, unknown> {\n  return Object.assign({}, base, patch) as Record<string, unknown>;\n}\n";
// depth 2: entry -> factory -> worker, and a plain call chain; the fault is two calls below the named entry
const FACTORY = "export const clampAll = createClamp(10);\nexport function createClamp(hi: number) {\n  return (xs: number[]) => xs.map((x) => clampOne(x, hi));\n}\nfunction clampOne(x: number, hi: number): number {\n  return x < hi ? x : hi - 1;\n}\n";
const CHAIN = "export function total(xs: number[]): number {\n  return sumFrom(xs, 0);\n}\nfunction sumFrom(xs: number[], start: number): number {\n  return addUp(xs, start);\n}\nfunction addUp(xs: number[], i: number): number {\n  let s = 0;\n  for (let k = i + 1; k < xs.length; k++) s += xs[k]!;\n  return s;\n}\n";
const CHAIN3 = "export function outer(x: number): number {\n  return lvl1(x);\n}\nfunction lvl1(x: number): number { return lvl2(x); }\nfunction lvl2(x: number): number { return lvl3(x); }\nfunction lvl3(x: number): number { return x > 1 ? x : 0; }\n";
// file-name focus: a method many files define; the faulty one is in the file the request names
const SCHEMA = (name: string, bug: boolean) => `export class ${name}Schema {\n  checks: string[] = ["required"];\n  optional(): this {\n    ${bug ? "" : "this.checks = "}this.checks.filter((c) => c !== "required");\n    return this;\n  }\n}\n`;
const SCHEMA_FILES = (): Record<string, string> => {
  const f: Record<string, string> = {};
  for (const n of ["array", "boolean", "date", "mixed", "number", "object"]) f[`src/${n}.ts`] = SCHEMA(n[0]!.toUpperCase() + n.slice(1), false);
  f["src/text.ts"] = SCHEMA("Text", true);
  return f;
};
const DRIVER = (name: string, bug: boolean) => `export class ${name}Driver {\n  open = 1;\n  release(): number {\n    ${bug ? "if (this.open > 1)" : "if (this.open > 0)"} this.open = this.open - 1;\n    return this.open;\n  }\n}\n`;
const DRIVER_FILES = (): Record<string, string> => {
  const f: Record<string, string> = {};
  for (const n of ["cockroach", "duck", "firebird", "maria", "mssql", "mysql"]) f[`src/drivers/${n}.ts`] = DRIVER(n[0]!.toUpperCase() + n.slice(1), false);
  f["src/drivers/postgres.ts"] = DRIVER("Postgres", true);
  return f;
};

export const CASES: Case[] = [
  // ---- discarded-result
  {
    id: "discarded-result admit (class method on a this.field array): `this.items.filter(..)` whose result is dropped is assigned back",
    run(l, ctx) {
      const checks: Check[] = [(x) => JSON.stringify(x.ids(new x.Registry().add(1).add(2).remove(1))) === "[2]", (x) => JSON.stringify(x.ids(new x.Registry().add(3).remove(9))) === "[3]"];
      admits(l, ctx, { "src/registry.ts": REGISTRY }, "`Registry.remove(1)` leaves the item in `items`: removing an id must drop it.", "src/registry.ts", checks, /this\.items = this\.items\.filter/);
    },
  },
  {
    id: "discarded-result admit (a let-bound string in a plain function): `tag.trim();` becomes `tag = tag.trim();`",
    run(l, ctx) {
      const checks: Check[] = [(x) => x.normalizeTag("  Foo ") === "foo", (x) => x.normalizeTag("bar") === "bar"];
      admits(l, ctx, { "src/tags.ts": TAGS }, "`normalizeTag('  Foo ')` keeps the spaces; it must trim them.", "src/tags.ts", checks, /tag = tag\.trim\(\)/);
    },
  },
  {
    id: "discarded-result near misses: a used result, a returned call, a mutating method, an optional call, a non-ref receiver, a const or import binding",
    run(l) {
      none(l, "discarded-result", ["function f(xs: number[]) { const y = xs.filter(Boolean); return y; }", "function f(xs: number[]) { return xs.filter(Boolean); }"]); // dr-statement
      none(l, "discarded-result", ["function f(xs: number[]) { let ys = xs; ys.sort(); ys.push(1); ys.reverse(); }"]); // dr-method
      none(l, "discarded-result", ["function f(xs?: number[]) { let ys = xs; ys?.filter(Boolean); }", "function f(o: { xs?: number[] }) { o.xs?.map(String); }"]); // dr-optional
      none(l, "discarded-result", ["function f(make: () => number[]) { make().filter(Boolean); }", "class A extends Array<number> { g() { this.filter(Boolean); } }", "function f(xs: string[]) { xs[0]!.trim(); }"]); // dr-ref
      none(l, "discarded-result", ["const xs = [1, 2];\nfunction f() { xs.filter(Boolean); }", "import { list } from \"./list\";\nfunction f() { list.map(String); }"]); // dr-const
      // and the admitted shape for contrast (a let binding and a property)
      assert.deepEqual(idioms(l, "function f(o: { xs: number[] }) { let ys = [1]; ys.filter(Boolean); o.xs.map(String); }").filter((m) => m.template === "discarded-result").map((m) => m.text), ["ys = ys.filter(Boolean)", "o.xs = o.xs.map(String)"]);
    },
  },
  // ---- case-predicate
  {
    id: "case-predicate admit (char classifier): `ch.toUpperCase() === ch` (true for '-' and '1') becomes `ch !== ch.toLowerCase()`",
    run(l, ctx) {
      const checks: Check[] = [(x) => x.isCapital("A") === true, (x) => x.isCapital("a") === false, (x) => x.isCapital("-") === false, (x) => x.capitals("Hi-There 2") === 2];
      admits(l, ctx, { "src/chars.ts": CAPITAL }, "`capitals('Hi-There 2')` counts `-`, space and `2` as capitals: `isCapital` must be true only for an upper-case letter.", "src/chars.ts", checks, /ch !== ch\.toLowerCase\(\)/);
    },
  },
  {
    id: "case-predicate admit (class getter on a this.field char, mirrored, ref on the left): `this.text === this.text.toLowerCase()` becomes `this.text !== this.text.toUpperCase()`",
    run(l, ctx) {
      const checks: Check[] = [(x) => new x.Glyph("a").isLower() === true, (x) => new x.Glyph("A").isLower() === false, (x) => x.lowerCount("ab-C 3") === 2];
      admits(l, ctx, { "src/word.ts": LOWERCASE }, "`lowerCount('ab-C 3')` counts `-`, space and `3`: `isLower` must be true only for a lower-case letter.", "src/word.ts", checks, /this\.text !== this\.text\.toUpperCase\(\)/);
    },
  },
  {
    id: "case-predicate near misses: loose equality, a call with arguments, a non-ref receiver, different operands",
    run(l) {
      none(l, "case-predicate", ["const f = (c: string) => c.toUpperCase() == c;", "const f = (c: string) => c.toLowerCase() != c;"]); // cp-op
      none(l, "case-predicate", ["const f = (c: any, loc: string) => c.toUpperCase(loc) === c;"]); // cp-noargs
      none(l, "case-predicate", ["const f = (next: () => string) => next().toUpperCase() === next();"]); // cp-ref
      none(l, "case-predicate", ["const f = (a: string, b: string) => a.toUpperCase() === b;", "const f = (o: { a: string; b: string }) => o.a === o.b.toLowerCase();"]); // cp-same
    },
  },
  // ---- typeof-null
  {
    id: "typeof-null admit (serializer): `v && typeof v !== \"object\"` drops 0, false and '' into the object branch; null stays primitive",
    run(l, ctx) {
      const checks: Check[] = [(x) => x.describeValue(1) === "prim:1", (x) => x.describeValue(0) === "prim:0", (x) => x.describeValue(false) === "prim:false", (x) => x.describeValue(null) === "prim:null", (x) => x.describeValue({ a: 1 }) === "obj:{\"a\":1}"];
      admits(l, ctx, { "src/describe.ts": DESCRIBE }, "`describeValue(0)` and `describeValue(false)` are treated as objects; falsy primitives must be described as primitives.", "src/describe.ts", checks, /\(v === null \|\| typeof v !== "object"\)/);
    },
  },
  {
    id: "typeof-null admit (recursive walk, operands reversed): `typeof v !== \"object\" && v` keeps falsy leaves",
    run(l, ctx) {
      const checks: Check[] = [(x) => JSON.stringify(x.leafValues({ a: 0, b: { c: false }, d: 1 })) === "[0,false,1]", (x) => JSON.stringify(x.leafValues({ a: "" })) === "[\"\"]", (x) => JSON.stringify(x.leafValues({ a: 2 })) === "[2]"];
      admits(l, ctx, { "src/walk.ts": LEAVES }, "`leafValues({ a: 0, b: { c: false } })` returns []: falsy leaves are lost.", "src/walk.ts", checks, /\(v === null \|\| typeof v !== "object"\)/);
    },
  },
  {
    id: "typeof-null near misses: ||, a non-ref operand, a typeof other than \"object\" or ===, different operands",
    run(l) {
      none(l, "typeof-null", ["const f = (v: unknown) => v || typeof v !== \"object\";"]); // tn-and
      none(l, "typeof-null", ["const f = (get: () => unknown) => get() && typeof get() !== \"object\";"]); // tn-ref
      none(l, "typeof-null", ["const f = (v: unknown) => v && typeof v !== \"string\";", "const f = (v: unknown) => v && typeof v !== \"function\";"]); // tn-object
      none(l, "typeof-null", ["const f = (v: unknown, w: unknown) => v && typeof w !== \"object\";"]); // tn-same
      none(l, "typeof-null", ["const f = (v: unknown) => v && typeof v === \"object\";"]); // === is not this shape
    },
  },
  // ---- proto-safe-copy
  {
    id: "proto-safe-copy admit (defaults merge): a JSON-parsed `__proto__` key no longer swaps the copy's prototype and hides a default",
    run(l, ctx) {
      const evil = () => JSON.parse("{\"__proto__\":{\"admin\":true},\"name\":\"x\"}");
      const checks: Check[] = [(x) => x.withDefaults(evil(), { admin: false }).admin === false, (x) => x.withDefaults({ name: "y" }, { name: "z", admin: false }).name === "y", (x) => x.withDefaults({}, { admin: false }).admin === false];
      admits(l, ctx, { "src/settings.ts": SETTINGS }, "`withDefaults(JSON.parse(input), { admin: false })` returns admin true when the input has a `__proto__` key; defaults must win.", "src/settings.ts", checks, /\(\{ \.\.\.user \}\)/);
    },
  },
  {
    id: "proto-safe-copy admit (two sources): `Object.assign({}, base, patch)` becomes `({ ...base, ...patch })`",
    run(l, ctx) {
      const checks: Check[] = [(x) => x.buildOptions({ a: 1 }, JSON.parse("{\"__proto__\":{\"polluted\":1}}")).polluted === undefined, (x) => x.buildOptions({ a: 1 }, { a: 2, b: 3 }).a === 2, (x) => x.buildOptions({ a: 1 }, {}).a === 1];
      admits(l, ctx, { "src/options.ts": OPTIONS }, "`buildOptions` lets a parsed `__proto__` key in the patch add inherited options such as `polluted`.", "src/options.ts", checks, /\(\{ \.\.\.base, \.\.\.patch \}\)/);
    },
  },
  {
    id: "proto-safe-copy near misses: another callee, a non-empty or non-literal target, no source, a spread source",
    run(l) {
      none(l, "proto-safe-copy", ["const f = (x: object) => Obj.assign({}, x);", "const f = (x: object) => Object.merge({}, x);"]); // pc-object
      none(l, "proto-safe-copy", ["const f = (x: object) => Object.assign({ a: 1 }, x);", "const f = (t: object, x: object) => Object.assign(t, x);"]); // pc-empty
      none(l, "proto-safe-copy", ["const f = () => Object.assign({});"]); // pc-sources
      none(l, "proto-safe-copy", ["const f = (xs: object[]) => Object.assign({}, ...xs);"]); // pc-spread
    },
  },
  // ---- depth-2 callees
  {
    id: "depth-2 admit (entry const -> factory -> worker): the fault two calls below the named entry is located and fixed",
    run(l, ctx) {
      const checks: Check[] = [(x) => JSON.stringify(x.clampAll([3, 12])) === "[3,10]", (x) => JSON.stringify(x.clampAll([10])) === "[10]", (x) => JSON.stringify(x.createClamp(5)([7, 2])) === "[5,2]"];
      const s = admits(l, ctx, { "src/clamp.ts": FACTORY }, "`clampAll([12])` gives 9; values above the limit must become exactly the limit.", "src/clamp.ts", checks, /function clampOne[^}]*\? x : hi(?! - 1)/);
      assert.ok(s.attempts <= 20);
    },
  },
  {
    id: "depth-2 admit (plain call chain): an off-by-one start two calls below `total` is located and fixed",
    run(l, ctx) {
      const checks: Check[] = [(x) => x.total([1, 2, 3]) === 6, (x) => x.total([5]) === 5, (x) => x.total([]) === 0];
      admits(l, ctx, { "src/sum.ts": CHAIN }, "`total([1, 2, 3])` returns 5 instead of 6.", "src/sum.ts", checks, /let k = i;|let k = i \+ 0;|let k = i - 0;/);
    },
  },
  {
    id: "depth near misses: repair-v1 stays at one level (NO_EDIT on the factory chain), and repair-v2 stops at two (no third level)",
    run(l, ctx) {
      const d = repoDir(ctx, { "src/clamp.ts": FACTORY });
      const v1 = simulate(l, d, { "src/clamp.ts": FACTORY }, "`clampAll([12])` gives 9; values above the limit must become exactly the limit.", () => 0, 1, false);
      for (const p of v1.proposals) for (const e of p) assert.ok(!/x < hi \? x : hi;|x <= hi \?/.test(e.content), "repair-v1 edited the depth-2 worker");
      const d1 = l.prop.locate(openRepo(d), { request: "`clampAll` is wrong.", failing: [] });
      assert.deepEqual(d1.map((s) => s.name), ["clampAll", "createClamp"]);
      const d3 = repoDir(ctx, { "src/deep.ts": CHAIN3 });
      const s3 = l.prop.locate(openRepo(d3), { request: "`outer(2)` is wrong.", failing: [] }, l.prop.CALLEE_DEPTH.v2);
      assert.deepEqual(s3.map((s) => `${s.name}:${s.tier}`), ["outer:0", "lvl1:1", "lvl2:2"]);
    },
  },
  // ---- file-name focus
  {
    id: "focus admit (schema classes, 7 files define the method): the file the request names (`text` -> src/text.ts) is located and fixed",
    run(l, ctx) {
      const files = SCHEMA_FILES();
      const checks: Check[] = [(x) => JSON.stringify(new x.TextSchema().optional().checks) === "[]"];
      admits(l, ctx, files, "`text().optional()` still fails for undefined: calling `optional` on the text schema does not drop the required check.", "src/text.ts", checks, /this\.checks = this\.checks\.filter/);
    },
  },
  {
    id: "focus admit (driver classes under a subdirectory): \"the Postgres driver\" points `release` at src/drivers/postgres.ts",
    run(l, ctx) {
      const files = DRIVER_FILES();
      const checks: Check[] = [(x) => new x.PostgresDriver().release() === 0];
      admits(l, ctx, files, "With the Postgres driver, `release()` never gives the connection back: after one release the count must be 0.", "src/drivers/postgres.ts", checks, /this\.open (> 0|>= 1)/);
    },
  },
  {
    id: "focus near misses: a request naming no file keeps every file in order; repair-v1 never focuses (the named file stays past its file cap)",
    run(l, ctx) {
      assert.deepEqual(l.prop.focusFiles(["src/a.ts", "src/b.ts"], l.prop.requestWords("fix `optional` please")), ["src/a.ts", "src/b.ts"]);
      assert.deepEqual(l.prop.focusFiles(["src/a.ts", "src/text.ts", "lib/text.d.ts"], l.prop.requestWords("the Text schema")), ["src/text.ts", "lib/text.d.ts"]);
      const files = SCHEMA_FILES();
      const d = repoDir(ctx, files);
      const req = "`text().optional()` still fails for undefined: calling `optional` on the text schema does not drop the required check.";
      const v1 = l.prop.locate(openRepo(d), { request: req, failing: [] });
      assert.ok(!v1.some((s) => s.path === "src/text.ts"), "repair-v1 focused on the named file");
      const v2 = l.prop.locate(openRepo(d), { request: req, failing: [] }, l.prop.CALLEE_DEPTH.v2);
      assert.deepEqual([...new Set(v2.map((s) => s.path))], ["src/text.ts"]);
    },
  },
  // ---- v1 unchanged
  {
    id: "idioms are repair-v2 only: repair-v1's candidate list (which model-v1 ranks) never holds an idiom candidate and keeps its order",
    run(l) {
      const text = REGISTRY + CAPITAL + DESCRIBE + SETTINGS;
      const site = { path: "src/all.ts", name: "all", start: 0, end: text.length, tier: 0 };
      const files = new Map([["src/all.ts", text]]);
      const v1 = l.prop.repairCandidates([site], files);
      assert.ok(v1.length > 0);
      for (const c of v1) assert.ok((l.prop.TEMPLATES as readonly string[]).includes(c.muts[0]!.template), `v1 got ${c.muts[0]!.template}`);
      const v2 = l.prop.repairCandidates([site], files, new Set(), true);
      // Later idioms (own-keys and the forms after it) are not in these first four. undefined-keeps-key has no site here.
      assert.deepEqual([...new Set(v2.slice(0, 4).map((c) => c.muts[0]!.template))].sort(), ["case-predicate", "discarded-result", "proto-safe-copy", "typeof-null"]);
      assert.equal(l.prop.repairProposer().name, "repair-v1");
      assert.equal(l.prop.repairProposer({ v2: true }).name, "repair-v2");
    },
  },
];
