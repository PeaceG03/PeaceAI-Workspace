// M173: Auditor's M171 follow-ups 1 and 3 (follow-up 2, the userns file guard, is in workflows.test.ts).
//  1. bin/loop.ts `proofs`: the rejection handler of runIsolationProofs prints `refused PROOFS_CRASHED` and exits 1.
//     A copy of bin/loop.ts (lib imports made absolute) has stage2CandUid stubbed to succeed and runIsolationProofs
//     stubbed to reject; the copy must print exactly that line and exit 1. Semantic mutants (the handler exits 0, the
//     handler is removed, the handler prints nothing) must each fail the same check.
//  3. lib/loopdeps.ts openWorkDir registers the new dir for removal right after mktemp, before the chmod; a child that
//     registers a fresh dir and is then stopped by SIGTERM / SIGINT / SIGHUP or exits must leave no dir behind, and must
//     still end by that signal (the hook re-raises it). SIGKILL is out of scope (it cannot be caught).
// Spec: peaceai/spec/repair-v2-m173.md.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "../..");
const libDir = join(ROOT, "peaceai/lib");
const binSrc = readFileSync(join(ROOT, "peaceai/bin/loop.ts"), "utf8");
const loopdepsSrc = readFileSync(join(libDir, "loopdeps.ts"), "utf8");
const scratch = mkdtempSync(join(tmpdir(), "m173-followups-"));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

const CAND_IMPORT = 'import { stage2CandUid } from "../lib/selfpropose.ts";';
const PROOFS_IMPORT = 'import { PROOFS, runIsolationProofs } from "../lib/loopdeps.ts";';
const HANDLER = '}, () => { console.log("refused PROOFS_CRASHED"); process.exit(1); });';
/** bin/loop.ts with absolute lib imports, a stage2CandUid that succeeds and a runIsolationProofs that rejects. */
function crashingCopy(src: string): string {
  assert.equal(src.split(CAND_IMPORT).length, 2, "the selfpropose import occurs once");
  assert.equal(src.split(PROOFS_IMPORT).length, 2, "the loopdeps proofs import occurs once");
  return src
    .replace(CAND_IMPORT, 'const stage2CandUid = (_e: unknown) => ({ ok: true as const, cand: { name: "m173-stub", uid: 4242 } });')
    .replace(PROOFS_IMPORT, 'import { PROOFS } from "../lib/loopdeps.ts";\nconst runIsolationProofs = (..._a: unknown[]): Promise<never> => Promise.reject(new Error("m173 stub crash"));')
    .replace(/from "\.\.\/lib\/([a-z0-9-]+\.ts)"/g, (_, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`);
}
/** Throws an AssertionError unless the copy prints exactly `refused PROOFS_CRASHED` and exits 1. */
function crashCheck(src: string, id: string): void {
  const bin = join(scratch, `${id}-loop.ts`);
  writeFileSync(bin, crashingCopy(src));
  const r = spawnSync(process.execPath, [...process.execArgv, bin, "proofs"], { encoding: "utf8", env: { PATH: process.env.PATH }, timeout: 120_000 });
  assert.equal(r.stdout, "refused PROOFS_CRASHED\n", `${id}: stdout`);
  assert.equal(r.status, 1, `${id}: exit status`);
}

test("M173 follow-up 1: bin/loop.ts proofs exits 1 and prints only refused PROOFS_CRASHED when the proofs reject", () => {
  assert.equal(binSrc.split(HANDLER).length, 2, "the rejection handler occurs once, as pinned");
  crashCheck(binSrc, "control");
});

const HANDLER_MUTANTS: readonly [string, string][] = [
  ["exit-0", '}, () => { console.log("refused PROOFS_CRASHED"); process.exit(0); });'],
  ["no-handler", "});"],
  ["silent-exit-1", "}, () => { process.exit(1); });"],
  ["no-exit", '}, () => { console.log("refused PROOFS_CRASHED"); });'],
];
for (const [id, to] of HANDLER_MUTANTS) {
  test(`M173 follow-up 1 mutation: the PROOFS_CRASHED handler mutant ${id} fails the check`, () => {
    assert.throws(() => crashCheck(binSrc.replace(HANDLER, to), id), assert.AssertionError, `no check notices ${id}`);
  });
}

// ---- follow-up 3
const TRACK = "  trackWorkDir(dir); // m173-guard:work-track (before the chmod)";
test("M173 follow-up 3: openWorkDir registers the dir after mktemp and before the chmod; close unregisters", () => {
  const body = loopdepsSrc.slice(loopdepsSrc.indexOf("export function openWorkDir("));
  const mk = body.indexOf('mkdtempSync(join(base, "peaceai-work-"))'), tr = body.indexOf(TRACK), ch = body.indexOf("chmodSync(dir, 0o750)");
  assert.ok(mk > 0 && tr > mk && ch > tr, "mktemp, then trackWorkDir, then chmod");
  assert.match(body, /const close = \(\) => \{ openWorkDirs\.delete\(dir\); removeWorkDir\(dir\); \};/);
  assert.match(body, /try \{ chmodSync\(dir, 0o750\); \} catch \{ close\(\); return null; \}/);
});

/** A child registers a fresh peaceai-work-* dir, then ends by `how`; returns the child's result and whether the dir is gone. */
function trackedChild(how: string, src = loopdepsSrc): { signal: NodeJS.Signals | null; status: number | null; gone: boolean; dir: string } {
  const lib = join(scratch, `loopdeps-${how}.ts`);
  writeFileSync(lib, src.replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`));
  const base = mkdtempSync(join(scratch, `base-${how}-`));
  const end = how === "exit" ? "process.exit(3);" : how === "throw" ? 'throw new Error("m173 child throw");' : `process.kill(process.pid, ${JSON.stringify(how)}); setTimeout(() => process.exit(0), 5000);`;
  const child = join(scratch, `child-${how}.ts`);
  writeFileSync(child, `import { mkdtempSync } from "node:fs";\nimport { join } from "node:path";\nimport { trackWorkDir } from ${JSON.stringify(pathToFileURL(lib).href)};\nconst dir = mkdtempSync(join(${JSON.stringify(base)}, "peaceai-work-"));\nconsole.log(dir);\ntrackWorkDir(dir);\n${end}\n`);
  const r = spawnSync(process.execPath, [...process.execArgv, child], { encoding: "utf8", timeout: 60_000 });
  const dir = r.stdout.trim().split("\n")[0] ?? "";
  assert.ok(dir.startsWith(join(base, "peaceai-work-")), `${how}: the child printed its dir`);
  return { signal: r.signal, status: r.status, gone: !existsSync(dir), dir };
}

