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
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { isGeneratedPath, isTestPath as codeTestPath, openRepo, type CodeRepo } from "./codesearch.ts";
import { applyRule, specHash, type RuleSpec } from "./learned.ts";
import { loadModel } from "./nlparse.ts";
import { approvedRules, isTestPath, planTask, PLAN_LICENSES, sha256, taskFileProblem, taskProblem, trainingRepos, type Plan, type PlanContext, type PlanTask, type PlanTaskFile } from "./plan.ts";
import { planTaskV2, type PlanV2 } from "./plan2.ts";
import { plannerSha256V2 } from "./plan2run.ts";
import { planTaskV3, type PlanV3 } from "./plan3.ts";
import { plannerSha256V3 } from "./plan3run.ts";
import { planTaskV4, type PlanV4 } from "./plan4.ts";
import { plannerSha256V4 } from "./plan4run.ts";
import { selectPlanner, type PlannerName } from "./plandefault.ts";
import { plannerSha256 } from "./planrun.ts";
import { committedLog, isLocked, taskKey } from "./plangrade.ts";
import { ATTEMPT_CODES, SHIM_SYNTH_CODES, EDIT_SCOPE_CLASSES, LOOP_ISOLATION_FAILS, LOOP_LOG, LOOP_MODEL_PROPOSERS, LOOP_SCHEMA_V4, loopRowProblem, LOOP_VERSION_V2, type AttemptCode, type EditScopeClass, type LoopBaseline, type LoopCode, type LoopRow, type LoopTests } from "./looprow.ts";
import { candCan, detectRunner, installDeps, installShim, openDepsCache, openWorkDir, SHIM_EXITS, shimArgs, type WorkDir, type DepsCache, type DepsFail, type DepsOptions, type RunnerPick } from "./loopdeps.ts";
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
/** M171: `base` is the task's private work dir (openWorkDir); the copy is made inside it. Absent: os.tmpdir(). */
export type CopyFetcher = (repo: string, commit: string, merge: string, testFiles: readonly string[], base?: string) => Copy;
export class LoopError extends Error { constructor(readonly code: LoopCode) { super(code); } }

