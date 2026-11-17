// gte and pull, plus the zipObjectDeep prototype asserts the published spec misses.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { practiceSandboxReady, runInPracticeSandbox, visibleNodeBin } from "../lib/practicemine.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { scaffoldPlan } from "../lib/testspec.ts";

const PATTERN = "^src/.+\\.ts$";
const root = resolve(import.meta.dirname, "../..");
const fixture = resolve(import.meta.dirname, "fixtures/m251");
const pins = JSON.parse(readFileSync(resolve(import.meta.dirname, "m251-pins.json"), "utf8")) as { path: string; sha256: string; fixture: string }[];
const zipPins = JSON.parse(readFileSync(resolve(import.meta.dirname, "m250-pins.json"), "utf8")) as { path: string; sha256: string; fixture: string }[];

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
function pinned(rel: string): string {
  return readFileSync(join(fixture, `${rel}.txt`), "utf8");
}
function zipPinned(rel: string): string {
  return readFileSync(resolve(root, "peaceai/test/fixtures/m250", `${rel}.txt`), "utf8");
}

const SHIM = [
  "function same(left, right) {",
  "  if (Object.is(left, right)) return true;",
  "  if (Array.isArray(left) && Array.isArray(right) && left.length === right.length) {",
  "    for (let i = 0; i < left.length; i++) if (!same(left[i], right[i]) || Object.prototype.hasOwnProperty.call(left, i) !== Object.prototype.hasOwnProperty.call(right, i)) return false;",
  "    return true;",
  "  }",
  "  if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {",
  "    const keys = Reflect.ownKeys(left);",
  "    return keys.length === Reflect.ownKeys(right).length && keys.every((key) => same(left[key], right[key]));",
  "  }",
  "  return false;",
  "}",
  "export function expect(actual) {",
  "  const api = {",
  "    toBe(expected) { if (!Object.is(actual, expected)) throw new Error(String(actual) + ' !== ' + String(expected)); return api; },",
  "    toEqual(expected) { if (!same(actual, expected)) throw new Error('not equal'); return api; },",
  "    toStrictEqual(expected) { if (!same(actual, expected)) throw new Error('not strict'); return api; },",
  "    toBeTruthy() { if (!actual) throw new Error('not truthy'); return api; },",
  "    toBeFalsy() { if (actual) throw new Error('not falsy'); return api; },",
  "    toThrow(err) { let threw; try { actual(); } catch (e) { threw = e; } if (!threw) throw new Error('did not throw'); if (err && !(threw instanceof err)) throw new Error('wrong throw'); return api; },",
  "    not: { toThrow() { try { actual(); } catch (e) { throw new Error('threw'); } return api; }, toBe() { return api; } },",
  "  };",
  "  return api;",
  "}",
  "export function test(_name, fn) { fn(); }",
  "export function it(_name, fn) { fn(); }",
  "export function describe(_name, fn) { fn(); }",
  "",
].join("\n");

