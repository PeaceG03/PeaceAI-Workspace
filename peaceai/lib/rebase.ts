// M16: stale-base re-apply and fresh grading for a chosen candidate patch (Builder side, on the box).
// When the target has moved past the task base, the candidate is re-applied onto the CURRENT head with a
// plain `git am` (no 3-way, no conflict resolution): anything that does not apply cleanly is refused. It is
// then graded FRESH on the new tree; the grade recorded at task time is never carried forward:
//   - the original suite must pass with the candidate applied;
//   - each new test file the candidate adds must PASS with it, and FAIL with its non-test edit taken back
//     out (the new head plus only the candidate's new tests).
// On any refusal the worktree is reset to the head it started from (only the commit made here is dropped).
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stubFunction } from "./learned-function.ts";

export interface RegradeRunners {
  /** Runs the target's original suite in `dir`; true when it passes. */
  suite: (dir: string) => boolean;
  /** Runs exactly these test files in `dir`; true when they all pass. */
  tests: (dir: string, files: string[]) => boolean;
}
export type RegradeResult =
  | { ok: true; stale: boolean; head: string; base: string; newHead: string; grade: FreshGrade }
  | { ok: false; reason: string };
export interface FreshGrade { suite: boolean; newTests: string[]; afterPass: boolean | null; beforeFail: boolean | null; stubFail?: boolean; verdict: "COUNTS" | "NO_NEW_TESTS" }
/** M17: the regrade record (old base -> new head -> fresh grade), kept with the verdict's applied commit. */
export interface RegradeRecord {
  schema: "peaceai-regrade:v1"; issue: number; runId: string; candidateId: string; diffSha256: string; patchSha256: string;
  oldBase: string; newHead: string; /** null inside the commit's own trailer (a commit cannot name itself). */ appliedCommit: string | null; gradedAt: string; grade: FreshGrade;
}
export function regradeRecord(r: { issue: number; runId: string; candidateId: string; diffSha256: string; patchSha256: string; oldBase: string; newHead: string; appliedCommit: string | null; grade: FreshGrade; now?: Date }): RegradeRecord {
  return { schema: "peaceai-regrade:v1", issue: r.issue, runId: r.runId, candidateId: r.candidateId, diffSha256: r.diffSha256, patchSha256: r.patchSha256, oldBase: r.oldBase, newHead: r.newHead, appliedCommit: r.appliedCommit, gradedAt: (r.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z"), grade: r.grade };
}

const isTest = (p: string) => /\.test\.(tsx?|mjs|js)$/.test(p);

/** Files the patch adds/changes, split into new test files and everything else. */
export function patchFiles(patch: string): { newTests: string[]; others: string[] } {
  const newTests: string[] = [];
  const others: string[] = [];
  const blocks = patch.split(/^diff --git /m).slice(1);
  for (const b of blocks) {
    const m = /^a\/(\S+) b\/(\S+)/.exec(b);
    if (!m) continue;
    const created = /^new file mode /m.test(b);
    (created && isTest(m[2]!) ? newTests : others).push(m[2]!);
  }
  return { newTests, others };
}

/** The fresh verdict from the three observed facts. Pure. */
export function freshVerdict(g: { suite: boolean; newTests: string[]; afterPass: boolean | null; beforeFail: boolean | null; stubFail?: boolean }): FreshGrade | { reason: string } {
  if (!g.suite) return { reason: "regrade: original suite fails on the new base" };
  if (g.newTests.length === 0) return { ...g, verdict: "NO_NEW_TESTS" };
  if (!g.afterPass) return { reason: "regrade: the candidate's new test fails on the new base" };
  if (!g.beforeFail) return { reason: "regrade: the candidate's new test passes without its edit on the new base (proves nothing)" };
  if (g.stubFail === false) return { reason: "regrade: the candidate's new test passes with the added function's body stubbed" };
  return { ...g, verdict: "COUNTS" };
}

export function rebaseAndRegrade(o: { worktree: string; patchFile: string; baseSha: string; identity: { name: string; email: string }; run: RegradeRunners }): RegradeResult {
  const git = (...a: string[]) => spawnSync("git", ["-C", o.worktree, ...a], { encoding: "utf8" });
  const out = (...a: string[]) => { const r = git(...a); if (r.status !== 0) throw new Error(`git ${a[0]} failed`); return r.stdout.trim(); };
  const head = out("rev-parse", "HEAD");
  const stale = head !== o.baseSha;
  const am = git("-c", `user.name=${o.identity.name}`, "-c", `user.email=${o.identity.email}`, "am", "--quiet", o.patchFile);
  if (am.status !== 0) {
    git("am", "--abort");
    return { ok: false, reason: stale ? "stale base: candidate does not apply cleanly onto the current head (refused; not resolved)" : "git am failed" };
  }
  const undo = (reason: string): RegradeResult => { git("reset", "--quiet", "--hard", head); return { ok: false, reason }; };
  if (!stale) return { ok: true, stale, head, base: o.baseSha, newHead: out("rev-parse", "HEAD"), grade: { suite: true, newTests: [], afterPass: null, beforeFail: null, verdict: "NO_NEW_TESTS" } };
  const { newTests, others } = patchFiles(readFileSync(o.patchFile, "utf8"));
  const suite = o.run.suite(o.worktree);
  const afterPass = newTests.length ? o.run.tests(o.worktree, newTests) : null;
  let beforeFail: boolean | null = null;
  // M17: an added exported function (one, in one non-test file) is also stubbed; the new test must fail then.
  let stubFail: boolean | undefined;
  const fnMatches = [...readFileSync(o.patchFile, "utf8").matchAll(/^\+export function ([A-Za-z_$][\w$]*)\(/gm)].map((m) => m[1]!);
  if (newTests.length && fnMatches.length === 1 && others.length === 1) {
    const file = join(o.worktree, others[0]!);
    const real = readFileSync(file, "utf8");
    const stub = stubFunction(real, fnMatches[0]!);
    if (stub !== null) { writeFileSync(file, stub); stubFail = !o.run.tests(o.worktree, newTests); writeFileSync(file, real); }
  }
  if (newTests.length) {
    // Before: the new head, plus only the candidate's new tests (its other edits taken back out).
    if (others.length && git("checkout", "--quiet", head, "--", ...others.filter((f) => git("cat-file", "-e", `${head}:${f}`).status === 0)).status !== 0) return undo("regrade: could not take the edit back out");
    for (const f of others) if (git("cat-file", "-e", `${head}:${f}`).status !== 0) git("rm", "--quiet", "-f", "--", f);
    beforeFail = !o.run.tests(o.worktree, newTests);
    git("reset", "--quiet", "--hard", "HEAD");
  }
  const v = freshVerdict({ suite, newTests, afterPass, beforeFail, ...(stubFail === undefined ? {} : { stubFail }) });
  if ("reason" in v) return undo(v.reason);
  return { ok: true, stale, head, base: o.baseSha, newHead: out("rev-parse", "HEAD"), grade: v };
}

