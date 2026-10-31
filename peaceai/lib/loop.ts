// M146 (step 3 of the general coding-agent roadmap, Oct 30 2026): PeaceAI's sandboxed test-and-fix loop.
// Given a task (a plain request and an external repo pinned at a commit; the plan-only task file format), PeaceAI
//   1. plans it (plan.ts planTask),  2. gathers context (codesearch.ts relevant),  3. proposes an edit,
//   4. applies it in a private copy,  5. runs the team's tests for the task in the stage-2 isolation,
//   6. reads the failures as filtered codes plus test names,  7. revises, up to maxAttempts.
// It stops on pass (PASS), on the attempt limit (ATTEMPT_LIMIT) or on a refusal (any other code).
//
// Safety (binding, Peace 2026-10-30):
// - Candidate code (the repo's tests and whatever the edit put in it) runs ONLY through selfpropose.ts guardedRun /
//   isolatedRun with the stage-2 candidate uid (stage2CandUid, M109/M106): sudo -u peaceai-cand, env -i with the
//   minimal suite env (no secrets), read-only copy, private HOME/TMPDIR, setsid, leftovers killed, tamper hashes.
//   selfpropose.ts is not changed. Without the candidate uid the loop refuses (CAND_UID_*); there is no unsandboxed path.
// - No network: the copy's node_modules/.bin/tsx (the program isolatedRun starts) is a wrapper that enters a new user,
//   network and mount namespace (unshare), makes /tmp, /var/tmp and /dev/shm read-only except the private TMPDIR, and
//   runs node there as the candidate uid. If the namespaces are not available it exits 97/98 and the loop stops with
//   ISOLATION_UNAVAILABLE (fail closed, never a run with network).
// - External repos only: a task naming PeaceAI's own repos is refused (SELF_TARGET); the stage-2 self-change flag
//   (peaceai/self/stage2.json) is never read or written here.
// - PeaceAI's edits are written only inside the copy (every path normalized, no absolute, "..", .git, node_modules,
//   symlink or realpath escape, never a team test file); the copy has no git remote and nothing is ever pushed.
// - The public log row carries codes and numbers only; test names stay in the local, gitignored .peaceai-out/loop.
//
// Each safety guard is a single line tagged "guard:<id>". The m146 mutation test deletes each tagged line in turn and
// requires a behavior case to fail.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, posix, resolve, sep } from "node:path";
import ts from "typescript";
import { openRepo } from "./codesearch.ts";
import { applyRule, specHash, type RuleSpec } from "./learned.ts";
import { loadModel } from "./nlparse.ts";
import { approvedRules, isTestPath, planTask, PLAN_LICENSES, sha256, taskFileProblem, taskProblem, trainingRepos, type Plan, type PlanTask, type PlanTaskFile } from "./plan.ts";
import { committedLog, isLocked, taskKey } from "./plangrade.ts";
import { ATTEMPT_CODES, LOOP_LOG, LOOP_SCHEMA_V2, loopRowProblem, LOOP_VERSION_V2, type AttemptCode, type LoopBaseline, type LoopCode, type LoopRow, type LoopTests } from "./looprow.ts";
import { detectRunner, installDeps, installShim, openDepsCache, shimArgs, type DepsCache, type DepsOptions, type RunnerPick } from "./loopdeps.ts";
import { guardedRun, stage2CandUid, type CandUid, type RawRun } from "./selfpropose.ts";
import { MAX_INDEX_FILE_BYTES, type IndexFile } from "./symbols.ts";

export const ROOT = join(import.meta.dirname, "../..");
export const MAX_ATTEMPTS = 20;
const now = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const git = (cwd: string, ...a: string[]): string => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28 }).trim();
const SELF_REPOS = /^peaceg03\//i; // PeaceAI's own repos (Workspace, Results, ...): the loop never targets them

// ---- the copy

/** A private working copy of the target at the pinned commit, plus the team's test files from the reference change. */
export interface Copy { dir: string; head: string; teamTests: Map<string, string>; close(): void }
export type CopyFetcher = (repo: string, commit: string, merge: string, testFiles: readonly string[]) => Copy;
export class LoopError extends Error { constructor(readonly code: LoopCode) { super(code); } }

