// M192 (batch 25): ava stays refused (TEST_RUNNER_UNSUPPORTED), with a terminality proof instead of a guard
// (spec peaceai/spec/loop-runners-ava-terminal-m192.md). M187 (batch 22) admitted ava with a worker-side pin on
// process.send; Auditor forged three credited passes through it on real ava 6.4.1 and M187 was reverted (853cb2d).
// Root cause: ava decides every test's verdict inside the worker process that runs the code under test and sends it
// to the main process over an IPC channel the worker owns, so there is nothing outside the worker's control to count.
// This file keeps every attack found as a killed case that must stay uncredited:
//   (a) a todo-only file that loads ava's own lib/worker/channel.cjs by absolute path and sends test-passed;
//   (b) process._send({ava: test-passed});
//   (c) a really failing test that wraps channel.send and rewrites test-failed into test-passed;
//   (d) process.send({ava: test-passed});
//   (e) a raw write(2) of a v8-serialized IPC frame on process.channel.fd (no JS object involved at all);
//   (f) worker threads (ava's default): parentPort.postMessage({ava: test-passed}).
// Layers:
//   1. detection (no network): each refusal condition has a refused near-miss and an admitted neighbour, and
//      (mutation) deleting the guard line that refuses it admits it.
//   2. REAL ava 6.4.1 (fixtures/m187-forge-ava6, pinned lockfile, `npm ci --ignore-scripts` into a temp dir): every
//      attack is live against ava's own verdict (the credit source any ava support would have to trust, as the
//      reverted M187 reporter did: ava's TAP finish block and exit code), so removing the refusal credits it
//      (mutation); controls show that verdict is not trivially a pass; and through PeaceAI every attack is refused
//      (detectRunner) and the shim given runner "ava" credits nothing (NO_REPORT).
//   3. a documented residual on a supported runner (not ava): the same in-process class on vitest 4.
// Shapes: leap years, roman numerals, a temperature conversion (none from PeaceSTOCKS or a task repo).
// Needs the npm registry for layer 2 / 3: in CI (CI=true) an install failure fails the test; elsewhere it is skipped.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { detectRunner, installShim, SHIM_EXITS, SHIM_PATH } from "../lib/loopdeps.ts";

