// M11: the proposal run itself. It refuses to start anywhere but an ephemeral GitHub-hosted job in a private repo
// (selfChangeAllowedHere); there is no box or local mode.
// It makes a FRESH clone of the source at the base commit, applies the change there, runs the LIVE suite (the base
// commit's peaceai/test/*.test.ts, restored from the base) plus new peaceai/self-tests, and writes the record and
// a git bundle of the exact candidate commit (so the promotion PR head can be that tested commit).
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appliedDiffRefusals, budgetMinutes, checkSelfChangeDiff, checkStage2Proposal, computeNeverZone, listSha, parseGitDiff, parseRawZ, SELF_SCHEMA, selfChangeAllowedHere, sha256, STAGE2_COUNTS_TRUST, STAGE2_DIFF_ARGS, STAGE2_PHASES, STAGE2_SCHEMA, stage2DiffSha, stage2GradeDecision, type CaseRun, type NeverZoneSet, type SelfChangeRecord, type Stage2Check, type Stage2Phase, type Stage2PrFacts, type Stage2Record, type TestRun } from "./selfchange.ts";

const NOREPLY = ["-c", "user.name=PeaceG03", "-c", "user.email=301894882+PeaceG03@users.noreply.github.com"];
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 }).trim();

/** The suite runs as a fresh top-level test run with a minimal environment (no inherited credentials). */
function suiteEnv(): NodeJS.ProcessEnv {
  const keep = ["PATH", "HOME", "LANG", "TZ", "TMPDIR"];
  const env: NodeJS.ProcessEnv = { PEACEAI_SELF_SANDBOX: "1", CI: "true" };
  for (const k of keep) if (process.env[k]) env[k] = process.env[k];
  return env;
}

function runSuite(cwd: string, suite: "live" | "new", files: string[], deadline: number): TestRun {
  if (files.length === 0) return { suite, files, filesSha256: listSha(files), exitCode: 0, pass: 0, fail: 0 };
  const left = Math.max(1000, deadline - Date.now());
  const r = spawnSync(join(cwd, "node_modules/.bin/tsx"), ["--test", "--test-reporter=tap", ...files], { cwd, encoding: "utf8", timeout: left, maxBuffer: 1 << 28, env: suiteEnv() });
  return { suite, files, filesSha256: listSha(files), exitCode: r.status ?? 124, pass: lastCount(r.stdout ?? "", "pass"), fail: lastCount(r.stdout ?? "", "fail") + (r.status === null ? 1 : 0) };
}

/** nodeModules: an already-installed dependency tree to link (the job's own checkout); otherwise `npm ci` in the clone. */
export interface ProposeOptions { id: string; diff: string; source: string; base: string; out: string; budget?: string; nodeModules?: string }
export interface ProposeResult { code: 0 | 2 | 3; message: string; record: SelfChangeRecord }

export function proposeInSandbox(o: ProposeOptions): ProposeResult | { code: 3; message: string; record: null } {
  const here = selfChangeAllowedHere(process.env);
  if (!here.ok) return { code: 3, message: `self-change refused reason=${here.reason}`, record: null };
  const deadline = Date.now() + budgetMinutes(o.budget) * 60_000;
  const check = checkSelfChangeDiff(o.diff);
  const rec: SelfChangeRecord = {
    schema: SELF_SCHEMA, id: o.id, baseSha: "", candidateSha: "", diffSha256: sha256(o.diff), paths: check.paths, check,
    liveSuite: { baseSha: "", filesSha256: "" }, tests: [], status: "refused",
    rollback: { kind: "revert", of: null, command: `peaceai/bin/self-change.ts rollback --record self-changes/${o.id}.json --repo <clone of main>` },
    createdAt: new Date().toISOString(),
  };
  const write = () => {
    mkdirSync(join(o.out, "self-changes"), { recursive: true });
    writeFileSync(join(o.out, "self-changes", `${o.id}.json`), JSON.stringify(rec, null, 1) + "\n");
  };
  if (!check.ok) {
    write();
    return { code: 2, record: rec, message: `self-change propose id=${o.id} status=refused refusals=${check.refusals.length}\n${check.refusals.map((r) => `  ${r.path}: ${r.reason}`).join("\n")}` };
  }
  const work = mkdtempSync(join(tmpdir(), "peaceai-self-"));
  try {
    execFileSync("git", ["clone", "--quiet", "--no-hardlinks", "--no-checkout", o.source, work], { stdio: "ignore" });
    rec.baseSha = git(work, "rev-parse", `${o.base}^{commit}`);
    rec.liveSuite.baseSha = rec.baseSha;
    git(work, "checkout", "--quiet", "--detach", rec.baseSha);
    git(work, "remote", "remove", "origin");
    const liveFiles = git(work, "ls-tree", "-r", "--name-only", rec.baseSha, "peaceai/test/").split("\n").filter((f) => /\.test\.ts$/.test(f));
    rec.liveSuite.filesSha256 = listSha(liveFiles);
    if (o.nodeModules && existsSync(o.nodeModules)) symlinkSync(o.nodeModules, join(work, "node_modules"), "dir");
    else execFileSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: work, stdio: "ignore", env: suiteEnv() });
    writeFileSync(join(work, ".self.patch"), o.diff);
    try { git(work, "apply", "--index", "--whitespace=nowarn", ".self.patch"); } catch {
      rec.check = { ...check, ok: false, refusals: [{ path: "-", reason: "patch does not apply to the base" }] };
      write();
      return { code: 2, record: rec, message: `self-change propose id=${o.id} status=refused reason=PATCH_DOES_NOT_APPLY` };
    }
    rmSync(join(work, ".self.patch"));
    // Auditor #504 blocker 1 (stage 1 too): git apply follows ---/+++ lines the header parser does not trust, so what
    // git STAGED must equal what was parsed, and the check is re-run on the canonical diff git produces.
    const staged = parseRawZ(execFileSync("git", ["diff", "--cached", "--raw", "-z", "--no-renames"], { cwd: work, encoding: "utf8", maxBuffer: 1 << 26 }));
    const again = checkSelfChangeDiff(git(work, "diff", "--cached", ...STAGE2_DIFF_ARGS.slice(1)));
    const applied = [...appliedDiffRefusals(staged, parseGitDiff(o.diff).files).map((reason) => ({ path: "-", reason })), ...again.refusals];
    if (applied.length) {
      rec.check = { ...check, ok: false, refusals: applied };
      write();
      return { code: 2, record: rec, message: `self-change propose id=${o.id} status=refused reason=APPLIED_DIFF_MISMATCH\n${applied.map((r) => `  ${r.path}: ${r.reason}`).join("\n")}` };
    }
    git(work, ...NOREPLY, "commit", "--quiet", "--no-verify", "-m", `self-change ${o.id}`);
    rec.candidateSha = git(work, "rev-parse", "HEAD");
    mkdirSync(join(o.out, "self-changes"), { recursive: true });
    git(work, "bundle", "create", join(o.out, "self-changes", `${o.id}.bundle`), `${rec.baseSha}..HEAD`);
    git(work, "checkout", rec.baseSha, "--", "peaceai/test");
    rec.tests.push(runSuite(work, "live", liveFiles, deadline));
    const newFiles = git(work, "ls-files", "peaceai/self-tests").split("\n").filter((f) => /\.test\.ts$/.test(f));
    rec.tests.push(runSuite(work, "new", newFiles, deadline));
    rec.status = rec.tests.every((t) => t.exitCode === 0 && t.fail === 0) && rec.tests[0]!.pass > 0 ? "awaiting-review" : "tested-failing";
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  write();
  const t = rec.tests.map((x) => `${x.suite}:pass=${x.pass},fail=${x.fail},exit=${x.exitCode}`).join(" ");
  return { code: rec.status === "awaiting-review" ? 0 : 3, record: rec, message: `self-change propose id=${o.id} status=${rec.status} base=${rec.baseSha.slice(0, 12)} candidate=${rec.candidateSha.slice(0, 12)} ${t}` };
}