/** Fetches exactly the pinned commit and the reference merge (depth 1, by URL: the copy never has a remote). */
export function gitCopyFetcher(url: (repo: string) => string = (r) => `https://github.com/${r}.git`): CopyFetcher {
  return (repo, commit, merge, testFiles) => {
    const dir = mkdtempSync(join(tmpdir(), "peaceai-loop-"));
    try {
      git(dir, "init", "-q");
      for (const sha of [commit, merge]) {
        let ok = false;
        for (let i = 0; i < 3 && !ok; i++) { try { git(dir, "fetch", "-q", "--depth", "1", url(repo), sha); ok = true; } catch { /* retry */ } }
        if (!ok) throw new LoopError("FETCH_FAILED");
      }
      git(dir, "checkout", "-q", "--detach", commit);
      const teamTests = new Map<string, string>();
      for (const f of testFiles) { try { teamTests.set(f, execFileSync("git", ["show", `${merge}:${f}`], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 26 })); } catch { /* not in the merge */ } }
      return { dir, head: git(dir, "rev-parse", "HEAD"), teamTests, close: () => rmSync(dir, { recursive: true, force: true }) };
    } catch (e) {
      rmSync(dir, { recursive: true, force: true });
      throw e instanceof LoopError ? e : new LoopError("FETCH_FAILED");
    }
  };
}

/** Back to the pinned commit: drops every earlier edit (node_modules, holding the runner wrapper, is kept). */
function resetCopy(c: Copy): void {
  git(c.dir, "checkout", "-q", "-f", "--detach", c.head);
  git(c.dir, "clean", "-qfdx", "-e", "node_modules");
}

/** The edit path inside the copy, or null when it would leave the copy or touch what PeaceAI may not edit. */
export function safeEditPath(dir: string, p: unknown): string | null {
  if (typeof p !== "string" || !p || p.includes("\0") || p.includes("\\")) return null;
  if (isAbsolute(p)) return null; // guard:abs
  const n = posix.normalize(p);
  if (n === ".." || n.startsWith("../") || n === ".") return null; // guard:dotdot
  if (/(?:^|\/)(?:\.git|node_modules)(?:\/|$)/.test(n)) return null; // guard:git-nm
  const full = resolve(dir, n);
  const root = realpathSync(dir);
  let probe = full;
  while (!existsSync(probe)) probe = dirname(probe);
  const real = realpathSync(probe);
  if (real !== root && !real.startsWith(root + sep)) return null; // guard:realpath
  if (existsSync(full) && lstatSync(full).isSymbolicLink()) return null; // guard:symlink
  return full;
}

/** Writes an edit into the copy. Every path is checked first, so a bad edit writes nothing at all. */
export function applyEdits(c: Copy, edits: readonly Edit[]): LoopCode | null {
  const targets: [string, string][] = [];
  for (const e of edits) {
    const full = safeEditPath(c.dir, e.path);
    if (full === null) return "EDIT_OUTSIDE_COPY";
    if (c.teamTests.has(posix.normalize(e.path))) return "TEAM_TEST_EDIT"; // guard:team-tests
    targets.push([full, e.content]);
  }
  for (const [full, content] of targets) { mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, content); }
  return null;
}

// ---- the isolated runner

/**
 * The program isolatedRun starts (`<copy>/node_modules/.bin/tsx`): new user + network + mount namespaces, /tmp,
 * /var/tmp and /dev/shm read-only except the private TMPDIR, then node as the candidate uid. Exits 97 (no namespaces)
 * or 98 (mount failed) instead of ever running with network.
 */