const libDir = resolve(import.meta.dirname, "../lib");
const base = mkdtempSync(join(tmpdir(), "peaceai-m187-forge-"));
after(() => {
  for (const p of survivors(base)) { try { process.kill(p, "SIGKILL"); } catch { /* gone */ } }
  spawnSync("chmod", ["-R", "u+w", base]); rmSync(base, { recursive: true, force: true });
});
let n = 0;

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
/** Runs `cmd args` as a new process group under a wrapper that SIGKILLs the group on every exit path. */
const GROUP_WRAPPER = String.raw`
const { spawn } = require("node:child_process");
const [ms, cmd, ...args] = process.argv.slice(1);
const c = spawn(cmd, args, { detached: true, stdio: "inherit" });
const pg = c.pid;
const killAll = () => { try { process.kill(-pg, "SIGKILL"); } catch {} };
const gone = () => { try { process.kill(-pg, 0); return false; } catch { return true; } };
const nap = new Int32Array(new SharedArrayBuffer(4));
const reap = () => { killAll(); const t0 = Date.now(); while (!gone() && Date.now() - t0 < 5000) Atomics.wait(nap, 0, 0, 50); };
const timer = setTimeout(killAll, Number(ms));
c.on("error", () => { clearTimeout(timer); reap(); process.exit(127); });
c.on("exit", (code, sig) => { clearTimeout(timer); reap(); process.exit(sig ? 128 : code ?? 1); });
for (const s of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(s, () => { reap(); process.exit(143); });
const ppid = process.ppid;
setInterval(() => { if (process.ppid !== ppid) { reap(); process.exit(1); } }, 250).unref();
`;
interface Run { tail: string; status: number | null; out: string }
function runGroup(cmd: string, args: string[], cwd: string): Run {
  const r = spawnSync(process.execPath, ["-e", GROUP_WRAPPER, "120000", cmd, ...args], { cwd, encoding: "utf8", env: { PATH: process.env.PATH, TMPDIR: join(cwd, ".tmp") }, timeout: 150_000 });
  const left = survivors(cwd);
  for (const p of left) { try { process.kill(p, "SIGKILL"); } catch { /* gone */ } }
  assert.deepEqual(left, [], `no process outlives a run in ${cwd}`);
  const stdout = r.stdout ?? "";
  return { tail: stdout.trimEnd().split("\n").filter((l) => /^# (pass|fail) \d+$/.test(l)).slice(-2).join("\n"), status: r.status, out: `${stdout}${r.stderr ?? ""}` };
}
/** A credited pass, read the way the M173 shim's summary is read: exit 0, `# pass N>0`, `# fail 0`. */
const credited = (r: Run) => r.status === 0 && /^# pass [1-9]\d*\n# fail 0$/.test(r.tail);

// ---- 1. detection
function repo(scripts: Record<string, string>, deps: Record<string, string>, extra: Record<string, string> = {}): string {
  const d = join(base, `det-${n++}`);
  mkdirSync(join(d, "test"), { recursive: true });
  writeFileSync(join(d, "package.json"), JSON.stringify({ name: "shape", private: true, scripts, devDependencies: deps }));
  writeFileSync(join(d, "test/leap.test.cjs"), 'const test = require("ava");\ntest("1900 is not a leap year", (t) => t.false(1900 % 4 === 0));\n');
  for (const [f, c] of Object.entries(extra)) { mkdirSync(dirname(join(d, f)), { recursive: true }); writeFileSync(join(d, f), c); }
  return d;
}
type Detect = typeof detectRunner;
const verdict = (det: Detect, d: string) => { const r = det(d, ["test/leap.test.cjs"]); return "refuse" in r ? r.refuse : `admit:${r.runner}`; };
// each refusal condition: a refused near-miss (killed by `guard`) and an admitted neighbour that must stay admitted.
// The by-path near-misses leave ava out of the dependencies (installed elsewhere): with ava declared,
// m192-guard:runner-dep-other refuses them as well, so each mutant deletes one layer and needs the case only it covers.
const CASES: { id: string; guard: string; refused: () => string; admitted: () => string; admitAs: string }[] = [
  { id: "the script names ava (npx), vitest installed beside it", guard: "guard:runner-other", refused: () => repo({ test: "npx ava --tap" }, { vitest: "4.1.10" }), admitted: () => repo({ test: "vitest run" }, { vitest: "4.1.10", "avalanche-fixtures": "1.0.0" }), admitAs: "admit:vitest" },
  { id: "ava through a script indirection", guard: "guard:runner-other", refused: () => repo({ test: "npm run unit", unit: "ava" }, { jest: "29.7.0" }), admitted: () => repo({ test: "npm run unit", unit: "jest" }, { jest: "29.7.0" }), admitAs: "admit:jest" },
  { id: "ava by path (node_modules/.bin/ava)", guard: "m192-guard:runner-path", refused: () => repo({ test: "./node_modules/.bin/ava" }, { vitest: "4.1.10" }), admitted: () => repo({ test: "vitest run test/ava.test.js" }, { vitest: "4.1.10" }), admitAs: "admit:vitest" },
  { id: "ava by path (node node_modules/ava/entrypoints/cli.mjs)", guard: "m192-guard:runner-path", refused: () => repo({ test: "node node_modules/ava/entrypoints/cli.mjs" }, { jest: "29.7.0" }), admitted: () => repo({ test: "node node_modules/jest/bin/jest.js" }, { jest: "29.7.0" }), admitAs: "admit:jest" },
  { id: "no runner named, ava in the dependencies beside vitest", guard: "m192-guard:runner-dep-other", refused: () => repo({}, { ava: "6.4.1", vitest: "4.1.10" }), admitted: () => repo({}, { "ava-like-helper": "1.0.0", vitest: "4.1.10" }), admitAs: "admit:vitest" },
];

test("M192 detection: every ava refusal condition has a refused near-miss and an admitted neighbour", () => {
  for (const c of CASES) {
    assert.equal(verdict(detectRunner, c.refused()), "TEST_RUNNER_UNSUPPORTED", `${c.id}: refused`);
    assert.equal(verdict(detectRunner, c.admitted()), c.admitAs, `${c.id}: the neighbour is admitted`);
  }
  // a plain `ava` script with ava installed (the shape Auditor's forges ran in) is refused
  assert.equal(verdict(detectRunner, repo({ test: "ava" }, { ava: "6.4.1" })), "TEST_RUNNER_UNSUPPORTED");
});

const LOOPDEPS = readFileSync(join(libDir, "loopdeps.ts"), "utf8");
async function mutantDetect(guard: string): Promise<Detect> {
  const ls = LOOPDEPS.split("\n"), hits = ls.flatMap((l, i) => (l.endsWith(`// ${guard}`) ? [i] : []));
  assert.equal(hits.length, 1, `one line holds ${guard}`);
  const text = ls.filter((_, i) => i !== hits[0]).join("\n").replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`);
  const p = join(base, `mutant-${guard.replace(/[^a-z0-9-]/g, "_")}-${n++}.ts`);
  writeFileSync(p, text);
  return ((await import(pathToFileURL(p).href)) as { detectRunner: Detect }).detectRunner;
}
test("M192 detection mutation: the M192 tags are the expected ones", () => {
  const tags = LOOPDEPS.split("\n").flatMap((l) => { const m = /\/\/ m192-guard:([a-z0-9-]+)$/.exec(l); return m ? [m[1]!] : []; });
  assert.deepEqual(tags.sort(), ["runner-dep-other", "runner-path"]);
});
for (const g of [...new Set(CASES.map((c) => c.guard))]) {
  test(`M192 detection mutation: deleting ${g} admits its refused near-miss`, async () => {
    const det = await mutantDetect(g);
    for (const c of CASES.filter((x) => x.guard === g)) assert.match(verdict(det, c.refused()), /^admit:/, `${c.id} with ${g} deleted: admitted`);
  });
}

// ---- 2. real ava 6.4.1
function fixture(name: string, from: string) {
  const dir = join(base, name);
  cpSync(resolve(import.meta.dirname, "fixtures", from), dir, { recursive: true });
  const r = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: dir, encoding: "utf8", timeout: 600_000 });
  mkdirSync(join(dir, ".tmp"), { recursive: true });
  return { dir, ok: r.status === 0, err: String(r.stderr).slice(0, 300) };
}
const AVA = fixture("ava", "m187-forge-ava6");
const skipFor = (f: { ok: boolean; err: string }) => (f.ok ? false : process.env.CI === "true" ? false : `npm ci failed (no registry?): ${f.err}`);
const skip = skipFor(AVA);
// ava's own config for the raw runs: child processes (as the reverted M187 forced) or worker threads (ava's default)
writeFileSync(join(AVA.dir, "procs.config.mjs"), 'export default { workerThreads: false, cache: false, files: ["test/**/*.test.cjs"] };\n');
writeFileSync(join(AVA.dir, "threads.config.mjs"), 'export default { workerThreads: true, cache: false, files: ["test/**/*.test.cjs"] };\n');

const CH = 'require(require("node:path").join(process.cwd(), "node_modules/ava/lib/worker/channel.cjs"))';
const P = (title: string) => `{ type: "test-passed", title: ${JSON.stringify(title)}, duration: 1, knownFailing: false, logs: [] }`;
const HEAD = 'const test = require("ava");\n';
const leap = "function isLeap(y) { return y % 4 === 0; }\n"; // wrong for 1900
const roman = 'function roman(n) { const t = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]]; let s = ""; for (const [v, c] of t) while (n >= v) { s += c; n -= v; } return s; }\n';
const toC = "function toCelsius(f) { return (f - 32) * 5 / 8; }\n"; // wrong factor
interface Attack { id: string; config: "procs" | "threads"; src: string }
const ATTACKS: Attack[] = [
  { id: "(a) todo only + ava's channel.cjs by absolute path sends test-passed", config: "procs", src: `${HEAD}test.todo("1900 is not a leap year");\n${CH}.send(${P("1900 is not a leap year")});\n` },
  { id: "(b) process._send of a test-passed event", config: "procs", src: `${HEAD}test.todo("14 is XIV");\nprocess._send({ ava: ${P("14 is XIV")} });\n` },
  { id: "(c) a really failing test, channel.send wrapped to turn test-failed into test-passed", config: "procs", src: `${HEAD}${toC}const ch = ${CH};\nconst send = ch.send;\nch.send = (e, ...r) => send(e && e.type === "test-failed" ? { ...e, type: "test-passed", knownFailing: false } : e, ...r);\ntest("212F is 100C", (t) => t.is(toCelsius(212), 100));\n` },
  { id: "(d) process.send of a test-passed event", config: "procs", src: `${HEAD}${leap}test.todo("1900 is not a leap year");\nprocess.send({ ava: ${P("1900 is not a leap year")} });\n` },
  { id: "(e) a raw v8-serialized IPC frame written to process.channel.fd", config: "procs", src: `${HEAD}const v8 = require("node:v8"), fs = require("node:fs");\ntest.todo("9 is IX");\nconst s = new v8.Serializer(); s.writeHeader(); s.writeValue({ ava: ${P("9 is IX")} });\nconst b = s.releaseBuffer(), h = Buffer.alloc(4); h.writeUInt32BE(b.length);\nfs.writeSync(process.channel.fd, Buffer.concat([h, b]));\n` },
  { id: "(f) worker threads: parentPort.postMessage of a test-passed event", config: "threads", src: `${HEAD}test.todo("32F is 0C");\nrequire("node:worker_threads").parentPort.postMessage({ ava: ${P("32F is 0C")} });\n` },
];
const FILE = "test/shape.test.cjs";
function withFile<T>(src: string, fn: () => T): T {
  mkdirSync(join(AVA.dir, "test"), { recursive: true });
  writeFileSync(join(AVA.dir, FILE), src);
  try { return fn(); } finally { rmSync(join(AVA.dir, FILE), { force: true }); }
}
/** ava's own verdict (the reverted M187 credit source): its TAP finish block and exit code. */
const rawAva = (config: string, src: string) => withFile(src, () => runGroup(process.execPath, ["node_modules/ava/entrypoints/cli.mjs", "--config", `${config}.config.mjs`, "--tap", FILE], AVA.dir));
/** PeaceAI's shim, asked to run ava (it supports vitest / jest / mocha only). */
const shimAva = (src: string) => withFile(src, () => { installShim(AVA.dir); return runGroup(process.execPath, [SHIM_PATH, "ava", "", FILE], AVA.dir); });

test("M192 real ava: controls (ava's own verdict credits a real pass and not a real failure, in both modes)", { skip }, () => {
  assert.ok(AVA.ok, `npm ci of the pinned ava fixture failed: ${AVA.err}`);
  for (const config of ["procs", "threads"]) {
    const ok = rawAva(config, `${HEAD}${roman}test("9 is IX", (t) => t.is(roman(9), "IX"));\n`);
    const bad = rawAva(config, `${HEAD}${leap}test("1900 is not a leap year", (t) => t.false(isLeap(1900)));\n`);
    assert.ok(credited(ok), `${config}: a real pass: ${ok.tail} ${ok.status} ${ok.out.slice(-300)}`);
    assert.ok(!credited(bad) && bad.status !== 0, `${config}: a real failure is not credited: ${bad.tail} ${bad.status}`);
  }
});

test("M192 mutation (the defence removed: ava's own verdict trusted, as M187 did): every attack is a credited pass", { skip }, () => {
  for (const a of ATTACKS) {
    const r = rawAva(a.config, a.src);
    assert.ok(credited(r), `${a.id}: live against ava's verdict, got ${JSON.stringify(r.tail)} exit ${r.status} ${r.out.slice(-300)}`);
  }
});

