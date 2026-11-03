// M173 batch 12 forging fix (Auditor, blocks crediting any PASS; pre-existing on main): before this fix the shim read
// the runner's report from $TMPDIR/peaceai-loop-report.json, which code under test can write (TMPDIR must be writable
// for it), so a test run could forge a pass: write that file, then process.exit(0); or, on mocha, patch
// Runnable.prototype.run (or the runner's emit, or node:assert) in-process. Now (loopdeps.ts SHIM / LAUNCH / reporters /
// MOCHA_GUARD, spec peaceai/spec/repair-v2-m173.md "Report forging"):
//   - the shim starts the runner through launch.cjs with a per-run nonce on its stdin (never in argv or env) and reads
//     fd 3, which must hold exactly one line `PEACEAI-REPORT <nonce> <json>`; anything else is no report (NO_REPORT);
//   - PeaceAI's own reporter (preloaded before any repo code) claims the one writer; a second claim, a second write,
//     a reporter not constructed by the runner's own code (a frame under node_modules), a second reporter, a mocha
//     reporter outside the CLI's Mocha#run all write a poison line instead;
//   - the mocha guard locks mocha's classes, pins the runner's emit and freezes node:assert's functions.
// This file shows each forging attack (unrelated shapes: leap years, roman numerals, a temperature conversion) is
// refused for mocha, vitest and jest, and (mutation check) that deleting the tagged guard line that stops it makes the
// same attack a credited pass. Three layers:
//   1. launch.cjs directly (no runner): one claim, one write, no newline, the nonce is not in argv / env, the caller check.
//   2. stub runners through the shim (no network): reporter-once for jest and vitest.
//   3. REAL runners through the shim: mocha 10.8.2 (fixtures/m172-real-mocha10), vitest 4.1.10
//      (fixtures/m173-forge-vitest4), jest 29.7.0 (fixtures/m173-forge-jest29), pinned lockfiles installed with
//      `npm ci --ignore-scripts` into temp dirs. Needs the npm registry: in CI (CI=true) an install failure fails the
//      test; elsewhere (an offline box) it is skipped. Includes the hazard on the raw runner with the pre-fix report
//      file, skips-only runs (never a pass on any of the three) and a pass beside a skip (documented: refused on mocha only).
// No candidate uid needed (the shim runs directly). Nothing here is modeled on a task repo or a reference diff.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  installShim, JEST_REPORTER_PATH, JEST_REPORTER_SOURCE, LAUNCH_PATH, LAUNCH_SOURCE, MOCHA_GUARD_PATH, MOCHA_GUARD_SOURCE,
  REPORT_CLAIM_SYMBOL, REPORT_LINE_PREFIX, SHIM_EXITS, SHIM_PATH, SHIM_SOURCE, VITEST_REPORTER_PATH, VITEST_REPORTER_SOURCE,
} from "../lib/loopdeps.ts";

const base = mkdtempSync(join(tmpdir(), "peaceai-m173-forge-"));
after(() => { spawnSync("chmod", ["-R", "u+w", base]); rmSync(base, { recursive: true, force: true }); });
let n = 0;

// ---- the guard tags and mutants
const SOURCES: Record<string, [string, string]> = {
  shim: [SHIM_PATH, SHIM_SOURCE], launch: [LAUNCH_PATH, LAUNCH_SOURCE], jest: [JEST_REPORTER_PATH, JEST_REPORTER_SOURCE],
  vitest: [VITEST_REPORTER_PATH, VITEST_REPORTER_SOURCE], mocha: [MOCHA_GUARD_PATH, MOCHA_GUARD_SOURCE],
};
const tagRe = (t: string) => new RegExp(`// m173-forge-guard:${t}$`);
const TAGS = Object.values(SOURCES).flatMap(([, s]) => s.split("\n").flatMap((l) => { const m = /\/\/ m173-forge-guard:([a-z-]+)$/.exec(l); return m ? [m[1]!] : []; }));
/** The source file holding a tag and that source with the tagged line deleted. */
function mutant(tag: string): [string, string] {
  const hits = Object.values(SOURCES).filter(([, s]) => s.split("\n").some((l) => tagRe(tag).test(l)));
  assert.equal(hits.length, 1, `one source holds ${tag}`);
  const [p, s] = hits[0]!;
  const ls = s.split("\n"), i = ls.findIndex((l) => tagRe(tag).test(l));
  return [p, ls.filter((_, j) => j !== i).join("\n")];
}
/** Installs the shim into dir (the given tag's line deleted, if any). */
function install(dir: string, tag?: string): void {
  installShim(dir);
  if (tag) { const [p, s] = mutant(tag); writeFileSync(join(dir, p), s); }
}

