// M219 (batch 55): live self-loop wiring - clean clone HEAD -> failing self-test or practice break -> PlanTask -> loop.
// Spec: peaceai/spec/self-loop-live-v1.md. EXPERIMENTAL, NOT default, NOT for credit.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import * as L from "../lib/self-loop-live.ts";
import * as S from "../lib/self-loop-task.ts";
import { STAGE2_CAND_ENV, stage2CandUid } from "../lib/selfpropose.ts";

const libDir = join(import.meta.dirname, "../lib");
const specPath = join(import.meta.dirname, "../spec/self-loop-live-v1.md");
const CAND = process.env.M219_CAND ?? process.env.M218_CAND ?? process.env.M146_CAND ?? "";
const cu = stage2CandUid({ [STAGE2_CAND_ENV]: CAND });
const cand = cu.ok;
const skipE2e = !cand && "needs stage-2 candidate uid (M219_CAND / M146_CAND = peaceai-cand3)";
const env = { ...process.env, [STAGE2_CAND_ENV]: CAND, PEACEAI_TSX: join(import.meta.dirname, "../../node_modules/.bin/tsx") };
process.env.PEACEAI_TSX = env.PEACEAI_TSX;

const G = ["-c", "user.name=PeaceG03", "-c", "user.email=301894882+PeaceG03@users.noreply.github.com", "-c", "commit.gpgsign=false"];
const git = (cwd: string, ...a: string[]) => execFileSync("git", [...G, ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

const base = mkdtempSync(join(tmpdir(), "peaceai-m219-"));
after(() => rmSync(base, { recursive: true, force: true }));

const HELPER = "peaceai/self-tests/helpers/dates.ts";
const HELPER_OK = `export function utcDayKey(d: Date): string {\n  return d.toISOString().slice(0, 10);\n}\nexport function minutesOfUtcDay(d: Date): number {\n  return d.getUTCHours() * 60 + d.getUTCMinutes();\n}\nexport function utcMonthKey(day: string): string {\n  const d = day.slice(0, 10);\n  if (d.length !== 10) throw new Error("BAD_DAY");\n  return d.slice(0, 7);\n}\n`;
const SELF_TEST = `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { utcMonthKey } from "./dates.ts";\ntest("utcMonthKey returns the expected values", () => {\n  assert.equal(utcMonthKey("2026-10-16"), "2026-10");\n});\n`;
const pkg = JSON.stringify({
  name: "fixture",
  private: true,
  type: "module",
  scripts: { test: "node --test" },
}, null, 1) + "\n";

function buildCleanFixture(dir: string): string {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  const put = (p: string, c: string) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); };
  put(".gitignore", "node_modules\n");
  put("package.json", pkg);
  put(HELPER, HELPER_OK);
  put("peaceai/self-tests/helpers/dates.ok.test.ts", SELF_TEST);
  put("peaceai/self-tests/helpers/text.ts", `export function plural(c: number, w: string): string { return c === 1 ? c + " " + w : c + " " + w + "s"; }\n`);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "fixture head");
  // install tsx for discovery (best-effort from host node_modules via npm pack is heavy; copy symlink from host if present)
  const hostTsx = join(import.meta.dirname, "../../node_modules");
  try {
    execFileSync("npm", ["ci", "--ignore-scripts"], { cwd: dir, stdio: "ignore" });
  } catch {
    // fall back: nest a minimal node_modules/tsx by linking host
    try {
      mkdirSync(join(dir, "node_modules"), { recursive: true });
      execFileSync("cp", ["-a", join(hostTsx, "tsx"), join(dir, "node_modules", "tsx")], { stdio: "ignore" });
      // tsx needs esbuild optionally; discovery uses tsx --test
    } catch { /* findFailingSelfTests may use PATH */ }
  }
  return git(dir, "rev-parse", "HEAD");
}

test("M219 pins: live refusals for dest/head/dirty; protected stays refused", () => {
  const host = join(base, "host");
  mkdirSync(host, { recursive: true });
  assert.equal(L.liveDestRefusal("relative", host), "SELF_LOOP_LIVE_DEST");
  assert.equal(L.liveDestRefusal(join(host, "inside"), host), "SELF_LOOP_LIVE_DEST");
  assert.equal(L.liveDestRefusal(join(base, "outside-clone"), host), null);
  assert.equal(L.liveHeadRefusal(join(base, "missing"), "a".repeat(40)), "SELF_LOOP_LIVE_CLONE");
  assert.equal(S.selfLoopEditRefusal("peaceai/lib/loop.ts"), "SELF_LOOP_PROTECTED");
  assert.equal(S.selfLoopEditRefusal(L.PRACTICE_HELPER), null);
});

