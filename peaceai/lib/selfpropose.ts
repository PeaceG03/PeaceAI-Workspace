// M11: the proposal run itself. It refuses to start anywhere but an ephemeral GitHub-hosted job in a private repo
// (selfChangeAllowedHere); there is no box or local mode.
// It makes a FRESH clone of the source at the base commit, applies the change there, runs the LIVE suite (the base
// commit's peaceai/test/*.test.ts, restored from the base) plus new peaceai/self-tests, and writes the record and
// a git bundle of the exact candidate commit (so the promotion PR head can be that tested commit).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { budgetMinutes, checkSelfChangeDiff, checkStage2Proposal, listSha, SELF_SCHEMA, selfChangeAllowedHere, sha256, STAGE2_DIFF_ARGS, STAGE2_SCHEMA, stage2DiffSha, type CaseRun, type SelfChangeRecord, type Stage2Record, type TestRun } from "./selfchange.ts";

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

const escRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function runCase(cwd: string, file: string, name: string, deadline: number): CaseRun {
  const left = Math.max(1000, deadline - Date.now());
  const r = spawnSync(join(cwd, "node_modules/.bin/tsx"), ["--test", "--test-reporter=tap", `--test-name-pattern=^${escRx(name)}$`, file], { cwd, encoding: "utf8", timeout: left, maxBuffer: 1 << 26, env: suiteEnv() });
  const num = (k: string) => Number(new RegExp(`^# ${k} (\\d+)$`, "m").exec(r.stdout ?? "")?.[1] ?? 0);
  return { exitCode: r.status ?? 124, pass: num("pass"), fail: num("fail") + (r.status === null ? 1 : 0) };
}
/** Every tracked test file of a commit (the unchanged base suite). */
export const suiteFilesAt = (work: string, sha: string): string[] => git(work, "ls-tree", "-r", "--name-only", sha).split("\n").filter((f) => /\.test\.ts$/.test(f) && !f.startsWith("node_modules/"));

/**
 * The stage-2 grading inside an already prepared clone `work` checked out at `baseSha` (no remote, deps linked).
 * Exported for the sandbox below; it does not check where it runs, so only proposeStage2InSandbox (guarded) and
 * offline dry runs on a scratch clone call it.
 */