// ---- M106 stage 2: a proposal that may touch protected (never-zone excluded) paths, graded under Auditor's limits.
// Auditor #504 blocker 5: grading is THREE kinds of step, and the private workflow runs each in its own fresh job:
//   prepareStage2  (job "prepare", runs NO candidate code): base pinned to main, never-zone closure from the base
//                  tree, strict parse, git apply, what git staged must equal what was parsed, the check runs on the
//                  canonical diff git produces, one candidate commit + bundle.
//   runStage2Phase (job "run", one fresh VM per phase; the ONLY place candidate code runs): its own clone and its
//                  own `npm ci --ignore-scripts` (no shared node_modules), each test run in a fresh session, the
//                  session and any new process killed afterwards (leftovers fail the phase). It writes raw counts
//                  only, never a verdict.
//   recordStage2   (job "record", runs NO candidate code): builds the record from the prepare output and the phase
//                  outputs. A failure is final: no retry, a rerun needs a new id (both records are kept).

const escRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const STAGE2_PREP_SCHEMA = "peaceai-self-change-prep:v2";
const STAGE2_RUN_SCHEMA = "peaceai-self-change-run:v2";
/** Every tracked test file of a commit (the unchanged base suite). */
export const suiteFilesAt = (work: string, sha: string): string[] => git(work, "ls-tree", "-r", "--name-only", sha).split("\n").filter((f) => /\.test\.ts$/.test(f) && !f.startsWith("node_modules/"));
const showAt = (work: string, sha: string) => (p: string): string | null => { const r = spawnSync("git", ["show", `${sha}:${p}`], { cwd: work, encoding: "utf8", maxBuffer: 1 << 26 }); return r.status === 0 ? r.stdout : null; };
/** The base tree's never-zone closure (blocker 2), read through git: no checkout, no candidate file involved. */
export const neverZoneAtSha = (work: string, sha: string): NeverZoneSet => computeNeverZone(git(work, "ls-tree", "-r", "--name-only", sha).split("\n").filter(Boolean), showAt(work, sha));

export interface Stage2Prep {
  schema: typeof STAGE2_PREP_SCHEMA; id: string; baseSha: string; mainSha: string; candidateSha: string; diffSha256: string;
  paths: string[]; candidateBlobs: Record<string, string | null>; check: Stage2Check; suiteFiles: string[]; createdAt: string;
  /** round 2 B4: the Results run that prepared this id (from GITHUB_REPOSITORY / GITHUB_RUN_ID / GITHUB_RUN_ATTEMPT) */
  run?: Stage2Record["run"];
}
/**
 * Blockers 1, 2, 6 (no candidate code runs here). `work` is a fresh clone at `baseSha` whose `mainRef` is main.
 * The submitted text is only parsed; everything that counts is computed from what git applied.
 */
