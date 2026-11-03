// M172 behavior cases (batch 11), as data so m172-mutation.test.ts can replay them against each mutant of
// peaceai/lib/loopdeps.ts / looprow.ts / loop.ts / editpropose.ts. Each case throws (node:assert) on failure; every
// admitted condition has at least two different code shapes and every m172 guard has a refused near miss.
//  - the mocha runner: PeaceAI reads the mocha command from the package's own scripts, passes on an allowlist of its
//    options, and the shim runs mocha (no config file read) with its JSON reporter written to a file;
//  - repair-v2 localisation: same-file functions passed as call arguments, and functions imported from a relative
//    module (one level), are located below the named entry point;
//  - repair-v2 idiom undefined-keeps-key.
// Synthetic fixtures only (stub runners; no network; no PeaceSTOCKS shape). Disclosure (batch 11 fix, Auditor B3): the
// undefined-keeps-key idiom was derived AFTER looking at the superstruct-coerce-undefined dev failure and its upstream
// fix (superstruct PR 1126), so no superstruct result may be credited to it. Its admitting shapes below (a patch loop,
// a property sanitizer, a form-title trim behind an import) are unrelated to that task's code; the earlier fixture that
// mirrored it (create -> check -> coerceAll over a value's keys) was removed.
// The repair cases use an in-process oracle (the edited module is transpiled and called), as in m168-cases.ts.
// Spec: peaceai/spec/loop-runners-v3.md and peaceai/spec/repair-v2-m172.md.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { openRepo } from "../lib/codesearch.ts";
import type * as Deps from "../lib/loopdeps.ts";
import type * as Loop from "../lib/loop.ts";
import type * as Row from "../lib/looprow.ts";
import type * as Prop from "../lib/editpropose.ts";
import { ADD_FIXED, MIT, pkgJson, plain, repo, STUB_PM, type Ctx } from "./m151-fixtures.ts";

export interface Libs { deps: typeof Deps; loop: typeof Loop; row: typeof Row; prop: typeof Prop }
export interface Case { id: string; needsCand?: string; run: (l: Libs, ctx: Ctx) => void }
const CAND_SKIP = "needs the stage-2 candidate uid and sudo (box / private job): a real install and run as that uid";

let n = 0;
const dir = (ctx: Ctx, name: string) => join(ctx.base, "m172", `${name}-${n++}`);

// ---------------------------------------------------------------------------------------------------------------
// mocha

/** A stub mocha CLI: records its argv in $TMPDIR/m172-argv.json; honours --require (relative or a package), --ui
 * (bdd: it/describe, tdd: test/suite); writes the json reporter's report only for `--reporter json --reporter-option
 * output=FILE`; M172_STUB_MOCHA=nostats writes a report with no stats, =pending one with a pending test, =mismatch one whose
 * test count is not passes + failures. Its lib/ has a runnable.js / pending.js for PeaceAI's pending guard. Exit code:
 * the failure count. */
export const STUB_MOCHA_CLI = [
  'import { writeFileSync } from "node:fs";',
  'import { createRequire } from "node:module";',
  'import { join, resolve } from "node:path";',
  'import { pathToFileURL } from "node:url";',
  "const args = process.argv.slice(2);",
  'writeFileSync(join(process.env.TMPDIR, "m172-argv.json"), JSON.stringify(args));',
  "let reporter = null, output = null; const requires = [], files = [];",
  "for (let i = 0; i < args.length; i++) {",
  "  const a = args[i];",
  '  if (a === "--require" || a === "-r") requires.push(args[++i]);',
  '  else if (a === "--reporter") reporter = args[++i];',
  '  else if (a === "--reporter-option" && args[i + 1].startsWith("output=")) output = args[++i].slice(7);',
  '  else if (a === "--ui" || a === "--timeout" || a === "--extension") i++;',
  '  else if (!a.startsWith("-")) files.push(a);',
  "}",
  "const tests = [];",
  "globalThis.it = globalThis.test = (name, fn) => tests.push(fn);",
  "globalThis.describe = globalThis.suite = (name, fn) => fn();",
  "for (const r of requires) await import(r.startsWith(\"./\") ? pathToFileURL(resolve(r)).href : pathToFileURL(createRequire(join(process.cwd(), \"x.js\")).resolve(r)).href);",
  "let passes = 0, failures = 0;",
  "for (const f of files) {",
  "  try { await import(pathToFileURL(resolve(f)).href); } catch { failures++; tests.length = 0; continue; }",
  "  for (const fn of tests.splice(0)) { try { await fn(); passes++; } catch { failures++; } }",
  "}",
  'const mode = process.env.M172_STUB_MOCHA;',
  'const rep = mode === "nostats" ? { tests: [] } : { stats: { passes, failures, pending: mode === "pending" ? 1 : 0, tests: passes + failures + (mode === "mismatch" ? 1 : 0) }, tests: [] };',
  'if (reporter === "json" && output) writeFileSync(output, JSON.stringify(rep)); else process.stdout.write(JSON.stringify(rep));',
  "process.exit(failures);",
  "",
].join("\n");