test("M219 spec names clean clone, practice break, experimental row", () => {
  const spec = readFileSync(specPath, "utf8");
  assert.match(spec, /clean clone|never the working/i);
  assert.match(spec, /M219-PRACTICE-BREAK|practice break/i);
  assert.match(spec, /experimental/i);
  assert.match(spec, /not for credit/i);
  assert.match(spec, /SELF_LOOP_LIVE_DIRTY|SELF_LOOP_LIVE_HEAD/);
  assert.match(spec, /m219-guard/);
});

test("M219 prepare: HEAD mismatch and dirty tree refuse; practice seed builds a task", () => {
  const host = join(base, "host-prep");
  mkdirSync(host, { recursive: true });
  const clean = join(base, "clean-prep");
  const head = buildCleanFixture(clean);
  const scratch = join(base, "scratch-prep");
  const outClone = join(base, "clone-unused");

  // HEAD mismatch
  const badHead = L.prepareSelfLoopLive({
    expectedHead: "b".repeat(40),
    cloneDest: outClone,
    scratchDest: scratch,
    hostWorkspace: host,
    existingCleanDir: clean,
  });
  assert.equal(badHead.ok, false);
  assert.equal(badHead.ok === false && badHead.code, "SELF_LOOP_LIVE_HEAD");

  // dirty
  const tracked = join(clean, HELPER);
  const prev = readFileSync(tracked, "utf8");
  writeFileSync(tracked, prev + "// dirt\n");
  const dirty = L.liveHeadRefusal(clean, head);
  assert.equal(dirty, "SELF_LOOP_LIVE_DIRTY");
  writeFileSync(tracked, prev);
  git(clean, "checkout", "-q", "--", HELPER);

  // practice seed (no failing self-tests)
  const ok = L.prepareSelfLoopLive({
    expectedHead: head,
    cloneDest: outClone,
    scratchDest: scratch,
    hostWorkspace: host,
    existingCleanDir: clean,
    seedIfClean: true,
  });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  if (!ok.ok) return;
  assert.equal(ok.seeded, true);
  assert.equal(ok.gap.editPath, L.PRACTICE_HELPER);
  assert.equal(ok.gap.testPath, L.PRACTICE_TEST);
  assert.match(readFileSync(join(ok.scratchDir, L.PRACTICE_HELPER), "utf8"), /utcDayKey/);
  // reference merge has the fix (no practice marker)
  const show = execFileSync("git", ["show", `${ok.gap.merge}:${L.PRACTICE_HELPER}`], { cwd: ok.scratchDir, encoding: "utf8" });
  assert.equal(show.includes(L.PRACTICE_BREAK_MARKER), false);
  const broken = execFileSync("git", ["show", `${ok.gap.commit}:${L.PRACTICE_HELPER}`], { cwd: ok.scratchDir, encoding: "utf8" });
  assert.ok(broken.includes(L.PRACTICE_BREAK_MARKER));
});

test("M219 e2e: practice-seeded live gap plans, edits, verifies as cand3 (or CAND_UID_*)", { skip: skipE2e || false }, () => {
  const host = join(base, "host-e2e");
  mkdirSync(join(host, "peaceai/plan"), { recursive: true });
  git(host, "init", "-q", "-b", "main");
  chmodSync(host, 0o755);
  const clean = join(base, "clean-e2e");
  const head = buildCleanFixture(clean);
  const scratch = join(base, "scratch-e2e");
  const out = join(base, "out-e2e");
  const prepared = L.prepareSelfLoopLive({
    expectedHead: head,
    cloneDest: join(base, "clone-e2e-unused"),
    scratchDest: scratch,
    hostWorkspace: host,
    existingCleanDir: clean,
  });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  if (!prepared.ok) return;
  const ran = L.runSelfLoopLive({
    prepared,
    hostWorkspace: host,
    outDir: out,
    env,
    proposer: L.practiceBreakProposer(),
    maxAttempts: 3,
    runMs: 90_000,
  });
  assert.equal(ran.ok, true, JSON.stringify(ran));
  if (!ran.ok) return;
  assert.equal(ran.row.experimental, true);
  assert.equal(ran.row.credit, false);
  assert.equal(ran.row.schema, L.SELF_LOOP_LIVE_SCHEMA);
  const log = readFileSync(join(out, L.SELF_LOOP_LIVE_LOG), "utf8").trim().split("\n");
  assert.equal(log.length, 1);
  if (!cand) {
    assert.match(String(ran.row.loopCode), /^CAND_UID_/);
    return;
  }
  assert.equal(ran.row.loopCode, "PASS", JSON.stringify(ran.row));
  assert.equal(ran.row.result, "pass");
});