export function prepareStage2(work: string, id: string, diff: string, baseSha: string, mainRef: string): Stage2Prep {
  const prep: Stage2Prep = { schema: STAGE2_PREP_SCHEMA, id, baseSha, mainSha: "", candidateSha: "", diffSha256: "", paths: [], candidateBlobs: {}, check: { ok: false, refusals: [], paths: [], newTests: [] }, suiteFiles: [], createdAt: new Date().toISOString() };
  const refuse = (reason: string) => { prep.check = { ok: false, refusals: [{ path: "-", reason }], paths: prep.paths, newTests: [] }; return prep; };
  const main = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${mainRef}^{commit}`], { cwd: work, encoding: "utf8" });
  if (main.status !== 0) return refuse("main is not available in the clone");
  prep.mainSha = main.stdout.trim();
  if (spawnSync("git", ["merge-base", "--is-ancestor", baseSha, prep.mainSha], { cwd: work }).status !== 0) return refuse("BASE_NOT_ON_MAIN: the base commit is not an ancestor of main");
  const parsed = parseGitDiff(diff);
  writeFileSync(join(work, ".self.patch"), diff);
  const ap = spawnSync("git", ["apply", "--index", "--whitespace=nowarn", ".self.patch"], { cwd: work, encoding: "utf8" });
  rmSync(join(work, ".self.patch"), { force: true });
  if (ap.status !== 0) return refuse("patch does not apply to the base");
  const staged = parseRawZ(execFileSync("git", ["diff", "--cached", "--raw", "-z", "--no-renames"], { cwd: work, encoding: "utf8", maxBuffer: 1 << 26 }));
  const canonical = git(work, "diff", "--cached", ...STAGE2_DIFF_ARGS.slice(1));
  const zone = neverZoneAtSha(work, baseSha);
  const cand = (p: string) => (existsSync(join(work, p)) ? readFileSync(join(work, p), "utf8") : null);
  const check = checkStage2Proposal(canonical, { base: showAt(work, baseSha), cand }, zone);
  const extra = [...parsed.problems.map((p) => `malformed diff: ${p}`), ...appliedDiffRefusals(staged, parsed.files)].map((reason) => ({ path: "-", reason }));
  prep.check = { ...check, ok: check.ok && extra.length === 0, refusals: [...extra, ...check.refusals] };
  prep.paths = [...new Set([...check.paths, ...staged.map((e) => e.path)])].sort();
  if (!prep.check.ok) return prep;
  git(work, ...NOREPLY, "commit", "--quiet", "-m", `self-change stage 2 ${id}`);
  prep.candidateSha = git(work, "rev-parse", "HEAD");
  prep.diffSha256 = stage2DiffSha(git(work, ...STAGE2_DIFF_ARGS, baseSha, prep.candidateSha));
  for (const p of prep.paths) { const r = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${prep.candidateSha}:${p}`], { cwd: work, encoding: "utf8" }); prep.candidateBlobs[p] = r.status === 0 ? r.stdout.trim() : null; }
  prep.suiteFiles = suiteFilesAt(work, baseSha);
  return prep;
}

export interface RawRun { file?: string; name?: string; exitCode: number; pass: number; fail: number; leftovers: number; tampered?: string[] }
export interface Stage2PhaseRun { schema: typeof STAGE2_RUN_SCHEMA; id: string; phase: Stage2Phase; candidateSha: string; runs: RawRun[]; leftovers: number; tampered?: number }

/** Processes in session `sid` (and, inside the private job only, any new process of this user since `before`). */
function strays(sid: number, before: ReadonlySet<number>, strict: boolean): number[] {
  const r = spawnSync("ps", ["-e", "-o", "pid=,sid=,uid=,ppid="], { encoding: "utf8" });
  const me = process.getuid?.() ?? -1;
  return (r.stdout ?? "").split("\n").map((l) => l.trim().split(/\s+/).map(Number)).filter((x) => x.length === 4 && Number.isFinite(x[0]))
    .filter(([pid, s, uid, ppid]) => pid !== process.pid && ppid !== process.pid && pid !== r.pid && (s === sid || (strict && uid === me && !before.has(pid!)))).map(([pid]) => pid!);
}
const pidsNow = (): Set<number> => new Set((spawnSync("ps", ["-e", "-o", "pid="], { encoding: "utf8" }).stdout ?? "").split("\n").map((l) => Number(l.trim())).filter((n) => n > 0));
/**
 * Blocker 5: one candidate test run in a fresh session (setsid), minimal env, with a deadline. Afterwards the
 * session is killed and counted; in the private job (strict) every new process of this user is too. Any leftover
 * fails the run. Off the private job (tests, the box) only the run's own session is touched.
 */
/**
 * Auditor #504 round 2 B1(2): the TAP runner prints its summary LAST, so the LAST `# pass N` / `# fail N` line counts;
 * a test that prints a fake summary earlier cannot win. (The counts stay advisory: candidate code shares the process.)
 */
export function lastCount(stdout: string, k: "pass" | "fail"): number {
  const all = [...stdout.matchAll(new RegExp(`^# ${k} (\\d+)$`, "gm"))];
  return all.length ? Number(all[all.length - 1][1]) : 0;
}
/** Auditor #504 round 3 R3-2: content hash of a file or a whole tree (symlinks hashed by target, never followed; "" = absent). */
export function treeHash(root: string, skip: ReadonlySet<string> = new Set([".git"])): string {
  const h = createHash("sha256");
  const walk = (p: string, rel: string): void => {
    let st;
    try { st = lstatSync(p); } catch { h.update(`absent\0${rel}\0`); return; }
    if (st.isSymbolicLink()) h.update(`link\0${rel}\0${readlinkSync(p)}\0`);
    else if (st.isDirectory()) { h.update(`dir\0${rel}\0${st.mode & 0o7777}\0`); for (const e of readdirSync(p).sort()) if (!skip.has(e)) walk(join(p, e), rel ? `${rel}/${e}` : e); }
    else if (st.isFile()) h.update(`file\0${rel}\0${st.mode & 0o7777}\0`).update(readFileSync(p)).update("\0");
    else h.update(`other\0${rel}\0`);
  };
  walk(root, "");
  return h.digest("hex");
}
/**
 * R3-2: what a candidate run must not change: every base test file and new test file in the clone, the clone's
 * node_modules, and the grader checkout (everything but .git). Hashed before and after each run; any change fails it.
 */