export function stubMocha(at: string, version = "10.2.0"): string {
  mkdirSync(join(at, "bin"), { recursive: true });
  writeFileSync(join(at, "package.json"), JSON.stringify({ name: "mocha", version, type: "module", bin: { mocha: "./bin/mocha.js", _mocha: "./bin/_mocha" } }));
  writeFileSync(join(at, "bin/mocha.js"), STUB_MOCHA_CLI);
  mkdirSync(join(at, "lib"), { recursive: true });
  writeFileSync(join(at, "lib/package.json"), JSON.stringify({ type: "commonjs" }));
  writeFileSync(join(at, "lib/runnable.js"), "function Runnable() {}\nRunnable.prototype.run = function (fn) { fn(); };\nmodule.exports = Runnable;\n");
  writeFileSync(join(at, "lib/pending.js"), "function Pending(m) { this.message = m; }\nmodule.exports = Pending;\n");
  return at;
}

const OK = 'it("a", () => {});\n';
const ONE_FAIL = 'it("a", () => {});\nit("b", () => { throw new Error("x"); });\n';
const TWO_FAIL = 'it("a", () => {});\nit("b", () => { throw new Error("x"); });\nit("c", () => { throw new Error("y"); });\n';
const REG_CHECK = 'it("registered", () => { if (globalThis.M172_REG !== 1) throw new Error("hook not loaded"); });\n';
const REG = "globalThis.M172_REG = 1;\n";
const PASS1 = "# pass 1\n# fail 0";
const FAIL1 = "# pass 1\n# fail 1";
const NONE = "# pass 0\n# fail 1";

/** Runs the shim directly in a fixture dir with the stub mocha; `args` are what follows the runner and pkgDir. */
function shimRun(l: Libs, ctx: Ctx, files: Record<string, string>, args: string[], o: { mode?: "nostats" | "pending" | "mismatch" } = {}) {
  const d = plain(dir(ctx, "shim"), { "package.json": pkgJson({ test: "mocha" }, { mocha: "10.2.0" }), ...files });
  stubMocha(join(d, "node_modules/mocha"));
  l.deps.installShim(d);
  const tmp = join(d, ".tmp");
  mkdirSync(tmp);
  const r = spawnSync(process.execPath, [l.deps.SHIM_PATH, "mocha", "", ...args], { cwd: d, encoding: "utf8", env: { PATH: process.env.PATH, TMPDIR: tmp, ...(o.mode ? { M172_STUB_MOCHA: o.mode } : {}) }, timeout: 60_000 });
  const rec = join(tmp, "m172-argv.json");
  return { tail: (r.stdout ?? "").trimEnd().split("\n").slice(-2).join("\n"), argv: existsSync(rec) ? JSON.parse(readFileSync(rec, "utf8")) as string[] : null, tmp, dir: d, status: r.status };
}
/** detectRunner on a fixture: the package.json (scripts, devDependencies) plus extra files. */
function detect(l: Libs, ctx: Ctx, scripts: Record<string, string>, extra: Record<string, string> = {}, devDeps: Record<string, string> = { mocha: "10.2.0" }) {
  const d = plain(dir(ctx, "det"), { "package.json": pkgJson(scripts, devDeps), "test/a.test.js": OK, "test/setup.cjs": REG, ...extra });
  return l.deps.detectRunner(d, ["test/a.test.js"]);
}
const REFUSED = { refuse: "TEST_RUNNER_UNSUPPORTED" };
const options = (r: ReturnType<typeof detect>) => { assert.ok(!("refuse" in r), `refused: ${JSON.stringify(r)}`); assert.equal((r as Deps.RunnerPick).runner, "mocha"); return (r as Deps.RunnerPick).options; };

// ---------------------------------------------------------------------------------------------------------------
// repair-v2 (in-process oracle, as in m168-cases.ts)

function repoDir(ctx: Ctx, files: Record<string, string>): string {
  const d = dir(ctx, "r");
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), c); }
  return d;
}
const tsFiles = (d: string, files: Record<string, string>) => Object.keys(files).filter((p) => /\.tsx?$/.test(p)).sort().map((p) => ({ path: p, content: readFileSync(join(d, p), "utf8") }));
function load(m: ReadonlyMap<string, string>, path: string, seen = new Map<string, Record<string, unknown>>()): Record<string, unknown> {
  if (seen.has(path)) return seen.get(path)!;
  const js = ts.transpileModule(m.get(path)!, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  seen.set(path, mod.exports);
  const req = (spec: string) => {
    const want = join(dirname(path), spec).replace(/\.js$/, "");
    const hit = [...m.keys()].find((k) => k.replace(/\.ts$/, "") === want);
    if (!hit) throw new Error(`no module ${spec}`);
    return load(m, hit, seen);
  };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: req }, { timeout: 1000 });
  return mod.exports;
}
type Check = (x: Record<string, any>) => boolean;
const oracle = (path: string, checks: readonly Check[]) => (m: ReadonlyMap<string, string>): number => {
  let x: Record<string, any>;
  try { x = load(m, path); } catch { return 0; }
  let ok = 0;
  for (const c of checks) { try { if (c(x)) ok++; } catch { /* a failing test */ } }
  return ok;
};
interface Sim { proposals: Prop.RepairEdit[][]; result: "pass" | "NO_EDIT" | "NO_MORE_EDITS" | "limit"; attempts: number }
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
function admits(l: Libs, ctx: Ctx, files: Record<string, string>, request: string, path: string, checks: Check[], expect: RegExp, editPath?: string): Sim {
  const d = repoDir(ctx, files);
  const t = oracle(path, checks);
  assert.ok(t(new Map(Object.entries(files))) < checks.length, "the fixture is not broken");
  const s = simulate(l, d, files, request, t, checks.length);
  assert.equal(s.result, "pass", `repair-v2 did not pass: ${s.result} after ${s.attempts}`);
  const last = s.proposals.at(-1)!;
  if (editPath) assert.deepEqual(last.map((e) => e.path), [editPath]);
  assert.match(last.map((e) => e.content).join("\n"), expect);
  return s;
}
function idioms(l: Libs, text: string): { template: string; text: string }[] {
  const site = { path: "src/x.ts", name: "x", start: 0, end: text.length, tier: 0 };
  return l.prop.idiomMutationsIn(l.prop.parseSource("src/x.ts", text), site, 0).map((m) => ({ template: m.template, text: m.text }));
}
const located = (l: Libs, files: Record<string, string>, ctx: Ctx, request: string, v2 = true) =>
  l.prop.locate(openRepo(repoDir(ctx, files)), { request, failing: [] }, v2 ? l.prop.CALLEE_DEPTH.v2 : l.prop.CALLEE_DEPTH.v1).map((s) => `${s.path}#${s.name}:${s.tier}`);