export function runnerWrapper(uid: number, gid: number): string {
  return [
    "#!/bin/sh",
    "# PeaceAI loop (M146): candidate tests run here with no network and no writable shared temp dirs. Written by",
    "# peaceai/lib/loop.ts into the private copy; started by selfpropose.ts isolatedRun as the stage-2 candidate uid.",
    "unshare -r -n -m true 2>/dev/null || exit 97",
    `exec unshare -r -n -m -- /bin/sh -c 'mount --bind "$TMPDIR" "$TMPDIR" || exit 98; for d in /tmp /var/tmp /dev/shm; do if [ -d "$d" ]; then mount --rbind "$d" "$d" && mount -o remount,bind,ro "$d" || exit 98; fi; done; exec unshare -U --map-user=${uid} --map-group=${gid} -- node "$@"' peaceai-loop "$@"`,
    "",
  ].join("\n");
}
function installRunner(c: Copy, cand: CandUid): void {
  const gid = Number(spawnSync("id", ["-g", cand.name], { encoding: "utf8" }).stdout.trim());
  const bin = join(c.dir, "node_modules/.bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "tsx"), runnerWrapper(cand.uid, gid)); // guard:wrapper
  chmodSync(join(bin, "tsx"), 0o755);
}

const escRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TAP = ["--test", "--test-reporter=tap"];

/** Top-level test("name") / it("name") calls with a literal name (others still run, counted by the whole run). */
export function testNames(content: string): string[] {
  const sf = ts.createSourceFile("t.ts", content, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const out: string[] = [];
  for (const st of sf.statements) {
    if (!ts.isExpressionStatement(st) || !ts.isCallExpression(st.expression)) continue;
    const callee = st.expression.expression;
    const name = ts.isIdentifier(callee) ? callee.text : null;
    const arg = st.expression.arguments[0];
    if ((name === "test" || name === "it") && arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) && !out.includes(arg.text)) out.push(arg.text);
  }
  return out.slice(0, 200);
}

export interface RunOutcome { codes: AttemptCode[]; failing: string[]; tests: LoopTests; isolation: boolean }
/**
 * One test run in the stage-2 isolation: node:test files whole and per named test (TAP), or vitest / jest files whole
 * through the loopdeps shim (counts from the runner's JSON report; per-test names are not collected for them).
 */
function runTests(c: Copy, cand: CandUid, runMs: number, pick: RunnerPick, testFiles: readonly string[]): RunOutcome {
  const files = [...testFiles].sort();
  const watch = [...new Set([...c.teamTests.keys(), ...files])].sort();
  const run = (args: string[]): RawRun => guardedRun(c.dir, args, Date.now() + runMs, watch, null, cand); // guard:isolated
  const json = pick.runner !== "node-test";
  const rel = (f: string) => (pick.pkgDir ? posix.relative(pick.pkgDir, posix.normalize(f)) : posix.normalize(f));
  const whole = run(json ? shimArgs({ ...pick, files: files.map(rel) }) : [...TAP, ...files]);
  const isolation = whole.exitCode !== 97 && whole.exitCode !== 98; // guard:isolation-exit
  const codes = new Set<AttemptCode>();
  if (whole.exitCode === 124) codes.add("TIMEOUT");
  if (whole.leftovers > 0) codes.add("LEFTOVERS");
  if (whole.tampered?.length) codes.add("TAMPERED");
  if (whole.exitCode !== 0 || whole.fail > 0) codes.add("TEST_FAIL");
  if (whole.pass + whole.fail === 0) codes.add("NO_TESTS_RAN");
  const named = json ? [] : files.flatMap((f) => testNames(c.teamTests.get(f) ?? (() => { try { return readFileSync(join(c.dir, f), "utf8"); } catch { return ""; } })()).map((name) => ({ f, name })));
  const failing: string[] = [];
  let passed = 0;
  if (isolation && named.length) {
    for (const t of named) {
      const r = run([...TAP, `--test-name-pattern=^${escRx(t.name)}$`, t.f]);
      if (r.exitCode === 0 && r.fail === 0 && r.pass >= 1 && r.leftovers === 0 && !r.tampered?.length) passed++; else failing.push(t.name);
    }
  } else passed = codes.size && !json ? 0 : whole.pass;
  const total = named.length || whole.pass + whole.fail;
  if (failing.length && !codes.has("TEST_FAIL")) codes.add("TEST_FAIL");
  if (passed > total) passed = total;
  return { codes: [...codes].sort() as AttemptCode[], failing, tests: { total, passedByPeaceAI: codes.size ? Math.min(passed, total) : total, filledByTeam: total - (codes.size ? Math.min(passed, total) : total) }, isolation };
}

// ---- the proposer

export interface Edit { path: string; content: string }
export interface Feedback { attempt: number; codes: AttemptCode[]; failing: string[] }
export interface ProposeInput { request: string; repo: string; plan: Plan; files: readonly IndexFile[]; context: readonly string[]; attempt: number; feedback: readonly Feedback[] }
export type Proposal = { edits: Edit[] } | { refuse: "NO_EDIT" | "NO_MORE_EDITS" };
export interface Proposer { name: string; next(input: ProposeInput): Proposal }

/**
 * v1 proposer: PeaceAI's own approved learned rules only. Its candidates are the edits the hash-pinned approved rules
 * produce for the planner's can-do steps (the same applyRule the planner and Job A use), one per attempt, in plan
 * order. It never invents code: no can-do step means NO_EDIT, no candidate left means NO_MORE_EDITS. The LM is not
 * used: its weights live in the Results repo (lm.ts LM_FILES), which this runner does not have.
 */
export function rulesProposer(rules: readonly RuleSpec[]): Proposer {
  let cands: Edit[][] | null = null;
  return {
    name: "rules-v1",
    next(input) {
      if (!cands) {
        cands = [];
        const seen = new Set<string>();
        const src = input.files.filter((f) => /\.tsx?$/.test(f.path));
        for (const step of input.plan.steps) {
          if (step.status !== "can-do" || !step.rule || !step.objective || step.rule.startsWith("pipeline:")) continue;
          const spec = rules.find((r) => `${r.id}@${specHash(r)}` === step.rule);
          if (!spec) continue;
          let e: ReturnType<typeof applyRule> = null;
          try { e = applyRule(spec, step.objective, src, isTestPath, input.repo); } catch { e = null; }
          if (!e) continue;
          const edits = [{ path: e.path, content: e.content }, ...(e.extra ?? []).map((x) => ({ path: x.path, content: x.content }))];
          const key = sha256(JSON.stringify(edits));
          if (!seen.has(key)) { seen.add(key); cands.push(edits); }
        }
      }
      if (cands.length === 0) return { refuse: "NO_EDIT" };
      const k = input.attempt - 1;
      return k < cands.length ? { edits: cands[k]! } : { refuse: "NO_MORE_EDITS" };
    },
  };
}

// ---- one task

export interface LoopOptions {
  root?: string;
  fetcher?: CopyFetcher;
  proposer?: Proposer;
  maxAttempts?: number;
  /** Per test-run deadline (ms). */
  runMs?: number;
  /** The environment the candidate uid is read from (PEACEAI_STAGE2_CAND). */
  env?: Record<string, string | undefined>;
  outDir?: string;
  committed?: string;
  rules?: RuleSpec[];
  training?: Set<string>;
  /** v2: dependency install limits (and, in tests only, a stub package manager). */
  deps?: DepsOptions;
  /** v2: the run's install cache (one per runLoopFile; a task run alone gets its own). */
  depsCache?: DepsCache;
  /** v2: where the run's install cache dir is made (default os.tmpdir()). */
  depsDir?: string;
}
export interface AttemptRecord { attempt: number; edits: string[]; codes: AttemptCode[]; failing: string[]; tests: LoopTests }
export interface LoopResult { row: LoopRow; plan: Plan | null; attempts: AttemptRecord[]; context: string[] }

export function loopSha256(): string {
  return sha256(["lib/loop.ts", "lib/looprow.ts", "lib/loopdeps.ts"].map((f) => readFileSync(join(ROOT, "peaceai", f), "utf8")).join("\0"));
}

/** Runs the loop on one task. Never throws: every outcome is a row with a fixed code. */
export function runLoopTask(task: PlanTask, set: "public" | "hidden", fileSha: string, o: Required<Omit<LoopOptions, "committed" | "outDir" | "training" | "deps" | "depsCache" | "depsDir">> & { training: Set<string>; deps?: DepsOptions; depsCache?: DepsCache }): LoopResult {
  const maxAttempts = Math.min(MAX_ATTEMPTS, Math.max(1, Math.floor(o.maxAttempts)));
  const workspace = (() => { try { return git(o.root, "rev-parse", "HEAD"); } catch { return "0".repeat(40); } })();
  const names = set === "public" ? { repo: task.repo, commit: task.commit } : {};
  const records: AttemptRecord[] = [];
  let plan: Plan | null = null;
  let context: string[] = [];
  const tests: LoopTests | null = null;
  let pick: RunnerPick | null = null;
  let deps: LoopRow["deps"] = null;
  let baseline: LoopBaseline | null = null;
  const done = (code: LoopCode): LoopResult => ({
    row: {
      schema: LOOP_SCHEMA_V2, at: now(), set, taskFileSha256: fileSha, taskKey: taskKey(fileSha, task.id), ...names, workspace,
      loop: LOOP_VERSION_V2, loopSha256: loopSha256(), proposer: o.proposer.name, lm: "not-loadable", code, maxAttempts,
      attempts: records.length, result: code === "PASS" ? "pass" : code === "ATTEMPT_LIMIT" ? "fail" : "refused",
      attemptCodes: records.map((r) => r.codes), tests: records.length ? records[records.length - 1]!.tests : tests,
      runner: pick?.runner ?? null, deps: pick ? deps : null, baseline,
    },
    plan, attempts: records, context,
  });
  if (taskProblem(task)) return done("TASK_INVALID");
  if (!(PLAN_LICENSES as readonly string[]).includes(task.license)) return done("LICENSE_NOT_ALLOWED");
  if (o.training.has(task.repo.toLowerCase())) return done("TRAINING_OVERLAP");
  if (SELF_REPOS.test(task.repo)) return done("SELF_TARGET"); // guard:self-target
  const cu = stage2CandUid(o.env);
  if (!cu.ok) return done(cu.reason as LoopCode); // guard:cand
  const cand = cu.cand;
  let c: Copy | null = null;
  const ownCache = o.depsCache ? null : openDepsCache();
  const cache = o.depsCache ?? ownCache!;
  try {
    c = o.fetcher(task.repo, task.commit, task.reference.from.merge, task.tests.files);
    if (c.head !== task.commit) return done("COMMIT_MISMATCH");
    const lic = (() => { try { return readFileSync(join(c!.dir, task.licensePath), "utf8"); } catch { return null; } })();
    if (lic === null || sha256(lic) !== task.licenseSha256) return done("LICENSE_CHANGED");
    // 1. plan, 2. context (both read-only on the copy)
    const files: IndexFile[] = [];
    for (const p of git(c.dir, "ls-files", "-z").split("\0").filter((x) => /\.tsx?$/.test(x))) {
      const content = readFileSync(join(c.dir, p), "utf8");
      if (Buffer.byteLength(content) <= MAX_INDEX_FILE_BYTES) files.push({ path: p, content });
    }
    let pkg: Record<string, any> = {};
    try { pkg = JSON.parse(readFileSync(join(c.dir, "package.json"), "utf8")); } catch { pkg = {}; }
    const testCommand: string | null = typeof pkg.scripts?.test === "string" ? pkg.scripts.test : null;
    try { plan = planTask(task.id, task.request, { repo: task.repo, files, rules: o.rules, model: loadModel(), testCommand }); }
    catch { return done("PLAN_FAILED"); }
    const rel = openRepo(c.dir).relevant(task.request);
    context = rel.ok ? [...rel.files, ...rel.tests].map((f) => f.path) : [];
    // 3. (v2) the test stage first: the runner the team's tests belong to, the repo's dependencies (lockfile only,
    //    scripts off, as the candidate uid), then the baseline run on the unedited copy. This runs whether or not
    //    the proposer has an edit, so every row says how far the task's own tests can be run.
    if (c.teamTests.size === 0) return done("NO_TESTS");
    for (const f of c.teamTests.keys()) if (!safeEditPath(c.dir, f)) return done("TASK_INVALID");
    const putTeamTests = () => { for (const [f, text] of c!.teamTests) { const full = safeEditPath(c!.dir, f); if (full) { mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, text); } } };
    putTeamTests(); // so the runner sees the package layout the tests live in (removed again by resetCopy)
    const det = detectRunner(c.dir, [...c.teamTests.keys()].sort());
    resetCopy(c);
    if ("refuse" in det) return done(det.refuse);
    pick = det;
    if (det.runner !== "node-test" || det.hasDeps) {
      const d = installDeps(c.dir, cand, cache, o.deps);
      if ("refuse" in d) return done(d.refuse);
      deps = d.pm;
    } else deps = "none";
    installRunner(c, cand);
    if (det.runner !== "node-test") installShim(c.dir);
    // the team's tests must fail before any edit (else the task proves nothing)
    putTeamTests();
    const base = runTests(c, cand, o.runMs, det, [...c.teamTests.keys()]);
    if (!base.isolation) return done("ISOLATION_UNAVAILABLE");
    const bp = base.codes.length ? base.tests.passedByPeaceAI : base.tests.total;
    baseline = { total: base.tests.total, passing: bp, failing: base.tests.total - bp };
    if (base.codes.length === 0) return done("BASELINE_PASSES");
    // 4. the first proposal
    const feedback: Feedback[] = [];
    let p = o.proposer.next({ request: task.request, repo: task.repo, plan, files, context, attempt: 1, feedback });
    if ("refuse" in p) return done(p.refuse);
    let related: string[] | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        p = o.proposer.next({ request: task.request, repo: task.repo, plan, files, context, attempt, feedback });
        if ("refuse" in p) return done(p.refuse);
      }
      // 4. apply in the copy (fresh from the pinned commit + the team's tests each time)
      resetCopy(c);
      putTeamTests();
      const bad = applyEdits(c, p.edits);
      if (bad) return done(bad);
      // 5. run, 6. read codes + names
      const r = runTests(c, cand, o.runMs, det, [...c.teamTests.keys()]);
      if (!r.isolation) return done("ISOLATION_UNAVAILABLE");
      // the team's tests pass: the tests the search tools relate to the edited files (testsFor) must not regress
      if (r.codes.length === 0) {
        related ??= relatedTests(c, det, p.edits.map((e) => e.path));
        if (related.length) {
          const after = runTests(c, cand, o.runMs, det, related);
          if (after.codes.length) {
            resetCopy(c);
            putTeamTests();
            const before = runTests(c, cand, o.runMs, det, related);
            if (before.codes.length === 0) r.codes = ["RELATED_FAIL"]; // they passed before the edit: a regression
          }
        }
      }
      records.push({ attempt, edits: p.edits.map((e) => e.path), codes: r.codes, failing: r.failing, tests: r.tests });
      if (r.codes.length === 0) return done("PASS");
      feedback.push({ attempt, codes: r.codes, failing: r.failing }); // 7. revise
    }
    return done("ATTEMPT_LIMIT");
  } catch (e) {
    return done(e instanceof LoopError ? e.code : "FETCH_FAILED");
  } finally {
    c?.close();
    ownCache?.close();
  }
}

