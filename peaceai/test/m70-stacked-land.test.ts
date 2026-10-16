// Stacked-batch landing (lib/stacked.ts): every refusal case and the happy path, on a real git repo.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NOREPLY_EMAIL, NOREPLY_NAME, splitPatch } from "../lib/patch.ts";
import { protectedReason } from "../lib/selfchange.ts";
import { checkStack, collectStack, parseProvenance, provenanceClause, trialLand, type BatchMember } from "../lib/stacked.ts";

const ID = { name: NOREPLY_NAME, email: NOREPLY_EMAIL };
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "m70-"));
  const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: NOREPLY_NAME, GIT_AUTHOR_EMAIL: NOREPLY_EMAIL, GIT_COMMITTER_NAME: NOREPLY_NAME, GIT_COMMITTER_EMAIL: NOREPLY_EMAIL } }).trim();
  g("init", "-q", "-b", "main");
  for (const f of ["a", "b", "c"]) writeFileSync(join(dir, `${f}.ts`), `export const ${f} = 1;\n`);
  g("add", "."); g("commit", "-qm", "base");
  const X = g("rev-parse", "HEAD");
  /** A one-commit format-patch on X editing `file` (as the verdict-patch comment carries it). */
  const mk = (file: string, line: string) => {
    g("checkout", "-q", "--detach", X);
    writeFileSync(join(dir, file), readFileSync(join(dir, file), "utf8") + line + "\n");
    g("commit", "-qam", `edit ${file}`);
    const patch = g("format-patch", "--stdout", "--no-signature", "--no-stat", "--full-index", "-1", "HEAD") + "\n";
    g("checkout", "-q", "main");
    const p = splitPatch(patch);
    if ("error" in p) throw new Error(p.error);
    return { patch, diff: p.diff };
  };
  const am = (patch: string) => { const f = join(dir, "..", `${Math.random()}.patch`); writeFileSync(f, patch); g("am", "-q", "--no-3way", f); rmSync(f); return g("rev-parse", "HEAD"); };
  return { dir, g, X, mk, am, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("happy path: #288 landed on X, #289 (disjoint) lands on Y byte-identically, suite run in a throwaway worktree", () => {
  const r = repo();
  try {
    const p288 = r.mk("a.ts", "export const a2 = 2;"), p289 = r.mk("b.ts", "export const b2 = 2;");
    const Y = r.am(p288.patch);
    const members: BatchMember[] = [{ issue: 288, baseSha: r.X, diff: p288.diff }, { issue: 293, baseSha: r.X, diff: r.mk("c.ts", "//").diff }];
    const d = checkStack({ issue: 289, base: r.X, head: Y, diff: p289.diff, members, commits: collectStack(r.dir, r.X, Y) });
    assert.deepEqual(d, { ok: true, via: [{ sha: Y, issue: 288 }] });
    let suiteDir = "";
    const t = trialLand({ worktree: r.dir, head: Y, patch: p289.patch, diff: p289.diff, identity: ID, suite: (dir) => { suiteDir = dir; return readFileSync(join(dir, "b.ts"), "utf8").includes("b2") && readFileSync(join(dir, "a.ts"), "utf8").includes("a2"); } });
    assert.equal(t.ok, true);
    assert.notEqual(suiteDir, r.dir);
    assert.equal(r.g("rev-parse", "HEAD"), Y, "caller worktree untouched by the trial");
    assert.equal(r.g("worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).length, 1, "trial worktree removed");
    const Z = r.am(p289.patch);
    assert.equal(r.g("rev-parse", `${Z}^{tree}`), (t as { tree: string }).tree);
    const clause = provenanceClause(r.X, Y, [Y]);
    assert.deepEqual(parseProvenance(`landed via the verdict patch; ${clause}; suite ok`), { base: r.X.slice(0, 12), onto: Y.slice(0, 12), via: [Y.slice(0, 12)] });
    // a third task stacks on two intermediates
    const p293 = r.mk("c.ts", "export const c2 = 2;");
    const d3 = checkStack({ issue: 293, base: r.X, head: Z, diff: p293.diff, members: [{ issue: 288, baseSha: r.X, diff: p288.diff }, { issue: 289, baseSha: r.X, diff: p289.diff }], commits: collectStack(r.dir, r.X, Z) });
    assert.deepEqual(d3, { ok: true, via: [{ sha: Y, issue: 288 }, { sha: Z, issue: 289 }] });
  } finally { r.done(); }
});

test("refuse (a): a non-batch commit, a non-noreply commit, a batch issue graded on another base", () => {
  const r = repo();
  try {
    const p288 = r.mk("a.ts", "x"), p289 = r.mk("b.ts", "y");
    const Y = r.am(p288.patch);
    const base = { issue: 289, base: r.X, head: Y, diff: p289.diff, commits: collectStack(r.dir, r.X, Y) };
    assert.equal((checkStack({ ...base, members: [] }) as { reason: string }).reason, "stack_foreign_commit");
    assert.equal((checkStack({ ...base, members: [{ issue: 288, baseSha: "9".repeat(40), diff: p288.diff }] }) as { reason: string }).reason, "stack_other_base");
    const c = collectStack(r.dir, r.X, Y)!;
    assert.equal((checkStack({ ...base, members: [{ issue: 288, baseSha: r.X, diff: p288.diff }], commits: [{ ...c[0]!, authorEmail: ["someone", "example.invalid"].join("@") }] }) as { reason: string }).reason, "stack_foreign_commit");
    // a hand commit after the batch patch
    writeFileSync(join(r.dir, "c.ts"), "hand\n");
    r.g("commit", "-qam", "hand");
    const H = r.g("rev-parse", "HEAD");
    assert.equal((checkStack({ ...base, head: H, members: [{ issue: 288, baseSha: r.X, diff: p288.diff }], commits: collectStack(r.dir, r.X, H) }) as { reason: string }).reason, "stack_foreign_commit");
  } finally { r.done(); }
});

test("refuse (a): duplicates (own patch already in the chain; one issue matching two members) and non-linear history", () => {
  const r = repo();
  try {
    const p288 = r.mk("a.ts", "x"), p289 = r.mk("b.ts", "y");
    const Y = r.am(p288.patch);
    const commits = collectStack(r.dir, r.X, Y);
    assert.equal((checkStack({ issue: 289, base: r.X, head: Y, diff: p288.diff, members: [], commits }) as { reason: string }).reason, "stack_duplicate");
    assert.equal((checkStack({ issue: 289, base: r.X, head: Y, diff: p289.diff, members: [{ issue: 288, baseSha: r.X, diff: p288.diff }, { issue: 290, baseSha: r.X, diff: p288.diff }], commits }) as { reason: string }).reason, "stack_duplicate");
    assert.equal((checkStack({ issue: 289, base: r.X, head: Y, diff: p289.diff, members: [], commits: null }) as { reason: string }).reason, "stack_not_linear");
    assert.equal((checkStack({ issue: 289, base: r.X, head: r.X, diff: p289.diff, members: [], commits }) as { reason: string }).reason, "stack_bad_input");
    // merge in range -> collectStack null
    r.g("checkout", "-q", "-b", "side", r.X); writeFileSync(join(r.dir, "c.ts"), "s\n"); r.g("commit", "-qam", "s");
    r.g("checkout", "-q", "main"); r.g("merge", "-q", "--no-ff", "-m", "m", "side");
    assert.equal(collectStack(r.dir, r.X, r.g("rev-parse", "HEAD")), null);
    // head not descending from base
    assert.equal(collectStack(r.dir, Y, r.X), null);
    // broken chain: commit list not ending at head
    assert.equal((checkStack({ issue: 289, base: r.X, head: "8".repeat(40), diff: p289.diff, members: [{ issue: 288, baseSha: r.X, diff: p288.diff }], commits }) as { reason: string }).reason, "stack_not_linear");
  } finally { r.done(); }
});

test("refuse (b): the task touches a file an intermediate commit changed", () => {
  const r = repo();
  try {
    const p288 = r.mk("a.ts", "x"), pSame = r.mk("a.ts", "z");
    const Y = r.am(p288.patch);
    const d = checkStack({ issue: 298, base: r.X, head: Y, diff: pSame.diff, members: [{ issue: 288, baseSha: r.X, diff: p288.diff }], commits: collectStack(r.dir, r.X, Y) });
    assert.equal((d as { reason: string }).reason, "stack_files_overlap");
  } finally { r.done(); }
});

test("refuse (c): patch does not apply as-is on head, or the applied diff differs from the verified diff", () => {
  const r = repo();
  try {
    const p289 = r.mk("b.ts", "y");
    writeFileSync(join(r.dir, "b.ts"), "changed\n"); r.g("commit", "-qam", "move b");
    const H = r.g("rev-parse", "HEAD");
    const t = trialLand({ worktree: r.dir, head: H, patch: p289.patch, diff: p289.diff, identity: ID, suite: () => true });
    assert.deepEqual([t.ok, (t as { reason: string }).reason], [false, "stack_not_byte_identical"]);
    const t2 = trialLand({ worktree: r.dir, head: r.X, patch: p289.patch, diff: p289.diff.replace("+y", "+q"), identity: ID, suite: () => true });
    assert.equal((t2 as { reason: string }).reason, "stack_not_byte_identical");
    assert.equal(r.g("rev-parse", "HEAD"), H);
  } finally { r.done(); }
});

test("refuse (d): full suite fails on head + patch; nothing lands in the caller's worktree", () => {
  const r = repo();
  try {
    const p288 = r.mk("a.ts", "x"), p289 = r.mk("b.ts", "y");
    const Y = r.am(p288.patch);
    const t = trialLand({ worktree: r.dir, head: Y, patch: p289.patch, diff: p289.diff, identity: ID, suite: () => false });
    assert.equal((t as { reason: string }).reason, "stack_suite_failed");
    assert.equal(r.g("rev-parse", "HEAD"), Y);
    assert.equal(r.g("status", "--porcelain"), "");
  } finally { r.done(); }
});

test("provenance clause: exactly one, well-formed; stacked.ts is protected; script keeps the M18 refusal and never pushes", () => {
  assert.equal(parseProvenance("no clause"), null);
  const c = provenanceClause("a".repeat(40), "b".repeat(40), ["c".repeat(40), "d".repeat(40)]);
  assert.equal(parseProvenance(`${c} ${c}`), null);
  assert.equal(parseProvenance(c)!.via.length, 2);
  assert.ok(protectedReason("peaceai/lib/stacked.ts"));
  const src = readFileSync(join(import.meta.dirname, "..", "bin", "apply-verdict-patch.ts"), "utf8");
  assert.match(src, /if \(head !== baseSha && !stackedVia\)\n  die\(`stale base/);
  assert.ok(!/\bpush\b"/.test(src) && !/"push"/.test(src));
  assert.ok(!/writeNew|appendIndex|record-verdict/.test(src + readFileSync(join(import.meta.dirname, "..", "lib", "stacked.ts"), "utf8")), "no Results writes");
});

test("mixed bases: an intermediate graded on an earlier chain commit is accepted; a base outside the chain, a later base and a non-batch commit refuse", () => {
  const r = repo();
  try {
    const p288 = r.mk("a.ts", "x"), p289 = r.mk("b.ts", "y");
    const Y = r.am(p288.patch); // #288 graded on X, landed as Y
    const p290 = r.mk("c.ts", "z"); // carried #290: regraded on Y (mk builds on X; c.ts is unchanged on Y, so the diff is the same)
    const Z = r.am(p290.patch);
    const ok = checkStack({ issue: 289, base: r.X, head: Z, diff: p289.diff, members: [{ issue: 288, baseSha: r.X, diff: p288.diff }, { issue: 290, baseSha: Y, diff: p290.diff }], commits: collectStack(r.dir, r.X, Z) });
    assert.deepEqual(ok, { ok: true, via: [{ sha: Y, issue: 288 }, { sha: Z, issue: 290 }] });
    const t = trialLand({ worktree: r.dir, head: Z, patch: p289.patch, diff: p289.diff, identity: ID, suite: () => true });
    assert.equal(t.ok, true);
    const reason = (m: BatchMember[], head = Z) => (checkStack({ issue: 289, base: r.X, head, diff: p289.diff, members: m, commits: collectStack(r.dir, r.X, head) }) as { reason?: string }).reason;
    // base outside the chain (a sha not in X..Z and not X)
    assert.equal(reason([{ issue: 288, baseSha: r.X, diff: p288.diff }, { issue: 290, baseSha: "7".repeat(40), diff: p290.diff }]), "stack_other_base");
    // base is the commit itself / a later commit: not an EARLIER chain commit
    assert.equal(reason([{ issue: 288, baseSha: r.X, diff: p288.diff }, { issue: 290, baseSha: Z, diff: p290.diff }]), "stack_other_base");
    assert.equal(reason([{ issue: 288, baseSha: Z, diff: p288.diff }, { issue: 290, baseSha: Y, diff: p290.diff }]), "stack_other_base");
    // non-batch commit inside a mixed-base chain
    writeFileSync(join(r.dir, "c.ts"), "hand\n");
    r.g("commit", "-qam", "hand");
    const H = r.g("rev-parse", "HEAD");
    assert.equal(reason([{ issue: 288, baseSha: r.X, diff: p288.diff }, { issue: 290, baseSha: Y, diff: p290.diff }], H), "stack_foreign_commit");
  } finally { r.done(); }
});