export function watchedHashes(work: string, files: readonly string[], grader: string | null): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of [...new Set(files)].sort()) m.set(`test:${f}`, treeHash(join(work, f)));
  // follow a top-level node_modules / grader symlink (the shared install is what a run could rewrite); links inside are hashed by target
  const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };
  m.set("node_modules", treeHash(real(join(work, "node_modules"))));
  if (grader) m.set("grader", treeHash(real(grader)));
  return m;
}
export function guardedRun(work: string, args: string[], deadline: number, files: readonly string[], grader: string | null): RawRun {
  const before = watchedHashes(work, files, grader);
  const r = isolatedRun(work, args, deadline);
  const after = watchedHashes(work, files, grader);
  const tampered = [...before].filter(([k, v]) => after.get(k) !== v).map(([k]) => k);
  return tampered.length ? { ...r, exitCode: r.exitCode || 1, fail: r.fail + 1, tampered } : { ...r, tampered };
}
export function isolatedRun(cwd: string, args: string[], deadline: number): { exitCode: number; pass: number; fail: number; leftovers: number } {
  const strict = selfChangeAllowedHere(process.env).ok;
  const before = pidsNow();
  const left = Math.max(1000, deadline - Date.now());
  const r = spawnSync("setsid", ["--wait", join(cwd, "node_modules/.bin/tsx"), ...args], { cwd, encoding: "utf8", timeout: left, killSignal: "SIGKILL", maxBuffer: 1 << 28, env: suiteEnv() });
  let leftovers = 0;
  for (let round = 0; round < 3; round++) {
    const s = r.pid ? strays(r.pid, before, strict) : [];
    if (!s.length) break;
    leftovers += s.length;
    for (const pid of s) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
    spawnSync("sleep", ["0.2"]);
  }
  return { exitCode: r.status ?? 124, pass: lastCount(r.stdout ?? "", "pass"), fail: lastCount(r.stdout ?? "", "fail") + (r.status === null ? 1 : 0), leftovers };
}

/**
 * The only place candidate code runs. `work` is a fresh clone holding base and candidate, with its OWN dependencies
 * (npm ci --ignore-scripts at the base lockfile; package files are never-zone). Writes nothing outside `work`.
 */
export function runStage2Phase(work: string, prep: Stage2Prep, phase: Stage2Phase, deadline: number, grader: string | null = null): Stage2PhaseRun {
  const out: Stage2PhaseRun = { schema: STAGE2_RUN_SCHEMA, id: prep.id, phase, candidateSha: prep.candidateSha, runs: [], leftovers: 0, tampered: 0 };
  // R3-2: every base test file + the new test files + node_modules + the grader must be unchanged by each run
  const watch = [...prep.suiteFiles, ...prep.check.newTests.map((t) => t.file)];
  const isolatedRun = (cwd: string, args: string[], dl: number) => guardedRun(cwd, args, dl, watch, grader);
  const tap = ["--test", "--test-reporter=tap"];
  const cases = prep.check.newTests.flatMap((t) => t.names.map((name) => ({ file: t.file, name })));
  const clean = (sha: string) => { git(work, "checkout", "--quiet", "-f", "--detach", sha); git(work, "clean", "-qfdx", "-e", "node_modules"); };
  if (phase === "suite") {
    clean(prep.candidateSha);
    if (prep.suiteFiles.length) git(work, "checkout", prep.baseSha, "--", ...prep.suiteFiles);
    out.runs.push(isolatedRun(work, [...tap, ...prep.suiteFiles], deadline));
  } else if (phase === "new-on-candidate") {
    for (const c of cases) { clean(prep.candidateSha); out.runs.push({ ...c, ...isolatedRun(work, [...tap, `--test-name-pattern=^${escRx(c.name)}$`, c.file], deadline) }); }
  } else {
    for (const c of cases) {
      clean(prep.baseSha);
      mkdirSync(join(work, c.file, ".."), { recursive: true });
      writeFileSync(join(work, c.file), execFileSync("git", ["show", `${prep.candidateSha}:${c.file}`], { cwd: work, encoding: "utf8", maxBuffer: 1 << 26 }));
      out.runs.push({ ...c, ...isolatedRun(work, [...tap, `--test-name-pattern=^${escRx(c.name)}$`, c.file], deadline) });
    }
  }
  out.leftovers = out.runs.reduce((n, r) => n + r.leftovers, 0);
  out.tampered = out.runs.reduce((n, r) => n + (r.tampered?.length ?? 0), 0);
  return out;
}