test("M192 real ava: through PeaceAI every attack stays refused (detectRunner) and the shim credits nothing for ava", { skip }, () => {
  writeFileSync(join(AVA.dir, "package.json"), JSON.stringify({ ...JSON.parse(readFileSync(join(AVA.dir, "package.json"), "utf8")), scripts: { test: "ava" } }));
  for (const a of ATTACKS) {
    const v = withFile(a.src, () => { const r = detectRunner(AVA.dir, [FILE]); return "refuse" in r ? r.refuse : `admit:${r.runner}`; });
    assert.equal(v, "TEST_RUNNER_UNSUPPORTED", `${a.id}: refused at detection`);
    const s = shimAva(a.src);
    assert.ok(!credited(s), `${a.id}: the shim credits nothing for ava, got ${JSON.stringify(s.tail)} exit ${s.status}`);
    assert.deepEqual([s.tail, s.status], ["# pass 0\n# fail 1", SHIM_EXITS.NO_REPORT], `${a.id}: NO_REPORT`);
  }
});

// ---- 3. documented residual (not ava; spec "Residuals"): the same in-process class on a supported runner. A really
// failing vitest 4 test rewrites its own result in onTestFailed; vitest's main process trusts the worker's task
// state, and the shim credits it. M173 documents in-process framework reach on vitest / jest as not closed; this pins
// the strongest form found (fail -> pass) so the note stays true. Batch 26 (M193, m193-inproc-forge.test.ts): terminal
// at the runner; killed by the M175 edit gate in test files and in source.
const VI = fixture("vitest", "m173-forge-vitest4");
test("M192 residual, vitest 4 (documented, not closed): a failing test that rewrites ctx.task.result is credited today", { skip: skipFor(VI) }, () => {
  assert.ok(VI.ok, `npm ci of the pinned vitest fixture failed: ${VI.err}`);
  mkdirSync(join(VI.dir, "test"), { recursive: true });
  writeFileSync(join(VI.dir, "test/leap.test.js"), `import { test, expect } from "vitest";\n${leap}test("1900 is not a leap year", (ctx) => {\n  ctx.onTestFailed(() => { ctx.task.result.state = "pass"; ctx.task.result.errors = []; });\n  expect(isLeap(1900)).toBe(false);\n});\n`);
  installShim(VI.dir);
  const r = runGroup(process.execPath, [SHIM_PATH, "vitest", "", "test/leap.test.js"], VI.dir);
  assert.ok(credited(r), `vitest residual: credited today (if this fails the residual may be closed: update the spec), got ${JSON.stringify(r.tail)} exit ${r.status}`);
});

test("M192 hygiene: no process outlives the file's runs (checked last)", { skip: !existsSync("/proc/self") && "no /proc" }, () => {
  assert.deepEqual(survivors(base), []);
});