/** Fetches exactly the pinned commit and the reference merge (depth 1, by URL: the copy never has a remote). */
export function gitCopyFetcher(url: (repo: string) => string = (r) => `https://github.com/${r}.git`): CopyFetcher {
  return (repo, commit, merge, testFiles, base) => {
    const dir = mkdtempSync(join(base ?? tmpdir(), "peaceai-loop-"));
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

/** The proposer's file index of a copy at the pinned commit: tracked .ts / .tsx files up to MAX_INDEX_FILE_BYTES.
 *  M167: shared with model-v1's scoring job, which must rebuild exactly the candidate list the attempt job sees. */
export function indexFiles(dir: string): IndexFile[] {
  const files: IndexFile[] = [];
  for (const p of git(dir, "ls-files", "-z").split("\0").filter((x) => /\.tsx?$/.test(x))) {
    const content = readFileSync(join(dir, p), "utf8");
    if (Buffer.byteLength(content) <= MAX_INDEX_FILE_BYTES) files.push({ path: p, content });
  }
  return files;
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

// ---- the isolation checks before candidate code runs (M171, spec loop-isolation-v1.md; the work dir: loopdeps.ts openWorkDir)

export type IsolationFail = (typeof LOOP_ISOLATION_FAILS)[number];
/** The roots the candidate must never be pointed into: the runner's home (its credentials, RUNNER_TEMP's parent), RUNNER_TEMP and the workspace checkout. */
export function privateRoots(root: string, env: Record<string, string | undefined>): string[] {
  const out: string[] = [];
  for (const p of [homedir(), env.RUNNER_TEMP, root]) {
    if (!p) continue;
    let r = resolve(p);
    try { r = realpathSync(r); } catch { /* absent: lexical */ }
    if (!out.includes(r)) out.push(r);
  }
  return out;
}
const under = (p: string, roots: readonly string[]): boolean => roots.some((r) => p === r || p.startsWith(r.endsWith(sep) ? r : r + sep));
const CRED_CONFIG = /extraheader|credential|askpass|sshcommand|insteadof|includeif|\[include\]|:\/\/[^\s/]*@/i;
const MAX_WALK = 1_000_000;

/**
 * M171: the checks before any candidate code runs in the copy (each failure is ISOLATION_UNAVAILABLE with a fixed
 * subcode, attempts 0, and nothing is run; the tests never run as the runner uid instead):
 *   the work dir admits no other user (no o= bits) and holds the copy;  the copy's .git/config names no credential;
 *   no symlink in the copy (or in the installed trees its node_modules links point to) resolves into a private root;
 *   the candidate uid can enter and read the copy and (`runner`: once installed) run its runner wrapper.
 */
export function isolationProblem(c: Copy, work: string, cand: CandUid, roots: readonly string[], runner: boolean): IsolationFail | null {
  let wreal: string;
  try { wreal = realpathSync(work); } catch { return "WORK_DIR"; }
  if ((statSync(wreal).mode & 0o007) !== 0) return "WORK_DIR"; // m171-guard:iso-work-mode
  if (!realpathSync(c.dir).startsWith(wreal + sep)) return "WORK_DIR"; // m171-guard:iso-in-work
  let config = "";
  try { config = readFileSync(join(c.dir, ".git/config"), "utf8"); } catch { config = ""; }
  if (CRED_CONFIG.test(config)) return "PRIVATE_CONFIG"; // m171-guard:iso-config
  // every symlink, by its lexical target and its realpath; trees outside the copy that a link points to are walked once
  const top = realpathSync(c.dir);
  const todo = [top];
  const seen = new Set<string>(todo);
  let n = 0;
  let bad = false;
  while (todo.length && !bad) {
    const d = todo.pop()!;
    let ents: string[];
    try { ents = readdirSync(d); } catch { continue; }
    for (const e of ents) {
      if (++n > MAX_WALK) { bad = true; break; }
      if (d === top && e === ".git") continue;
      const p = join(d, e);
      let st; try { st = lstatSync(p); } catch { continue; }
      if (st.isDirectory()) { todo.push(p); continue; }
      if (!st.isSymbolicLink()) continue;
      const lex = resolve(d, readlinkSync(p));
      let real: string | null = null;
      try { real = realpathSync(p); } catch { real = null; }
      if (under(lex, roots) || (real !== null && under(real, roots))) { bad = true; break; } // m171-guard:iso-links
      if (real !== null && !seen.has(real)) { try { if (statSync(real).isDirectory()) { seen.add(real); todo.push(real); } } catch { /* gone */ } }
    }
  }
  if (bad) return "PRIVATE_LINK";
  const reach = ["-x", c.dir, "-a", "-r", c.dir, ...(runner ? ["-a", "-x", join(c.dir, "node_modules/.bin/tsx")] : [])];
  if (!candCan(cand, ["test", ...reach])) return "CAND_NO_ACCESS"; // m171-guard:iso-access
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

export interface RunOutcome { codes: AttemptCode[]; failing: string[]; tests: LoopTests; isolation: boolean; isoFail: IsolationFail | null; synth: ShimSynth | null; executed: number }
/** M173: which made-up count the runner shim reported through its own exit code (null: real counts, or node:test). */
export type ShimSynth = (typeof SHIM_SYNTH_CODES)[number];
export function shimSynth(json: boolean, exitCode: number): ShimSynth | null {
  if (!json) return null; // m173-loop-guard:synth-json-only
  for (const k of SHIM_SYNTH_CODES) if (SHIM_EXITS[k] === exitCode) return k;
  return null;
}
/** M173: why a baseline that ran proves nothing (null: it proves something, the loop goes on): the shim had no report
 *  (its 1/0/1 counts are made up), a suite failed to load or run, no test executed, or the only failure is the exit. */
export function baselineRefusal(base: Pick<RunOutcome, "synth" | "executed">): LoopCode | null {
  if (base.synth === "NO_REPORT") return "BASELINE_NO_REPORT"; // m173-loop-guard:base-no-report
  if (base.synth === "SUITE_LOAD") return "BASELINE_SUITE_LOAD"; // m173-loop-guard:base-suite-load
  if (base.executed < 1) return "NO_TESTS_RAN"; // m173-loop-guard:base-none-ran
  if (base.synth === "EXIT_ONLY") return "BASELINE_EXIT_ONLY"; // m173-loop-guard:base-exit-only
  return null;
}
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
  const isoFail: IsolationFail | null = whole.exitCode === 97 ? "NO_NAMESPACES" : whole.exitCode === 98 ? "MOUNT_FAILED" : null; // M171: which one, a fixed code
  const codes = new Set<AttemptCode>();
  if (whole.exitCode === 124) codes.add("TIMEOUT");
  if (whole.leftovers > 0) codes.add("LEFTOVERS");
  if (whole.tampered?.length) codes.add("TAMPERED");
  if (whole.exitCode !== 0 || whole.fail > 0) codes.add("TEST_FAIL");
  if (whole.pass + whole.fail === 0) codes.add("NO_TESTS_RAN");
  const synth = isolation ? shimSynth(json, whole.exitCode) : null;
  if (synth) codes.add(synth); // m173-loop-guard:run-synth-code
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
  return { codes: [...codes].sort() as AttemptCode[], failing, tests: { total, passedByPeaceAI: codes.size ? Math.min(passed, total) : total, filledByTeam: total - (codes.size ? Math.min(passed, total) : total) }, isolation, isoFail, synth, executed: synth === "NO_REPORT" ? 0 : whole.pass + whole.fail };
}

// ---- the planner (M162)

/** A plan from any planner selectPlanner can pick. The loop and its proposers read only the steps (action, file,
 *  status, rule, objective) and tests, which v1, v2, v3 and v4 plans share. */
export type LoopPlan = Plan | PlanV2 | PlanV3 | PlanV4;
/** How the loop runs each planner and reads its digest. WHICH planner runs is decided only by plandefault.ts. */
const LOOP_PLANNERS: Readonly<Record<PlannerName, { sha: () => string; plan: (task: PlanTask, ctx: PlanContext, dir: string) => LoopPlan }>> = Object.freeze({
  "plan-only-v1": { sha: () => plannerSha256(), plan: (t: PlanTask, ctx: PlanContext) => planTask(t.id, t.request, ctx) },
  "plan-only-v2": { sha: () => plannerSha256V2(), plan: (t: PlanTask, ctx: PlanContext, dir: string) => planTaskV2(t.id, t.request, ctx, openRepo(dir)) },
  "plan-only-v3": { sha: () => plannerSha256V3(), plan: (t: PlanTask, ctx: PlanContext, dir: string) => planTaskV3(t.id, t.request, ctx, openRepo(dir)) },
  "plan-only-v4": { sha: () => plannerSha256V4(), plan: (t: PlanTask, ctx: PlanContext, dir: string) => planTaskV4(t.id, t.request, ctx, openRepo(dir)) },
});
/** The loop's planner, picked only through plandefault.selectPlanner: no flag = the default; null = an unknown name. */
export function loopPlanner(flag: string | undefined): PlannerName | null {
  return selectPlanner(flag)?.name ?? null;
}

// ---- M174 load diagnostics (batch 13, spec: peaceai/spec/load-diagnostics-m174.md): compile diagnostics for a team test suite that does not
// load. PeaceAI reads the copy's files with the TypeScript compiler API (a program over the team's test files; nothing
// is executed, and the runner's own output, which candidate code can write, is never read) and keeps only filtered
// codes: which name a team test imports from a relative source module that does not export it (MISSING_EXPORT, from
// TS2305 / TS2459 / TS2614 / TS2724), or which relative module it imports that does not exist (MISSING_MODULE, TS2307). The
// name and module come from the test file's syntax tree and the module resolution, never from the message text.
// The program's host reads only files inside the copy (by realpath, never under node_modules) and TypeScript's own
// lib files. Each guard is a single line tagged "// m174-guard:<id>"; m174-mutation.test.ts deletes each in turn. (Kept in loop.ts, inside the protected loop closure and loopSha256, rather than a new lib file.)
export const LOAD_DIAG_KINDS = ["MISSING_EXPORT", "MISSING_MODULE"] as const;
export type LoadDiagKind = (typeof LOAD_DIAG_KINDS)[number];
/** One filtered diagnostic: the team test file, the repo-relative module and the imported name (identifiers only). */
export interface LoadDiag { kind: LoadDiagKind; test: string; module: string; name: string; spec: string }
/** TypeScript codes read (any other diagnostic is dropped). */
export const EXPORT_CODES: readonly number[] = [2305, 2459, 2614, 2724];
export const MODULE_CODES: readonly number[] = [2307];
export const MAX_LOAD_DIAGS = 20;
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]{0,99}$/;
const SRC = /\.(?:ts|tsx|mts|cts)$/;

/** The fixed options of the diagnostics program (the repo's tsconfig is not read: no paths, plugins or extends). */
export const LOAD_OPTIONS: ts.CompilerOptions = {
  noEmit: true, allowJs: true, checkJs: false, skipLibCheck: true, types: [], noResolve: false, strict: false,
  module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022,
  allowImportingTsExtensions: true, resolveJsonModule: false, esModuleInterop: true, lib: ["lib.es2022.d.ts"],
};

/** A compiler host that reads only regular files inside `root` (realpath, outside node_modules) and TypeScript's lib dir. */
export function confinedHost(root: string, options: ts.CompilerOptions = LOAD_OPTIONS): ts.CompilerHost {
  const host = ts.createCompilerHost(options, true);
  const top = realpathSync(root);
  const libDir = realpathSync(dirname(ts.getDefaultLibFilePath(options)));
  const ok = (p: string): boolean => {
    let real: string;
    try { real = realpathSync(p); } catch { return false; }
    if (real.startsWith(libDir + sep)) return true; // TypeScript's own lib files
    if (!real.startsWith(top + sep)) return false; // m174-guard:host-inside
    if (/(?:^|\/)node_modules(?:\/|$)/.test(relative(top, real).split(sep).join("/"))) return false; // m174-guard:host-no-modules
    if (/(?:^|\/)node_modules(?:\/|$)/.test(relative(top, resolve(p)).split(sep).join("/"))) return false; // m174-guard:host-no-modules-lex
    try { return statSync(real).isFile(); } catch { return false; }
  };
  return {
    ...host,
    fileExists: (p) => ok(p),
    readFile: (p) => (ok(p) ? readFileSync(p, "utf8") : undefined),
    getSourceFile: (p, lang, onError) => { const text = ok(p) ? readFileSync(p, "utf8") : undefined; return text === undefined ? undefined : ts.createSourceFile(p, text, lang, true); },
    directoryExists: (d) => { try { const r = realpathSync(d); return (r === top || r.startsWith(top + sep) || r.startsWith(libDir)) && statSync(r).isDirectory(); } catch { return false; } },
    getDirectories: () => [],
    realpath: (p) => { try { return realpathSync(p); } catch { return p; } },
    writeFile: () => { /* never */ },
  };
}

/** Does `file` (repo-relative) export names TypeScript cannot know here (an `export *` from a module outside the copy)? */
function opaqueExports(program: ts.Program, host: ts.CompilerHost, abs: string, seen: Set<string> = new Set()): boolean {
  if (seen.has(abs)) return false;
  seen.add(abs);
  const sf = program.getSourceFile(abs);
  if (!sf) return false; // callers pass files of the program only
  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st) || st.exportClause || !st.moduleSpecifier || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const r = ts.resolveModuleName(st.moduleSpecifier.text, abs, program.getCompilerOptions(), host).resolvedModule;
    const target = r ? program.getSourceFile(r.resolvedFileName) : undefined;
    if (!target) return true; // m174-guard:star-unknown
    if (opaqueExports(program, host, target?.fileName ?? "", seen)) return true;
  }
  return false;
}