/** The record, from the prepare output and the phase outputs only (no candidate code). Missing or foreign phase output = failed. */
export function recordStage2(prep: Stage2Prep, runs: readonly Stage2PhaseRun[]): Stage2Record {
  const rec: Stage2Record = {
    schema: STAGE2_SCHEMA, id: prep.id, baseSha: prep.baseSha, candidateSha: prep.candidateSha, diffSha256: prep.diffSha256, paths: prep.paths,
    candidateBlobs: prep.candidateBlobs, check: prep.check, baseSuite: { suite: "live", files: prep.suiteFiles, filesSha256: listSha(prep.suiteFiles), exitCode: 1, pass: 0, fail: 0 },
    newTests: [], phases: [], status: "refused", createdAt: new Date().toISOString(), countsTrust: STAGE2_COUNTS_TRUST, run: prep.run ?? null,
  };
  if (!prep.check.ok || !prep.candidateSha) return rec;
  const get = (ph: Stage2Phase) => runs.find((r) => r.schema === STAGE2_RUN_SCHEMA && r.phase === ph && r.id === prep.id && r.candidateSha === prep.candidateSha);
  const failed: CaseRun = { exitCode: 1, pass: 0, fail: 1 };
  const bad = (r: RawRun) => r.leftovers > 0 || !Array.isArray(r.tampered) || r.tampered.length > 0;
  const asCase = (r: RawRun | undefined): CaseRun => (r ? { exitCode: bad(r) ? 1 : r.exitCode, pass: r.pass, fail: r.fail + (bad(r) ? 1 : 0) } : failed);
  for (const ph of STAGE2_PHASES) { const r = get(ph); rec.phases.push({ phase: ph, ran: !!r, leftovers: r?.leftovers ?? 0, tampered: r ? (typeof r.tampered === "number" ? r.tampered : 1) : 0 }); }
  const s = get("suite")?.runs[0];
  rec.baseSuite = { ...rec.baseSuite, ...asCase(s), ...(s ? {} : { exitCode: 1 }) };
  const cases = prep.check.newTests.flatMap((t) => t.names.map((name) => ({ file: t.file, name })));
  const find = (ph: Stage2Phase, c: { file: string; name: string }) => get(ph)?.runs.find((r) => r.file === c.file && r.name === c.name);
  // a missing base run counts as "passes on base" (never as the wanted failure)
  for (const c of cases) { const b = find("new-on-base", c); rec.newTests.push({ ...c, onCandidate: asCase(find("new-on-candidate", c)), onBase: b && !bad(b) ? { exitCode: b.exitCode, pass: b.pass, fail: b.fail } : { exitCode: 0, pass: 1, fail: 0 } }); }
  rec.status = stage2GradeDecision(rec, prep.suiteFiles).ok ? "awaiting-review" : "tested-failing";
  return rec;
}

/** Offline composition of the three steps in ONE clone, for tests and pipeline dry runs only; the job never calls it. */
export function gradeStage2Offline(work: string, id: string, diff: string, baseSha: string, mainRef: string, deadline: number): Stage2Record {
  const prep = prepareStage2(work, id, diff, baseSha, mainRef);
  if (!prep.check.ok) return recordStage2(prep, []);
  return recordStage2(prep, STAGE2_PHASES.map((ph) => runStage2Phase(work, prep, ph, deadline)));
}

const writeOnce = (file: string, text: string) => {
  if (existsSync(file)) throw new Error(`refusing to overwrite ${file} (a stage-2 failure is final; rerun with a new id)`);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text, { flag: "wx" });
};
const freshClone = (source: string): string => {
  const work = mkdtempSync(join(tmpdir(), "peaceai-self2-"));
  execFileSync("git", ["clone", "--quiet", "--no-hardlinks", "--no-checkout", source, work], { stdio: "ignore" });
  return work;
};

/** Job "prepare" (guarded): fresh clone, base pinned to origin/main, prepareStage2, writes <out>/<id>.prep.json (+ .bundle). */
export function prepareStage2InSandbox(o: { id: string; diff: string; source: string; base: string; out: string }): { code: 0 | 2 | 3; message: string; prep: Stage2Prep | null } {
  const here = selfChangeAllowedHere(process.env);
  if (!here.ok) return { code: 3, message: `self-change stage2 refused reason=${here.reason}`, prep: null };
  if (!/^[0-9a-f]{40}$/.test(o.base)) return { code: 2, message: "self-change stage2 refused reason=BASE_NOT_A_COMMIT_SHA", prep: null };
  const work = freshClone(o.source);
  let prep: Stage2Prep;
  try {
    if (spawnSync("git", ["cat-file", "-e", `${o.base}^{commit}`], { cwd: work }).status !== 0) return { code: 2, message: "self-change stage2 refused reason=BASE_NOT_FOUND", prep: null };
    git(work, "checkout", "--quiet", "--detach", o.base);
    prep = prepareStage2(work, o.id, o.diff, o.base, "refs/remotes/origin/main");
    const env = process.env;
    prep.run = env.GITHUB_RUN_ID ? { repository: env.GITHUB_REPOSITORY ?? "", runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT ?? "" } : null;
    if (prep.candidateSha) {
      const bundle = join(o.out, `${o.id}.bundle`);
      if (existsSync(bundle)) throw new Error(`refusing to overwrite ${bundle} (a stage-2 failure is final; rerun with a new id)`);
      mkdirSync(o.out, { recursive: true });
      git(work, "bundle", "create", bundle, `${o.base}..${prep.candidateSha}`);
    }
  } finally { rmSync(work, { recursive: true, force: true }); }
  writeOnce(join(o.out, `${o.id}.prep.json`), JSON.stringify(prep, null, 1) + "\n");
  const why = prep.check.refusals.map((r) => `  ${r.path}: ${r.reason}`).join("\n");
  return { code: prep.check.ok ? 0 : 2, prep, message: `self-change stage2 prepare id=${o.id} ok=${prep.check.ok} base=${o.base.slice(0, 12)} candidate=${prep.candidateSha.slice(0, 12)} diff=${prep.diffSha256.slice(0, 12)}${why ? `\n${why}` : ""}` };
}