test("M173 forging: the guard tags are the expected ones (each is deleted by a mutant below)", () => {
  assert.deepEqual(TAGS, [
    "shim-one-line", "shim-nonce", "launch-claim-once", "launch-write-once", "launch-dot-dir", "jest-reporter-caller", "jest-reporter-once",
    "vitest-reporter-caller", "vitest-reporter-once", "mocha-cli-instance", "mocha-reporter-in-run", "mocha-emit-pin", "mocha-lock", "mocha-assert-lock",
  ]);
  assert.equal(REPORT_LINE_PREFIX, "PEACEAI-REPORT ");
  for (const s of [SHIM_SOURCE, LAUNCH_SOURCE]) assert.ok(!s.includes("peaceai-loop-report.json"), "no report file any more");
  assert.ok(LAUNCH_SOURCE.includes(`Symbol.for("${REPORT_CLAIM_SYMBOL}")`));
});

// ---- 1. launch.cjs directly
const NONCE = "5e".repeat(32);
/** Runs launch.cjs with `pre` as the preload (a file at `preAt` in dir) and an empty entry; fd 3 and the child's record. */
function launch(pre: string, o: { tag?: string; nonce?: string; preAt?: string; files?: Record<string, string> } = {}) {
  const d = join(base, `launch-${n++}`);
  mkdirSync(join(d, "node_modules/some-runner"), { recursive: true });
  install(d, o.tag);
  writeFileSync(join(d, "node_modules/some-runner/empty.cjs"), "");
  for (const [f, c] of Object.entries(o.files ?? {})) { mkdirSync(dirname(join(d, f)), { recursive: true }); writeFileSync(join(d, f), c); }
  const preAt = join(d, o.preAt ?? "pre.cjs");
  mkdirSync(dirname(preAt), { recursive: true });
  writeFileSync(preAt, pre);
  const r = spawnSync(process.execPath, [join(d, LAUNCH_PATH), join(d, "node_modules"), preAt, join(d, "node_modules/some-runner/empty.cjs")], { cwd: d, input: o.nonce ?? NONCE, stdio: ["pipe", "pipe", "pipe", "pipe"], encoding: "utf8", env: { PATH: process.env.PATH, TMPDIR: d } });
  const rec = join(d, "rec.json");
  return { fd3: String(r.output[3] ?? ""), status: r.status, stderr: String(r.stderr), rec: existsSync(rec) ? JSON.parse(readFileSync(rec, "utf8")) : null, dir: d };
}
const CLAIM = `const claim = process[Symbol.for("${REPORT_CLAIM_SYMBOL}")];\n`;
const line = (json: string, nonce = NONCE) => `PEACEAI-REPORT ${nonce} ${json}\n`;

test("M173 forging, launch: one claim, one write, one line (m173-forge-guard:launch-claim-once, launch-write-once)", () => {
  assert.equal(launch(CLAIM + 'const w = claim(); w(\'{"leap":1}\');\n').fd3, line('{"leap":1}'), "the one report");
  assert.equal(launch(CLAIM + 'const w = claim(); const w2 = claim(); w(\'{"leap":1}\'); if (w2) w2(\'{"leap":2}\');\n').fd3, "PEACEAI-POISON\n" + line('{"leap":1}'), "a second claim is the poison line, never a writer");
  assert.equal(launch(CLAIM + 'const w = claim(); w(\'{"leap":1}\'); w(\'{"leap":2}\');\n').fd3, line('{"leap":1}') + "PEACEAI-POISON\n", "a second write is the poison line");
  assert.equal(launch(CLAIM + 'const w = claim(); w(\'{"leap":1}\\n\');\n').fd3, "PEACEAI-POISON\n", "a newline in the json is the poison line");
  assert.equal(launch(CLAIM + 'const w = claim(); if (w) w(\'{"leap":1}\');\n', { nonce: "" }).fd3, "PEACEAI-POISON\n", "no nonce: no writer");
  assert.equal(launch(CLAIM + 'const w = claim(); if (w) w(\'{"leap":1}\');\n', { nonce: "zz" }).fd3, "PEACEAI-POISON\n", "a malformed nonce: no writer");
  // mutants: each deleted guard changes the line
  assert.equal(launch(CLAIM + 'const w = claim(); const w2 = claim(); if (w2) w2(\'{"leap":2}\');\n', { tag: "launch-claim-once" }).fd3, line('{"leap":2}'), "mutant launch-claim-once: a second claim writes a report");
  assert.equal(launch(CLAIM + 'const w = claim(); w(\'{"leap":1}\'); w(\'{"leap":2}\');\n', { tag: "launch-write-once" }).fd3, line('{"leap":1}') + line('{"leap":2}'), "mutant launch-write-once: two reports");
});

