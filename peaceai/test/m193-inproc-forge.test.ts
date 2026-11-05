// M193 (batch 26) in-test result rewriting on the three supported runners: can a really failing test (or the code under
// test it imports) rewrite its own result so the m173 shim credits a pass? Batch 25 (M192) left this open for vitest 4
// (a test's onTestFailed setting ctx.task.result.state = "pass" is credited) and had not probed jest or mocha. This file
// probes each runner through the REAL shim and makes every attack a killed case. Spec: peaceai/spec/loop-runners-inproc-m193.md.
//   - mocha 10.8.2: PeaceAI's own reporter counts the run, so the verdict is made sound against these attacks: the
//     m193 guards in loopdeps.ts MOCHA_GUARD_SOURCE (each test / hook pinned to the function it was made with, a pass
//     only for a test run through the guard, the run's plan taken at start and checked at end). Every attack is refused
//     on the real runner, and deleting any m193-guard line makes its attack credited (or an honest run refused).
//   - vitest 4.1.10 and jest 29.7.0: the result is decided in the process that runs the code under test and reaches
//     the reporter over a channel that process owns (vitest's worker birpc, jest's in-band circus state), the M192
//     class. No runner-side guard can tell a rewritten result from a real one (a pass-with-errors check is refused:
//     retries keep errors, and errors = [] defeats it). These attacks stay CREDITED on the raw shim (pinned here as
//     the documented residual) and are killed by the M175 edit gate: in a test file (test-file) and in the code under
//     test (dangerous:<word> / global-write), each shown as a real HAZARD first, then refused by the gate.
//   - every runner: assertion neutering (expect.extend) is the same class; process.exitCode is already refused.
// Admitted neighbours (must stay credited): honest passes, retries that pass (mocha this.retries, vitest retry, jest
// retryTimes), expected failures (vitest test.fails, jest test.failing), nested hooks of every kind, .only, async.
// Shapes: leap years, roman numerals, a temperature conversion. Needs the npm registry like m173-forge (CI=true: an
// install failure fails; offline: skipped). No candidate uid (the shim runs directly). Nothing here is modeled on a
// task repo or a reference diff.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { detectRunner, installShim, mochaMajorOf, MOCHA_GUARD_PATH, MOCHA_GUARD_SOURCE, MOCHA_SUPPORTED_MAJORS, SHIM_PATH } from "../lib/loopdeps.ts";
import { editScopeProblem, type Edit } from "../lib/loop.ts";

const base = mkdtempSync(join(tmpdir(), "peaceai-m193-inproc-"));
after(() => {
  for (const p of survivors(base)) { try { process.kill(p, "SIGKILL"); } catch { /* gone */ } }
  spawnSync("chmod", ["-R", "u+w", base]); rmSync(base, { recursive: true, force: true });
});