/** Job "run" (guarded): fresh clone + bundle, its own npm ci, one phase, writes <out>/<id>.<phase>.json (raw counts only). */
export function runStage2InSandbox(o: { prepFile: string; bundle: string; source: string; phase: string; out: string; budget?: string }): { code: 0 | 1 | 3; message: string } {
  const here = selfChangeAllowedHere(process.env);
  if (!here.ok) return { code: 3, message: `self-change stage2 refused reason=${here.reason}` };
  if (!(STAGE2_PHASES as readonly string[]).includes(o.phase)) return { code: 1, message: `usage: --phase ${STAGE2_PHASES.join("|")}` };
  const prep = JSON.parse(readFileSync(o.prepFile, "utf8")) as Stage2Prep;
  if (prep.schema !== STAGE2_PREP_SCHEMA || !prep.check.ok || !/^[0-9a-f]{40}$/.test(prep.candidateSha)) return { code: 1, message: "self-change stage2 run: nothing to run (prepare refused)" };
  const deadline = Date.now() + budgetMinutes(o.budget) * 60_000;
  const work = freshClone(o.source);
  let run: Stage2PhaseRun;
  try {
    git(work, "fetch", "--quiet", o.bundle, `${prep.candidateSha}`);
    git(work, "remote", "remove", "origin");
    git(work, "checkout", "--quiet", "--detach", prep.baseSha);
    execFileSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: work, stdio: "ignore", env: suiteEnv() });
    run = runStage2Phase(work, prep, o.phase as Stage2Phase, deadline, join(import.meta.dirname, "../.."));
  } finally { rmSync(work, { recursive: true, force: true }); }
  writeOnce(join(o.out, `${prep.id}.${o.phase}.json`), JSON.stringify(run, null, 1) + "\n");
  return { code: 0, message: `self-change stage2 run id=${prep.id} phase=${o.phase} runs=${run.runs.length} leftovers=${run.leftovers}` };
}

/**
 * decide2's repo facts (blockers 1 and 6), from a clone whose `mainRef` is main: the real base..head diff hash, the
 * base pinned to main, the PR = exactly one commit base..head, and the full check re-run on the real diff with
 * the base tree's never-zone. `prCommits` are the PR's commit SHAs as GitHub lists them. No candidate code runs.
 */
