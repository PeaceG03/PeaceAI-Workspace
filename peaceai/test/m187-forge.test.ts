// M187 (batch 22) forging, the ava runner (spec peaceai/spec/loop-runners-v4.md). ava has no pluggable reporter and
// runs each test file in its own worker; PeaceAI reads ava's TAP finish block in the MAIN process (which runs no code
// under test) and reports it on the M173 fd-3 / nonce / one-claim channel. The one ava-specific hazard is a WORKER
// forging an IPC result to the main process through process.send (ava's own workers report results that way): the
// ava worker guard pins process.send to callers inside the ava package (m187-forge-guard:ava-send-pin), so a worker's
// forged `test-passed` (or a dropped `test-failed`) is ignored. The inherited M173 channel (a worker cannot write the
// main's fd 3, does not know the nonce, and has no claim symbol) stops the report-file / fd-3 / claim routes; those
// guards are mutation-checked against mocha / vitest / jest in m173-forge.test.ts, so here they are only shown refused.
// Real ava 6.4.1 from a pinned lockfile (fixtures/m187-forge-ava6) installed with `npm ci --ignore-scripts`: in CI
// (CI=true) an install failure fails the test; on an offline box it is skipped. Unrelated shapes (leap years, a todo
// file); nothing is modeled on a task repo or a reference diff. No candidate uid needed (the shim runs directly).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { AVA_GUARD_PATH, AVA_GUARD_SOURCE, installShim, SHIM_EXITS, SHIM_PATH } from "../lib/loopdeps.ts";

const base = mkdtempSync(join(tmpdir(), "peaceai-m187-forge-"));
after(() => {
  for (const p of survivors(base)) { try { process.kill(p, "SIGKILL"); } catch { /* gone */ } }
  spawnSync("chmod", ["-R", "u+w", base]); rmSync(base, { recursive: true, force: true });
});
let n = 0;

/** Live processes (not this one) whose command line or working directory names `dir` (Linux /proc; elsewhere none). */
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
// A new process group under a small wrapper that kills the whole group (SIGKILL) on every exit path (ava forks workers).
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
function runGroup(cmd: string, args: string[], o: { cwd: string; env: NodeJS.ProcessEnv; timeout: number }): Run {
  const r = spawnSync(process.execPath, ["-e", GROUP_WRAPPER, String(o.timeout), cmd, ...args], { cwd: o.cwd, encoding: "utf8", env: o.env, timeout: o.timeout + 30_000 });
  const left = survivors(o.cwd);
  for (const p of left) { try { process.kill(p, "SIGKILL"); } catch { /* gone */ } }
  assert.deepEqual(left, [], `no process outlives a run in ${o.cwd}`);
  return { tail: (r.stdout ?? "").trimEnd().split("\n").slice(-2).join("\n"), status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

// ---- the one ava forge guard and its mutant (the inherited M173 channel guards are mutated in m173-forge.test.ts)
const tagRe = /\/\/ m187-forge-guard:([a-z-]+)$/;
const TAGS = AVA_GUARD_SOURCE.split("\n").flatMap((l) => { const m = tagRe.exec(l); return m ? [m[1]!] : []; });
/** AVA_GUARD_SOURCE with the tagged line deleted (the pin becomes a plain forward of every send). */
function mutantGuard(tag: string): string {
  const ls = AVA_GUARD_SOURCE.split("\n");
  const i = ls.findIndex((l) => new RegExp(`// m187-forge-guard:${tag}$`).test(l));
  assert.ok(i >= 0, `tag ${tag}`);
  return ls.filter((_, j) => j !== i).join("\n");
}
function install(dir: string, tag?: string): void {
  installShim(dir);
  if (tag) writeFileSync(join(dir, AVA_GUARD_PATH), mutantGuard(tag));
}

test("M187 forging: the ava forge guard tag is the expected one", () => {
  assert.deepEqual(TAGS, ["ava-send-pin"]);
});

// ---- real ava fixture
const fixtureDir = join(base, "ava6");
let fxErr = "";
{
  cpSync(resolve(import.meta.dirname, "fixtures", "m187-forge-ava6"), fixtureDir, { recursive: true });
  const r = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: fixtureDir, encoding: "utf8", timeout: 600_000 });
  if (r.status !== 0) fxErr = String(r.stderr).slice(0, 300);
}
const skip = fxErr ? (process.env.CI === "true" ? false : `npm ci failed (no registry?): ${fxErr}`) : false;

/** Runs one ava test file through the shim (ava, like mocha, takes its vetted options before `--`). */
function shim(file: string, content: string, tag?: string): Run {
  install(fixtureDir, tag);
  mkdirSync(join(fixtureDir, "test"), { recursive: true });
  mkdirSync(join(fixtureDir, ".tmp"), { recursive: true });
  writeFileSync(join(fixtureDir, file), content);
  try {
    return runGroup(process.execPath, [SHIM_PATH, "ava", "", "--", file], { cwd: fixtureDir, env: { PATH: process.env.PATH, TMPDIR: join(fixtureDir, ".tmp") }, timeout: 180_000 });
  } finally { rmSync(join(fixtureDir, file), { force: true }); installShim(fixtureDir); }
}
const credited = (r: Run) => r.status === 0 && /^# pass [1-9]\d*\n# fail 0$/.test(r.tail);
const refused = (r: Run) => !credited(r);