/**
 * The filtered load diagnostics of the team's test files in the copy `dir` (repo-relative paths), at most
 * MAX_LOAD_DIAGS, sorted. `teamTests`: the team's test files (never a module to edit). Nothing is executed.
 */
export function loadDiagnostics(dir: string, testFiles: readonly string[], teamTests: ReadonlySet<string> = new Set(testFiles)): LoadDiag[] {
  const top = realpathSync(dir);
  const host = confinedHost(top);
  const roots = [...testFiles].sort().map((f) => join(top, f)).filter((p) => existsSync(p));
  const program = ts.createProgram({ rootNames: roots, options: LOAD_OPTIONS, host });
  const out: LoadDiag[] = [];
  const key = new Set<string>();
  for (const abs of roots) {
    const sf = program.getSourceFile(abs);
    if (!sf) continue;
    const test = relative(top, abs).split(sep).join("/");
    for (const d of program.getSemanticDiagnostics(sf)) {
      const exp = EXPORT_CODES.includes(d.code), mod = MODULE_CODES.includes(d.code);
      if (!exp && !mod) continue;
      if (d.start === undefined) continue;
      for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.importClause) continue;
        const spec = st.moduleSpecifier.text;
        if (!spec.startsWith("./") && !spec.startsWith("../")) continue; // m174-guard:relative
        if (st.importClause.isTypeOnly) continue; // m174-guard:type-only (erased: cannot stop a suite loading)
        if (mod && d.start === st.moduleSpecifier.getStart(sf)) {
          const lex = posix.normalize(posix.join(posix.dirname(test), spec));
          if (lex.startsWith("../") || /(?:^|\/)node_modules(?:\/|$)/.test(lex)) continue; // m174-guard:module-lex-inside
          push({ kind: "MISSING_MODULE", test, module: lex, name: "", spec });
          continue;
        }
        const b = st.importClause.namedBindings;
        if (!exp || !b || !ts.isNamedImports(b)) continue;
        for (const e of b.elements) {
          const n = e.propertyName ?? e.name;
          if (d.start < n.getStart(sf) || d.start >= n.getEnd()) continue;
          if (e.isTypeOnly) continue; // m174-guard:type-only-name
          const r = ts.resolveModuleName(spec, abs, LOAD_OPTIONS, host).resolvedModule;
          if (!r) continue;
          const real = realpathSync(r.resolvedFileName);
          const module = relative(top, real).split(sep).join("/");
          if (module.startsWith("..") || !SRC.test(module) || /\.d\.[cm]?ts$/.test(module)) continue; // m174-guard:module-source
          if (codeTestPath(module) || isGeneratedPath(module)) continue; // m174-guard:module-not-test
          if (teamTests.has(module)) continue; // m174-guard:module-not-team
          if (opaqueExports(program, host, real)) continue; // m174-guard:star-opaque
          push({ kind: "MISSING_EXPORT", test, module, name: n.text, spec });
        }
      }
    }
  }
  function push(x: LoadDiag): void {
    if (x.kind === "MISSING_EXPORT" && !IDENT.test(x.name)) return; // m174-guard:name-ident
    const k = `${x.kind}\0${x.module}\0${x.name}`;
    if (key.has(k)) return;
    key.add(k);
    out.push(x);
  }
  out.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.module < b.module ? -1 : a.module > b.module ? 1 : 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.test < b.test ? -1 : 1));
  return out.slice(0, MAX_LOAD_DIAGS); // m174-guard:cap
}

