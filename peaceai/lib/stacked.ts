// Stacked-batch landing (Architect-approved, for Auditor). Several tasks of one batch were all graded on the
// same base X and each has a recorded `/verdict <label> right`. After the first lands, main is Y != X and
// apply-verdict-patch.sh refuses every other patch as stale. Carry-forward (lib/carry.ts) cannot help: it
// only fires inside a comment-sourced verdict run, and a recorded verdict is never rewritten (store.ts).
// This route keeps the base check and adds ONE narrow exception, used by apply-verdict-patch.ts only when
// `--stacked-batch <issues>` is given. A patch graded on X may land on Y only if ALL hold (else REFUSED):
//   (a) every commit in X..Y is a landed PeaceAI verdict patch of the same batch: linear first-parent chain,
//       noreply author, and its diff equals (byte for byte) the Results-verified diff of a batch issue whose
//       task base is X; each batch issue matches at most one commit, the landing issue none;
//   (b) the task's touched files are disjoint from every file those commits changed;
//   (c) the patch applies byte-identically on Y: plain `git am` (no 3-way), and the resulting commit's diff
//       equals the verified diff;
//   (d) the target's full suite passes on the result, in a throwaway worktree, before the real worktree is
//       touched. Nothing is pushed here, ever.
// No verdict record is written, fabricated or reused for another attempt; Results is only read (as before).
// The provenance clause (base X, landed-on Y, intermediate shas) goes into the builder-log `why`, and
// builder-log/trace.ts re-checks it against git.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffPaths } from "./carry.ts";
import { NOREPLY_EMAIL, sha256 } from "./patch.ts";

const SHA = /^[0-9a-f]{40}$/;

export type StackReason =
  | "stack_bad_input" // malformed shas / empty batch
  | "stack_not_linear" // X not an ancestor of Y, a merge in X..Y, or a broken first-parent chain
  | "stack_foreign_commit" // a commit in X..Y is not a verified verdict patch of this batch (or not noreply)
  | "stack_other_base" // a matched batch issue was graded on a base other than X
  | "stack_duplicate" // two commits match one batch issue, or a commit matches the landing issue itself
  | "stack_files_overlap" // the task touches a file an intermediate commit changed
  | "stack_not_byte_identical" // the patch does not apply as-is on Y, or the applied diff differs
  | "stack_suite_failed"; // full suite failed on Y + patch

export interface BatchMember { issue: number; baseSha: string; diff: string }
export interface StackCommit { sha: string; parents: string[]; authorEmail: string; diff: string }
export interface StackInput {
  issue: number;
  base: string; // X: the landing task's graded base
  head: string; // Y: current main
  diff: string; // the landing task's verified diff
  members: readonly BatchMember[]; // other batch issues, each verified against Results exactly as the normal path
  commits: readonly StackCommit[] | null; // X..Y oldest first; null when X is not an ancestor of Y or a merge exists
}
export type StackDecision = { ok: true; via: { sha: string; issue: number }[] } | { ok: false; reason: StackReason; detail: string };

const norm = (d: string) => d.replace(/\n*$/, "\n");
export const sameDiff = (a: string, b: string) => sha256(norm(a)) === sha256(norm(b));

/** Conditions (a) and (b). Pure. (c) and (d) need git and the suite: see trialLand(). */
export function checkStack(i: StackInput): StackDecision {
  const no = (reason: StackReason, detail: string): StackDecision => ({ ok: false, reason, detail });
  if (!SHA.test(i.base) || !SHA.test(i.head) || i.base === i.head || !i.diff) return no("stack_bad_input", "base/head must be distinct full shas and the diff non-empty");
  if (!i.commits || i.commits.length === 0) return no("stack_not_linear", "base is not a strict ancestor of head through a merge-free chain");
  let prev = i.base;
  for (const c of i.commits) {
    if (c.parents.length !== 1 || c.parents[0] !== prev) return no("stack_not_linear", `commit ${c.sha.slice(0, 12)} breaks the first-parent chain`);
    prev = c.sha;
  }
  if (prev !== i.head) return no("stack_not_linear", "chain does not end at head");
  const used = new Set<number>();
  const via: { sha: string; issue: number }[] = [];
  const changed = new Set<string>();
  for (const c of i.commits) {
    if (c.authorEmail !== NOREPLY_EMAIL) return no("stack_foreign_commit", `commit ${c.sha.slice(0, 12)} author is not the noreply identity`);
    if (sameDiff(c.diff, i.diff)) return no("stack_duplicate", `commit ${c.sha.slice(0, 12)} is the landing task's own patch`);
    const hits = i.members.filter((m) => m.issue !== i.issue && sameDiff(m.diff, c.diff));
    if (hits.length === 0) return no("stack_foreign_commit", `commit ${c.sha.slice(0, 12)} matches no verified patch of this batch`);
    if (hits.length > 1) return no("stack_duplicate", `commit ${c.sha.slice(0, 12)} matches several batch issues`);
    const m = hits[0]!;
    if (m.baseSha !== i.base) return no("stack_other_base", `#${m.issue} was graded on ${m.baseSha.slice(0, 12)}, not ${i.base.slice(0, 12)}`);
    if (used.has(m.issue)) return no("stack_duplicate", `#${m.issue} matches more than one commit`);
    used.add(m.issue);
    via.push({ sha: c.sha, issue: m.issue });
    for (const f of diffPaths(c.diff)) changed.add(f);
  }
  const touched = diffPaths(i.diff);
  if (touched.length === 0) return no("stack_bad_input", "the landing diff names no files");
  const overlap = touched.filter((f) => changed.has(f));
  if (overlap.length) return no("stack_files_overlap", `${overlap.length} touched file(s) changed between base and head`);
  return { ok: true, via };
}