test("M173 forging, launch: the nonce is in neither argv nor env, and stdin is spent before repo code runs", () => {
  const r = launch('require("node:fs").writeFileSync(require("node:path").join(__dirname, "rec.json"), JSON.stringify({ argv: process.argv, env: process.env, stdin: (() => { try { return require("node:fs").readFileSync(0, "utf8"); } catch (e) { return "error"; } })() }));\n');
  assert.ok(r.rec, r.stderr);
  assert.ok(!JSON.stringify(r.rec.argv).includes(NONCE) && !JSON.stringify(r.rec.env).includes(NONCE), "no nonce in argv / env");
  assert.ok(!String(r.rec.stdin).includes(NONCE), "stdin no longer holds it");
});

test("M173 forging, launch: the caller check (peaceai.loop.from) takes the runner's code under node_modules only (m173-forge-guard:launch-dot-dir)", () => {
  const K = 'module.exports = (from) => { class K { constructor() { this.ok = from(K); } } return K; };\n';
  const pre = (where: string) => `const from = process[Symbol.for("peaceai.loop.from")];\nconst K = require(${JSON.stringify(where)})(from);\nconst mk = require("./node_modules/some-runner/mk.cjs");\nconst out = { here: new K().ok, deps: mk(K).ok };\nrequire("node:fs").writeFileSync(require("node:path").join(__dirname, "rec.json"), JSON.stringify(out));\n`;
  const files = { "k.cjs": K, "node_modules/some-runner/mk.cjs": "module.exports = (K) => new K();\n" };
  const r = launch(pre("./k.cjs"), { files });
  assert.deepEqual(r.rec, { here: false, deps: true }, r.stderr);
  // a repo that locks Error.prepareStackTrace gets no reporter (a refusal, never a pass)
  const locked = launch('Object.defineProperty(Error, "prepareStackTrace", { value: (e, s) => [], writable: false, configurable: false });\n' + pre("./k.cjs"), { files });
  assert.deepEqual(locked.rec, { here: false, deps: false }, locked.stderr);
  // code written to TMPDIR (writable by the candidate) under a node_modules dir name is not the runner's
  const tmpd = launch(pre("./k.cjs").replace('"./node_modules/some-runner/mk.cjs"', '"./t/node_modules/evil/mk.cjs"'), { files: { ...files, "t/node_modules/evil/mk.cjs": "module.exports = (K) => new K();\n" } });
  assert.deepEqual(tmpd.rec, { here: false, deps: false }, tmpd.stderr);
  // nor is code in a dot dir right under node_modules (vite bundles a config to node_modules/.vite-temp)
  const dot = launch(pre("./k.cjs").replace('"./node_modules/some-runner/mk.cjs"', '"./node_modules/.vite-temp/mk.cjs"'), { files: { ...files, "node_modules/.vite-temp/mk.cjs": "module.exports = (K) => new K();\n" } });
  assert.deepEqual(dot.rec, { here: false, deps: false }, dot.stderr);
  const dotm = launch(pre("./k.cjs").replace('"./node_modules/some-runner/mk.cjs"', '"./node_modules/.vite-temp/mk.cjs"'), { tag: "launch-dot-dir", files: { ...files, "node_modules/.vite-temp/mk.cjs": "module.exports = (K) => new K();\n" } });
  assert.deepEqual(dotm.rec, { here: false, deps: true }, "mutant launch-dot-dir: a bundled config under node_modules/.vite-temp passes the caller check");
});

// ---- the shim on a dir (stub or real runner)
interface Run { tail: string; status: number | null; out: string }
function shim(dir: string, runner: string, file: string): Run {
  mkdirSync(join(dir, ".tmp"), { recursive: true });
  const r = spawnSync(process.execPath, [SHIM_PATH, runner, "", ...(runner === "mocha" ? ["--"] : []), file], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH, TMPDIR: join(dir, ".tmp") }, timeout: 180_000 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return { tail: (r.stdout ?? "").trimEnd().split("\n").slice(-2).join("\n"), status: r.status, out };
}
const credited = (r: Run) => r.status === 0 && /^# pass [1-9]\d*\n# fail 0$/.test(r.tail);
const refused = (r: Run) => r.status !== 0 && !/\n# fail 0$/.test(`\n${r.tail}`);