export function gradeStage2(work: string, id: string, diff: string, baseSha: string, deadline: number): Stage2Record {
  const show = (p: string) => { const r = spawnSync("git", ["show", `${baseSha}:${p}`], { cwd: work, encoding: "utf8", maxBuffer: 1 << 26 }); return r.status === 0 ? r.stdout : null; };
  const rec: Stage2Record = {
    schema: STAGE2_SCHEMA, id, baseSha, candidateSha: "", diffSha256: "", paths: [], candidateBlobs: {},
    check: { ok: false, refusals: [], paths: [], newTests: [] }, baseSuite: { suite: "live", files: [], filesSha256: "", exitCode: 1, pass: 0, fail: 0 },
    newTests: [], status: "refused", createdAt: new Date().toISOString(),
  };
  writeFileSync(join(work, ".self.patch"), diff);
  try { git(work, "apply", "--index", "--whitespace=nowarn", ".self.patch"); } catch {
    rmSync(join(work, ".self.patch"), { force: true });
    rec.check = { ok: false, refusals: [{ path: "-", reason: "patch does not apply to the base" }], paths: [], newTests: [] };
    return rec;
  }
  rmSync(join(work, ".self.patch"), { force: true });
  const cand = (p: string) => (existsSync(join(work, p)) ? readFileSync(join(work, p), "utf8") : null);
  rec.check = checkStage2Proposal(diff, { base: show, cand });
  rec.paths = rec.check.paths;
  if (!rec.check.ok) return rec;
  git(work, ...NOREPLY, "commit", "--quiet", "--no-verify", "-m", `self-change stage 2 ${id}`);
  rec.candidateSha = git(work, "rev-parse", "HEAD");
  rec.diffSha256 = stage2DiffSha(git(work, ...STAGE2_DIFF_ARGS, baseSha, rec.candidateSha));
  for (const p of rec.paths) { const r = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${rec.candidateSha}:${p}`], { cwd: work, encoding: "utf8" }); rec.candidateBlobs[p] = r.status === 0 ? r.stdout.trim() : null; }
  // (a) the UNCHANGED base suite on the candidate: every base test file put back to its base content
  const files = suiteFilesAt(work, baseSha);
  if (files.length) git(work, "checkout", baseSha, "--", ...files);
  rec.baseSuite = runSuite(work, "live", files, deadline);
  git(work, "checkout", "--quiet", "-f", rec.candidateSha);
  // (b) every new test passes on the candidate ...
  for (const t of rec.check.newTests) for (const name of t.names) rec.newTests.push({ file: t.file, name, onCandidate: runCase(work, t.file, name, deadline), onBase: { exitCode: 0, pass: 0, fail: 0 } });
  // ... and fails on the base (base tree + only the candidate's version of that test file)
  git(work, "checkout", "--quiet", "-f", "--detach", baseSha);
  git(work, "clean", "-qfdx", "-e", "node_modules");
  for (const t of rec.newTests) {
    mkdirSync(join(work, t.file, ".."), { recursive: true });
    writeFileSync(join(work, t.file), execFileSync("git", ["show", `${rec.candidateSha}:${t.file}`], { cwd: work, encoding: "utf8", maxBuffer: 1 << 26 }));
    t.onBase = runCase(work, t.file, t.name, deadline);
    git(work, "checkout", "--quiet", "-f", "--detach", baseSha);
    git(work, "clean", "-qfdx", "-e", "node_modules");
  }
  git(work, "checkout", "--quiet", "-f", "--detach", rec.candidateSha);
  const s = rec.baseSuite;
  rec.status = s.exitCode === 0 && s.fail === 0 && s.pass > 0 && rec.newTests.every((t) => !(t.onBase.exitCode === 0 && t.onBase.fail === 0) && t.onCandidate.exitCode === 0 && t.onCandidate.fail === 0 && t.onCandidate.pass > 0) ? "awaiting-review" : "tested-failing";
  return rec;
}

/** Stage 2 in the sandbox: only an ephemeral private Actions job (selfChangeAllowedHere), fresh clone, record + bundle. */
export function proposeStage2InSandbox(o: ProposeOptions): { code: 0 | 2 | 3; message: string; record: Stage2Record | null } {
  const here = selfChangeAllowedHere(process.env);
  if (!here.ok) return { code: 3, message: `self-change stage2 refused reason=${here.reason}`, record: null };
  const deadline = Date.now() + budgetMinutes(o.budget) * 60_000;
  const work = mkdtempSync(join(tmpdir(), "peaceai-self2-"));
  let rec: Stage2Record;
  try {
    execFileSync("git", ["clone", "--quiet", "--no-hardlinks", "--no-checkout", o.source, work], { stdio: "ignore" });
    const baseSha = git(work, "rev-parse", `${o.base}^{commit}`);
    git(work, "checkout", "--quiet", "--detach", baseSha);
    git(work, "remote", "remove", "origin");
    if (o.nodeModules && existsSync(o.nodeModules)) symlinkSync(o.nodeModules, join(work, "node_modules"), "dir");
    else execFileSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: work, stdio: "ignore", env: suiteEnv() });
    rec = gradeStage2(work, o.id, o.diff, baseSha, deadline);
    mkdirSync(join(o.out, "self-changes"), { recursive: true });
    if (rec.candidateSha) git(work, "bundle", "create", join(o.out, "self-changes", `${o.id}.stage2.bundle`), `${baseSha}..${rec.candidateSha}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  mkdirSync(join(o.out, "self-changes"), { recursive: true });
  writeFileSync(join(o.out, "self-changes", `${o.id}.stage2.json`), JSON.stringify(rec, null, 1) + "\n");
  const why = rec.check.refusals.map((r) => `  ${r.path}: ${r.reason}`).join("\n");
  const t = rec.newTests.map((x) => `${x.name}:base=${x.onBase.fail > 0 || x.onBase.exitCode !== 0 ? "fail" : "PASS"},cand=${x.onCandidate.fail === 0 && x.onCandidate.exitCode === 0 ? "pass" : "FAIL"}`).join(" ");
  return { code: rec.status === "awaiting-review" ? 0 : rec.status === "refused" ? 2 : 3, record: rec, message: `self-change stage2 id=${o.id} status=${rec.status} base=${rec.baseSha.slice(0, 12)} candidate=${rec.candidateSha.slice(0, 12)} diff=${rec.diffSha256.slice(0, 12)} suite:pass=${rec.baseSuite.pass},fail=${rec.baseSuite.fail} ${t}${why ? `\n${why}` : ""}` };
}