test("M219 protected path never prepares a live task from practice helper swap", () => {
  // buildSelfLoopTask already refuses; live prepare uses PRACTICE_HELPER only
  assert.equal(S.selfLoopEditRefusal("peaceai/lib/loop.ts"), "SELF_LOOP_PROTECTED");
  assert.equal(S.selfLoopEditRefusal(".github/workflows/tests.yml"), "SELF_LOOP_PROTECTED");
  assert.equal(L.liveDestRefusal("/tmp/ok-outside", "/workspace/batch55"), null);
});

// ---- mutation
const SRC = readFileSync(join(libDir, "self-loop-live.ts"), "utf8");
const tsPath = createRequire(join(libDir, "self-loop-live.ts")).resolve("typescript");
function rewrite(t: string): string {
  return t
    .replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`)
    .replace(/from "typescript"/g, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`);
}
const tagsOf = (t: string) => t.split("\n").flatMap((l) => {
  const m = /\/\/ m219-guard:([a-z0-9-]+)/.exec(l);
  return m ? [m[1]!] : [];
});
const drop = (text: string, tag: string) => {
  const ls = text.split("\n");
  const hit = (l: string) => new RegExp(`// m219-guard:${tag}(?![a-z0-9-])`).test(l);
  assert.equal(ls.filter(hit).length, 1, `one line holds ${tag}`);
  return ls.filter((l) => !hit(l)).join("\n");
};

test("M219 mutation: every m219-guard has a case; deleting it is caught", async () => {
  const tags = tagsOf(SRC);
  assert.deepEqual(tags.sort(), ["dest", "dirty", "head", "outside"]);
  const dir = join(base, "mut");
  mkdirSync(dir, { recursive: true });
  const load = async (text: string) => {
    const f = join(dir, `m-${tagsOf(text).join("") || "ctrl"}-${Math.random().toString(16).slice(2)}.ts`);
    writeFileSync(f, rewrite(text));
    return (await import(pathToFileURL(f).href)) as typeof L;
  };
  const control = await load(SRC);
  const host = join(base, "mut-host");
  mkdirSync(host, { recursive: true });
  assert.equal(control.liveDestRefusal("rel", host), "SELF_LOOP_LIVE_DEST");
  assert.equal(control.liveDestRefusal(join(host, "in"), host), "SELF_LOOP_LIVE_DEST");

  {
    const m = await load(drop(SRC, "dest"));
    // without absolute check, a relative path may still fail outside check depending on resolve - use empty string
    // Deleting dest line removes !isAbsolute check; "" still fails typeof/empty before the guard.
    // A path like "relative/x" without absolute check: resolve("relative/x") is cwd-relative absolute, then outside may pass.
    assert.equal(m.liveDestRefusal("relative/x", host), null);
  }
  {
    const m = await load(drop(SRC, "outside"));
    assert.equal(m.liveDestRefusal(join(host, "inside"), host), null);
  }
  // head + dirty need a real git dir
  const gdir = join(base, "mut-git");
  mkdirSync(gdir, { recursive: true });
  git(gdir, "init", "-q", "-b", "main");
  writeFileSync(join(gdir, "f"), "1");
  git(gdir, "add", "f");
  git(gdir, "commit", "-q", "-m", "c");
  const sha = git(gdir, "rev-parse", "HEAD");
  {
    const m = await load(drop(SRC, "head"));
    assert.notEqual(m.liveHeadRefusal(gdir, "a".repeat(40)), "SELF_LOOP_LIVE_HEAD");
  }
  writeFileSync(join(gdir, "f"), "2");
  {
    const m = await load(drop(SRC, "dirty"));
    assert.equal(m.liveHeadRefusal(gdir, sha), null);
  }
  void control;
});