export function stage2PrFacts(repo: string, rec: Stage2Record, headSha: string, prCommits: readonly string[], mainRef: string, ledger: Stage2PrFacts["ledger"] = { entry: null, commits: 0 }): Stage2PrFacts {
  const none: Stage2PrFacts = { headSha: "", diffSha256: "", baseOnMain: false, commitsExact: false, recheck: { ok: false, refusals: [{ path: "-", reason: "PR head not available" }], paths: [], newTests: [] }, ledger };
  const sha = (x: string) => /^[0-9a-f]{40}$/.test(x);
  if (!sha(headSha) || !sha(rec.baseSha) || spawnSync("git", ["cat-file", "-e", `${headSha}^{commit}`], { cwd: repo }).status !== 0 || spawnSync("git", ["cat-file", "-e", `${rec.baseSha}^{commit}`], { cwd: repo }).status !== 0) return { ...none, headSha };
  const main = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${mainRef}^{commit}`], { cwd: repo, encoding: "utf8" }).stdout.trim();
  const mb = main ? spawnSync("git", ["merge-base", main, headSha], { cwd: repo, encoding: "utf8" }).stdout.trim() : "";
  const baseOnMain = !!main && spawnSync("git", ["merge-base", "--is-ancestor", rec.baseSha, main], { cwd: repo }).status === 0 && mb === rec.baseSha;
  const between = git(repo, "rev-list", `${rec.baseSha}..${headSha}`).split("\n").filter(Boolean);
  const parents = git(repo, "rev-list", "--parents", "-n", "1", headSha).split(" ").slice(1);
  const commitsExact = between.length === 1 && between[0] === headSha && parents.length === 1 && parents[0] === rec.baseSha && prCommits.length === 1 && prCommits[0] === headSha;
  const diff = git(repo, ...STAGE2_DIFF_ARGS, rec.baseSha, headSha);
  const recheck = checkStage2Proposal(diff, { base: showAt(repo, rec.baseSha), cand: showAt(repo, headSha) }, neverZoneAtSha(repo, rec.baseSha));
  return { headSha, diffSha256: stage2DiffSha(diff), baseOnMain, commitsExact, recheck, ledger };
}

// ---- M109 stage 2: the proposal GENERATOR (Auditor #504 limit 5 provenance: "a PeaceAI engine run whose only input
// was the task text"). Inputs are exactly (1) the task text and (2) a snapshot of the task's BASE commit read through
// git objects of that commit only. The skills (selfGenerateCore) run in a separate `node` process under the Node
// permission model with NO fs read or write grant, no child processes, no workers, no code generation from strings
// and an empty environment; its source is shipped as text and hashed into the record. So the generator cannot read
// the landed diff, the answer commit, later commits, the source repo or any credential: it sees only what the
// trusted side hands it on stdin. The trusted side (no generator code) turns the output into a canonical git diff,
// runs the stage-2 check on it with the base tree's never-zone, and writes a record. Credit stays hard-refused
// (stage2Credit); this record is the provenance a later, Auditor-reviewed credit rule would need.
// Known limit: the Node permission model does not block network access; the generator code is reviewed,
// dependency-free and in the never-zone (selfpropose.ts), and its environment carries no token.

export const SELF_GEN_SCHEMA = "peaceai-self-gen:v1";
/** Snapshot texts are limited to the shapes a stage-2 proposal could edit (and the generator might read). */
const GEN_TEXT_SHAPE = /^docs\/[a-z0-9][a-z0-9._-]{0,80}\.md$|^peaceai\/docs\/[a-z0-9][a-z0-9._-]{0,80}\.md$|^peaceai\/test\/[a-z0-9][a-z0-9._-]{0,80}\.test\.ts$/;
const GEN_MAX_TEXT = 512 * 1024;
export interface GenSnapshot { baseSha: string; paths: string[]; files: Record<string, string> }
export interface GenInput { task: string; baseSha: string; paths: string[]; files: Record<string, string> }
export interface GenOutput { status: "candidate" | "refused"; skill: string | null; reason: string; files: { path: string; text: string }[] }
export interface SelfGenRecord {
  schema: typeof SELF_GEN_SCHEMA; taskSha256: string; baseSha: string; snapshotSha256: string; generatorSha256: string;
  status: "candidate" | "refused" | "refused-by-check" | "error"; skill: string | null; reason: string;
  paths: string[]; candidateBlobs: Record<string, string>; diff: string; diffSha256: string; check: Stage2Check | null; createdAt: string;
}

/** The base commit's tree, through git objects of `baseSha` only (ls-tree + cat-file of its blobs). No checkout. */
export function genSnapshot(repo: string, baseSha: string): GenSnapshot {
  if (!/^[0-9a-f]{40}$/.test(baseSha)) throw new Error("genSnapshot: base must be a full commit sha");
  const rows = execFileSync("git", ["ls-tree", "-r", "-z", "--full-tree", baseSha], { cwd: repo, encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean);
  const paths: string[] = [];
  const want: { path: string; oid: string }[] = [];
  for (const r of rows) {
    const tab = r.indexOf("\t");
    const [mode, type, oid] = r.slice(0, tab).split(" ");
    const path = r.slice(tab + 1);
    if (type !== "blob") continue;
    paths.push(path);
    if (mode === "100644" && GEN_TEXT_SHAPE.test(path)) want.push({ path, oid: oid! });
  }
  const files: Record<string, string> = {};
  if (want.length) {
    const out = execFileSync("git", ["cat-file", "--batch"], { cwd: repo, input: want.map((w) => w.oid).join("\n") + "\n", maxBuffer: 1 << 28 });
    let at = 0;
    for (const w of want) {
      const nl = out.indexOf(0x0a, at);
      const size = Number(out.subarray(at, nl).toString("utf8").split(" ")[2]);
      const body = out.subarray(nl + 1, nl + 1 + size);
      at = nl + 1 + size + 1;
      if (size <= GEN_MAX_TEXT && !body.includes(0)) files[w.path] = body.toString("utf8");
    }
  }
  return { baseSha, paths: paths.sort(), files };
}

/**
 * The generator skills. SELF-CONTAINED on purpose (no imports, no module-scope references): it is shipped to the
 * sandboxed process as source text. Deterministic: same task + same snapshot -> same output.
 *   DOC_PAGE_STUB  "docs: <title>" -> a NEW root doc page docs/<slug>.md holding the title (a stub; it cannot know
 *                  facts the task text does not state).
 *   TEST_APPEND    "M<NN>: ..." -> locates peaceai/test/m<NN>-*.test.ts, then REFUSES: writing a test body from
 *                  task text alone is not a skill PeaceAI has.
 * Everything else is refused NO_FAMILY. Refusals are the honest default.
 */
export function selfGenerateCore(input: GenInput): GenOutput {
  const task = String(input && input.task ? input.task : "").replace(/\s+/g, " ").trim();
  const paths: string[] = Array.isArray(input && input.paths) ? input.paths : [];
  const refuse = (skill: string | null, reason: string): GenOutput => ({ status: "refused", skill, reason, files: [] });
  if (!task) return refuse(null, "EMPTY_TASK");
  const doc = /^docs?\s*:\s*(.+)$/i.exec(task);
  if (doc) {
    const title = doc[1]!.replace(/[\s.]+$/, "");
    const stop = new Set(["a", "an", "the", "of", "on", "in", "is", "are", "to", "for", "and", "or", "not", "no", "be", "by", "with", "as", "at", "it"]);
    const words = title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 0 && !stop.has(w)).slice(0, 6);
    if (words.length === 0) return refuse("DOC_PAGE_STUB", "NO_SLUG: the title has no usable words");
    const path = `docs/${words.join("-")}.md`;
    if (path.length > 90) return refuse("DOC_PAGE_STUB", "NO_SLUG: slug too long");
    if (paths.includes(path)) return refuse("DOC_PAGE_STUB", `TARGET_EXISTS: ${path}`);
    const head = title.charAt(0).toUpperCase() + title.slice(1);
    return { status: "candidate", skill: "DOC_PAGE_STUB", reason: "new root doc page from the task title", files: [{ path, text: `# ${head}\n\n${head}.\n` }] };
  }
  const m = /\bM(\d{1,3})\b/.exec(task);
  if (m) {
    const rx = new RegExp(`^peaceai/test/m${m[1]}-[a-z0-9-]+\\.test\\.ts$`);
    const hits = paths.filter((p) => rx.test(p));
    if (hits.length !== 1) return refuse("TEST_APPEND", `NO_TARGET: ${hits.length} files match peaceai/test/m${m[1]}-*.test.ts`);
    return refuse("TEST_APPEND", `NO_SKILL: writing a test body from the task text alone is not supported (target located: ${hits[0]})`);
  }
  return refuse(null, "NO_FAMILY: no self-change generator skill matches the task text");
}

const PERMISSION_FLAG = process.allowedNodeEnvironmentFlags.has("--permission") ? "--permission" : "--experimental-permission";
/** The exact program the sandboxed process runs for a generator source (hashed into the record). */
export const genProgram = (coreSource: string): string =>
  `"use strict";const __name=(f)=>f;const core=(${coreSource});` +
  `const input=JSON.parse(require("node:fs").readFileSync(0,"utf8"));process.stdout.write(JSON.stringify(core(input)));`;