/** M174 L0 edit gate (load-repair mode only; Auditor's single-token scope): the token a load repair may insert. */
export const LOAD_EDIT_TOKEN = "export ";
/** Is `next` exactly `orig` with 1..MAX_LOAD_DIAGS copies of LOAD_EDIT_TOKEN inserted, each at the start of the text
 *  or after whitespace (so it never joins an identifier)? Nothing else may differ: no new import, statement or body. */
export function loadEditShape(orig: string, next: string): boolean {
  const T = LOAD_EDIT_TOKEN;
  const k = (next.length - orig.length) / T.length;
  if (!Number.isInteger(k) || k < 1 || k > MAX_LOAD_DIAGS) return false; // m174-guard:scope-count
  let o = 0, n = 0;
  for (let left = k; ; left--) {
    let p = 0;
    while (o + p < orig.length && n + p < next.length && orig[o + p] === next[n + p]) p++;
    if (left === 0) return o + p === orig.length && n + p === next.length;
    let hit = p, seen = false;
    for (let i = Math.max(0, p - T.length); i <= p && !seen; i++) if (next.startsWith(T, n + i)) { hit = i; seen = true; }
    if (!seen) return false; // m174-guard:scope-token
    if (n + hit > 0 && !/\s/.test(next[n + hit - 1]!)) return false; // m174-guard:scope-boundary
    o += hit;
    n += hit + T.length;
  }
}
/** Test infrastructure and config a load repair may never touch (runner configs, setup files). */
const LOAD_EDIT_INFRA = /(?:^|\/)(?:[^/]*[.-])?config\.[cm]?tsx?$|(?:^|\/)(?:vitest|vite|jest|mocha|ava|karma)[^/]*\.[cm]?tsx?$|(?:^|\/)[^/]*setup[^/]*\.[cm]?tsx?$/i;
/**
 * M174 L0 edit gate: why a load-repair proposal is outside the single-token scope (null: inside). Checked on the copy
 * reset to the pinned commit, before the team's tests are put back and before anything runs; a proposal outside the
 * scope is the proposer's failure (PROPOSER_FAILED), never run. `original` reads a regular file of the pinned commit.
 */
export function loadEditProblem(edits: readonly Edit[], original: (path: string) => string | null): string | null {
  if (edits.length === 0) return "empty"; // m174-guard:scope-nonempty
  for (const e of edits) {
    if (!/\.(?:[cm]?ts|tsx)$/.test(e.path) || /\.d\.[cm]?ts$/.test(e.path)) return "not-source"; // m174-guard:scope-source
    if (codeTestPath(e.path) || isGeneratedPath(e.path)) return "test-path"; // m174-guard:scope-not-test
    if (LOAD_EDIT_INFRA.test(e.path)) return "infra"; // m174-guard:scope-not-infra
    const o = original(e.path);
    if (o === null) return "new-file"; // m174-guard:scope-exists
    if (o === null || !loadEditShape(o, e.content)) return "shape"; // m174-guard:scope-shape
  }
  return null;
}

// ---- M175 L0 edit-scope gate (spec/edit-gate-m175.md)
// Generalizes the M174 load gate (loadEditProblem / loadEditShape / LOAD_EDIT_INFRA, reused below as the one source of
// truth for the export shape and the infra file class) from load-repair to EVERY proposer and attempt. In normal
// (edit) mode the loop calls editScopeProblem on every candidate, in the same place the load gate runs (before the
// team's tests go back, before anything runs): a candidate whose scope is wider than the pinned policy admits is
// refused (EDIT_SCOPE) rather than run, because a wider edit could add a runner-patching import, edit a test or config,
// or redefine a global and so make a fake PASS in process. The classification has three axes: the edited file's class,
// the top-level statement shape, and the identifier tokens.