// ---- 2. stub runners: a second reporter the runner's own code is driven to construct gets no writer
const STUB_JEST_BIN = [
  'const rp = process.argv.find((a) => a.startsWith("--reporters=")).slice("--reporters=".length);',
  "const R = require(rp);",
  "const real = new R({}, {});",
  "const results = (p, f) => ({ numPassedTests: p, numFailedTests: f, numFailedTestSuites: f ? 1 : 0, numRuntimeErrorTestSuites: 0, numTotalTests: p + f });",
  'if (process.env.STUB_MODE === "second") { const extra = new R({}, {}); extra.onRunComplete(new Set(), results(4, 0)); process.exit(0); }',
  'real.onRunComplete(new Set(), process.env.STUB_MODE === "fail" ? results(3, 1) : results(4, 0));',
  'process.exit(process.env.STUB_MODE === "fail" ? 1 : 0);',
  "",
].join("\n");
const STUB_VITEST_BIN = [
  'import { pathToFileURL } from "node:url";',
  'const rp = process.argv.find((a) => a.startsWith("--reporter=")).slice("--reporter=".length);',
  "const R = (await import(pathToFileURL(rp).href)).default;",
  "const real = new R();",
  'const tree = (f) => [{ type: "suite", result: { state: f ? "fail" : "pass" }, tasks: [{ type: "test", mode: "run", result: { state: "pass" } }, { type: "test", mode: "run", result: { state: f ? "fail" : "pass" } }] }];',
  'if (process.env.STUB_MODE === "second") { const extra = new R(); await extra.onFinished(tree(false), []); process.exit(0); }',
  'await real.onFinished(tree(process.env.STUB_MODE === "fail"), []);',
  'process.exit(process.env.STUB_MODE === "fail" ? 1 : 0);',
  "",
].join("\n");
function stubShim(runner: "jest" | "vitest", mode: string, tag?: string): Run {
  const d = join(base, `stub-${runner}-${n++}`);
  mkdirSync(join(d, "node_modules", runner), { recursive: true });
  const bin = runner === "jest" ? "bin.cjs" : "bin.mjs";
  writeFileSync(join(d, "node_modules", runner, "package.json"), JSON.stringify({ name: runner, version: runner === "jest" ? "29.7.0" : "4.1.10", bin }));
  writeFileSync(join(d, "node_modules", runner, bin), runner === "jest" ? STUB_JEST_BIN : STUB_VITEST_BIN);
  writeFileSync(join(d, "package.json"), "{}");
  install(d, tag);
  mkdirSync(join(d, ".tmp"));
  const r = spawnSync(process.execPath, [SHIM_PATH, runner, "", "test/a.test.js"], { cwd: d, encoding: "utf8", env: { PATH: process.env.PATH, TMPDIR: join(d, ".tmp"), STUB_MODE: mode }, timeout: 60_000 });
  return { tail: (r.stdout ?? "").trimEnd().split("\n").slice(-2).join("\n"), status: r.status, out: `${r.stdout}${r.stderr}` };
}

test("M173 forging, stub jest / vitest: a second reporter instance gets no writer (m173-forge-guard:jest-reporter-once, vitest-reporter-once)", () => {
  for (const runner of ["jest", "vitest"] as const) {
    const ok = stubShim(runner, "pass"), bad = stubShim(runner, "fail"), second = stubShim(runner, "second");
    assert.ok(credited(ok), `${runner}: a real pass is credited: ${ok.tail} ${ok.status} ${ok.out}`);
    assert.deepEqual([bad.tail.split("\n")[1], bad.status], ["# fail 1", 1], `${runner}: a real failure stays one`);
    assert.ok(refused(second), `${runner}: the second instance's report is refused: ${second.tail} ${second.status}`);
    assert.equal(second.status, SHIM_EXITS.NO_REPORT);
    const m = stubShim(runner, "second", `${runner}-reporter-once`);
    assert.ok(credited(m), `mutant ${runner}-reporter-once: the second instance's forged pass is credited: ${m.tail} ${m.status}`);
  }
});

// ---- 3. real runners
function fixture(name: string, from: string) {
  const dir = join(base, name);
  cpSync(resolve(import.meta.dirname, "fixtures", from), dir, { recursive: true });
  const r = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: dir, encoding: "utf8", timeout: 600_000 });
  return { dir, ok: r.status === 0, err: String(r.stderr).slice(0, 300) };
}
const FX = { mocha: fixture("mocha", "m172-real-mocha10"), vitest: fixture("vitest", "m173-forge-vitest4"), jest: fixture("jest", "m173-forge-jest29") };
const allOk = Object.values(FX).every((f) => f.ok);
const skip = allOk ? false : process.env.CI === "true" ? false : `npm ci failed (no registry?): ${Object.values(FX).map((f) => f.err).join(" | ")}`;
type R3 = keyof typeof FX;

const leap = "function isLeap(y) { return y % 4 === 0; }\n"; // wrong for 1900
const roman = 'function roman(n) { const t = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]]; let s = ""; for (const [v, c] of t) while (n >= v) { s += c; n -= v; } return s; }\n';
const toC = "function toCelsius(f) { return (f - 32) * 5 / 8; }\n"; // wrong factor
const MPASS = JSON.stringify({ stats: { tests: 1, passes: 1, failures: 0, pending: 0 } });
const JPASS = JSON.stringify({ numPassedTests: 1, numFailedTests: 0, numFailedTestSuites: 0, numRuntimeErrorTestSuites: 0, numTotalTests: 1, success: true });
const fakeLine = (json: string) => JSON.stringify(`PEACEAI-REPORT ${"7".repeat(64)} ${json}\n`);
const FILE = 'require("node:path").join(process.env.TMPDIR, "peaceai-loop-report.json")';
const VTREE = '[{ type: "suite", result: { state: "pass" }, tasks: [{ type: "test", mode: "run", result: { state: "pass" } }] }]';

