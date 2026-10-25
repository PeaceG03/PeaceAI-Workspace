// M11: the proposal run itself. It refuses to start anywhere but an ephemeral GitHub-hosted job in a private repo
// (selfChangeAllowedHere); there is no box or local mode.
// It makes a FRESH clone of the source at the base commit, applies the change there, runs the LIVE suite (the base
// commit's peaceai/test/*.test.ts, restored from the base) plus new peaceai/self-tests, and writes the record and
// a git bundle of the exact candidate commit (so the promotion PR head can be that tested commit).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appliedDiffRefusals, budgetMinutes, checkSelfChangeDiff, checkStage2Proposal, computeNeverZone, listSha, parseGitDiff, parseRawZ, SELF_SCHEMA, selfChangeAllowedHere, sha256, STAGE2_DIFF_ARGS, STAGE2_PHASES, STAGE2_SCHEMA, stage2DiffSha, stage2GradeDecision, type CaseRun, type NeverZoneSet, type SelfChangeRecord, type Stage2Check, type Stage2Phase, type Stage2PrFacts, type Stage2Record, type TestRun } from "./selfchange.ts";

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
  const num = (k: string) => Number(new RegExp(`^# ${k} (\\d+)$`, "m").exec(r.stdout ?? "")?.[1] ?? 0);
  return { suite, files, filesSha256: listSha(files), exitCode: r.status ?? 124, pass: num("pass"), fail: num("fail") + (r.status === null ? 1 : 0) };
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

export interface RawRun { file?: string; name?: string; exitCode: number; pass: number; fail: number; leftovers: number }
export interface Stage2PhaseRun { schema: typeof STAGE2_RUN_SCHEMA; id: string; phase: Stage2Phase; candidateSha: string; runs: RawRun[]; leftovers: number }

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
  const num = (k: string) => Number(new RegExp(`^# ${k} (\\d+)$`, "m").exec(r.stdout ?? "")?.[1] ?? 0);
  return { exitCode: r.status ?? 124, pass: num("pass"), fail: num("fail") + (r.status === null ? 1 : 0), leftovers };
}

/**
 * The only place candidate code runs. `work` is a fresh clone holding base and candidate, with its OWN dependencies
 * (npm ci --ignore-scripts at the base lockfile; package files are never-zone). Writes nothing outside `work`.
 */
export function runStage2Phase(work: string, prep: Stage2Prep, phase: Stage2Phase, deadline: number): Stage2PhaseRun {
  const out: Stage2PhaseRun = { schema: STAGE2_RUN_SCHEMA, id: prep.id, phase, candidateSha: prep.candidateSha, runs: [], leftovers: 0 };
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
  return out;
}

/** The record, from the prepare output and the phase outputs only (no candidate code). Missing or foreign phase output = failed. */
export function recordStage2(prep: Stage2Prep, runs: readonly Stage2PhaseRun[]): Stage2Record {
  const rec: Stage2Record = {
    schema: STAGE2_SCHEMA, id: prep.id, baseSha: prep.baseSha, candidateSha: prep.candidateSha, diffSha256: prep.diffSha256, paths: prep.paths,
    candidateBlobs: prep.candidateBlobs, check: prep.check, baseSuite: { suite: "live", files: prep.suiteFiles, filesSha256: listSha(prep.suiteFiles), exitCode: 1, pass: 0, fail: 0 },
    newTests: [], phases: [], status: "refused", createdAt: new Date().toISOString(),
  };
  if (!prep.check.ok || !prep.candidateSha) return rec;
  const get = (ph: Stage2Phase) => runs.find((r) => r.schema === STAGE2_RUN_SCHEMA && r.phase === ph && r.id === prep.id && r.candidateSha === prep.candidateSha);
  const failed: CaseRun = { exitCode: 1, pass: 0, fail: 1 };
  const asCase = (r: RawRun | undefined): CaseRun => (r ? { exitCode: r.leftovers ? 1 : r.exitCode, pass: r.pass, fail: r.fail + (r.leftovers ? 1 : 0) } : failed);
  for (const ph of STAGE2_PHASES) { const r = get(ph); rec.phases.push({ phase: ph, ran: !!r, leftovers: r?.leftovers ?? 0 }); }
  const s = get("suite")?.runs[0];
  rec.baseSuite = { ...rec.baseSuite, ...asCase(s), ...(s ? {} : { exitCode: 1 }) };
  const cases = prep.check.newTests.flatMap((t) => t.names.map((name) => ({ file: t.file, name })));
  const find = (ph: Stage2Phase, c: { file: string; name: string }) => get(ph)?.runs.find((r) => r.file === c.file && r.name === c.name);
  // a missing base run counts as "passes on base" (never as the wanted failure)
  for (const c of cases) { const b = find("new-on-base", c); rec.newTests.push({ ...c, onCandidate: asCase(find("new-on-candidate", c)), onBase: b && !b.leftovers ? { exitCode: b.exitCode, pass: b.pass, fail: b.fail } : { exitCode: 0, pass: 1, fail: 0 } }); }
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
    run = runStage2Phase(work, prep, o.phase as Stage2Phase, deadline);
  } finally { rmSync(work, { recursive: true, force: true }); }
  writeOnce(join(o.out, `${prep.id}.${o.phase}.json`), JSON.stringify(run, null, 1) + "\n");
  return { code: 0, message: `self-change stage2 run id=${prep.id} phase=${o.phase} runs=${run.runs.length} leftovers=${run.leftovers}` };
}

/**
 * decide2's repo facts (blockers 1 and 6), from a clone whose `mainRef` is main: the real base..head diff hash, the
 * base pinned to main, the PR = exactly one commit base..head, and the full check re-run on the real diff with
 * the base tree's never-zone. `prCommits` are the PR's commit SHAs as GitHub lists them. No candidate code runs.
 */
export function stage2PrFacts(repo: string, rec: Stage2Record, headSha: string, prCommits: readonly string[], mainRef: string): Stage2PrFacts {
  const none: Stage2PrFacts = { headSha: "", diffSha256: "", baseOnMain: false, commitsExact: false, recheck: { ok: false, refusals: [{ path: "-", reason: "PR head not available" }], paths: [], newTests: [] } };
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
  return { headSha, diffSha256: stage2DiffSha(diff), baseOnMain, commitsExact, recheck };
}