// ---------- provenance (builder-log `why` clause; trace.ts re-checks it) ----------
export function provenanceClause(base: string, onto: string, via: readonly string[]): string {
  return `stacked: base ${base.slice(0, 12)} landed-on ${onto.slice(0, 12)} via ${via.map((s) => s.slice(0, 12)).join("+")}`;
}
export function parseProvenance(why: string): { base: string; onto: string; via: string[] } | null {
  const all = [...why.matchAll(/\bstacked: base ([0-9a-f]{12}) landed-on ([0-9a-f]{12}) via ([0-9a-f]{12}(?:\+[0-9a-f]{12})*)\b/g)];
  if (all.length !== 1) return null;
  const m = all[0]!;
  return { base: m[1]!, onto: m[2]!, via: m[3]!.split("+") };
}

// ---------- git side ----------
const run = (dir: string, args: string[], env?: NodeJS.ProcessEnv) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } });
const out = (dir: string, args: string[]) => {
  const r = run(dir, args);
  if (r.status !== 0) throw new Error(`git ${args[0]} failed`);
  return r.stdout.trim();
};

/** X..Y oldest first, or null if X is not a strict ancestor of Y or any commit in the range is a merge. */
export function collectStack(worktree: string, base: string, head: string): StackCommit[] | null {
  if (run(worktree, ["merge-base", "--is-ancestor", base, head]).status !== 0 || base === head) return null;
  const all = out(worktree, ["rev-list", "--reverse", `${base}..${head}`]).split("\n").filter(Boolean);
  const fp = out(worktree, ["rev-list", "--reverse", "--first-parent", `${base}..${head}`]).split("\n").filter(Boolean);
  if (all.join() !== fp.join()) return null;
  return all.map((sha) => {
    const [parents, email] = out(worktree, ["log", "-1", "--format=%P%n%ae", sha]).split("\n");
    const diff = run(worktree, ["diff", "--full-index", `${sha}^`, sha]).stdout;
    return { sha, parents: (parents ?? "").split(" ").filter(Boolean), authorEmail: email ?? "", diff };
  });
}

export type TrialResult = { ok: true; tree: string } | { ok: false; reason: StackReason; detail: string };
/**
 * (c) + (d): in a throwaway detached worktree at Y, plain `git am` the patch (no 3-way), require the commit's
 * diff to equal the verified diff, and run the full suite. The caller's worktree is never touched here.
 */
export function trialLand(o: { worktree: string; head: string; patch: string; diff: string; identity: { name: string; email: string }; suite: (dir: string) => boolean }): TrialResult {
  const tmp = mkdtempSync(join(tmpdir(), "peaceai-stack-"));
  const wt = join(tmp, "wt");
  try {
    if (run(o.worktree, ["worktree", "add", "--detach", wt, o.head]).status !== 0) return { ok: false, reason: "stack_not_byte_identical", detail: "could not create the trial worktree" };
    const file = join(tmp, "p.patch");
    writeFileSync(file, o.patch);
    const am = run(wt, ["-c", `user.name=${o.identity.name}`, "-c", `user.email=${o.identity.email}`, "am", "--quiet", "--no-3way", file]);
    if (am.status !== 0) return { ok: false, reason: "stack_not_byte_identical", detail: "git am does not apply the patch as-is on head" };
    if (!sameDiff(run(wt, ["diff", "--full-index", "HEAD^", "HEAD"]).stdout, o.diff)) return { ok: false, reason: "stack_not_byte_identical", detail: "applied diff differs from the verified diff" };
    if (!o.suite(wt)) return { ok: false, reason: "stack_suite_failed", detail: "full suite failed on head + patch" };
    return { ok: true, tree: out(wt, ["rev-parse", "HEAD^{tree}"]) };
  } finally {
    run(o.worktree, ["worktree", "remove", "--force", wt]);
    rmSync(tmp, { recursive: true, force: true });
    run(o.worktree, ["worktree", "prune"]);
  }
}