// fixtures (synthetic)
const DEFAULTS = "export function applyPatch(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {\n  for (const k of Object.keys(patch)) {\n    const v = patch[k];\n    if (v !== undefined) target[k] = v;\n  }\n  return target;\n}\n";
const SANITIZE = "export function sanitize(box: { width?: number }): { width?: number } {\n  const w = clean(box.width);\n  if (w != undefined) {\n    box.width = w;\n  }\n  return box;\n}\nfunction clean(x: number | undefined): number | undefined {\n  return typeof x === \"number\" && x >= 0 ? x : undefined;\n}\n";
const DISPATCH = "export function total(xs: number[]): number {\n  return apply(addUp, xs, 0);\n}\nfunction apply(f: (xs: number[], i: number) => number, xs: number[], i: number): number {\n  return f(xs, i);\n}\nfunction addUp(xs: number[], i: number): number {\n  let s = 0;\n  for (let k = i + 1; k < xs.length; k++) s += xs[k]!;\n  return s;\n}\n";
const MAPPED = "export function capAll(xs: number[]): number[] {\n  return xs.map(capOne);\n}\nfunction capOne(x: number): number {\n  return x < 10 ? x : 10 - 1;\n}\n";
const MAPPED_ALIAS = "export function capAll(xs: number[]): number[] {\n  const f = capOne;\n  return xs.map((x) => f(x));\n}\nfunction capOne(x: number): number {\n  return x < 10 ? x : 10 - 1;\n}\n";
const SUM_MOD = "export function addUp(xs: number[], i: number): number {\n  let s = 0;\n  for (let k = i + 1; k < xs.length; k++) s += xs[k]!;\n  return s;\n}\n";
const API = (spec: string) => `import { addUp } from ${JSON.stringify(spec)};\nexport function total(xs: number[]): number {\n  return addUp(xs, 0);\n}\n`;
// batch 11 fix (Auditor B3): a form whose blank title must be cleared; the trim lives in a helper module reached
// through a same-file step and an aliased `.js` import from a subdirectory (property write, reversed `undefined !==`)
const TRIM_MOD = "export function trimTitle(form: { title?: string }): { title?: string } {\n  const t = typeof form.title === \"string\" && form.title.trim() !== \"\" ? form.title.trim() : undefined;\n  if (undefined !== t) form.title = t;\n  return form;\n}\n";
const FORM = "import { trimTitle as tidyTitle } from \"./text/trim.js\";\nexport function submit(form: { title?: string }): { title?: string } {\n  return prepare(form);\n}\nfunction prepare(form: { title?: string }): { title?: string } {\n  return tidyTitle(form);\n}\n";
// a second import shape: an entry in a subdirectory importing from its parent (`../lib/paging.js`), the call nested in
// an expression; the fault in the helper is a comparison off by one
const PAGING_MOD = "export function lastPage(count: number, size: number): number {\n  let pages = 0;\n  for (let seen = 0; seen <= count; seen += size) pages++;\n  return pages < 1 ? 1 : pages;\n}\n";
const PAGES = "import { lastPage } from \"../lib/paging.js\";\nexport function pageLabel(count: number, size: number): string {\n  return `of ${lastPage(count, size)}`;\n}\n";