/**
 * Run a generator source under the permission model with no fs/child/worker grant and an empty env, from an empty
 * temp cwd; input on stdin, output (JSON) on stdout. Exported for the leak-wall tests (probe sources).
 */
export function runGeneratorSandboxed(coreSource: string, input: unknown, timeoutMs = 60_000): { ok: boolean; output: unknown; error: string } {
  const cwd = mkdtempSync(join(tmpdir(), "peaceai-gen-"));
  try {
    const r = spawnSync(process.execPath, [PERMISSION_FLAG, "--disallow-code-generation-from-strings", "--no-warnings", "-e", genProgram(coreSource)], { cwd, env: {}, input: JSON.stringify(input), encoding: "utf8", timeout: timeoutMs, maxBuffer: 1 << 26 });
    if (r.status !== 0) return { ok: false, output: null, error: `exit=${r.status ?? r.signal} ${(r.stderr ?? "").slice(0, 2000)}` };
    try { return { ok: true, output: JSON.parse(r.stdout), error: "" }; } catch { return { ok: false, output: null, error: "generator output is not JSON" }; }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}

const gitBlobSha = (text: string): string => { const b = Buffer.from(text, "utf8"); return createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex"); };
/** The canonical stage-2 diff (STAGE2_DIFF_ARGS) of whole-file writes over the base texts, built in a throwaway repo. */
function proposalDiff(base: Record<string, string | null>, writes: readonly { path: string; text: string }[]): string {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-gendiff-"));
  try {
    const g = (...a: string[]) => execFileSync("git", ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", ...NOREPLY, ...a], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 28 });
    g("init", "--quiet");
    const put = (p: string, t: string) => { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), t); };
    for (const [p, t] of Object.entries(base)) if (t !== null) put(p, t);
    g("add", "-A");
    g("commit", "--quiet", "--allow-empty", "--no-verify", "-m", "base");
    for (const w of writes) put(w.path, w.text);
    g("add", "-A");
    return g(STAGE2_DIFF_ARGS[0], "--cached", ...STAGE2_DIFF_ARGS.slice(1), "HEAD");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/**
 * One generator run: snapshot the base, run the skills sandboxed on (task, snapshot), then (trusted side) validate
 * the output shape, build the canonical diff and run the stage-2 check with the base tree's never-zone.
 * `coreSource` is for tests only; the CLI always uses selfGenerateCore.
 */
export function generateStage2Proposal(repo: string, task: string, baseSha: string, coreSource: string = selfGenerateCore.toString()): SelfGenRecord {
  const snap = genSnapshot(repo, baseSha);
  const program = genProgram(coreSource);
  const rec: SelfGenRecord = {
    schema: SELF_GEN_SCHEMA, taskSha256: sha256(task), baseSha, snapshotSha256: sha256(JSON.stringify(snap)), generatorSha256: sha256(program),
    status: "error", skill: null, reason: "", paths: [], candidateBlobs: {}, diff: "", diffSha256: "", check: null, createdAt: new Date().toISOString(),
  };
  const run = runGeneratorSandboxed(coreSource, { task, baseSha, paths: snap.paths, files: snap.files } satisfies GenInput);
  if (!run.ok) return { ...rec, reason: `GENERATOR_FAILED: ${run.error}` };
  const o = run.output as GenOutput;
  const shapeOk = !!o && (o.status === "candidate" || o.status === "refused") && Array.isArray(o.files) && typeof o.reason === "string" &&
    o.files.every((f) => f && typeof f.path === "string" && typeof f.text === "string");
  if (!shapeOk) return { ...rec, reason: "GENERATOR_OUTPUT_MALFORMED" };
  rec.skill = typeof o.skill === "string" ? o.skill : null;
  rec.reason = o.reason;
  if (o.status === "refused") return { ...rec, status: "refused" };
  if (o.files.length === 0) return { ...rec, status: "refused", reason: "GENERATOR_EMPTY_CANDIDATE" };
  const seen = new Set<string>();
  for (const f of o.files) {
    if (seen.has(f.path)) return { ...rec, status: "refused", reason: `GENERATOR_DUPLICATE_PATH: ${f.path}` };
    seen.add(f.path);
    // a write to a base file the generator was never shown would be blind (and its base text is not in the snapshot)
    if (snap.paths.includes(f.path) && !(f.path in snap.files)) return { ...rec, status: "refused", reason: `GENERATOR_WRITES_UNSEEN_FILE: ${f.path}` };
  }
  const base: Record<string, string | null> = {};
  for (const f of o.files) base[f.path] = snap.files[f.path] ?? null;
  const cand = new Map(o.files.map((f) => [f.path, f.text]));
  rec.paths = [...seen].sort();
  for (const f of o.files) rec.candidateBlobs[f.path] = gitBlobSha(f.text);
  try { rec.diff = proposalDiff(base, o.files); } catch (e) { return { ...rec, status: "error", reason: `DIFF_FAILED: ${(e as Error).message.slice(0, 500)}` }; }
  rec.diffSha256 = stage2DiffSha(rec.diff);
  rec.check = checkStage2Proposal(rec.diff, { base: (p) => snap.files[p] ?? showAt(repo, baseSha)(p), cand: (p) => cand.get(p) ?? snap.files[p] ?? showAt(repo, baseSha)(p) }, neverZoneAtSha(repo, baseSha));
  rec.status = rec.check.ok ? "candidate" : "refused-by-check";
  return rec;
}