/** PINNED edit-scope policy (m168-style): the only scope classes allowed before a run, per attempt mode. "load" is the
 *  M174 load-repair special case (one inserted `export ` keyword); "edit" is every other attempt (that, or an in-body
 *  change to an existing source file). Widening it later (multi-token edits, new imports, test/config edits) is a
 *  reviewed one-line change here, pinned by the M175 policy test (see the edit-gate-m175 spec). */
export const EDIT_SCOPE_POLICY: { readonly edit: readonly EditScopeClass[]; readonly load: readonly EditScopeClass[] } =
  Object.freeze({ edit: Object.freeze(["export-keyword", "in-body"] as const), load: Object.freeze(["export-keyword"] as const) });

/** Identifier tokens that reach the runner's own assertions or the module system; a repair never needs to add one, so a
 *  candidate using one more often than the original is a multi-token global redefine, outside scope. */
export const EDIT_DANGEROUS: readonly string[] = ["globalThis", "global", "eval", "Function", "require", "Reflect", "Proxy", "__proto__", "expect", "assert", "vi", "jest"];

const EDIT_LOCKFILE = /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.ya?ml|bun\.lockb?)$/;
const editSourceExt = (p: string): boolean => /\.(?:[cm]?ts|tsx)$/.test(p) && !/\.d\.[cm]?ts$/.test(p);

/** Per identifier, how many times it appears as a word in `s` (comments and strings counted too: a cheap over-count
 *  that can only make the gate stricter, never looser). */
