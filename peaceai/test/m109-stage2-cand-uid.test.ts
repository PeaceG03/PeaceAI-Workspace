// M109 (Peace 2026-10-25, "Yes on all 4 go ahead": the stage-2 candidate user, required before any flag flip).
// Stage-2 candidate code runs only as a separate non-sudo uid that the Results run job creates (peaceai-cand), on a
// clone it can read but not change, with a private HOME/TMPDIR. These tests run off Actions, so the uid switch goes
// through a stub `sudo` first on PATH that logs its argv and runs the command as this user; the real switch only
// happens in the run job. The stub never grants anything: it just records what isolatedRun asked sudo to do.
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isolatedRun, runStage2InSandbox, STAGE2_CAND_ENV, stage2CandUid } from "../lib/selfpropose.ts";

const repo = resolve(import.meta.dirname, "../..");
const tmp = mkdtempSync(join(tmpdir(), "m109-cand-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));
const bin = join(tmp, "bin");
const log = join(tmp, "sudo.log");
const mode = join(tmp, "mode");
mkdirSync(bin);
// stub sudo: log argv; `-n -u U -- sudo -n true` answers from the mode file; `-u U -- true` fails in mode
// "unreachable"; chown is a no-op (non-root); everything else is run as this user.
writeFileSync(join(bin, "sudo"), `#!/bin/bash
printf '%s\\n' "$*" >> '${log}'
m=$(cat '${mode}' 2>/dev/null || true)
[ "$1" = "-n" ] || exit 64
shift
if [ "$1" = "-u" ]; then
  shift 2; [ "$1" = "--" ] || exit 64; shift
  if [ "$*" = "sudo -n true" ]; then [ "$m" = "has-sudo" ] && exit 0; exit 1; fi
  if [ "$*" = "true" ] && [ "$m" = "unreachable" ]; then exit 1; fi
  exec "$@"
fi
[ "$1" = "chown" ] && exit 0
exec "$@"
`);
chmodSync(join(bin, "sudo"), 0o755);
const withStub = <T>(m: string, f: () => T): T => {
  const saved = process.env.PATH;
  writeFileSync(mode, m);
  process.env.PATH = `${bin}:${saved ?? ""}`;
  try { return f(); } finally { process.env.PATH = saved; }
};
const me = spawnSync("id", ["-un"], { encoding: "utf8" }).stdout.trim();
const nobodyUid = Number(spawnSync("id", ["-u", "nobody"], { encoding: "utf8" }).stdout.trim());

test("M109: stage2CandUid accepts only an existing, separate, sudo-less uid the runner can switch to", () => {
  const r = (v: string | undefined, m = "ok") => withStub(m, () => stage2CandUid(v === undefined ? {} : { [STAGE2_CAND_ENV]: v }));
  assert.deepEqual(r(undefined), { ok: false, reason: "CAND_UID_REQUIRED" });
  assert.deepEqual(r(""), { ok: false, reason: "CAND_UID_REQUIRED" });
  for (const bad of ["Bad Name", "a;b", "-x", "../x", "x".repeat(40)]) assert.deepEqual(r(bad), { ok: false, reason: "CAND_UID_BAD_NAME" }, bad);
  assert.deepEqual(r("peaceai-no-such-user-m109"), { ok: false, reason: "CAND_UID_MISSING" });
  assert.deepEqual(r("root"), { ok: false, reason: "CAND_UID_NOT_SEPARATE" });
  if (me && me !== "root") assert.deepEqual(r(me), { ok: false, reason: "CAND_UID_NOT_SEPARATE" });
  assert.deepEqual(r("nobody", "unreachable"), { ok: false, reason: "CAND_UID_UNREACHABLE" });
  assert.deepEqual(r("nobody", "has-sudo"), { ok: false, reason: "CAND_UID_HAS_SUDO" });
  assert.deepEqual(r("nobody"), { ok: true, cand: { name: "nobody", uid: nobodyUid } });
});

test("M109: in the private job run2 refuses to run candidate code without the candidate uid", () => {
  const saved = process.env;
  process.env = { PATH: saved.PATH, GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "PeaceG03/PeaceAI-Results", GITHUB_EVENT_NAME: "workflow_dispatch", RUNNER_ENVIRONMENT: "github-hosted" };
  try {
    const r = runStage2InSandbox({ prepFile: "/nonexistent", bundle: "/nonexistent", source: repo, phase: "suite", out: "/nonexistent" });
    assert.deepEqual(r, { code: 3, message: "self-change stage2 refused reason=CAND_UID_REQUIRED" });
    process.env[STAGE2_CAND_ENV] = "root";
    assert.deepEqual(runStage2InSandbox({ prepFile: "/nonexistent", bundle: "/nonexistent", source: repo, phase: "suite", out: "/nonexistent" }), { code: 3, message: "self-change stage2 refused reason=CAND_UID_NOT_SEPARATE" });
  } finally { process.env = saved; }
});

test("M109: isolatedRun with a candidate uid goes through sudo -u <uid> env -i, private HOME/TMPDIR, read-only clone, no inherited secrets", () => {
  const work = join(tmp, "work");
  mkdirSync(join(work, "sub"), { recursive: true });
  symlinkSync(join(repo, "node_modules"), join(work, "node_modules"));
  writeFileSync(join(work, "a.test.ts"), `import test from "node:test";\nimport assert from "node:assert/strict";\ntest("env", () => {\n  assert.equal(process.env.GH_TOKEN, undefined);\n  assert.equal(process.env.M109_PARENT_ONLY, undefined);\n  assert.ok(process.env.HOME && process.env.HOME === process.env.TMPDIR && process.env.HOME.includes("peaceai-s2cand-home-"));\n});\n`);
  writeFileSync(join(work, "sub", "w.txt"), "x");
  chmodSync(join(work, "sub", "w.txt"), 0o666);
  chmodSync(work, 0o700);
  rmSync(log, { force: true });
  const saved = { ...process.env };
  process.env.GH_TOKEN = "m109-not-a-real-token";
  process.env.M109_PARENT_ONLY = "1";
  let r;
  try { r = withStub("ok", () => isolatedRun(work, ["--test", "--test-reporter=tap", "a.test.ts"], Date.now() + 120_000, { name: "nobody", uid: nobodyUid })); }
  finally { delete process.env.GH_TOKEN; delete process.env.M109_PARENT_ONLY; Object.assign(process.env, saved); }
  assert.deepEqual(r, { exitCode: 0, pass: 1, fail: 0, leftovers: 0 });
  const lines = readFileSync(log, "utf8").trim().split("\n");
  const run = lines.find((l) => l.startsWith("-n -u nobody -- env -i "));
  assert.ok(run, lines.join("\n"));
  const priv = /HOME=(\S+)/.exec(run!)![1]!;
  assert.match(run!, new RegExp(`TMPDIR=${priv.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `));
  assert.match(run!, / setsid --wait \S+\/node_modules\/\.bin\/tsx --test --test-reporter=tap a\.test\.ts$/);
  assert.doesNotMatch(run!, /GH_TOKEN|M109_PARENT_ONLY/);
  assert.ok(lines.includes(`-n chown nobody ${priv}`), "the private HOME is handed to the candidate uid");
  assert.ok(lines.includes(`-n rm -rf -- ${priv}`) && !existsSync(priv), "and removed afterwards");
  // the clone: traversable and readable by the candidate uid, writable by nobody but its owner
  assert.equal(statSync(work).mode & 0o777, 0o755);
  assert.equal(statSync(join(work, "sub", "w.txt")).mode & 0o022, 0);
  // without a candidate uid nothing goes through sudo (offline tests and dry runs)
  rmSync(log, { force: true });
  const plain = withStub("ok", () => isolatedRun(work, ["--test", "--test-reporter=tap", "a.test.ts"], Date.now() + 120_000));
  assert.equal(plain.exitCode, 1, "the HOME/TMPDIR assertion fails outside the candidate uid");
  assert.ok(!existsSync(log));
});

test("M109: the run job creates the sudo-less candidate user before run2 and names it only in the run2 step", () => {
  const wf = readFileSync(join(repo, "peaceai/results-repo/self-change-stage2.yml"), "utf8");
  const code = wf.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  const runJob = code.slice(code.indexOf("\n  run:\n"), code.indexOf("\n  record:\n"));
  const add = runJob.indexOf("sudo useradd --system --no-create-home --shell /usr/sbin/nologin peaceai-cand\n");
  assert.ok(add > 0, "the run job creates the user");
  assert.match(runJob, /if sudo -n -u peaceai-cand -- sudo -n true 2>\/dev\/null; then echo "peaceai-cand must not have sudo"; exit 1; fi/);
  const step = runJob.slice(runJob.indexOf("- name: Run phase"), runJob.indexOf("- name: Leftover process check"));
  assert.ok(add < runJob.indexOf("- name: Run phase"), "before any candidate code runs");
  assert.match(step, /\n {10}PEACEAI_STAGE2_CAND: peaceai-cand\n/);
  assert.match(step, /self-change\.ts run2 /);
  assert.equal((code.match(/useradd/g) ?? []).length, 1, "only the run job creates it");
  assert.equal((code.match(/PEACEAI_STAGE2_CAND/g) ?? []).length, 1, "only the run2 step names it");
});