interface Attack { id: string; runner: R3; files: Record<string, string>; test: string; tag?: string }
const MA = 'const assert = require("node:assert");\n';
const ATTACKS: Attack[] = [
  // mocha (code in the spec file, i.e. what code under test it imports can do)
  { id: "mocha (a) fake report file + exit 0", runner: "mocha", test: "test/leap.test.js", files: { "test/leap.test.js": `${MA}${leap}it("1900 is not a leap year", () => assert.equal(isLeap(1900), false));\nafter(() => { require("node:fs").writeFileSync(${FILE}, ${JSON.stringify(MPASS)}); process.exit(0); });\n` } },
  { id: "mocha: a report line on fd 3 without the nonce + exit 0", runner: "mocha", tag: "shim-nonce", test: "test/leap.test.js", files: { "test/leap.test.js": `${MA}${leap}it("1900 is not a leap year", () => assert.equal(isLeap(1900), false));\nafter(() => { require("node:fs").writeSync(3, ${fakeLine(MPASS)}); process.exit(0); });\n` } },
  { id: "mocha: claim the writer, write a pass, exit 0", runner: "mocha", tag: "launch-claim-once", test: "test/leap.test.js", files: { "test/leap.test.js": `${MA}${leap}it("1900 is not a leap year", () => assert.equal(isLeap(1900), false));\nafter(() => { const w = process[Symbol.for("peaceai.loop.claim")](); if (w) w(${JSON.stringify(MPASS)}); process.exit(0); });\n` } },
  { id: "mocha: a claim attempt in an otherwise passing run", runner: "mocha", tag: "shim-one-line", test: "test/roman.test.js", files: { "test/roman.test.js": `${MA}${roman}process[Symbol.for("peaceai.loop.claim")]();\nit("14 is XIV", () => assert.equal(roman(14), "XIV"));\n` } },
  { id: "mocha (c) construct PeaceAI's reporter on a fake runner", runner: "mocha", tag: "mocha-reporter-in-run", test: "test/leap.test.js", files: { "test/leap.test.js": `${MA}${leap}it("1900 is not a leap year", () => assert.equal(isLeap(1900), false));\nafter(() => { const R = require(process.argv[process.argv.indexOf("--reporter") + 1]); const e = new (require("node:events"))(); new R(e); e.emit("pass"); e.emit("test end"); e.emit("end"); process.exit(0); });\n` } },
  { id: "mocha (c) a spec file runs its own Mocha with PeaceAI's reporter", runner: "mocha", tag: "mocha-cli-instance", test: "test/temp.test.mjs", files: { "test/temp.test.mjs": `import assert from "node:assert";\nimport { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\nconst Mocha = require("mocha");\n${toC}it("212F is 100C", () => assert.equal(toCelsius(212), 100));\nconst m = new Mocha({ reporter: process.argv[process.argv.indexOf("--reporter") + 1] });\nm.suite.addTest(new Mocha.Test("freezing", () => assert.equal(toCelsius(32), 0)));\nawait new Promise(() => m.run(() => process.exit(0)));\n` } },
  { id: "mocha (b) Runnable.prototype.run patched", runner: "mocha", tag: "mocha-lock", test: "test/temp.test.js", files: { "test/temp.test.js": `${MA}${toC}require("mocha/lib/runnable").prototype.run = function (fn) { fn(); };\nit("212F is 100C", () => assert.equal(toCelsius(212), 100));\n` } },
  { id: "mocha (b) a run method defined on Test.prototype", runner: "mocha", tag: "mocha-lock", test: "test/temp.test.js", files: { "test/temp.test.js": `${MA}${toC}Object.defineProperty(require("mocha/lib/test").prototype, "run", { value: function (fn) { fn(); } });\nit("212F is 100C", () => assert.equal(toCelsius(212), 100));\n` } },
  { id: "mocha (b) EventEmitter emit patched: the runner's fail becomes pass", runner: "mocha", tag: "mocha-emit-pin", test: "test/temp.test.js", files: { "test/temp.test.js": `${MA}${toC}const Runner = require("mocha/lib/runner");\nconst EE = require("node:events");\nconst emit = EE.prototype.emit;\nEE.prototype.emit = function (name, ...a) { if (!(this instanceof Runner)) return emit.call(this, name, ...a); const r = emit.call(this, name === "fail" ? "pass" : name, ...a); if (name === "end") process.exit(0); return r; };\nit("212F is 100C", () => assert.equal(toCelsius(212), 100));\n` } },
  { id: "mocha (b) node:assert patched", runner: "mocha", tag: "mocha-assert-lock", test: "test/temp.test.js", files: { "test/temp.test.js": `${MA}${toC}assert.equal = () => {};\nit("212F is 100C", () => assert.equal(toCelsius(212), 100));\n` } },
  // jest (one test file runs in band, in jest's own process)
  { id: "jest (a) fake report file + exit 0", runner: "jest", test: "test/leap.test.js", files: { "test/leap.test.js": `${leap}test("1900 is not a leap year", () => expect(isLeap(1900)).toBe(false));\nafterAll(() => { require("node:fs").writeFileSync(${FILE}, ${JSON.stringify(JPASS)}); process.exit(0); });\n` } },
  { id: "jest: a report line on fd 3 without the nonce + exit 0", runner: "jest", tag: "shim-nonce", test: "test/leap.test.js", files: { "test/leap.test.js": `${leap}test("1900 is not a leap year", () => expect(isLeap(1900)).toBe(false));\nafterAll(() => { require("node:fs").writeSync(3, ${fakeLine(JPASS)}); process.exit(0); });\n` } },
  { id: "jest: claim the writer, write a pass, exit 0", runner: "jest", tag: "launch-claim-once", test: "test/leap.test.js", files: { "test/leap.test.js": `${leap}test("1900 is not a leap year", () => expect(isLeap(1900)).toBe(false));\nafterAll(() => { const c = process[Symbol.for("peaceai.loop.claim")]; const w = c && c(); if (w) w(${JSON.stringify(JPASS)}); process.exit(0); });\n` } },
  { id: "jest: a claim attempt in an otherwise passing run", runner: "jest", tag: "shim-one-line", test: "test/roman.test.js", files: { "test/roman.test.js": `${roman}const c = process[Symbol.for("peaceai.loop.claim")]; if (c) c();\ntest("14 is XIV", () => expect(roman(14)).toBe("XIV"));\n` } },
  { id: "jest (c) the config constructs PeaceAI's reporter and reports a pass", runner: "jest", tag: "jest-reporter-caller", test: "test/temp.test.js", files: { "jest.config.js": `const R = require(process.argv.find((a) => a.startsWith("--reporters=")).slice("--reporters=".length));\nnew R({}, {}).onRunComplete(new Set(), ${JPASS});\nprocess.exit(0);\n`, "test/temp.test.js": `${toC}test("212F is 100C", () => expect(toCelsius(212)).toBe(100));\n` } },
  { id: "jest (c) a test file requires PeaceAI's reporter and reports a pass", runner: "jest", test: "test/temp.test.js", files: { "test/temp.test.js": `${toC}test("212F is 100C", () => expect(toCelsius(212)).toBe(100));\nafterAll(() => { const R = require(process.argv.find((a) => a.startsWith("--reporters=")).slice("--reporters=".length)); new R({}, {}).onRunComplete(new Set(), ${JPASS}); process.exit(0); });\n` } },
  // vitest (tests run in workers; the config runs in vitest's own process)
  { id: "vitest (a) fake report file + exit 0 (a test file)", runner: "vitest", test: "test/leap.test.js", files: { "test/leap.test.js": `import { test, expect, afterAll } from "vitest";\nimport fs from "node:fs";\nimport path from "node:path";\n${leap}test("1900 is not a leap year", () => expect(isLeap(1900)).toBe(false));\nafterAll(() => { fs.writeFileSync(path.join(process.env.TMPDIR, "peaceai-loop-report.json"), ${JSON.stringify(JPASS)}); process.exit(0); });\n` } },
  { id: "vitest (a) fake report file + exit 0 (the config)", runner: "vitest", test: "test/leap.test.js", files: { "vitest.config.js": `import fs from "node:fs";\nimport path from "node:path";\nfs.writeFileSync(path.join(process.env.TMPDIR, "peaceai-loop-report.json"), ${JSON.stringify(JPASS)});\nprocess.exit(0);\nexport default {};\n`, "test/leap.test.js": `import { test, expect } from "vitest";\n${leap}test("1900 is not a leap year", () => expect(isLeap(1900)).toBe(false));\n` } },
  { id: "vitest: a report line on fd 3 without the nonce + exit 0 (the config)", runner: "vitest", tag: "shim-nonce", test: "test/leap.test.js", files: { "vitest.config.js": `import fs from "node:fs";\nfs.writeSync(3, ${fakeLine(JPASS)});\nprocess.exit(0);\nexport default {};\n`, "test/leap.test.js": `import { test, expect } from "vitest";\n${leap}test("1900 is not a leap year", () => expect(isLeap(1900)).toBe(false));\n` } },
  { id: "vitest: claim the writer, write a pass, exit 0 (the config)", runner: "vitest", tag: "launch-claim-once", test: "test/leap.test.js", files: { "vitest.config.js": `const w = process[Symbol.for("peaceai.loop.claim")]();\nif (w) w(${JSON.stringify(JPASS)});\nprocess.exit(0);\nexport default {};\n`, "test/leap.test.js": `import { test, expect } from "vitest";\n${leap}test("1900 is not a leap year", () => expect(isLeap(1900)).toBe(false));\n` } },
  { id: "vitest: a claim attempt in an otherwise passing run (the config)", runner: "vitest", tag: "shim-one-line", test: "test/roman.test.js", files: { "vitest.config.js": 'process[Symbol.for("peaceai.loop.claim")]();\nexport default {};\n', "test/roman.test.js": `import { test, expect } from "vitest";\n${roman}test("14 is XIV", () => expect(roman(14)).toBe("XIV"));\n` } },
  { id: "vitest (c) the config constructs PeaceAI's reporter and reports a pass", runner: "vitest", tag: "vitest-reporter-caller", test: "test/temp.test.js", files: { "vitest.config.js": `import { pathToFileURL } from "node:url";\nconst p = process.argv.find((a) => a.startsWith("--reporter=")).slice("--reporter=".length);\nconst R = (await import(pathToFileURL(p).href)).default;\nawait new R().onFinished(${VTREE}, []);\nprocess.exit(0);\nexport default {};\n`, "test/temp.test.js": `import { test, expect } from "vitest";\n${toC}test("212F is 100C", () => expect(toCelsius(212)).toBe(100));\n` } },
  { id: "vitest (c) a test file writes fd 3 (a worker) and exits 0", runner: "vitest", test: "test/temp.test.js", files: { "test/temp.test.js": `import { test, expect, afterAll } from "vitest";\nimport fs from "node:fs";\n${toC}test("212F is 100C", () => expect(toCelsius(212)).toBe(100));\nafterAll(() => { try { fs.writeSync(3, ${fakeLine(JPASS)}); } catch {} process.exit(0); });\n` } },
];