function transpile(rel: string, text: string): string {
  const depth = rel.split("/").length - 1;
  const shim = `${"../".repeat(depth)}shim.mjs`;
  return ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: rel,
  }).outputText
    .replaceAll("from 'vitest'", `from '${shim}'`)
    .replaceAll('from "vitest"', `from "${shim}"`)
    .replace(/from (['"])(\.[^'"]+?)(?:\.ts)?\1/g, (_m, q: string, spec: string) => spec.endsWith(".mjs") ? `from ${q}${spec}${q}` : `from ${q}${spec}.mjs${q}`);
}

function runBoxed(files: Record<string, string>, entry: string): { code: number | null; stdout: string } {
  const node = visibleNodeBin();
  assert.ok(node);
  const dir = mkdtempSync(join(tmpdir(), "peaceai-m251-"));
  try {
    for (const [name, text] of Object.entries(files)) {
      const path = join(dir, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    }
    const ran = runInPracticeSandbox(dir, [node!, entry], 20_000, { capture: true, nodePath: node });
    assert.equal(ran.unsafe, false, ran.stdout);
    return { code: ran.code, stdout: ran.stdout };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function tree(rows: { path: string }[], read: (rel: string) => string): Record<string, string> {
  const files: Record<string, string> = { "shim.mjs": SHIM };
  for (const row of rows) {
    if (!row.path.endsWith(".ts")) continue;
    files[row.path.replace(/\.ts$/, ".mjs")] = transpile(row.path, read(row.path));
  }
  return files;
}

function admit(specFile: string, spec: string, moduleFile: string) {
  return scaffoldPlan(specFile, spec, `Cannot find module '/work/${moduleFile}'`, PATTERN, [], () => null);
}

test("the m251 pins match the copied bytes", () => {
  for (const row of pins) assert.equal(sha256(pinned(row.path)), row.sha256, row.path);
});

test("gte and pull are admitted", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed on this host"); return; }
  const cases = [
    { spec: "compat/util/gte.spec.ts", source: "compat/util/gte.ts", symbol: "gte", shape: "gte", body: "a >= b" },
    { spec: "compat/array/pull.spec.ts", source: "compat/array/pull.ts", symbol: "pull", shape: "pull", body: "hasOwnProperty" },
  ];
  const base = tree(pins, pinned);
  for (const row of cases) {
    const spec = pinned(row.spec);
    const source = pinned(row.source);
    const entry = row.spec.replace(/\.ts$/, ".mjs");
    const impl = row.source.replace(/\.ts$/, ".mjs");
    const missing = `export function ${row.symbol}(..._args) {\n  throw new Error("missing");\n}\n`;
    const before = runBoxed({ ...base, [impl]: missing }, entry);
    assert.notEqual(before.code, 0, row.symbol);
    const after = runBoxed({ ...base, [impl]: transpile(row.source, source) }, entry);
    assert.equal(after.code, 0, `${row.symbol}\n${after.stdout}`);
    const plan = admit(`src/${row.spec}`, spec, `src/${row.source}`);
    assert.equal(plan?.ok, true, row.symbol);
    if (!plan?.ok) continue;
    assert.equal(plan.fit.shape, row.shape, row.symbol);
    assert.ok(plan.files[0]!.content.includes(row.body), row.symbol);
    const built = runBoxed({ ...base, [impl]: transpile(row.source, plan.files[0]!.content) }, entry);
    assert.equal(built.code, 0, `${row.symbol} scaffold\n${built.stdout}`);
  }
});

const KILLS = [
  { guard: "gte-guard:fit", file: "src/gfit2.spec.ts", spec: "import { gfit2 } from './gfit2';\nexpect(gfit2(3, 1)).toBe(true);\nexpect(gfit2(3, 3)).toBe(false);\nexpect(gfit2('def', 'abc')).toBe(false);\n", body: "a >= b" },
  { guard: "gte-guard:text", file: "src/gtext2.spec.ts", spec: "import { gtext2 } from './gtext2';\nexpect(gtext2(3, 3)).toBe(true);\nexpect(gtext2(1, 3)).toBe(false);\nexpect(gtext2(true, false)).toBe(true);\n", body: "a >= b" },
  { guard: "pul-guard:fit", file: "src/pfit.spec.ts", spec: "import { pfit } from './pfit';\nexpect(pfit(null, 1)).toBe(0);\nexpect(pfit(undefined, 1)).toBe(undefined);\n", body: "hasOwnProperty" },
  { guard: "pul-guard:nullish", file: "src/pnil.spec.ts", spec: "import { pnil } from './pnil';\nexpect(pnil(null, 1)).toBe(null);\nexpect(pnil(1, 2)).toBe(1);\n", body: "hasOwnProperty" },
];

test("a near-miss each adversarial guard names is refused", () => {
  for (const row of KILLS) assert.equal(admit(row.file, row.spec, row.file.replace(/\.spec\.ts$/, ".ts"))?.ok, false, row.guard);
});

const base = resolve(root, "peaceai/test/.m251-mutants");
mkdirSync(base, { recursive: true });
let n = 0;
async function mutant(guard: string) {
  const text = readFileSync(resolve(root, "peaceai/lib/testspec.ts"), "utf8");
  const lines = text.split("\n");
  const hits = lines.flatMap((line, i) => (line.includes(`// ${guard}`) ? [i] : []));
  assert.equal(hits.length, 1, guard);
  const next = lines.filter((_, i) => i !== hits[0]).join("\n").replace(/from "\.\/([A-Za-z0-9-]+\.ts)"/g, (_m, file: string) => `from ${JSON.stringify(pathToFileURL(resolve(root, "peaceai/lib", file)).href)}`);
  const file = join(base, `mutant-${n++}.ts`);
  writeFileSync(file, next);
  return import(`${pathToFileURL(file).href}?m=${n}`);
}

test("deleting an adversarial guard admits the case it refused", async () => {
  try {
    for (const row of KILLS) {
      const mod = await mutant(row.guard) as typeof import("../lib/testspec.ts");
      const plan = mod.scaffoldPlan(row.file, row.spec, `Cannot find module '/work/${row.file.replace(/\.spec\.ts$/, ".ts")}'`, PATTERN, [], () => null);
      assert.equal(plan?.ok, true, row.guard);
      if (plan?.ok) assert.ok(plan.files[0]!.content.includes(row.body), row.guard);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("zipObjectDeep does not retarget [[Prototype]] or write through a.__proto__.b", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed on this host"); return; }
  const spec = zipPinned("compat/array/zipObjectDeep.spec.ts");
  const plan = admit("src/compat/array/zipObjectDeep.spec.ts", spec, "src/compat/array/zipObjectDeep.ts");
  assert.equal(plan?.ok, true);
  if (!plan?.ok) return;
  const files = tree(zipPins, zipPinned);
  files["scaffold/zipObjectDeep.mjs"] = transpile("zipObjectDeep.ts", plan.files[0]!.content);
  const script = [
    "import { zipObjectDeep } from './compat/array/zipObjectDeep.mjs';",
    "import { zipObjectDeep as szip } from './scaffold/zipObjectDeep.mjs';",
    "let bad = 0;",
    "const say = (name, a, b) => { bad++; console.log('FAIL', name, a, b); };",
    "const value = { polluted: true };",
    "const pub = zipObjectDeep(['__proto__'], [value]);",
    "const ours = szip(['__proto__'], [value]);",
    "if (Object.getPrototypeOf(pub) !== Object.prototype) say('pub prototype', Object.getPrototypeOf(pub), Object.prototype);",
    "if (Object.getPrototypeOf(ours) !== Object.prototype) say('scaffold prototype', Object.getPrototypeOf(ours), Object.prototype);",
    "if (pub.polluted !== undefined || ours.polluted !== undefined) say('inherited polluted', pub.polluted, ours.polluted);",
    "const before = Object.prototype.b;",
    "zipObjectDeep(['a.__proto__.b'], [1]);",
    "szip(['a.__proto__.b'], [1]);",
    "if (Object.prototype.b !== before) { say('Object.prototype.b', Object.prototype.b, before); delete Object.prototype.b; }",
    "if (bad) process.exit(1);",
    "console.log('proto ok');",
    "",
  ].join("\n");
  const ran = runBoxed({ ...files, "proto.mjs": script }, "proto.mjs");
  assert.equal(ran.code, 0, ran.stdout);
});

test("gte and pull match the published pin on adversarial values", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed on this host"); return; }
  const gtePlan = admit("src/compat/util/gte.spec.ts", pinned("compat/util/gte.spec.ts"), "src/compat/util/gte.ts");
  const pullPlan = admit("src/compat/array/pull.spec.ts", pinned("compat/array/pull.spec.ts"), "src/compat/array/pull.ts");
  assert.equal(gtePlan?.ok, true);
  assert.equal(pullPlan?.ok, true);
  if (!gtePlan?.ok || !pullPlan?.ok) return;
  const files = tree(pins, pinned);
  files["scaffold/gte.mjs"] = transpile("gte.ts", gtePlan.files[0]!.content);
  files["scaffold/pull.mjs"] = transpile("pull.ts", pullPlan.files[0]!.content);
  const script = [
    "import { gte } from './compat/util/gte.mjs';",
    "import { pull } from './compat/array/pull.mjs';",
    "import { gte as sgte } from './scaffold/gte.mjs';",
    "import { pull as spull } from './scaffold/pull.mjs';",
    "let bad = 0;",
    "const say = (...xs) => { bad++; console.log('FAIL', ...xs); };",
    "const same = (l, r) => {",
    "  if (Object.is(l, r)) return true;",
    "  if (Array.isArray(l) && Array.isArray(r) && l.length === r.length) {",
    "    for (let i = 0; i < l.length; i++) if (Object.prototype.hasOwnProperty.call(l, i) !== Object.prototype.hasOwnProperty.call(r, i) || !same(l[i], r[i])) return false;",
    "    return true;",
    "  }",
    "  return false;",
    "};",
    "const check = (name, pub, ours) => { let pe, oe, pv, ov; try { pv = pub(); } catch (e) { pe = e; } try { ov = ours(); } catch (e) { oe = e; } if (pe || oe) { if (!pe || !oe || pe.name !== oe.name) say(name, pe && pe.name, oe && oe.name); return; } if (!same(pv, ov)) say(name, pv, ov); };",
    "const sym = Symbol('x');",
    "const vo = { valueOf() { return 5; } };",
    "const ts = { toString() { return '8'; } };",
    "for (const [n, a, b] of [['eq', 3, 3], ['lex', '10', '9'], ['words', 'def', 'def'], ['mix', '6', 4], ['junk', 'x', 1], ['vo', vo, 5], ['ts', ts, 8], ['sym', sym, 1], ['boxed', Object(sym), 0], ['null', null, 0], ['und', undefined, 1], ['bool', false, false], ['bi', 1n, 1], ['n0', -0, 0]]) {",
    "  check('gte ' + n, () => gte(a, b), () => sgte(a, b));",
    "}",
    "function copy(v) { if (!Array.isArray(v)) return v; const a = v.slice(); for (let i = 0; i < v.length; i++) if (!Object.prototype.hasOwnProperty.call(v, i)) delete a[i]; return a; }",
    "function both(name, value, ...rest) {",
    "  const left = copy(value), right = copy(value);",
    "  check(name, () => pull(left, ...rest), () => spull(right, ...rest));",
    "  check(name + ' array', () => left, () => right);",
    "}",
    "both('null', null, 1);",
    "both('und', undefined, 1);",
    "both('nums', [1, 2, 1, 3], 1, 3);",
    "both('nan', [1, NaN, 2, NaN], NaN);",
    "both('zero', [0, 1, -0], -0);",
    "both('hole', [1, , 2], undefined);",
    "both('sym', [sym, 1, sym], sym);",
    "both('bi', [1n, 2n, 1n], 1n);",
    "both('bare', { a: 1 }, 1);",
    "const before = Object.prototype.b;",
    "spull(['__proto__', 'b'], '__proto__');",
    "if (Object.prototype.b !== before) { say('pull proto', Object.prototype.b); delete Object.prototype.b; }",
    "if (bad) process.exit(1);",
    "console.log('adv ok');",
    "",
  ].join("\n");
  const ran = runBoxed({ ...files, "adv.mjs": script }, "adv.mjs");
  assert.equal(ran.code, 0, ran.stdout);
});

test("a near-miss that the published calls accept is verified_test_only", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed on this host"); return; }
  const nodePath = visibleNodeBin();
  if (!nodePath) { t.skip("no visible node"); return; }
  const rows = [
    {
      symbol: "gte", file: "src/compat/util/gte.ts",
      candidate: "export function gte(a: unknown, b: unknown): boolean { return (a as number) > (b as number); }\n",
      args: [[3, 3], [1, 3]],
      deps: ["compat/util/toNumber.ts", "compat/predicate/isSymbol.ts"],
    },
    {
      symbol: "pull", file: "src/compat/array/pull.ts",
      candidate: "export function pull(a: unknown): unknown { return a; }\n",
      args: [[null, 1], [[1, 2, 3], 2]],
      deps: ["compat/_internal/basePull.ts", "compat/_internal/hasOwn.ts"],
    },
  ];
  const trees: string[] = [];
  try {
    for (const row of rows) {
      const make = (text: string) => {
        const dir = mkdtempSync(join(tmpdir(), "peaceai-m251-grade-"));
        mkdirSync(join(dir, row.file, ".."), { recursive: true });
        writeFileSync(join(dir, row.file), text);
        for (const dep of row.deps) {
          const path = join(dir, "src", dep);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, pinned(dep));
        }
        trees.push(dir);
        return dir;
      };
      const grade = gradeBehavior({
        candidateRoot: make(row.candidate), fixRoot: make(pinned(row.file.slice("src/".length))), nodePath,
        target: { symbol: row.symbol, file: row.file, form: "named", exportName: row.symbol, args: row.args },
      });
      assert.equal(grade.behavior, "verified_test_only", `${row.symbol} ${grade.behavior}`);
    }
  } finally {
    for (const dir of trees) rmSync(dir, { recursive: true, force: true });
  }
});