/** Up to 10 existing tests the search tools relate to the edited files (testsFor), in the runner's package, not the team's. */
function relatedTests(c: Copy, pick: RunnerPick, edited: readonly string[]): string[] {
  const repo = openRepo(c.dir);
  const out: string[] = [];
  for (const e of edited) {
    const r = repo.testsFor(posix.normalize(e));
    if (!r.ok) continue;
    for (const t of r.tests.slice(0, 3)) {
      if (c.teamTests.has(t.path) || out.includes(t.path)) continue;
      if (pick.pkgDir && !t.path.startsWith(pick.pkgDir + "/")) continue;
      out.push(t.path);
    }
  }
  return out.slice(0, 10).sort();
}

// ---- a task file

/** Runs the loop on every task of a task file locked in the committed plan-only log (runs.jsonl); appends one loop row per task to loop-runs.jsonl. */
export function runLoopFile(path: string, opts: LoopOptions = {}): { code: "OK" | "TASK_FILE_UNLOCKED" | "TASK_FILE_INVALID" | "TRAINING_LIST_UNREADABLE"; results: LoopResult[] } {
  const root = opts.root ?? ROOT;
  const text = readFileSync(path, "utf8");
  const fileSha = sha256(text);
  if (!isLocked(opts.committed ?? committedLog(root), fileSha)) return { code: "TASK_FILE_UNLOCKED", results: [] }; // guard:lock
  let parsed: PlanTaskFile;
  try { parsed = JSON.parse(text); } catch { return { code: "TASK_FILE_INVALID", results: [] }; }
  if (taskFileProblem(parsed)) return { code: "TASK_FILE_INVALID", results: [] };
  let training = opts.training;
  if (!training) { try { training = trainingRepos(root).repos; } catch { return { code: "TRAINING_LIST_UNREADABLE", results: [] }; } }
  const o = {
    root, fetcher: opts.fetcher ?? gitCopyFetcher(), proposer: opts.proposer ?? rulesProposer(opts.rules ?? approvedRules(root)),
    maxAttempts: opts.maxAttempts ?? 3, runMs: opts.runMs ?? 120_000, env: opts.env ?? process.env, rules: opts.rules ?? approvedRules(root), training,
  };
  const outDir = opts.outDir ?? join(root, ".peaceai-out/loop");
  mkdirSync(outDir, { recursive: true });
  const results: LoopResult[] = [];
  // one install cache per run (keyed by lockfile sha256), removed when the run ends; never shared between runs
  const depsCache = opts.depsCache ?? openDepsCache(opts.depsDir);
  try {
    for (const task of parsed.tasks) {
      // a fresh proposer state per task
      const r = runLoopTask(task, parsed.set, fileSha, { ...o, proposer: opts.proposer ?? rulesProposer(o.rules), deps: opts.deps, depsCache });
      if (loopRowProblem(r.row)) throw new Error("log_row_invalid"); // a bug: never write a row the validator rejects
      results.push(r);
      appendFileSync(join(root, LOOP_LOG), JSON.stringify(r.row) + "\n");
      writeFileSync(join(outDir, `${r.row.taskKey}.json`), JSON.stringify({ row: r.row, attempts: r.attempts, context: r.context, plan: r.plan }, null, 1) + "\n");
    }
  } finally { if (!opts.depsCache) depsCache.close(); }
  return { code: "OK", results };
}
export { ATTEMPT_CODES };