/** Runs one attack (its files written, then removed again) in the runner's fixture with the given shim install. */
function attack(a: Attack, tag?: string): Run {
  const d = FX[a.runner].dir;
  install(d, tag);
  for (const [f, c] of Object.entries(a.files)) { mkdirSync(dirname(join(d, f)), { recursive: true }); writeFileSync(join(d, f), c); }
  try { return shim(d, a.runner, a.test); } finally { for (const f of Object.keys(a.files)) rmSync(join(d, f), { force: true }); installShim(d); }
}

test("M173 forging, real runners: the hazard on the raw runner with the pre-fix report file (code under test forges a pass)", { skip }, () => {
  const raw: Record<R3, (out: string) => string[]> = {
    mocha: (out) => ["node_modules/mocha/bin/mocha.js", "--no-config", "--no-package", "--reporter", "json", "--reporter-option", `output=${out}`],
    jest: (out) => ["node_modules/jest/bin/jest.js", "--ci", "--json", `--outputFile=${out}`, "--watchman=false", "--runTestsByPath"],
    vitest: (out) => ["node_modules/vitest/vitest.mjs", "run", "--reporter=json", `--outputFile=${out}`],
  };
  for (const id of ["mocha (a) fake report file + exit 0", "jest (a) fake report file + exit 0", "vitest (a) fake report file + exit 0 (the config)"]) {
    const a = ATTACKS.find((x) => x.id === id)!;
    const d = FX[a.runner].dir, tmp = join(d, ".tmp"), out = join(tmp, "peaceai-loop-report.json");
    mkdirSync(tmp, { recursive: true });
    rmSync(out, { force: true });
    for (const [f, c] of Object.entries(a.files)) { mkdirSync(dirname(join(d, f)), { recursive: true }); writeFileSync(join(d, f), c); }
    try {
      const r = spawnSync(process.execPath, [...raw[a.runner](out), a.test], { cwd: d, encoding: "utf8", env: { PATH: process.env.PATH, TMPDIR: tmp }, timeout: 180_000 });
      const j = JSON.parse(readFileSync(out, "utf8"));
      const [p, f] = a.runner === "mocha" ? [j.stats.passes, j.stats.failures] : [j.numPassedTests, j.numFailedTests];
      assert.deepEqual([r.status, p, f], [0, 1, 0], `${id}: the raw runner exits 0 and the file says 1 pass, 0 failed (the failing test is hidden)`);
    } finally { for (const f of Object.keys(a.files)) rmSync(join(d, f), { force: true }); }
  }
});