function editTokenCounts(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of s.match(/[A-Za-z_$][\w$]*/g) ?? []) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
}
/** Top-level statements of `s`, or null if it does not parse (an unparsable candidate cannot run or patch anything). */
function editTopLevel(s: string): ts.Statement[] | null {
  const sf = ts.createSourceFile("edit.tsx", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diags = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  return diags && diags.length ? null : [...sf.statements];
}
const EDIT_IMPORTISH = new Set<ts.SyntaxKind>([ts.SyntaxKind.ImportDeclaration, ts.SyntaxKind.ImportEqualsDeclaration]);
const editImportish = (st: readonly ts.Statement[]): number =>
  st.filter((s) => EDIT_IMPORTISH.has(s.kind) || (ts.isExportDeclaration(s) && s.moduleSpecifier !== undefined)).length;

/** The scope class of one edit to an existing source file, or a refusal reason (string). An edit whose candidate (or
 *  whose original) does not parse is "in-body": it cannot run or patch anything, so it fails safely at run time rather
 *  than being refused here (m173's broken-return case relies on this). The structural checks run only when both parse,
 *  and each is deletion-safe (a removed guard changes the class, it does not throw), so the mutation test can replay. */
export function editSourceClass(orig: string, next: string): EditScopeClass | string {
  if (loadEditShape(orig, next)) return "export-keyword"; // m175-guard:shape-export
  const a = editTopLevel(orig), b = editTopLevel(next);
  if (a !== null && b !== null) {
    const n = Math.min(a.length, b.length);
    if (a.length !== b.length) return "top-level-count"; // m175-guard:toplevel-count
    for (let i = 0; i < n; i++) if (a[i]!.kind !== b[i]!.kind) return "top-level-kind"; // m175-guard:toplevel-kind
    if (editImportish(b) > editImportish(a)) return "adds-import"; // m175-guard:adds-import
    const ca = editTokenCounts(orig), cb = editTokenCounts(next);
    for (const w of EDIT_DANGEROUS) if ((cb.get(w) ?? 0) > (ca.get(w) ?? 0)) return "dangerous:" + w; // m175-guard:dangerous
  }
  return "in-body";
}
/** The scope class of one edit, or a refusal reason. `original` reads a regular file at the pinned commit (null: none). */
export function editClass(path: string, content: string, original: (p: string) => string | null): EditScopeClass | string {
  if (codeTestPath(path) || isGeneratedPath(path)) return "test-file"; // m175-guard:class-test
  if (EDIT_LOCKFILE.test(path)) return "lockfile"; // m175-guard:class-lockfile
  if (LOAD_EDIT_INFRA.test(path)) return "runner-infra"; // m175-guard:class-infra
  if (!editSourceExt(path)) return "config"; // m175-guard:class-source (package.json, tsconfig, *.config.*, .json/.yml, .js, .d.ts)
  const o = original(path);
  if (o === null) return "new-file"; // m175-guard:class-exists
  return editSourceClass(o ?? "", content); // (o is non-null here; the ?? keeps class-exists's deletion a clean miss, not a throw)
}
/**
 * M175 general L0 edit gate: why a proposal is outside the pinned scope for `mode` (null: inside), checked on the copy
 * reset to the pinned commit, before the team's tests go back and before anything runs. An edit to a path outside the
 * copy or to a team test file is left to applyEdits (EDIT_OUTSIDE_COPY / TEAM_TEST_EDIT), so `skip(path)` is true for
 * those; every other edit must land in a class EDIT_SCOPE_POLICY[mode] admits.
 */
export function editScopeProblem(edits: readonly Edit[], original: (p: string) => string | null, skip: (p: string) => boolean, mode: "edit" | "load" = "edit"): string | null {
  const allow = EDIT_SCOPE_POLICY[mode];
  for (const e of edits) {
    if (skip(e.path)) continue; // m175-guard:skip-owned
    const c = editClass(e.path, e.content, original);
    if (!(EDIT_SCOPE_CLASSES as readonly string[]).includes(c)) return c; // a refusal reason
    if (!allow.includes(c as EditScopeClass)) return c; // m175-guard:policy (a class this mode does not admit)
  }
  return null;
}
/** The widest scope class a (non-refused) proposal ran under, for the PASS row, or null if there is nothing to record. */
export function editScopeOf(edits: readonly Edit[], original: (p: string) => string | null): EditScopeClass | null {
  let out: EditScopeClass | null = null;
  for (const e of edits) {
    const c = editClass(e.path, e.content, original);
    if (!(EDIT_SCOPE_CLASSES as readonly string[]).includes(c)) continue;
    if (c === "in-body") return "in-body";
    out = c as EditScopeClass;
  }
  return out;
}

// ---- the proposer

export interface Edit { path: string; content: string }
/** (after #659) A proposal's `edits` must be an array of { path: string, content: string }; anything else (missing,
 *  an object, a bad element) is the proposer's failure, PROPOSER_FAILED. An empty array is a well-formed no-op attempt:
 *  it is applied (nothing changes) and graded like any other attempt. (batch 6) A sparse array (a hole, which
 *  Array.prototype.every skips) is malformed too: Array.from turns each hole into undefined, which fails the check. */
const validEdits = (x: unknown): x is Edit[] => Array.isArray(x) && Array.from(x as unknown[]).every((e) => typeof e === "object" && e !== null && typeof (e as Edit).path === "string" && typeof (e as Edit).content === "string");
export interface Feedback { attempt: number; codes: AttemptCode[]; failing: string[]; tests: LoopTests }
/** M174: `loadDiagnostics` is given only in load-repair mode (the baseline suite did not load; see loadRepairDiags). */
export interface ProposeInput { request: string; repo: string; plan: LoopPlan; files: readonly IndexFile[]; context: readonly string[]; attempt: number; feedback: readonly Feedback[]; baseline?: LoopBaseline | null; loadDiagnostics?: readonly LoadDiag[] }
export type Proposal = { edits: Edit[] } | { refuse: "NO_EDIT" | "NO_MORE_EDITS" };
export interface Proposer {
  name: string;
  /**
   * M166: a model-backed proposer (looprow LOOP_MODEL_PROPOSERS) names the model manifest sha256 behind its ranking;
   * the loop copies it into the (v4) row, read when the row is written. Absent / null for proposers without a model.
   */
  readonly modelManifestSha256?: string | null;
  /**
   * M152: called once per task after the baseline, on the copy reset to the pinned commit (the team's test files are
   * NOT in it), with the code search tools and the baseline's failing test names (node:test only). A proposer must do
   * all its searching here: from the first next() on, the copy holds the team's tests it is graded by.
   */
  prepare?(search: CodeRepo, input: { request: string; failing: readonly string[] }): void;
  next(input: ProposeInput): Proposal;
  /**
   * M174: true only for a proposer that can repair a suite that does not load from its load diagnostics (repair-v2).
   * For any other proposer such a baseline still refuses BASELINE_SUITE_LOAD before it is asked.
   */
  readonly loadRepair?: boolean;
}

/**
 * M174 (spec/load-diagnostics-m174.md): the load diagnostics that let the loop go on past a baseline whose suite did
 * not load (null: refuse as before). Only a SUITE_LOAD baseline, only for a load-repair proposer, and only when the
 * team's tests import at least one name a relative source module of the copy does not export. The attempts are graded
 * as every attempt: PASS needs no failure code at all, so a suite that still does not load never passes.
 */
export function loadRepairDiags(refusal: LoopCode | null, proposer: Pick<Proposer, "loadRepair">, diags: () => LoadDiag[]): LoadDiag[] | null {
  if (refusal !== "BASELINE_SUITE_LOAD") return null; // m174-guard:lm-suite-load-only
  if (proposer.loadRepair !== true) return null; // m174-guard:lm-proposer
  const d = diags();
  if (!d.some((x) => x.kind === "MISSING_EXPORT")) return null; // m174-guard:lm-needs-export
  return d;
}

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
  /** M152: a fresh proposer per task (runLoopFile); wins over `proposer`. M167: given the task's key and file sha256
   *  (model-v1 looks its ranking up by them; other proposers ignore them). */
  makeProposer?: (task: { taskKey: string; taskFileSha256: string }) => Proposer;
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
  /** M162 (runLoopFile): the planner flag (v1|v2|v3|v4 or plan-only-vN), resolved by selectPlanner; absent = the default. */
  plannerFlag?: string;
  /** M171, tests only: where the task's work dir is made (default os.tmpdir()). */
  workBase?: string;
  /** M171, tests only: the private roots no link in the copy may point into (default privateRoots(root)). */
  privateRoots?: string[];
}
export interface AttemptRecord { attempt: number; edits: string[]; codes: AttemptCode[]; failing: string[]; tests: LoopTests }
export interface LoopResult { row: LoopRow; plan: LoopPlan | null; attempts: AttemptRecord[]; context: string[] }

/** The loop's code, hashed into every row: the loop, its row, its dependency install and (M152) the edit proposer, so a
 *  row binds the proposer version it was produced with. `root` is for tests only. */
export function loopSha256(root: string = ROOT): string {
  const files = ["lib/loop.ts", "lib/looprow.ts", "lib/loopdeps.ts"];
  files.push("lib/editpropose.ts"); // m152-guard:sha-proposer
  files.push("lib/modelpropose.ts"); // m167-guard:sha-model
  return sha256(files.map((f) => readFileSync(join(root, "peaceai", f), "utf8")).join("\0"));
}