for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  test(`M173 follow-up 3: a registered work dir is removed when the process is stopped by ${sig}, which still ends it`, () => {
    const r = trackedChild(sig);
    assert.ok(r.gone, `${sig}: ${r.dir} leaked`);
    assert.equal(r.signal, sig, `${sig}: the process did not end by the same signal`);
  });
}
test("M173 follow-up 3: a registered work dir is removed on process.exit and on an uncaught throw", () => {
  const e = trackedChild("exit");
  assert.ok(e.gone, "exit: leaked");
  assert.equal(e.status, 3);
  const t = trackedChild("throw");
  assert.ok(t.gone, "throw: leaked");
  assert.equal(t.status, 1);
});
test("M173 follow-up 3 mutation: without the exit and signal hooks the dir leaks (the checks above notice)", () => {
  const noHooks = loopdepsSrc.replace("  if (workHooks) return;", "  return;");
  assert.notEqual(noHooks, loopdepsSrc);
  assert.equal(trackedChild("SIGTERM", noHooks).gone, false, "the SIGTERM check would not notice");
  assert.equal(trackedChild("exit", noHooks).gone, false, "the exit check would not notice");
  const noReraise = loopdepsSrc.replace("sweepWorkDirs(); process.kill(process.pid, sig);", "sweepWorkDirs();");
  assert.notEqual(noReraise, loopdepsSrc);
  assert.notEqual(trackedChild("SIGTERM", noReraise).signal, "SIGTERM", "the re-raise check would not notice");
});