test("M173 forging, real runners: controls (a pass is credited, a failure is not); skips-only is never a pass; a pass beside a skip (documented)", { skip }, () => {
  const T: Record<R3, { ok: string; bad: string; skip: string; mixed: string }> = {
    mocha: { ok: `${MA}${roman}it("9 is IX", () => assert.equal(roman(9), "IX"));\n`, bad: `${MA}${leap}it("2024 leaps", () => assert.ok(isLeap(2024)));\nit("1900 does not", () => assert.equal(isLeap(1900), false));\n`, skip: `${MA}it.skip("later", () => {});\n`, mixed: `${MA}${roman}it("9 is IX", () => assert.equal(roman(9), "IX"));\nit.skip("later", () => {});\n` },
    jest: { ok: `${roman}test("9 is IX", () => expect(roman(9)).toBe("IX"));\n`, bad: `${leap}test("2024 leaps", () => expect(isLeap(2024)).toBe(true));\ntest("1900 does not", () => expect(isLeap(1900)).toBe(false));\n`, skip: 'test.skip("later", () => {});\n', mixed: `${roman}test("9 is IX", () => expect(roman(9)).toBe("IX"));\ntest.todo("later");\n` },
    vitest: { ok: `import { test, expect } from "vitest";\n${roman}test("9 is IX", () => expect(roman(9)).toBe("IX"));\n`, bad: `import { test, expect } from "vitest";\n${leap}test("2024 leaps", () => expect(isLeap(2024)).toBe(true));\ntest("1900 does not", () => expect(isLeap(1900)).toBe(false));\n`, skip: 'import { test } from "vitest";\ntest.skip("later", () => {});\n', mixed: `import { test, expect } from "vitest";\n${roman}test("9 is IX", () => expect(roman(9)).toBe("IX"));\ntest.todo("later");\n` },
  };
  for (const runner of Object.keys(FX) as R3[]) {
    const run = (c: string) => attack({ id: "control", runner, test: "test/c.test.js", files: { "test/c.test.js": c } });
    const ok = run(T[runner].ok), bad = run(T[runner].bad), sk = run(T[runner].skip), mx = run(T[runner].mixed);
    assert.ok(credited(ok), `${runner}: a real pass is credited: ${ok.tail} ${ok.status} ${ok.out.slice(-400)}`);
    assert.deepEqual([bad.tail, bad.status], ["# pass 1\n# fail 1", 1], `${runner}: a real failure`);
    assert.ok(!credited(sk) && /^# pass 0\n/.test(sk.tail), `${runner}: skips only is never a pass (no test passed): ${sk.tail} ${sk.status}`);
    // skips (spec "Report forging", Skips): mocha refuses any pending test (m172-guard:shim-mocha-pending, the batch 11
    // Pending route); vitest and jest credit a pass beside a static skip / todo (a team test file may hold one)
    if (runner === "mocha") assert.deepEqual([mx.tail, mx.status], ["# pass 0\n# fail 1", SHIM_EXITS.SUITE_LOAD], "mocha: a pass beside a skipped test credits nothing");
    else assert.ok(credited(mx) && mx.tail === "# pass 1\n# fail 0", `${runner}: a pass beside a todo test is credited (documented): ${mx.tail} ${mx.status}`);
  }
});

test("M173 forging, real runners: every forging attack is refused (no credited pass) on mocha, vitest and jest", { skip }, () => {
  assert.ok(allOk, `npm ci of the pinned fixtures failed: ${Object.values(FX).map((f) => f.err).join(" | ")}`);
  for (const a of ATTACKS) {
    const r = attack(a);
    assert.ok(refused(r), `${a.id}: refused, got ${JSON.stringify(r.tail)} exit ${r.status}`);
  }
  for (const runner of Object.keys(FX) as R3[]) assert.ok(ATTACKS.some((a) => a.runner === runner && a.id.includes("(a)")), `${runner}: has an (a) attack`);
});

// mutation: every tag is the guard that stops some attack (layers 1 and 2 cover launch-write-once and the reporter-once tags)
const COVERED_ELSEWHERE = new Set(["launch-write-once", "launch-dot-dir", "jest-reporter-once", "vitest-reporter-once"]);
test("M173 forging mutation: every tag has an attack (here, or in layers 1 / 2)", () => {
  for (const t of TAGS) assert.ok(COVERED_ELSEWHERE.has(t) || ATTACKS.some((a) => a.tag === t), `no attack for ${t}`);
});
for (const t of TAGS.filter((x) => !COVERED_ELSEWHERE.has(x))) {
  test(`M173 forging mutation, real runners: deleting m173-forge-guard:${t} makes its attack a credited pass`, { skip }, () => {
    for (const a of ATTACKS.filter((x) => x.tag === t)) {
      const r = attack(a, t);
      assert.ok(credited(r), `${a.id} with ${t} deleted: credited, got ${JSON.stringify(r.tail)} exit ${r.status}`);
    }
  });
}