/** Runs the loop on one task. Never throws: every outcome is a row with a fixed code. */
export function runLoopTask(task: PlanTask, set: "public" | "hidden", fileSha: string, o: Required<Omit<LoopOptions, "committed" | "outDir" | "training" | "deps" | "depsCache" | "depsDir" | "makeProposer" | "plannerFlag" | "workBase" | "privateRoots">> & { training: Set<string>; deps?: DepsOptions; depsCache?: DepsCache; planner?: PlannerName; workBase?: string; privateRoots?: string[] }): LoopResult {
  const maxAttempts = Math.min(MAX_ATTEMPTS, Math.max(1, Math.floor(o.maxAttempts)));
  const workspace = (() => { try { return git(o.root, "rev-parse", "HEAD"); } catch { return "0".repeat(40); } })();
  const names = set === "public" ? { repo: task.repo, commit: task.commit } : {};
  const records: AttemptRecord[] = [];
  // M162: the planner (absent = selectPlanner's default) and its digest, recorded in every row
  const planner = o.planner ?? loopPlanner(undefined)!;
  const plannerSha = LOOP_PLANNERS[planner].sha();
  let plan: LoopPlan | null = null;
  let context: string[] = [];
  const tests: LoopTests | null = null;
  let pick: RunnerPick | null = null;
  let deps: LoopRow["deps"] = null;
  let baseline: LoopBaseline | null = null;
  let loadDiags: LoadDiag[] | null = null; // M174: set only in load-repair mode
  let editScope: EditScopeClass | null = null; // M175: the scope class a normal-mode PASS ran under
  const done = (code: LoopCode, depsFail?: DepsFail, isolationFail?: IsolationFail | null): LoopResult => ({
    row: {
      schema: LOOP_SCHEMA_V4, at: now(), set, taskFileSha256: fileSha, taskKey: taskKey(fileSha, task.id), ...names, workspace,
      loop: LOOP_VERSION_V2, loopSha256: loopSha256(), proposer: o.proposer.name, planner, plannerSha256: plannerSha,
      modelManifestSha256: o.proposer.modelManifestSha256 ?? null, code, maxAttempts, // M166: v4
      ...((LOOP_MODEL_PROPOSERS as readonly string[]).includes(o.proposer.name) ? {} : { lm: "not-loadable" as const }), // m167-guard:loop-no-lm
      attempts: records.length, result: code === "PASS" ? "pass" : code === "ATTEMPT_LIMIT" ? "fail" : "refused",
      attemptCodes: records.map((r) => r.codes), tests: records.length ? records[records.length - 1]!.tests : tests,
      // hidden rows: taskKey plus scores only (runner, package manager and baseline counts could identify the repo)
      ...(set === "hidden" ? { runner: null, deps: null, baseline: null } : { runner: pick?.runner ?? null, deps: pick ? deps : null, baseline }),
      // M169: which install step failed (a fixed code), public rows only
      ...(set === "public" && code === "DEPS_INSTALL_FAILED" && depsFail ? { depsFail } : {}), // m169-guard:loop-depsfail
      // M171: which isolation check failed (a fixed code), public rows only
      ...(set === "public" && code === "ISOLATION_UNAVAILABLE" && isolationFail ? { isolationFail } : {}), // m171-guard:loop-isofail
      // M174: the baseline suite did not load; the task went on in load-repair mode (both sets: a fixed code)
      ...(loadDiags ? { baselineLoad: "MISSING_EXPORT" as const } : {}), // m174-guard:loop-row-load
      ...(editScope ? { editScope } : {}), // m175-guard:loop-row-scope
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
  let work: WorkDir | null = null;
  const ownCache = o.depsCache ? null : openDepsCache();
  const cache = o.depsCache ?? ownCache!;
  try {
    // M171: the copy lives in a fresh private work dir only the runner and the candidate uid can enter
    work = openWorkDir(cand, o.workBase);
    if (work === null) return done("ISOLATION_UNAVAILABLE", undefined, "WORK_DIR"); // m171-guard:loop-work
    const roots = o.privateRoots ?? privateRoots(o.root, o.env);
    c = o.fetcher(task.repo, task.commit, task.reference.from.merge, task.tests.files, work.dir);
    if (c.head !== task.commit) return done("COMMIT_MISMATCH");
    chmodSync(c.dir, 0o755); // the copy itself is mkdtemp's 0700; the work dir around it (0750, group cand) keeps others out
    const early = isolationProblem(c, work.dir, cand, roots, false);
    if (early) return done("ISOLATION_UNAVAILABLE", undefined, early); // m171-guard:loop-iso-early
    const lic = (() => { try { return readFileSync(join(c!.dir, task.licensePath), "utf8"); } catch { return null; } })();
    if (lic === null || sha256(lic) !== task.licenseSha256) return done("LICENSE_CHANGED");
    // 1. plan, 2. context (both read-only on the copy)
    const files = indexFiles(c.dir);
    let pkg: Record<string, any> = {};
    try { pkg = JSON.parse(readFileSync(join(c.dir, "package.json"), "utf8")); } catch { pkg = {}; }
    const testCommand: string | null = typeof pkg.scripts?.test === "string" ? pkg.scripts.test : null;
    try { plan = LOOP_PLANNERS[planner].plan(task, { repo: task.repo, files, rules: o.rules, model: loadModel(), testCommand }, c.dir); }
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
      if ("refuse" in d) return done(d.refuse, d.fail);
      deps = d.pm;
    } else deps = "none";
    installRunner(c, cand);
    if (det.runner !== "node-test") installShim(c.dir);
    // the team's tests must fail before any edit (else the task proves nothing)
    putTeamTests();
    const iso = isolationProblem(c, work.dir, cand, roots, true);
    if (iso) return done("ISOLATION_UNAVAILABLE", undefined, iso); // m171-guard:loop-iso
    const base = runTests(c, cand, o.runMs, det, [...c.teamTests.keys()]);
    if (!base.isolation) return done("ISOLATION_UNAVAILABLE", undefined, base.isoFail);
    const bp = base.codes.length ? base.tests.passedByPeaceAI : base.tests.total;
    baseline = { total: base.tests.total, passing: bp, failing: base.tests.total - bp };
    const unrun = baselineRefusal(base);
    // M174: the team's tests are in the copy now; their load diagnostics are read (never run) only when they can matter
    loadDiags = loadRepairDiags(unrun, o.proposer, () => { try { return loadDiagnostics(c!.dir, [...c!.teamTests.keys()].sort()); } catch { return []; } }); // a crash here refuses as before
    if (unrun && !loadDiags) return done(unrun); // m173-loop-guard:base-refuse (no edit is scored against a baseline that proved nothing)
    if (base.codes.length === 0) return done("BASELINE_PASSES");
    // (M152) the proposer's search, on the pinned commit without the team's tests
    if (o.proposer.prepare) {
      resetCopy(c); // m152-guard:prepare-clean
      // a throwing search is the proposer's failure, not the fetch's: a fixed code, the error itself is dropped
      let prepared = true;
      try { o.proposer.prepare(openRepo(c.dir), { request: task.request, failing: [...base.failing] }); } catch { prepared = false; }
      if (!prepared) return done("PROPOSER_FAILED"); // m152-guard:prepare-failed
    }
    // 4. the proposals. (M164) a throwing next() is the proposer's failure, not the fetch's: a fixed code, the error
    // itself is dropped (as prepare's); so is a next() that returns no proposal at all (undefined or another non-object,
    // which would otherwise throw on the `in` check below and land on the catch-all FETCH_FAILED), and (after #659) a
    // proposal that neither refuses nor carries a valid `edits` array (e.g. [] or {}), which would throw in applyEdits
    const feedback: Feedback[] = [];
    const ask = (attempt: number): ReturnType<Proposer["next"]> | null => {
      try { return o.proposer.next({ ...(loadDiags ? { loadDiagnostics: loadDiags } : {}), request: task.request, repo: task.repo, plan: plan!, files, context, attempt, feedback, baseline }); } catch { return null; }
    };
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const p = ask(attempt);
      if (p === null) return done("PROPOSER_FAILED"); // m164-guard:next-failed
      if (typeof p !== "object") return done("PROPOSER_FAILED"); // m164-guard:next-empty
      if (!("refuse" in p) && !validEdits((p as { edits?: unknown }).edits)) return done("PROPOSER_FAILED"); // m164-guard:next-malformed
      if ("refuse" in p) return done(p.refuse);
      // 4. apply in the copy (fresh from the pinned commit + the team's tests each time)
      resetCopy(c);
      // M174 L0 gate: a load-repair proposal must be single `export ` insertions in existing source files, else it is
      // refused here, before anything runs (a wider edit could patch the runner's assertions in process)
      const readPinned = (f: string): string | null => { const full = safeEditPath(c!.dir, f); try { return full && lstatSync(full).isFile() ? readFileSync(full, "utf8") : null; } catch { return null; } };
      if (loadDiags && loadEditProblem(p.edits, readPinned) !== null) return done("PROPOSER_FAILED"); // m174-guard:scope-gate
      if (!loadDiags && editScopeProblem(p.edits, readPinned, (f) => safeEditPath(c!.dir, f) === null || c!.teamTests.has(posix.normalize(f)), "edit") !== null) return done("EDIT_SCOPE"); // m175-guard:scope-gate
      putTeamTests();
      const bad = applyEdits(c, p.edits);
      if (bad) return done(bad);
      // 5. run, 6. read codes + names
      const r = runTests(c, cand, o.runMs, det, [...c.teamTests.keys()]);
      if (!r.isolation) return done("ISOLATION_UNAVAILABLE", undefined, r.isoFail);
      // the team's tests pass: the tests the search tools relate to the edited files (testsFor) must not regress
      if (r.codes.length === 0) {
        const related = relatedTests(c, det, p.edits.map((e) => e.path)); // per attempt: each edit touches its own files
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
      if (r.codes.length === 0) { if (!loadDiags) editScope = editScopeOf(p.edits, readPinned); return done("PASS"); }
      feedback.push({ attempt, codes: r.codes, failing: r.failing, tests: r.tests }); // 7. revise
    }
    return done("ATTEMPT_LIMIT");
  } catch (e) {
    return done(e instanceof LoopError ? e.code : "FETCH_FAILED");
  } finally {
    c?.close();
    work?.close();
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
export function runLoopFile(path: string, opts: LoopOptions = {}): { code: "OK" | "PLANNER_UNKNOWN" | "TASK_FILE_UNLOCKED" | "TASK_FILE_INVALID" | "TRAINING_LIST_UNREADABLE"; results: LoopResult[] } {
  // M162: an unknown planner name is refused before anything is read or run
  const planner = loopPlanner(opts.plannerFlag);
  if (!planner) return { code: "PLANNER_UNKNOWN", results: [] }; // m162-guard:planner-unknown
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
      const r = runLoopTask(task, parsed.set, fileSha, { ...o, planner, proposer: opts.makeProposer?.({ taskKey: taskKey(fileSha, task.id), taskFileSha256: fileSha }) ?? opts.proposer ?? rulesProposer(o.rules), deps: opts.deps, depsCache });
      if (loopRowProblem(r.row)) throw new Error("log_row_invalid"); // a bug: never write a row the validator rejects
      results.push(r);
      appendFileSync(join(root, LOOP_LOG), JSON.stringify(r.row) + "\n");
      writeFileSync(join(outDir, `${r.row.taskKey}.json`), JSON.stringify({ row: r.row, attempts: r.attempts, context: r.context, plan: r.plan }, null, 1) + "\n");
    }
  } finally { if (!opts.depsCache) depsCache.close(); }
  return { code: "OK", results };
}
export { ATTEMPT_CODES };