export const CASES: Case[] = [
  // ---- mocha: detection (two shapes admitted; a near miss per guard)
  {
    id: "mocha admit (direct test script): `mocha --require ./test/setup.cjs --recursive test` gives the mocha pick with its options",
    run(l, ctx) {
      assert.deepEqual(options(detect(l, ctx, { test: "mocha --require ./test/setup.cjs --recursive test" })), ["--require", "./test/setup.cjs", "--recursive"]);
      assert.ok((l.row.LOOP_RUNNERS as readonly string[]).includes("mocha"), "a mocha row is a valid loop row");
    },
  },
  {
    id: "mocha admit (one named script down, npx, short flags and = values): `npx mocha -r ts-node/register -u tdd --timeout=5000 'x'` is normalised",
    run(l, ctx) {
      const r = detect(l, ctx, { test: "npm run build && npm run test:unit", build: "tsc", "test:unit": "npx mocha -r ts-node/register -u tdd --timeout=5000 --extension ts --exit test/**/*.ts" });
      assert.deepEqual(options(r), ["--require", "ts-node/register", "--ui", "tdd", "--timeout", "5000", "--extension", "ts", "--exit"]);
      assert.deepEqual(options(detect(l, ctx, { test: "mocha" })), [], "a bare mocha command");
    },
  },
  {
    id: "mocha near misses (m172-guard:mocha-one-command): two mocha commands, or mocha only under a wrapper (`nyc mocha`)",
    run(l, ctx) {
      assert.deepEqual(detect(l, ctx, { test: "mocha test/a && mocha test/b" }), REFUSED);
      assert.deepEqual(detect(l, ctx, { test: "nyc mocha test" }), REFUSED);
    },
  },
  {
    id: "mocha near misses (m172-guard:mocha-flag, missing value): an option off the allowlist (--grep, --file, --config), or a flag with no value",
    run(l, ctx) {
      for (const t of ["mocha --grep fast test", "mocha --file ./test/setup.cjs test", "mocha --config x.json test", "mocha test --require"]) assert.deepEqual(detect(l, ctx, { test: t }), REFUSED, t);
      // batch 11 fix (Auditor): flags that load code, change the reporter, or read a config, each refused (also as --flag=value)
      for (const t of ["mocha --loader ts-node/esm test", "mocha --loader=ts-node/esm test", "mocha --import tsx test", "mocha --import=tsx test", "mocha --node-option no-warnings test",
        "mocha -n no-warnings test", "mocha --reporter spec test", "mocha --reporter=json test", "mocha -R dot test", "mocha --reporter-option output=x.json test", "mocha --package ./other.json test",
        "mocha --package=./other.json test"]) assert.deepEqual(detect(l, ctx, { test: t }), REFUSED, t);
    },
  },
  {
    id: "mocha near misses (m172-guard:mocha-ui / mocha-timeout / mocha-extension): values off the allowlist",
    run(l, ctx) {
      assert.deepEqual(detect(l, ctx, { test: "mocha --ui chai test" }), REFUSED, "ui (a package name, not a mocha interface)");
      assert.deepEqual(detect(l, ctx, { test: "mocha --timeout 2s test" }), REFUSED, "timeout");
      assert.deepEqual(detect(l, ctx, { test: "mocha --extension ./test/setup.cjs test" }), REFUSED, "extension (a path, not an extension)");
    },
  },
  {
    id: "mocha near misses (m172-guard:mocha-require-dotdot / -file / -pkg): a `..` path or package subpath, a missing file, a symlink, an absolute path",
    run(l, ctx) {
      assert.deepEqual(detect(l, ctx, { test: "mocha --require ./../outside.cjs test" }), REFUSED, "./.. path");
      assert.deepEqual(detect(l, ctx, { test: "mocha --require pkg/../../outside test" }), REFUSED, "package subpath with ..");
      assert.deepEqual(detect(l, ctx, { test: "mocha --require ./test/missing.cjs test" }), REFUSED, "missing file");
      const d = plain(dir(ctx, "det"), { "package.json": pkgJson({ test: "mocha --require ./test/link.cjs test" }, { mocha: "10.2.0" }), "test/a.test.js": OK, "elsewhere.cjs": REG });
      symlinkSync(join(d, "elsewhere.cjs"), join(d, "test/link.cjs"));
      assert.deepEqual(l.deps.detectRunner(d, ["test/a.test.js"]), REFUSED, "a symlinked hook");
      assert.deepEqual(detect(l, ctx, { test: "mocha --require /tmp/x.cjs test" }), REFUSED, "absolute path");
    },
  },
  {
    id: "mocha --require without ./ (batch 11 fix, m172-guard:mocha-require-bare / -file): mocha loads `test/x.cjs` (or `test/x` + .js) from its cwd, so it gets the same regular-file / no-symlink check",
    run(l, ctx) {
      assert.deepEqual(options(detect(l, ctx, { test: "mocha --require test/setup.cjs test" })), ["--require", "test/setup.cjs"], "the control: a bare path to a regular file");
      assert.deepEqual(options(detect(l, ctx, { test: "mocha -r test/plain test" }, { "test/plain.js": REG })), ["--require", "test/plain"], "the control: mocha's `.js` fallback");
      const linked = (script: string, link: string, to: string, dirLink = false) => {
        const d = plain(dir(ctx, "det"), { "package.json": pkgJson({ test: script }, { mocha: "10.2.0" }), "test/a.test.js": OK, "real/setup.cjs": REG, "real/setup.js": REG });
        symlinkSync(join(d, to), join(d, link), dirLink ? "dir" : "file");
        return l.deps.detectRunner(d, ["test/a.test.js"]);
      };
      assert.deepEqual(linked("mocha --require test/link.cjs test", "test/link.cjs", "real/setup.cjs"), REFUSED, "a bare symlinked hook");
      assert.deepEqual(linked("mocha --require test/hook test", "test/hook.js", "real/setup.js"), REFUSED, "a symlinked hook reached by the .js fallback");
      assert.deepEqual(linked("mocha --require lnk/setup.cjs test", "lnk", "real", true), REFUSED, "a regular file under a symlinked directory (bare)");
      assert.deepEqual(linked("mocha --require ./lnk/setup.cjs test", "lnk", "real", true), REFUSED, "a regular file under a symlinked directory (./)");
      assert.deepEqual(detect(l, ctx, { test: "mocha --require test test" }), REFUSED, "a directory");
    },
  },
  {
    id: "mocha near misses (m172-guard:mocha-config / mocha-options, guard:runner-dep): a .mocharc file, a \"mocha\" key in package.json, refused options, no mocha dependency",
    run(l, ctx) {
      assert.deepEqual(detect(l, ctx, { test: "mocha test" }, { ".mocharc.json": "{}" }), REFUSED, ".mocharc.json");
      assert.deepEqual(detect(l, ctx, { test: "mocha test" }, { ".mocharc.yml": "spec: x\n" }), REFUSED, ".mocharc.yml");
      const d = plain(dir(ctx, "det"), { "package.json": JSON.stringify({ name: "f", scripts: { test: "mocha test" }, devDependencies: { mocha: "10.2.0" }, mocha: { require: "x" } }), "test/a.test.js": OK });
      assert.deepEqual(l.deps.detectRunner(d, ["test/a.test.js"]), REFUSED, "package.json mocha key");
      assert.deepEqual(detect(l, ctx, { test: "mocha --grep x test" }), REFUSED, "options refused");
      assert.deepEqual(detect(l, ctx, { test: "mocha test" }, {}, { vitest: "1.0.0" }), REFUSED, "no mocha dependency");
      assert.deepEqual(detect(l, ctx, { test: "ava" }, {}, { ava: "6.0.0" }), REFUSED, "ava stays unsupported");
    },
  },
  // ---- the service check stays before the runner check (m172-order:service-first; batch 10 made the order, now mocha
  // is admitted a compose file with mocha no longer shows it, so these use ava, which stays unsupported)
  {
    id: "service first (m172-order:service-first): a compose file with an unsupported runner (ava) is TEST_NEEDS_SERVICE, direct and one script down; near miss: ava alone",
    run(l, ctx) {
      assert.deepEqual(detect(l, ctx, { test: "ava" }, { "docker-compose.yml": "services: {}\n" }, { ava: "6.0.0" }), { refuse: "TEST_NEEDS_SERVICE" });
      assert.deepEqual(detect(l, ctx, { test: "npm run test:unit", "test:unit": "ava" }, { "compose.yaml": "services: {}\n" }, { ava: "6.0.0" }), { refuse: "TEST_NEEDS_SERVICE" });
      assert.deepEqual(detect(l, ctx, { test: "ava" }, {}, { ava: "6.0.0" }), REFUSED);
    },
  },
  // ---- mocha: the shim
  {
    id: "mocha shim admit: options pass through before the files; mocha reads no config; the json report's stats are the counts (bdd and a --require hook)",
    run(l, ctx) {
      const files = { "test/setup.cjs": REG, "test/a.test.js": REG_CHECK };
      const pick: Deps.RunnerPick = { runner: "mocha", pkgDir: "", files: ["test/a.test.js"], hasDeps: true, options: ["--require", "./test/setup.cjs", "--ui", "bdd"] };
      const args = l.deps.shimArgs(pick).slice(3);
      assert.deepEqual(args, ["--require", "./test/setup.cjs", "--ui", "bdd", "--", "test/a.test.js"]);
      const r = shimRun(l, ctx, files, args);
      assert.equal(r.tail, PASS1);
      assert.deepEqual(r.argv, ["--no-config", "--no-package", "--require", join(r.dir, l.deps.MOCHA_GUARD_PATH), "--require", "./test/setup.cjs", "--ui", "bdd", "--reporter", "json", "--reporter-option", `output=${join(r.tmp, "peaceai-loop-report.json")}`, "test/a.test.js"]);
      assert.deepEqual(l.deps.shimArgs({ runner: "vitest", pkgDir: "", files: ["a"], hasDeps: true }).slice(1), ["vitest", "", "a"], "other runners unchanged");
    },
  },
  {
    id: "mocha shim admit (tdd, no options, two files) and near misses: a failing test, no `--` (m172-guard:shim-mocha-sep), a report with no stats (m172-guard:shim-mocha-stats)",
    run(l, ctx) {
      const tdd = 'suite("s", () => { test("t", () => {}); });\n';
      assert.equal(shimRun(l, ctx, { "test/a.test.js": tdd, "test/b.test.js": OK }, ["--", "test/a.test.js", "test/b.test.js"]).tail, "# pass 2\n# fail 0");
      assert.equal(shimRun(l, ctx, { "test/a.test.js": ONE_FAIL }, ["--", "test/a.test.js"]).tail, FAIL1);
      const nosep = shimRun(l, ctx, { "test/a.test.js": OK }, ["test/a.test.js"]);
      assert.deepEqual([nosep.tail, nosep.argv], [NONE, null], "no options separator: mocha is not run");
      assert.equal(shimRun(l, ctx, { "test/a.test.js": OK }, ["--", "test/a.test.js"], { mode: "nostats" }).tail, NONE);
    },
  },
  {
    id: "mocha shim fail-closed (batch 11 fix, m172-guard:shim-mocha-pending / shim-mocha-total): a report with a pending test, or with tests != passes + failures, credits no pass; two failures count two",
    run(l, ctx) {
      assert.equal(shimRun(l, ctx, { "test/a.test.js": TWO_FAIL }, ["--", "test/a.test.js"]).tail, "# pass 1\n# fail 2", "two failures are two (not the pending count, not 1)");
      assert.equal(shimRun(l, ctx, { "test/a.test.js": OK }, ["--", "test/a.test.js"], { mode: "pending" }).tail, NONE, "a pending test");
      assert.equal(shimRun(l, ctx, { "test/a.test.js": ONE_FAIL }, ["--", "test/a.test.js"], { mode: "pending" }).tail, "# pass 0\n# fail 1", "a pending test with a failure");
      assert.equal(shimRun(l, ctx, { "test/a.test.js": OK }, ["--", "test/a.test.js"], { mode: "mismatch" }).tail, NONE, "a test that neither passed nor failed");
      assert.equal(shimRun(l, ctx, { "test/a.test.js": TWO_FAIL }, ["--", "test/a.test.js"], { mode: "mismatch" }).tail, "# pass 0\n# fail 2", "a mismatch keeps the failure count");
      // M173 (batch 12 merge): those counts are made up, so the shim exits SUITE_LOAD (loopdeps SHIM_EXITS), never the
      // runner's 1 a real failing test gives; a report with no stats is NO_REPORT; a real failure stays 1, a pass 0
      const e = l.deps.SHIM_EXITS, st = (f: string, mode?: "nostats" | "pending" | "mismatch") => shimRun(l, ctx, { "test/a.test.js": f }, ["--", "test/a.test.js"], mode ? { mode } : {}).status;
      assert.deepEqual([st(OK, "pending"), st(ONE_FAIL, "pending"), st(OK, "mismatch"), st(TWO_FAIL, "mismatch")], [e.SUITE_LOAD, e.SUITE_LOAD, e.SUITE_LOAD, e.SUITE_LOAD], "pending / mismatch -> SUITE_LOAD");
      assert.deepEqual([st(OK, "nostats"), st(ONE_FAIL), st(TWO_FAIL), st(OK)], [e.NO_REPORT, 1, 1, 0], "no stats -> NO_REPORT; real failures 1; pass 0");
    },
  },
  // ---- mocha: end to end (real install as the candidate uid, stage-2 isolation)
  {
    id: "loop: a mocha task (--require hook) whose fix makes every test pass is PASS (before batch 11: TEST_RUNNER_UNSUPPORTED)",
    needsCand: CAND_SKIP,
    run(l, ctx) {
      const stub = stubMocha(join(ctx.base, "m172", `stub-mocha-${n++}`));
      const pm = join(ctx.base, "m172", `stub-pm-${n++}.mjs`);
      writeFileSync(pm, STUB_PM.replace("M151_STUB_VITEST_DIR, \"node_modules/vitest\"", "M151_STUB_VITEST_DIR, \"node_modules/mocha\""));
      spawnSync("chmod", ["-R", "a+rX", join(ctx.base, "m172")]);
      chmodSync(stub, 0o755);
      const srcBase = "export function add(a, b) {\n  return a - b;\n}\nexport function sub(a, b) {\n  return a - b;\n}\n";
      const teamTest = 'import assert from "node:assert/strict";\nimport { add } from "../src/calc.ts";\n\nit("add sums two numbers", () => assert.equal(add(2, 3), 5));\nit("hook loaded", () => assert.equal(globalThis.M172_REG, 1));\n';
      const subTest = 'import assert from "node:assert/strict";\nimport { sub } from "../src/calc.ts";\n\nit("sub subtracts", () => assert.equal(sub(5, 3), 2));\n';
      const lock = JSON.stringify({ name: "fixture", lockfileVersion: 3, requires: true, packages: { "": { name: "fixture", devDependencies: { mocha: "10.2.0" } } } }, null, 1) + "\n";
      const rd = join(ctx.base, "repos", `m172mocha${n++}`);
      repo(rd, { "package.json": pkgJson({ test: "mocha --require ./test/setup.cjs test" }, { mocha: "10.2.0" }), "package-lock.json": lock, LICENSE: MIT, "src/calc.ts": srcBase, "test/sub.test.ts": subTest, "test/setup.cjs": REG });
      const git = (...a: string[]) => execFileSync("git", ["-C", rd, ...a], { encoding: "utf8" }).trim();
      const commit = git("rev-parse", "HEAD");
      mkdirSync(join(rd, "test"), { recursive: true });
      writeFileSync(join(rd, "src/calc.ts"), ADD_FIXED);
      writeFileSync(join(rd, "test/calc.test.ts"), teamTest);
      git("add", "-A"); execFileSync("git", ["-C", rd, "-c", "user.name=PeaceG03", "-c", "user.email=301894882+PeaceG03@users.noreply.github.com", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "reference"]);
      const merge = git("rev-parse", "HEAD");
      const name = rd.split("/").pop()!;
      const task: typeof ctx.vitest = { ...ctx.vitest, id: `m172-${name}`, repo: `m151-fixture/${name}`, commit, tests: { command: "mocha", files: ["test/calc.test.ts"] }, reference: { ...ctx.vitest.reference, from: { pr: 1, merge } } };
      const proposer: Loop.Proposer = { name: "fixed", next: () => ({ edits: [{ path: "src/calc.ts", content: ADD_FIXED }] }) };
      const r = l.loop.runLoopTask(task, "public", "a".repeat(64), {
        root: ctx.root, fetcher: ctx.fetcher, proposer, maxAttempts: 1, runMs: 60_000, env: ctx.env, rules: [], training: new Set<string>(),
        deps: { tool: (p: string) => [process.execPath, pm, p], extraEnv: { M151_STUB_VITEST_DIR: stub } },
      });
      assert.equal(l.row.loopRowProblem(r.row), null, String(l.row.loopRowProblem(r.row)));
      assert.equal(r.row.code, "PASS", JSON.stringify(r.row));
      assert.equal(r.row.runner, "mocha");
      assert.deepEqual(r.row.tests, { total: 2, passedByPeaceAI: 2, filledByTeam: 0 });
      assert.deepEqual(r.row.baseline, { total: 2, passing: 1, failing: 1 });
    },
  },
  // ---- repair-v2: undefined-keeps-key
  {
    id: "undefined-keeps-key admit (patch loop, element access): `if (v !== undefined) target[k] = v` also writes a present key's undefined",
    run(l, ctx) {
      const checks: Check[] = [
        (x) => { const r = x.applyPatch({ a: 1 }, { a: undefined }); return "a" in r && r.a === undefined; },
        (x) => !("b" in x.applyPatch({}, { b: undefined })),
        (x) => x.applyPatch({ a: 1 }, { a: 2 }).a === 2,
      ];
      admits(l, ctx, { "src/patch.ts": DEFAULTS }, "`applyPatch({ a: 1 }, { a: undefined })` keeps the stale `a: 1`; a key the target already has must take the undefined.", "src/patch.ts", checks, /if \(v !== undefined \|\| k in target\) target\[k\] = v;/);
    },
  },
  {
    id: "undefined-keeps-key admit (property access, block body, loose !=): `if (w != undefined) { box.width = w; }` clears a present width",
    run(l, ctx) {
      const checks: Check[] = [(x) => { const r = x.sanitize({ width: -1 }); return "width" in r && r.width === undefined; }, (x) => x.sanitize({ width: 2 }).width === 2, (x) => !("width" in x.sanitize({}))];
      admits(l, ctx, { "src/box.ts": SANITIZE }, "`sanitize({ width: -1 })` keeps the invalid width; an invalid present width must become undefined.", "src/box.ts", checks, /if \(w != undefined \|\| "width" in box\) \{/);
    },
  },
  {
    id: "undefined-keeps-key near misses: an else branch, a null check, another value, a computed key call, a non-ref target (m172-guard:uk-no-else / uk-undefined / uk-same-value / uk-key / uk-ref)",
    run(l) {
      const fired = (s: string) => idioms(l, s).filter((m) => m.template === "undefined-keeps-key");
      assert.deepEqual(fired("if (v !== undefined) o[k] = v;").map((m) => m.text), ["v !== undefined || k in o"], "the control fires");
      assert.deepEqual(fired('if (undefined !== v) this.cfg["x"] = v;').map((m) => m.text), ['undefined !== v || "x" in this.cfg'], "reversed, literal key, this-rooted ref");
      for (const s of ["if (v !== undefined) o[k] = v; else o[k] = 0;", "if (v !== null) o[k] = v;", "if (v !== undefined) o[k] = w;", "if (v !== undefined) o[key()] = v;", "if (v !== undefined) get()[k] = v;", "if (v !== undefined) { o[k] = v; n++; }", "if (v === undefined) o[k] = v;"]) assert.deepEqual(fired(s), [], `fired on: ${s}`);
    },
  },
  // ---- repair-v2 localisation: functions passed as call arguments
  {
    id: "ref-arg admit (dispatcher): a worker passed as an argument (`apply(addUp, xs, 0)`) is located and its off-by-one fixed",
    run(l, ctx) {
      const checks: Check[] = [(x) => x.total([1, 2, 3]) === 6, (x) => x.total([5]) === 5, (x) => x.total([]) === 0];
      admits(l, ctx, { "src/total.ts": DISPATCH }, "`total([1, 2, 3])` returns 5 instead of 6.", "src/total.ts", checks, /let k = i;|let k = i \+ 0;|let k = i - 0;/);
    },
  },
  {
    id: "ref-arg admit (array callback): `xs.map(capOne)` locates capOne and the cap is fixed",
    run(l, ctx) {
      const checks: Check[] = [(x) => JSON.stringify(x.capAll([3, 12])) === "[3,10]", (x) => JSON.stringify(x.capAll([10])) === "[10]"];
      admits(l, ctx, { "src/cap.ts": MAPPED }, "`capAll([12])` gives 9; values above the cap must become exactly 10.", "src/cap.ts", checks, /\? x : (?:10(?! - 1)|11 - 1)/);
    },
  },
  {
    id: "ref-arg near misses (m172-guard:ref-arg): repair-v1 does not locate a passed function; a function bound to a local first is not a call argument",
    run(l, ctx) {
      assert.deepEqual(located(l, { "src/cap.ts": MAPPED }, ctx, "`capAll` is wrong.", false), ["src/cap.ts#capAll:0"]);
      assert.deepEqual(located(l, { "src/cap.ts": MAPPED }, ctx, "`capAll` is wrong."), ["src/cap.ts#capAll:0", "src/cap.ts#capOne:1"]);
      assert.deepEqual(located(l, { "src/cap.ts": MAPPED_ALIAS }, ctx, "`capAll` is wrong."), ["src/cap.ts#capAll:0"]);
    },
  },
  // ---- repair-v2 localisation: functions imported from a relative module
  {
    id: "imported admit (entry -> helper module, extensionless specifier): `total` calls `addUp` from ./sum; the fault there is fixed",
    run(l, ctx) {
      const checks: Check[] = [(x) => x.total([1, 2, 3]) === 6, (x) => x.total([5]) === 5];
      admits(l, ctx, { "src/api.ts": API("./sum"), "src/sum.ts": SUM_MOD }, "`total([1, 2, 3])` returns 5 instead of 6.", "src/api.ts", checks, /let k = i;|let k = i \+ 0;|let k = i - 0;/, "src/sum.ts");
    },
  },
  {
    id: "imported admit (entry -> same-file helper -> aliased import from a subdirectory `.js` specifier): the idiom fault two calls down is fixed (a form title trim)",
    run(l, ctx) {
      const files = { "src/form.ts": FORM, "src/text/trim.ts": TRIM_MOD };
      assert.deepEqual(located(l, files, ctx, "`submit` is wrong."), ["src/form.ts#submit:0", "src/form.ts#prepare:1", "src/text/trim.ts#trimTitle:2"]);
      const checks: Check[] = [(x) => { const r = x.submit({ title: "   " }); return "title" in r && r.title === undefined; }, (x) => x.submit({ title: " a " }).title === "a", (x) => !("title" in x.submit({}))];
      admits(l, ctx, files, "`submit({ title: \"   \" })` keeps the blank title; a blank title must be cleared to undefined.", "src/form.ts", checks, /undefined !== t \|\| "title" in form/, "src/text/trim.ts");
    },
  },
  {
    id: "imported admit (entry in a subdirectory -> `../lib/paging.js`, the call inside a template literal): the comparison fault in the helper is fixed",
    run(l, ctx) {
      const files = { "src/report/pages.ts": PAGES, "src/lib/paging.ts": PAGING_MOD };
      assert.deepEqual(located(l, files, ctx, "`pageLabel` is wrong."), ["src/report/pages.ts#pageLabel:0", "src/lib/paging.ts#lastPage:1"]);
      assert.deepEqual(located(l, files, ctx, "`pageLabel` is wrong.", false), ["src/report/pages.ts#pageLabel:0"], "repair-v1 does not follow the import");
      const checks: Check[] = [(x) => x.pageLabel(10, 5) === "of 2", (x) => x.pageLabel(11, 5) === "of 3", (x) => x.pageLabel(0, 5) === "of 1"];
      admits(l, ctx, files, "`pageLabel(10, 5)` says `of 3`; ten items at five per page are 2 pages.", "src/report/pages.ts", checks, /seen < count/, "src/lib/paging.ts");
    },
  },
  {
    id: "imported near misses (m172-guard:imp-v2-only / imp-relative / imp-inside / imp-allowed): repair-v1, a bare specifier, a path above the root, a test-dir module",
    run(l, ctx) {
      const req = "`total` is wrong.";
      assert.deepEqual(located(l, { "src/api.ts": API("./sum"), "src/sum.ts": SUM_MOD }, ctx, req), ["src/api.ts#total:0", "src/sum.ts#addUp:1"], "the control");
      assert.deepEqual(located(l, { "src/api.ts": API("./sum"), "src/sum.ts": SUM_MOD }, ctx, req, false), ["src/api.ts#total:0"], "repair-v1");
      assert.deepEqual(located(l, { "src/api.ts": API("sum"), "src/sum.ts": SUM_MOD }, ctx, req), ["src/api.ts#total:0"], "bare specifier");
      assert.deepEqual(located(l, { "api.ts": API("../sum"), "sum.ts": SUM_MOD }, ctx, req), ["api.ts#total:0"], "above the root");
      assert.deepEqual(located(l, { "src/api.ts": API("./__tests__/sum"), "src/__tests__/sum.ts": SUM_MOD }, ctx, req), ["src/api.ts#total:0"], "a test path");
      // batch 11 fix (Auditor): type-only imports are not followed (m172-guard:imp-type-only / imp-type-only-name)
      assert.deepEqual(located(l, { "src/api.ts": API("./sum").replace("import {", "import type {"), "src/sum.ts": SUM_MOD }, ctx, req), ["src/api.ts#total:0"], "import type { addUp }");
      assert.deepEqual(located(l, { "src/api.ts": API("./sum").replace("import { addUp }", "import { type addUp }"), "src/sum.ts": SUM_MOD }, ctx, req), ["src/api.ts#total:0"], "import { type addUp }");
      assert.equal(l.prop.resolveImport("src/a/b.ts", "../c.js", (p) => p === "src/c.ts"), "src/c.ts");
      assert.equal(l.prop.resolveImport("src/b.ts", "./d", (p) => p === "src/d/index.ts"), "src/d/index.ts");
    },
  },
];