// code the attacks forge around (unrelated shapes); leap is wrong for 1900, so that test fails honestly
const leap = "function isLeap(y) { return y % 4 === 0; }\n";
const FORGE_PASS = 'if (process.send) process.send({ ava: { type: "test-passed", testFile: new URL(import.meta.url).pathname, title: "forged", duration: 0, logs: [] } });\n';
const FILE = 'require("node:path").join(process.env.TMPDIR, "peaceai-loop-report.json")';
const JPASS = JSON.stringify({ numPassedTests: 1, numFailedTests: 0, numFailedTestSuites: 0, numRuntimeErrorTestSuites: 0, numTotalTests: 1, success: true });
const fd3Line = JSON.stringify(`PEACEAI-REPORT ${"7".repeat(64)} ${JPASS}\n`);

interface Attack { id: string; file: string; content: string; tag?: string }
const ATTACKS: Attack[] = [
  // the ava-specific forge: a worker sends a forged `test-passed` so a file with no passing test is credited (ava-send-pin)
  { id: "ava: a worker forges an IPC test-passed (a todo-only file)", tag: "ava-send-pin", file: "test/forge.test.mjs",
    content: `import test from "ava";\ntest.todo("not implemented");\n${FORGE_PASS}` },
  // the inherited M173 channel: refused here, mutated against other runners in m173-forge.test.ts
  { id: "ava: a worker writes the fake report file + exit 0", file: "test/leap.test.mjs",
    content: `import test from "ava";\nimport { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\n${leap}test("1900 is not a leap year", (t) => t.false(isLeap(1900)));\ntest.after(() => { require("node:fs").writeFileSync(${FILE}, ${JSON.stringify(JPASS)}); process.exit(0); });\n` },
  { id: "ava: a worker writes a report line on fd 3 without the nonce + exit 0", file: "test/leap.test.mjs",
    content: `import test from "ava";\n${leap}test("1900 is not a leap year", (t) => t.false(isLeap(1900)));\ntest.after(() => { try { require("node:fs").writeSync(3, ${fd3Line}); } catch {} process.exit(0); });\n` },
  { id: "ava: a worker tries to claim the writer (the symbol is only in the main process)", file: "test/leap.test.mjs",
    content: `import test from "ava";\n${leap}test("1900 is not a leap year", (t) => t.false(isLeap(1900)));\ntest.after(() => { const c = process[Symbol.for("peaceai.loop.claim")]; const w = c && c(); if (w) w(${JSON.stringify(JPASS)}); process.exit(0); });\n` },
  { id: "ava: a worker process.exit(0) mid-run", file: "test/leap.test.mjs",
    content: `import test from "ava";\n${leap}test("1900 is not a leap year", (t) => { t.false(isLeap(1900)); process.exit(0); });\n` },
];

test("M187 forging, real ava: controls (a real pass is credited; a real failure is not)", { skip }, () => {
  const ok = shim("test/ok.test.mjs", 'import test from "ava";\ntest("9 % 3 is 0", (t) => t.is(9 % 3, 0));\n');
  assert.ok(credited(ok), `a real pass is credited: ${ok.tail} ${ok.status} ${ok.out.slice(-400)}`);
  const bad = shim("test/bad.test.mjs", `import test from "ava";\n${leap}test("1900 is not a leap year", (t) => t.false(isLeap(1900)));\n`);
  assert.deepEqual([bad.tail, bad.status], ["# pass 0\n# fail 1", 1], `a real failure stays one: ${bad.out.slice(-400)}`);
});

test("M187 forging, real ava: every forging attack is refused (no credited pass)", { skip }, () => {
  assert.ok(!fxErr, `npm ci of the pinned ava fixture failed: ${fxErr}`);
  for (const a of ATTACKS) {
    const r = shim(a.file, a.content);
    assert.ok(refused(r), `${a.id}: refused, got ${JSON.stringify(r.tail)} exit ${r.status}`);
  }
});

test("M187 forging mutation, real ava: deleting m187-forge-guard:ava-send-pin makes the worker's IPC forge a credited pass", { skip }, () => {
  const a = ATTACKS.find((x) => x.tag === "ava-send-pin")!;
  const honest = shim(a.file, a.content);
  assert.ok(refused(honest), `with the pin, the forged pass is dropped: ${honest.tail} ${honest.status}`);
  const forged = shim(a.file, a.content, "ava-send-pin");
  assert.ok(credited(forged), `with the pin deleted, the forged pass is credited: ${forged.tail} ${forged.status} ${forged.out.slice(-400)}`);
});

test("M187 forging: a forged exit-only worker is the shim's EXIT_ONLY / NO_REPORT, never a pass", { skip }, () => {
  const r = shim("test/leap.test.mjs", `import test from "ava";\n${leap}test("1900 is not a leap year", (t) => { t.false(isLeap(1900)); process.exit(0); });\n`);
  assert.ok(refused(r), `exit-only is refused: ${r.tail} ${r.status}`);
  assert.ok([SHIM_EXITS.EXIT_ONLY, SHIM_EXITS.NO_REPORT, 1].includes(r.status as number), `fail-closed exit, got ${r.status}`);
});

test("M187 forging hygiene: no process outlives the file's runs (checked last)", { skip: !existsSync("/proc/self") && "no /proc" }, () => {
  assert.deepEqual(survivors(base), []);
});