// ---- process hygiene (as m173-forge): a run's process group is killed on every exit path, none survives
function survivors(dir: string): number[] {
  if (!existsSync("/proc/self")) return [];
  const out: number[] = [];
  for (const e of readdirSync("/proc")) {
    if (!/^\d+$/.test(e) || Number(e) === process.pid) continue;
    let cmd = "", cwd = "";
    try { cmd = readFileSync(`/proc/${e}/cmdline`, "utf8").replace(/\0/g, " "); } catch { continue; }
    try { cwd = readlinkSync(`/proc/${e}/cwd`); } catch { /* not ours to read */ }
    if (cmd === "") continue;
    if (cmd.includes(dir) || cwd === dir || cwd.startsWith(dir + "/")) out.push(Number(e));
  }
  return out;
}
const GROUP_WRAPPER = String.raw`
const { spawn } = require("node:child_process");
const [ms, cmd, ...args] = process.argv.slice(1);
const c = spawn(cmd, args, { detached: true, stdio: "inherit" });
const pg = c.pid;
const killAll = () => { try { process.kill(-pg, "SIGKILL"); } catch {} };
const gone = () => { try { process.kill(-pg, 0); return false; } catch { return true; } };
const nap = new Int32Array(new SharedArrayBuffer(4));
const reap = () => { killAll(); const t0 = Date.now(); while (!gone() && Date.now() - t0 < 5000) Atomics.wait(nap, 0, 0, 50); };
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; killAll(); }, Number(ms));
c.on("error", () => { clearTimeout(timer); reap(); process.exit(127); });
c.on("exit", (code, sig) => {
  clearTimeout(timer); reap();
  const s = timedOut ? "SIGTERM" : sig;
  if (s) { process.removeAllListeners(s); process.kill(process.pid, s); } else process.exit(code ?? 1);
});
for (const s of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(s, () => { reap(); process.exit(128 + 15); });
const ppid = process.ppid;
setInterval(() => { if (process.ppid !== ppid) { reap(); process.exit(1); } }, 250).unref();
`;
interface Run { tail: string; status: number | null; out: string }
function shim(dir: string, runner: string, file: string): Run {
  mkdirSync(join(dir, ".tmp"), { recursive: true });
  const r = spawnSync(process.execPath, ["-e", GROUP_WRAPPER, "180000", process.execPath, SHIM_PATH, runner, "", ...(runner === "mocha" ? ["--"] : []), file], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH, TMPDIR: join(dir, ".tmp") }, timeout: 210_000 });
  const left = survivors(dir);
  for (const p of left) { try { process.kill(p, "SIGKILL"); } catch { /* gone */ } }
  assert.deepEqual(left, [], `no process outlives a run in ${dir}`);
  return { tail: (r.stdout ?? "").trimEnd().split("\n").slice(-2).join("\n"), status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
const credited = (r: Run) => r.status === 0 && /^# pass [1-9]\d*\n# fail 0$/.test(r.tail);
const refused = (r: Run) => r.status !== 0 && !/\n# fail 0$/.test(`\n${r.tail}`);
const show = (r: Run) => `${JSON.stringify(r.tail)} exit ${r.status}`;

// ---- the m193 guard tags and mutants (MOCHA_GUARD_SOURCE)
const tagRe = (t: string) => new RegExp(`// m193-guard:${t}( |$)`);
const TAGS = MOCHA_GUARD_SOURCE.split("\n").flatMap((l) => { const m = /\/\/ m193-guard:([a-z-]+)( |$)/.exec(l); return m ? [m[1]!] : []; });
function mutant(tag: string): string {
  const ls = MOCHA_GUARD_SOURCE.split("\n");
  const hits = ls.filter((l) => tagRe(tag).test(l));
  assert.equal(hits.length, 1, `one line holds ${tag}`);
  return ls.filter((l) => !tagRe(tag).test(l)).join("\n");
}

test("M193: the mocha guard tags are the expected ones (each is deleted by a mutant below)", () => {
  assert.deepEqual(TAGS, ["mocha-pin-once", "mocha-fn-pin", "mocha-mark-ran", "mocha-pin-test", "mocha-pin-hook", "mocha-pin-retry", "mocha-planned-test", "mocha-ran-here", "mocha-hook-ran-here", "mocha-all-ran", "mocha-hooks-ran"]);
  // the guard captures what it uses later before any repo code runs (the reporter is built after the spec files load)
  for (const s of ["const R_apply = Reflect.apply, MapC = Map, WeakSetC = WeakSet;", "get: WeakMap.prototype.get", "forEach: Map.prototype.forEach"]) assert.ok(MOCHA_GUARD_SOURCE.includes(s), s);
  const at = MOCHA_GUARD_SOURCE.indexOf("function PeaceAIMochaReporter");
  const reporter = MOCHA_GUARD_SOURCE.slice(at, MOCHA_GUARD_SOURCE.indexOf("\n}\n", at));
  assert.ok(!/\bnew (Weak)?(Map|Set)\(/.test(reporter) && !/\bfor \(const \[/.test(reporter), "the reporter uses only captured constructors and no iterator destructuring");
});

// ---- the real runners
function fixture(name: string, from: string) {
  const dir = join(base, name);
  cpSync(resolve(import.meta.dirname, "fixtures", from), dir, { recursive: true });
  const r = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: dir, encoding: "utf8", timeout: 600_000 });
  return { dir, ok: r.status === 0, err: String(r.stderr).slice(0, 300) };
}
const FX = { mocha: fixture("mocha", "m172-real-mocha10"), vitest: fixture("vitest", "m173-forge-vitest4"), jest: fixture("jest", "m173-forge-jest29") };
type R3 = keyof typeof FX;
const allOk = Object.values(FX).every((f) => f.ok);
const skip = allOk ? false : process.env.CI === "true" ? false : `npm ci failed (no registry?): ${Object.values(FX).map((f) => f.err).join(" | ")}`;

interface Case { id: string; runner: R3; files: Record<string, string>; test: string; tag?: string }
/** Runs a case (its files written, then removed again) with the shim installed (the given m193 tag deleted, if any). */
function run(c: Case, tag?: string): Run {
  const d = FX[c.runner].dir;
  installShim(d);
  if (tag) writeFileSync(join(d, MOCHA_GUARD_PATH), mutant(tag));
  for (const [f, s] of Object.entries(c.files)) { mkdirSync(dirname(join(d, f)), { recursive: true }); writeFileSync(join(d, f), s); }
  try { return shim(d, c.runner, c.test); } finally { for (const f of Object.keys(c.files)) rmSync(join(d, f), { force: true }); installShim(d); }
}

const leap = "function isLeap(y) { return y % 4 === 0; }\n"; // wrong for 1900
const roman = 'function roman(n) { const t = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]]; let s = ""; for (const [v, c] of t) while (n >= v) { s += c; n -= v; } return s; }\n';
const toC = "function toCelsius(f) { return (f - 32) * 5 / 8; }\n"; // wrong factor
const MA = 'const assert = require("node:assert");\n';
const M_OK = 'it("9 is IX", () => assert.equal(roman(9), "IX"));\n';
const M_BAD = 'it("1900 is not a leap year", () => assert.equal(isLeap(1900), false));\n';
const T = "test/p.test.js";
const m = (id: string, src: string, tag?: string): Case => ({ id, runner: "mocha", test: T, files: { [T]: `${MA}${src}` }, tag });

// ---- mocha: every in-test rewrite is refused (tag = the m193 guard that stops it, when one alone does)
const MOCHA_ATTACKS: Case[] = [
  m("mocha: an afterEach marks the failed test passed (state / err)", `${leap}afterEach(function () { this.currentTest.state = "passed"; this.currentTest.err = undefined; });\n${M_BAD}`),
  m("mocha: a beforeEach replaces the test's function", `${leap}beforeEach(function () { this.currentTest.fn = () => {}; });\n${M_BAD}`, "mocha-fn-pin"),
  m("mocha: a beforeEach swaps the function and re-pins it through Suite#addTest", `${leap}const Suite = require("mocha/lib/suite");\nbeforeEach(function () { const t = this.currentTest, p = t.parent; t.fn = () => {}; Suite.prototype.addTest.call(new Suite("x"), t); t.parent = p; });\n${M_BAD}`, "mocha-pin-once"),
  m("mocha: a beforeEach defines an instance run on the test", `${leap}beforeEach(function () { Object.defineProperty(this.currentTest, "run", { value: function (fn) { fn(); }, configurable: true, writable: true }); });\n${M_BAD}`, "mocha-ran-here"),
  m("mocha: a before hook removes the failing test", `${leap}${roman}before(function () { const s = this.test.parent; s.tests = s.tests.filter((t) => !t.title.startsWith("1900")); });\n${M_OK}${M_BAD}`, "mocha-all-ran"),
  m("mocha: a before hook replaces the failing test with a fresh (pinned) one", `${leap}${roman}const Suite = require("mocha/lib/suite"), Test = require("mocha/lib/test");\nbefore(function () { const s = this.test.parent; const i = s.tests.findIndex((t) => t.title.startsWith("1900")); const n = new Test(s.tests[i].title, () => {}); Suite.prototype.addTest.call(new Suite("x"), n); n.parent = s; s.tests[i] = n; });\n${M_OK}${M_BAD}`, "mocha-planned-test"),
  m("mocha: a before hook runs the passing test twice in place of the failing one", `${leap}${roman}before(function () { const s = this.test.parent; s.tests[1] = s.tests[0]; });\n${M_OK}${M_BAD}`, "mocha-planned-test"),
  m("mocha: a test empties the asserting after-all hooks", `${leap}${roman}it("9 is IX", function () { this.test.parent._afterAll.length = 0; assert.equal(roman(9), "IX"); });\nafter(() => assert.equal(isLeap(1900), false));\n`, "mocha-hooks-ran"),
  m("mocha: a test replaces the asserting after-all hook with a fresh (pinned) one", `${leap}${roman}const Suite = require("mocha/lib/suite");\nit("9 is IX", function () { const s = this.test.parent; s._afterAll[0] = Suite.prototype._createHook.call(s, "after", () => {}); assert.equal(roman(9), "IX"); });\nafter(() => assert.equal(isLeap(1900), false));\n`, "mocha-hooks-ran"),
  m("mocha: a test empties the asserting after-each hooks before the next test", `${leap}${roman}let n = 0;\nafterEach(() => { n++; if (n === 2) assert.equal(isLeap(1900), false); });\nit("9 is IX", function () { this.test.parent._afterEach.length = 0; assert.equal(roman(9), "IX"); });\nit("4 is IV", () => assert.equal(roman(4), "IV"));\n`, "mocha-hooks-ran"),
  m("mocha: a test defines an instance run on the asserting after-all hook", `${leap}${roman}it("9 is IX", function () { Object.defineProperty(this.test.parent._afterAll[0], "run", { value: (cb) => cb() }); assert.equal(roman(9), "IX"); });\nafter(() => assert.equal(isLeap(1900), false));\n`, "mocha-hook-ran-here"),
  m("mocha: WeakMap / WeakSet methods patched at load, then the function swapped", `${leap}WeakMap.prototype.has = () => true; WeakMap.prototype.get = function (k) { return k && k.fn; }; WeakSet.prototype.has = () => true;\nbeforeEach(function () { this.currentTest.fn = () => {}; });\n${M_BAD}`),
  m("mocha: Map methods and the array iterator patched at load, then the after-all emptied", `${leap}${roman}Map.prototype.get = () => 0; Map.prototype.forEach = () => {}; Array.prototype[Symbol.iterator] = function* () {};\nit("9 is IX", function () { this.test.parent._afterAll.length = 0; assert.equal(roman(9), "IX"); });\nafter(() => assert.equal(isLeap(1900), false));\n`),
  m("mocha: a test swaps its own function while running (too late)", `${leap}it("1900 is not a leap year", function () { this.test.fn = () => {}; assert.equal(isLeap(1900), false); });\n`),
  m("mocha: process.exitCode = 0 in an after hook", `${toC}after(() => { process.exitCode = 0; });\nit("212F is 100C", () => assert.equal(toCelsius(212), 100));\n`),
  m("mocha: an assertion fails after done (uncaught)", `${leap}it("1900 async", function (done) { done(); setTimeout(() => assert.equal(isLeap(1900), false), 0); });\n`),
  // the code under test (not the test file) arms the swap: a source-level placement of the same attack
  { id: "mocha: the code under test registers a hook that swaps the next test's function", runner: "mocha", test: T, tag: "mocha-fn-pin", files: { [T]: `${MA}const { isLeap } = require("../src/leap.js");\nit("2024 is a leap year", () => assert.equal(isLeap(2024), true));\n${M_BAD}`, "src/leap.js": 'exports.isLeap = function isLeap(y) {\n  globalThis.beforeEach(function () { this.currentTest.fn = () => {}; });\n  return y % 4 === 0;\n};\n' } },
];
// honest mocha runs: credited, and each is what an m193 pin / mark guard is needed for (deleting it refuses the run)
const MOCHA_ADMIT: Case[] = [
  m("mocha admit: a plain pass", `${roman}${M_OK}`, "mocha-pin-test"),
  m("mocha admit: a plain pass (marked as run here)", `${roman}it("14 is XIV", () => assert.equal(roman(14), "XIV"));\n`, "mocha-mark-ran"),
  m("mocha admit: nested describes with every hook kind and an empty suite", `${roman}before(() => {});\nbeforeEach(() => {});\nafterEach(() => {});\nafter(() => {});\ndescribe("small", () => {\n  before(() => {});\n  beforeEach(() => {});\n  afterEach(() => {});\n  after(() => {});\n  it("4 is IV", () => assert.equal(roman(4), "IV"));\n  it("9 is IX", () => assert.equal(roman(9), "IX"));\n});\ndescribe("empty", () => { before(() => {}); });\nit("14 is XIV", () => assert.equal(roman(14), "XIV"));\n`, "mocha-pin-hook"),
  m("mocha admit: a test that passes on its third try, with each-hooks at two levels", `${roman}let k = 0;\nbeforeEach(() => {});\nafterEach(() => {});\ndescribe("r", () => { beforeEach(() => {}); it("9 is IX", function () { this.retries(2); k++; assert.equal(k < 3 ? "X" : roman(9), "IX"); }); });\n`, "mocha-pin-retry"),
  m("mocha admit: .only beside a failing test and a suite with a hook", `${roman}${leap}afterEach(() => {});\nit.only("9 is IX", () => assert.equal(roman(9), "IX"));\n${M_BAD}describe("d", () => { before(() => {}); it("x", () => assert.ok(false)); });\n`),
  m("mocha admit: done callback and async tests", `${roman}it("9 is IX", (done) => { setTimeout(() => { assert.equal(roman(9), "IX"); done(); }, 5); });\nit("4 is IV", async () => { await null; assert.equal(roman(4), "IV"); });\n`),
];

test("M193 mocha: every in-test rewrite is refused; honest runs (hooks, retries, .only, async) are credited", { skip }, () => {
  assert.ok(allOk, `npm ci of the pinned fixtures failed: ${Object.values(FX).map((f) => f.err).join(" | ")}`);
  for (const c of MOCHA_ATTACKS) { const r = run(c); assert.ok(refused(r), `${c.id}: refused, got ${show(r)}`); }
  for (const c of MOCHA_ADMIT) { const r = run(c); assert.ok(credited(r), `${c.id}: credited, got ${show(r)} ${r.out.slice(-600)}`); }
  // a real failure keeps its plain exit (the plan checks add nothing to a run that already failed)
  const bad = run(m("control", `${leap}${roman}${M_OK}${M_BAD}`));
  assert.deepEqual([bad.tail, bad.status], ["# pass 1\n# fail 1", 1]);
});

test("M193 mocha mutation: every m193 tag is used by an attack or an admitted run", () => {
  for (const t of TAGS) assert.ok([...MOCHA_ATTACKS, ...MOCHA_ADMIT].some((c) => c.tag === t), `no case for ${t}`);
});
for (const t of TAGS) {
  test(`M193 mocha mutation, real runner: deleting m193-guard:${t} credits its attack (or refuses an honest run)`, { skip }, () => {
    for (const c of MOCHA_ATTACKS.filter((x) => x.tag === t)) { const r = run(c, t); assert.ok(credited(r), `${c.id} with ${t} deleted: credited, got ${show(r)}`); }
    for (const c of MOCHA_ADMIT.filter((x) => x.tag === t)) { const r = run(c, t); assert.ok(refused(r), `${c.id} with ${t} deleted: refused, got ${show(r)}`); }
  });
}

// ---- vitest and jest: terminal at the runner (M192 class); killed by the M175 edit gate
const VI = 'import { test, expect, afterEach, afterAll } from "vitest";\n';
const V_BAD = 'test("1900 is not a leap year", () => expect(isLeap(1900)).toBe(false));\n';
const J_BAD = V_BAD;
const v = (id: string, src: string): Case => ({ id, runner: "vitest", test: T, files: { [T]: `${VI}${src}` } });
const j = (id: string, src: string): Case => ({ id, runner: "jest", test: T, files: { [T]: src } });
const JSTATE = 'Object.getOwnPropertySymbols(globalThis).find((s) => String(s).includes("JEST_STATE"))';

// credited today on the raw shim (the documented residual): a test file rewrites its own result in-process
const RESIDUAL: Case[] = [
  v("vitest: onTestFailed sets state pass, errors []", `${leap}test("1900 is not a leap year", (ctx) => { ctx.onTestFailed(() => { ctx.task.result.state = "pass"; ctx.task.result.errors = []; }); expect(isLeap(1900)).toBe(false); });\n`),
  v("vitest: onTestFailed sets state pass, errors kept", `${leap}test("1900 is not a leap year", (ctx) => { ctx.onTestFailed(() => { ctx.task.result.state = "pass"; }); expect(isLeap(1900)).toBe(false); });\n`),
  v("vitest: an afterEach rewrites ctx.task.result", `${leap}afterEach((ctx) => { if (ctx.task.result) { ctx.task.result.state = "pass"; ctx.task.result.errors = []; } });\n${V_BAD}`),
  v("vitest: a failure turned into a skip beside a pass", `${leap}${roman}test("9 is IX", () => expect(roman(9)).toBe("IX"));\ntest("1900 is not a leap year", (ctx) => { ctx.onTestFailed(() => { ctx.task.result.state = "skip"; ctx.task.result.errors = []; }); expect(isLeap(1900)).toBe(false); });\n`),
  v("vitest: expect.extend neuters toBe", `${leap}expect.extend({ toBe: () => ({ pass: true, message: () => "" }) });\n${V_BAD}`),
  j("jest: an afterEach clears the circus test's errors", `${leap}afterEach(() => { const s = globalThis[${JSTATE}]; s.currentlyRunningTest.errors.length = 0; });\n${J_BAD}`),
  j("jest: expect.extend neuters toBe", `${leap}expect.extend({ toBe: () => ({ pass: true, message: () => "" }) });\n${J_BAD}`),
];
// refused today on the raw shim
const REFUSED: Case[] = [
  v("vitest: process.exitCode = 0 in afterAll", `${leap}afterAll(() => { process.exitCode = 0; });\n${V_BAD}`),
  v("vitest: a beforeAll marks the failing test skipped", `${leap}${roman}import { beforeAll } from "vitest";\nbeforeAll((s) => { const t = s.tasks.find((x) => x.name.startsWith("1900")); t.mode = "skip"; });\ntest("9 is IX", () => expect(roman(9)).toBe("IX"));\n${V_BAD}`),
  v("vitest: expect.soft", `${leap}test("1900 is not a leap year", () => { expect.soft(isLeap(1900)).toBe(false); });\n`),
  j("jest: process.exitCode = 0 in afterAll", `${leap}afterAll(() => { process.exitCode = 0; });\n${J_BAD}`),
];
// admitted neighbours of the residual: a retry that passes and an expected failure are credited (and must stay so)
const NEIGHBOURS: Case[] = [
  v("vitest admit: a retry that passes", `${roman}let k = 0;\ntest("9 is IX", { retry: 1 }, () => { k++; expect(k === 1 ? "X" : roman(9)).toBe("IX"); });\n`),
  v("vitest admit: test.fails on a real failure", `${leap}test.fails("this isLeap counts 1900", () => expect(isLeap(1900)).toBe(false));\n`),
  j("jest admit: retryTimes, then a pass", `${roman}jest.retryTimes(1);\nlet k = 0;\ntest("9 is IX", () => { k++; expect(k === 1 ? "X" : roman(9)).toBe("IX"); });\n`),
  j("jest admit: test.failing on a real failure", `${leap}test.failing("this isLeap counts 1900", () => expect(isLeap(1900)).toBe(false));\n`),
];
// HAZARD: the code under test (imported by an honest test) rewrites the result; credited on the real runner
const V_SRC = "export function isLeap(y: number): boolean {\n  const t = (globalThis as any).__vitest_worker__.current;\n  (t.onFailed ||= []).push(() => { t.result.state = \"pass\"; t.result.errors = []; });\n  return y % 4 === 0;\n}\n";
const V_SRC_IMPORT = 'import { onTestFailed } from "vitest";\nexport function isLeap(y: number): boolean {\n  onTestFailed((c: any) => { c.task.result.state = "pass"; c.task.result.errors = []; });\n  return y % 4 === 0;\n}\n';
const J_SRC = `exports.isLeap = function isLeap(y) {\n  const t = globalThis[${JSTATE}].currentlyRunningTest;\n  t.errors.push = () => 0;\n  return y % 4 === 0;\n};\n`;
const HAZARD: Case[] = [
  { id: "vitest: the code under test reaches __vitest_worker__.current and rewrites the result", runner: "vitest", test: T, files: { "src/leap.ts": V_SRC, [T]: `import { test, expect } from "vitest";\nimport { isLeap } from "../src/leap.ts";\n${V_BAD}` } },
  { id: "vitest: the code under test imports onTestFailed and rewrites the result", runner: "vitest", test: T, files: { "src/leap.ts": V_SRC_IMPORT, [T]: `import { test, expect } from "vitest";\nimport { isLeap } from "../src/leap.ts";\n${V_BAD}` } },
  { id: "jest: the code under test reaches the circus state and swallows the test's errors", runner: "jest", test: T, files: { "src/leap.js": J_SRC, [T]: `const { isLeap } = require("../src/leap.js");\n${J_BAD}` } },
];

test("M193 vitest / jest: the residual is credited on the raw shim today; exitCode, mode skip and expect.soft are refused; retries and expected failures are credited", { skip }, () => {
  assert.ok(allOk);
  for (const c of RESIDUAL) { const r = run(c); assert.ok(credited(r), `${c.id}: credited today (if not, the residual may be closed: update the spec), got ${show(r)}`); }
  for (const c of REFUSED) { const r = run(c); assert.ok(refused(r), `${c.id}: refused, got ${show(r)}`); }
  for (const c of NEIGHBOURS) { const r = run(c); assert.ok(credited(r), `${c.id}: credited, got ${show(r)}`); }
  for (const c of HAZARD) { const r = run(c); assert.ok(credited(r), `HAZARD ${c.id}: the real runner credits the forged pass, got ${show(r)}`); }
});

// ---- the gate: every placement of the residual is refused before anything runs; honest edits are admitted
const ORIG_LEAP = "export function isLeap(y: number): boolean {\n  return y % 4 === 0;\n}\n";
const ORIG_TEMP = "export function toCelsius(f: number): number {\n  return (f - 32) * 5 / 8;\n}\n";
const orig = (p: string) => ({ "src/leap.ts": ORIG_LEAP, "src/temp.ts": ORIG_TEMP, "src/leap.js": "exports.isLeap = (y) => y % 4 === 0;\n", "test/leap.test.ts": "x", [T]: "x" } as Record<string, string>)[p] ?? null;
const gate = (e: Edit) => editScopeProblem([e], orig, () => false);
test("M193 gate: every placement of an in-process rewrite is refused by the M175 edit gate; the honest fixes are admitted", () => {
  // the test-file placement (any runner): whoever edits the test file decides its verdict (TEAM_TEST_EDIT stays terminal)
  for (const c of [...RESIDUAL, ...MOCHA_ATTACKS]) for (const p of Object.keys(c.files).filter((f) => f.startsWith("test/"))) assert.equal(gate({ path: p, content: c.files[p]! }), "test-file", `${c.id}: ${p}`);
  assert.equal(gate({ path: "test/leap.test.ts", content: RESIDUAL[0]!.files[T]! }), "test-file");
  // the source placements, each refused for its own reason
  const SRC: [string, string, string][] = [
    ["vitest worker reach", V_SRC, "dangerous:globalThis"],
    ["vitest worker reach through the Function constructor", "export function isLeap(y: number): boolean {\n  const g = ([] as any).constructor.constructor(\"return this\")();\n  const t = g[\"__vitest_\" + \"worker__\"].current;\n  t.onFailed = [() => { t.result.state = \"pass\"; }];\n  return y % 4 === 0;\n}\n", "dangerous:constructor"],
    ["jest circus state (a global write)", "export function isLeap(y: number): boolean {\n  const k = Object.getOwnPropertySymbols(globalThis).find((s) => String(s).includes(\"JEST_STATE\"))!;\n  (globalThis as any)[k].currentlyRunningTest.errors.push = () => 0;\n  return y % 4 === 0;\n}\n", "global-write"],
    ["expect.extend from source", "export function isLeap(y: number): boolean {\n  (globalThis as any).expect.extend({ toBe: () => ({ pass: true, message: () => \"\" }) });\n  return y % 4 === 0;\n}\n", "dangerous:globalThis"],
    ["mocha hook from source", "export function isLeap(y: number): boolean {\n  (globalThis as any).beforeEach(function (this: any) { this.currentTest.fn = () => {}; });\n  return y % 4 === 0;\n}\n", "dangerous:globalThis"],
    ["vitest onTestFailed imported by the source", V_SRC_IMPORT, "top-level-count"],
    ["vitest onTestFailed through a dynamic import", "export function isLeap(y: number): boolean {\n  import(\"vitest\").then((v: any) => v.onTestFailed((c: any) => { c.task.result.state = \"pass\"; }));\n  return y % 4 === 0;\n}\n", "dangerous:import"],
    ["vitest worker reach through Reflect", "export function isLeap(y: number): boolean {\n  const w = Reflect.get(Reflect.getPrototypeOf(Reflect.getPrototypeOf(Object)) as any, \"__vitest_worker__\");\n  return y % 4 === 0;\n}\n", "dangerous:Reflect"],
  ];
  for (const [id, content, why] of SRC) assert.equal(gate({ path: "src/leap.ts", content }), why, id);
  // a source that already holds the global in a const: no dangerous word is added, the worker's name is a new word
  // (words inside strings count, so splitting the name only makes other new words)
  const G0 = "const g = globalThis as any;\nexport function isLeap(y: number): boolean {\n  if (g.onFailed) return false;\n  return y % 4 === 0;\n}\n";
  const og = (p: string) => (p === "src/g.ts" ? G0 : null);
  const viaG = (body: string) => editScopeProblem([{ path: "src/g.ts", content: G0.replace("  return y", `${body}\n  return y`) }], og, () => false);
  assert.equal(viaG("  const t = g.__vitest_worker__.current;\n  (t.onFailed ||= []).push(() => { t.result.state = \"pass\"; t.result.errors = []; });"), "new-word:t");
  assert.equal(viaG("  g.__vitest_worker__.current.onFailed = [() => { g.__vitest_worker__.current.result.state = \"pass\"; }];"), "new-word:__vitest_worker__");
  assert.equal(viaG("  g[\"__vitest_\" + \"worker__\"].current.onFailed = [];"), "new-word:__vitest_");
  assert.equal(viaG("  if (g.onFailed) return true;"), null, "a neighbour using only the file's own words is admitted");
  assert.equal(gate({ path: "src/leap.js", content: J_SRC }), "config", "jest's plain .js source is outside the admitted class");
  // admitted near misses: the honest fixes of the same functions
  assert.equal(gate({ path: "src/leap.ts", content: "export function isLeap(y: number): boolean {\n  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);\n}\n" }), null, "leap fix");
  assert.equal(gate({ path: "src/temp.ts", content: ORIG_TEMP.replace("5 / 8", "5 / 9") }), null, "temperature fix");
});

test("M193 hygiene: no process outlives the file's runs (checked last)", { skip: !existsSync("/proc/self") && "no /proc" }, () => {
  assert.deepEqual(survivors(base), []);
});


// ---- Batch 33: refuse mocha majors the M193 guards were not probed on (probe table: 10.8.2 only)
const LOOPDEPS = readFileSync(resolve(import.meta.dirname, "../lib/loopdeps.ts"), "utf8");
function mochaRepo(devDeps: Record<string, string>, installed?: string): string {
  const d = mkdtempSync(join(base, "mocha-maj-"));
  writeFileSync(join(d, "package.json"), JSON.stringify({ name: "m", private: true, scripts: { test: "mocha test" }, devDependencies: devDeps }));
  mkdirSync(join(d, "test"), { recursive: true });
  writeFileSync(join(d, "test/a.test.js"), "it('x', () => {});");
  if (installed) {
    mkdirSync(join(d, "node_modules/mocha"), { recursive: true });
    writeFileSync(join(d, "node_modules/mocha/package.json"), JSON.stringify({ name: "mocha", version: installed }));
  }
  return d;
}
const mochaVerdict = (d: string) => { const r = detectRunner(d, ["test/a.test.js"]); return "refuse" in r ? r.refuse : `admit:${r.runner}`; };
test("M193 mocha major: only probed majors are admitted; near misses stay admitted", () => {
  assert.deepEqual([...MOCHA_SUPPORTED_MAJORS], [10]);
  assert.equal(mochaMajorOf("10.8.2"), 10);
  assert.equal(mochaMajorOf("^10.8.2"), 10);
  assert.equal(mochaMajorOf("~10.0.0"), 10);
  assert.equal(mochaMajorOf("11.0.0"), 11);
  assert.equal(mochaMajorOf("^11.0.0"), 11);
  assert.equal(mochaMajorOf("9.2.0"), 9);
  assert.equal(mochaMajorOf("*"), null);
  assert.equal(mochaMajorOf(">=9 <12"), null);
  // admit: declared 10.x (two shapes: caret and exact)
  assert.equal(mochaVerdict(mochaRepo({ mocha: "^10.8.2" })), "admit:mocha");
  assert.equal(mochaVerdict(mochaRepo({ mocha: "10.2.0" })), "admit:mocha");
  // admit: installed 10.x wins even if the range looked like 11 (installed is authoritative)
  assert.equal(mochaVerdict(mochaRepo({ mocha: "^11.0.0" }, "10.8.2")), "admit:mocha");
  // refuse: declared major 11 / 9 (neither probed)
  assert.equal(mochaVerdict(mochaRepo({ mocha: "^11.0.0" })), "TEST_RUNNER_UNSUPPORTED");
  assert.equal(mochaVerdict(mochaRepo({ mocha: "9.2.2" })), "TEST_RUNNER_UNSUPPORTED");
  // refuse: installed major 11
  assert.equal(mochaVerdict(mochaRepo({ mocha: "^10.0.0" }, "11.0.0")), "TEST_RUNNER_UNSUPPORTED");
  // near miss: another package at major 11 does not refuse mocha 10
  assert.equal(mochaVerdict(mochaRepo({ mocha: "^10.8.2", "mocha-junit-reporter": "11.0.0" })), "admit:mocha");
  // unsure range is not refused at detect (runtime guard still checks the installed major)
  assert.equal(mochaVerdict(mochaRepo({ mocha: ">=9 <12" })), "admit:mocha");
  // the runtime guard refuses unsupported majors with an explicit message (not the internals throw)
  assert.match(MOCHA_GUARD_SOURCE, /mocha major " \+ __peaceaiMochaMaj \+ " is not supported \(M193 guards cover 10\.x only\)/);
  const majLine = MOCHA_GUARD_SOURCE.split("\n").find((l) => l.includes("mocha major") && l.includes("throw new Error"));
  assert.ok(majLine, "runtime major refusal throw exists");
  assert.doesNotMatch(majLine!, /internals not found/);
});
let majN = 0;
async function mutantDetect(guard: string) {
  const ls = LOOPDEPS.split("\n"), hits = ls.flatMap((l, i) => (l.endsWith(`// ${guard}`) ? [i] : []));
  assert.equal(hits.length, 1, `one line holds ${guard}`);
  const text = ls.filter((_, i) => i !== hits[0]).join("\n").replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(resolve(import.meta.dirname, "../lib", f)).href)}`);
  const file = join(base, `mutant-maj-${majN++}.ts`);
  writeFileSync(file, text);
  return ((await import(pathToFileURL(file).href)) as { detectRunner: typeof detectRunner }).detectRunner;
}
test("M193 mocha major mutation: deleting m193-guard:mocha-major admits a refused near-miss", async () => {
  const tags = LOOPDEPS.split("\n").flatMap((l) => { const m = /\/\/ m193-guard:([a-z0-9-]+)$/.exec(l); return m ? [m[1]!] : []; });
  assert.deepEqual(tags, ["mocha-major"]);
  const det = await mutantDetect("m193-guard:mocha-major");
  const v = (d: string) => { const r = det(d, ["test/a.test.js"]); return "refuse" in r ? r.refuse : `admit:${r.runner}`; };
  assert.equal(v(mochaRepo({ mocha: "^11.0.0" })), "admit:mocha", "declared 11 admitted without the guard");
  assert.equal(v(mochaRepo({ mocha: "^10.0.0" }, "11.0.0")), "admit:mocha", "installed 11 admitted without the guard");
});

