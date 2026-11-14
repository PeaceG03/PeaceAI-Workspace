// Mixed practice replay. credit: false. Experimental.
//   tsx peaceai/bin/practice-replay.ts --pairs <jsonl> --out <dir outside this repo> --core-archive <tar> --clones-dir <dir>
// --core-archive is the pinned core tar capability-job.ts checks against peaceai/core-pin.json.
// --clones-dir holds one git clone per repo, named <owner>__<name>, with the recorded commits present.
// --clones is the same option.
// Each row is graded twice. Text mode gives Job A the commit subject. Test-as-spec checks out only
// the recorded test file onto the base, reads the failing assertions, and asks repair-v2 for a source
// edit. The fix diff and the fix's other files are not shown. Nothing is pushed.
// A row passes only when peaceai/bin/gate.ts prints GATE PASS and the recorded test fails before the
// candidate and passes after it. Unmeasured is never a pass.
// A repo that targets.json does not name is UNMEASURED GATE_NO_TARGET. gate.ts and scope.ts are not edited.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { classifyJobOutput } from "../lib/capabilityjob.ts";
import { GIT_LOCK_ARGS, INSTALL_MAX_ENTRIES, cloneCheckProblems, ensurePracticeInstall, materializeSolverTree, mergeCloneRootCollisions, pairProblems, poisonStamp, practiceGit, practiceGitEnv, practiceSandboxReady, processStartId, readPairFingerprint, releaseWorktree, replayCloneRecord, runInPracticeSandbox, writeCommitFile, yarnIsModern, type LockFiles, type PracticePair } from "../lib/practicemine.ts";
import {
  PROTECTED_GATE_FILE, PROTECTED_GATE_FUNCTION, PROTECTED_GATE_WHY, gradePracticeRow, replayDocument, targetIsScorable, writePracticeOutputs,
  type GradedRow, type Understanding,
} from "../lib/practicereplay.ts";
import { gradeBehavior, type BehaviorGrade } from "../lib/specgrade.ts";
import { runTestSpec, type SpecResult } from "../lib/testspec.ts";
import { loadTargets } from "../lib/target.ts";
import { pinnedKernel, readCorePin } from "./capability-job.ts";

const ROW_MS = 45_000;
const TEST_MS = 60_000;
const USAGE = "usage: practice-replay.ts --pairs <jsonl> --out <dir> [--core-archive <tar>] [--clones-dir <dir>] [--install-cache <dir>] [--install-max <n>]";

function flag(name: string, args: string[]): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith("--")) throw new Error(USAGE);
  return value;
}

function insideRepo(root: string, target: string): boolean {
  const repo = resolve(root);
  const rel = relative(repo, resolve(target));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function git(dir: string, args: string[], timeout = 60_000): boolean {
  return practiceGit(dir, args, timeout).ok;
}

function cloneDir(repo: string, clones: string, work: string): string | null {
  const cached = clones ? join(clones, repo.replace("/", "__")) : "";
  const dir = join(work, repo.replace("/", "__"));
  if (existsSync(join(dir, ".git"))) return dir;
  const src = cached && existsSync(join(cached, ".git")) ? cached : "";
  if (!src) return null;
  if (spawnSync("git", [...GIT_LOCK_ARGS, "clone", "--quiet", src, dir], { env: practiceGitEnv(), stdio: "ignore", timeout: 180_000 }).status !== 0) return null;
  return dir;
}

const HELD_TEMP_PREFIXES = ["peaceai-held-clone-", "peaceai-held-install-"];
const HELD_OWNER = ".peaceai-owner";

function ownerStamp(): string {
  return `${process.pid} ${processStartId(process.pid) ?? "0"}\n`;
}

function ownerStillAlive(pid: number, start: string): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); } catch { return false; }
  const now = processStartId(pid);
  return now !== null && now === start;
}

/** An ownerless directory is reaped only after it has sat this long. A pid of 0, or text that is not a pid, is never reaped. */
export const HELD_OWNERLESS_MS = 24 * 60 * 60 * 1000;

function reapLog(message: string): void {
  console.log(`reap ${message}`);
}

/** Delete held-out temp dirs whose owner is dead. Errors are logged and do not stop the scan. */
export function reapStaleHeldTemps(root = tmpdir(), remove: (dir: string) => void = (dir) => rmSync(dir, { recursive: true, force: true })): string[] {
  const removed: string[] = [];
  let names: string[] = [];
  try { names = readdirSync(root); } catch (err) {
    reapLog(`skipped: ${(err as Error).message}`);
    return removed;
  }
  for (const name of names) {
    if (!HELD_TEMP_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    const dir = join(root, name);
    try {
      let text = "";
      let ownerless = false;
      try { text = readFileSync(join(dir, HELD_OWNER), "utf8"); } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        ownerless = true;
      }
      if (ownerless) {
        const age = Date.now() - lstatSync(dir).mtimeMs;
        if (age < HELD_OWNERLESS_MS) continue;
      } else {
        const [pidText, start] = text.trim().split(/\s+/);
        const pid = Number(pidText);
        if (!Number.isInteger(pid) || pid <= 0 || pidText !== String(pid)) continue;
        if (ownerStillAlive(pid, start ?? "")) continue;
      }
      remove(dir);
      removed.push(dir);
    } catch (err) {
      reapLog(`${name}: ${(err as Error).message}`);
    }
  }
  return removed;
}

function markHeldOwner(dir: string): void {
  const dest = join(dir, HELD_OWNER);
  const tmp = join(dir, `.${HELD_OWNER}.${process.pid}.tmp`);
  writeFileSync(tmp, ownerStamp());
  renameSync(tmp, dest);
}

/** Dev clones stay under out/clones. A held-out clone is a temp directory, deleted after grading. */
export function replayClonePlace(split: "dev" | "held-out", outDir: string): { dir: string; release(): void } {
  if (split !== "held-out") return { dir: join(outDir, "clones"), release() {} };
  const dir = mkdtempSync(join(tmpdir(), "peaceai-held-clone-"));
  markHeldOwner(dir);
  return { dir, release() { rmSync(dir, { recursive: true, force: true }); } };
}

/** Copy one repo out of --clones-dir. Held-out copies are not created under outDir. `root` is the directory release deletes. */
export function openPracticeClone(repo: string, split: "dev" | "held-out", clones: string, outDir: string): { dir: string | null; root: string; release(): void } {
  const place = replayClonePlace(split, outDir);
  return { dir: cloneDir(repo, clones, place.dir), root: place.dir, release: place.release };
}

/** Held-out installs never use a cache under outDir. The returned directory is deleted with the other held-out temps. */
export function practiceInstallRoot(split: "dev" | "held-out", outDir: string, explicit?: string): { dir: string; release(): void } {
  if (split === "held-out") {
    const dir = mkdtempSync(join(tmpdir(), "peaceai-held-install-"));
    markHeldOwner(dir);
    return { dir, release() { rmSync(dir, { recursive: true, force: true }); } };
  }
  return { dir: explicit ? resolve(explicit) : join(outDir, "install-cache"), release() {} };
}

/** Delete every held-out temp this replay owns. A second call is harmless. */
export function releaseHeldPlaces(places: readonly { release(): void }[]): void {
  for (const place of places) place.release();
}

/** How many later pairs still need each dependency fingerprint. */
export function tallyFingerprints(fingerprints: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const fingerprint of fingerprints) counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
  return counts;
}

/** Drop one use. When none remain, the temp install for that fingerprint is removed. */
export function finishHeldFingerprint(cacheRoot: string, fingerprint: string, remaining: Map<string, number>): boolean {
  const left = (remaining.get(fingerprint) ?? 1) - 1;
  if (left > 0) {
    remaining.set(fingerprint, left);
    return false;
  }
  remaining.delete(fingerprint);
  if (cacheRoot) rmSync(join(cacheRoot, "installs", fingerprint), { recursive: true, force: true });
  return true;
}

function linkModules(modules: string, dir: string): void {
  const dest = join(dir, "node_modules");
  if (!existsSync(modules) || existsSync(dest)) return;
  spawnSync("ln", ["-s", modules, dest], { stdio: "ignore" });
}

function runTest(dir: string, cmd: string[], nodePath: string, modules: string): { code: number | null; blocked: boolean } {
  const before = poisonStamp(dir);
  const ran = runInPracticeSandbox(dir, cmd, TEST_MS, { nodePath, nodeModules: modules });
  const released = releaseWorktree(dir, before);
  if (ran.unsafe || released.poison.length > 0 || !released.clean) return { code: null, blocked: true };
  return { code: ran.code, blocked: false };
}

/** Apply one candidate on a fresh base, with the recorded test file as the spec. Returns exits, or nulls when the diff does not apply. */
function gradeCandidate(repoDir: string, pair: PracticePair, diff: string, modules: string): { beforeExit: number | null; afterExit: number | null } {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-practice-grade-"));
  if (!materializeSolverTree(repoDir, pair.baseSha, dir)) { rmSync(dir, { recursive: true, force: true }); return { beforeExit: null, afterExit: null }; }
  try {
    if (!existsSync(pair.toolchain.nodePath)) return { beforeExit: null, afterExit: null };
    linkModules(modules, dir);
    if (!writeCommitFile(repoDir, pair.fixSha, pair.testFile, dir)) return { beforeExit: null, afterExit: null };
    const before = runTest(dir, pair.testCommand, pair.toolchain.nodePath, modules);
    if (before.blocked) return { beforeExit: before.code, afterExit: null };
    linkModules(modules, dir);
    if (!writeCommitFile(repoDir, pair.fixSha, pair.testFile, dir)) return { beforeExit: before.code, afterExit: null };
    const applied = spawnSync("git", ["-C", dir, ...GIT_LOCK_ARGS, "apply", "--whitespace=nowarn", "-"], { input: diff, encoding: "utf8", env: practiceGitEnv(), stdio: ["pipe", "ignore", "ignore"] });
    if (applied.status !== 0) return { beforeExit: before.code, afterExit: null };
    const after = runTest(dir, pair.testCommand, pair.toolchain.nodePath, modules);
    if (after.blocked) return { beforeExit: before.code, afterExit: null };
    return { beforeExit: before.code, afterExit: after.code };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function replayOne(tooling: string, bundle: string, coreDir: string, repoDir: string, pair: PracticePair, modules: string): GradedRow {
  const scorable = targetIsScorable(pair.repo);
  if (!scorable) return { ...blank(pair, "text"), ...gradePracticeRow({ scorable: false, core: "ok", job: null, gatePass: false, beforeExit: null, afterExit: null }) };
  const outDir = mkdtempSync(join(tmpdir(), "peaceai-practice-out-"));
  const dir = mkdtempSync(join(tmpdir(), "peaceai-practice-base-"));
  try {
    if (!materializeSolverTree(repoDir, pair.baseSha, dir)) return { ...blank(pair, "text"), ...gradePracticeRow({ scorable: true, core: "ok", job: { status: "unmeasured", reason: "CHECKOUT_FAILED" }, gatePass: false, beforeExit: null, afterExit: null }) };
    const ran = spawnSync(join(tooling, "node_modules/.bin/tsx"), [join(tooling, "peaceai/bin/generate.ts")], {
      cwd: tooling, encoding: "utf8", timeout: ROW_MS,
      env: {
        ...process.env,
        PEACEAI_KERNEL_BUNDLE: bundle,
        PEACEAI_OUT_DIR: outDir,
        PEACEAI_WORKSPACE_DIR: dir,
        PEACEAI_TARGET: pair.repo,
        PEACEAI_TEST_EXISTING: "true",
        PEACEAI_TEST_FILE: pair.testFile,
        ISSUE_TITLE: pair.subject.slice(0, 200),
        ISSUE_BODY: pair.subject.slice(0, 200),
      },
    });
    let candidates: number | null = null;
    const summaryPath = join(outDir, "summary.json");
    if (existsSync(summaryPath)) {
      try { candidates = ((JSON.parse(readFileSync(summaryPath, "utf8")) as { candidates?: unknown[] }).candidates ?? []).length; } catch { candidates = null; }
    }
    const timedOut = (ran.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
    const job = classifyJobOutput({ timedOut, code: ran.status, candidates, stdout: `${ran.stdout ?? ""}\n${ran.stderr ?? ""}` });
    if (job.status !== "pass") return { ...blank(pair, "text"), ...gradePracticeRow({ scorable: true, core: "ok", job, gatePass: false, beforeExit: null, afterExit: null }) };
    const gated = spawnSync(join(tooling, "node_modules/.bin/tsx"), [join(tooling, "peaceai/bin/gate.ts")], {
      cwd: tooling, encoding: "utf8", timeout: 60_000,
      env: { ...process.env, PEACEAI_OUT_DIR: outDir, PEACEAI_WORKSPACE_DIR: dir, PEACEAI_CORE_DIR: coreDir, PEACEAI_TARGET: pair.repo },
    });
    const gateOut = `${gated.stdout ?? ""}\n${gated.stderr ?? ""}`;
    const gatePass = gated.status === 0 && /GATE PASS/.test(gateOut);
    if (!gatePass) return { ...blank(pair, "text"), ...gradePracticeRow({ scorable: true, core: "ok", job, gatePass: false, beforeExit: null, afterExit: null }) };
    let beforeExit: number | null = null;
    let afterExit: number | null = null;
    let fixed = false;
    const summary = JSON.parse(readFileSync(summaryPath, "utf8")) as { candidates?: { file: string }[] };
    for (const candidate of summary.candidates ?? []) {
      const diff = readFileSync(join(outDir, candidate.file), "utf8");
      const graded = gradeCandidate(repoDir, pair, diff, modules);
      if (beforeExit === null) beforeExit = graded.beforeExit;
      if (graded.beforeExit !== null && graded.beforeExit !== 0 && graded.afterExit === 0) { afterExit = 0; fixed = true; break; }
      if (afterExit === null) afterExit = graded.afterExit;
    }
    if (!fixed && afterExit === null) afterExit = null;
    return { ...blank(pair, "text"), ...gradePracticeRow({ scorable: true, core: "ok", job, gatePass: true, beforeExit, afterExit: fixed ? 0 : afterExit }) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
}

function blank(pair: PracticePair, understanding: Understanding): Pick<GradedRow, "repo" | "split" | "fixSha" | "understanding"> {
  return { repo: pair.repo, split: pair.split, fixSha: pair.fixSha, understanding };
}

/**
 * The failing test is the spec. The work tree is the base plus that one test file from the fix.
 * The fix's other files are not checked out. Tests run in the same sandbox as the text rows,
 * with the pair's recorded node. A source diff from repair-v2 then uses the same gate.
 * Nothing is pushed.
 */
/** The fix's symbol is loaded only here, after the solver has already returned. The solver never sees it. */
function gradeCandidateBehavior(repoDir: string, dir: string, pair: PracticePair, spec: Extract<SpecResult, { status: "diff" }>, modules: string): BehaviorGrade {
  const fixDir = mkdtempSync(join(tmpdir(), "peaceai-practice-fix-"));
  const unavailable = (): BehaviorGrade => ({ behavior: "diff_unavailable", compared: 0 });
  let grade = unavailable();
  try {
    if (!materializeSolverTree(repoDir, pair.fixSha, fixDir) || !spec.fit.targets.length) return grade;
    linkModules(modules, fixDir);
    linkModules(modules, dir);
    const applied = spawnSync("git", ["-C", dir, ...GIT_LOCK_ARGS, "apply", "--whitespace=nowarn", "-"], { input: spec.diff, encoding: "utf8", env: practiceGitEnv(), stdio: ["pipe", "ignore", "ignore"] });
    if (applied.status !== 0) return grade;
    grade = { behavior: "verified_strict", compared: 0 };
    for (const target of spec.fit.targets) {
      const one = gradeBehavior({ candidateRoot: dir, fixRoot: fixDir, target, nodePath: pair.toolchain.nodePath, nodeModules: modules });
      grade = { behavior: one.behavior, compared: grade.compared + one.compared, ...(one.counterexample ? { counterexample: one.counterexample } : {}) };
      if (one.behavior !== "verified_strict") break;
    }
    return grade;
  } finally {
    spawnSync("git", ["-C", dir, ...GIT_LOCK_ARGS, "checkout", "-f"], { env: practiceGitEnv(), stdio: "ignore" });
    spawnSync("git", ["-C", dir, ...GIT_LOCK_ARGS, "clean", "-fd"], { env: practiceGitEnv(), stdio: "ignore" });
    linkModules(modules, dir);
    writeCommitFile(repoDir, pair.fixSha, pair.testFile, dir);
    rmSync(fixDir, { recursive: true, force: true });
  }
}

function specOne(tooling: string, coreDir: string, repoDir: string, pair: PracticePair, modules: string): GradedRow {
  const form = blank(pair, "test-as-spec");
  const outDir = mkdtempSync(join(tmpdir(), "peaceai-practice-spec-"));
  const dir = mkdtempSync(join(tmpdir(), "peaceai-practice-spec-base-"));
  const unmeasured = (reason: string): GradedRow => ({ ...form, ...gradePracticeRow({ scorable: true, core: "ok", job: { status: "unmeasured", reason }, gatePass: false, beforeExit: null, afterExit: null }) });
  try {
    if (!materializeSolverTree(repoDir, pair.baseSha, dir)) return unmeasured("CHECKOUT_FAILED");
    if (!existsSync(pair.toolchain.nodePath)) return unmeasured("UNSAFE_ENV");
    if (!existsSync(modules)) return unmeasured("INSTALL_UNAVAILABLE");
    linkModules(modules, dir);
    if (!writeCommitFile(repoDir, pair.fixSha, pair.testFile, dir)) return unmeasured("CHECKOUT_FAILED");
    const key = Object.keys(loadTargets().targets).find((name) => name.toLowerCase() === pair.repo.toLowerCase());
    const config = key ? loadTargets().targets[key] : undefined;
    if (!config) return { ...form, ...gradePracticeRow({ scorable: false, core: "ok", job: null, gatePass: false, beforeExit: null, afterExit: null }) };
    const spec = runTestSpec({
      root: dir,
      subject: pair.subject,
      testFile: pair.testFile,
      testCommand: pair.testCommand,
      sourcePattern: config.sourcePattern,
      denyPatterns: config.denyPatterns,
      originalSuite: config.originalSuite,
      toolchain: pair.toolchain,
      nodeModules: modules,
      restoreTree: () => writeCommitFile(repoDir, pair.fixSha, pair.testFile, dir),
    });
    if (spec.status === "blocked") return { ...unmeasured(spec.reason), diagnostic: spec.diagnostic };
    if (spec.status === "cant") return { ...form, ...gradePracticeRow({ scorable: true, core: "ok", job: { status: "fail", reason: spec.reason }, gatePass: false, beforeExit: null, afterExit: null }), diagnostic: spec.diagnostic };
    const checked = gradeCandidateBehavior(repoDir, dir, pair, spec, modules);
    const fit = {
      shape: spec.fit.shape, examples: spec.fit.examples, behavior: checked.behavior, diff: spec.diff,
      ...(checked.counterexample ? { counterexample: checked.counterexample } : {}),
    };
    if (checked.behavior !== "verified_strict") {
      return { ...form, ...gradePracticeRow({ scorable: true, core: "ok", job: { status: "pass", reason: "JOB_A_CANDIDATES:1" }, gatePass: true, beforeExit: 1, afterExit: 0, behavior: checked.behavior }), diagnostic: spec.diagnostic, fit };
    }
    mkdirSync(join(outDir, "candidates"), { recursive: true });
    writeFileSync(join(outDir, "candidates", "candidate-1.diff"), spec.diff);
    const diffLines = spec.diff.split("\n").filter((line) => /^[+-](?![+-]{2} )/.test(line)).length;
    writeFileSync(join(outDir, "summary.json"), JSON.stringify({
      schema: "peaceai-workspace-candidates:v1",
      taskId: "workspace-issue-spec",
      baseSha: pair.baseSha,
      candidates: [{ id: "candidate-1", file: "candidates/candidate-1.diff", transformations: ["REPAIR_V2"], operationId: null, diffBytes: Buffer.byteLength(spec.diff), diffLines }],
    }) + "\n");
    const gated = spawnSync(join(tooling, "node_modules/.bin/tsx"), [join(tooling, "peaceai/bin/gate.ts")], {
      cwd: tooling, encoding: "utf8", timeout: 60_000,
      env: { ...process.env, PEACEAI_OUT_DIR: outDir, PEACEAI_WORKSPACE_DIR: dir, PEACEAI_CORE_DIR: coreDir, PEACEAI_TARGET: pair.repo },
    });
    const gateOut = `${gated.stdout ?? ""}\n${gated.stderr ?? ""}`;
    const gatePass = gated.status === 0 && /GATE PASS/.test(gateOut);
    if (!gatePass) return { ...form, ...gradePracticeRow({ scorable: true, core: "ok", job: { status: "pass", reason: "JOB_A_CANDIDATES:1" }, gatePass: false, beforeExit: null, afterExit: null, behavior: "verified_strict" }), diagnostic: spec.diagnostic, fit };
    const graded = gradeCandidate(repoDir, pair, spec.diff, modules);
    return { ...form, ...gradePracticeRow({ scorable: true, core: "ok", job: { status: "pass", reason: "JOB_A_CANDIDATES:1" }, gatePass: true, beforeExit: graded.beforeExit, afterExit: graded.afterExit, behavior: "verified_strict" }), diagnostic: spec.diagnostic, fit };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
}

function readPairs(path: string): PracticePair[] {
  const text = readFileSync(path, "utf8");
  const rows: PracticePair[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as PracticePair;
    const problems = pairProblems(row);
    if (problems.length) throw new Error(`bad pair: ${problems.join(",")}`);
    rows.push(row);
  }
  return rows;
}

function pushInstall(graded: GradedRow[], pair: PracticePair, reason: string, lines: string[]): void {
  for (const understanding of ["text", "test-as-spec"] as const) {
    graded.push({
      repo: pair.repo, split: pair.split, fixSha: pair.fixSha, understanding,
      status: "unmeasured", reason, gap: true, ...(lines.length ? { lines } : {}),
    });
  }
}

function main(): void {
  reapStaleHeldTemps();
  const args = process.argv.slice(2);
  if (args.includes("--hold-held-temps")) {
    const clone = replayClonePlace("held-out", tmpdir());
    const install = practiceInstallRoot("held-out", tmpdir());
    console.log(`held-clone ${clone.dir}`);
    console.log(`held-install ${install.dir}`);
    setInterval(() => {}, 1_000_000);
    return;
  }
  if (args.includes("-h") || args.includes("--help")) { console.log(USAGE); return; }
  const pairsPath = flag("--pairs", args);
  const out = flag("--out", args);
  const coreArchive = flag("--core-archive", args);
  const clones = flag("--clones-dir", args) ?? flag("--clones", args) ?? "";
  const installCache = flag("--install-cache", args);
  const installMax = Number(flag("--install-max", args) ?? INSTALL_MAX_ENTRIES);
  if (!Number.isInteger(installMax) || installMax < 1) { console.log(USAGE); process.exit(2); }
  if (!pairsPath || !out) { console.log(USAGE); process.exit(2); }
  const tooling = resolve(import.meta.dirname, "../..");
  if (insideRepo(tooling, resolve(out))) { console.log("refused WRITE_IN_TARGET"); process.exit(2); }
  // generate.ts stays outside the sandbox: the sandbox hides .git and does not mount the PeaceAI
  // tooling or the kernel bundle, and the candidate output directory is not the work tree.
  const manifest = JSON.parse(readFileSync(join(tooling, "practice/manifest.json"), "utf8")) as { repos: { name: string; root: string; split: string; upstreams?: string[] }[] };
  const corpus = (JSON.parse(readFileSync(join(tooling, "practice/corpus-roots.json"), "utf8")) as { roots?: Record<string, string | null> }).roots ?? {};
  const held = manifest.repos.filter((repo) => repo.split === "held-out").map((repo) => ({ name: repo.name, root: repo.root, upstreams: repo.upstreams ?? [] }));
  const recorded = mergeCloneRootCollisions(replayCloneRecord(manifest.repos, corpus), corpus, clones, held);
  const cloneProblems = cloneCheckProblems(held, recorded, clones);
  if (cloneProblems.length) {
    for (const problem of cloneProblems) console.log(problem);
    process.exit(1);
  }
  const pairs = readPairs(resolve(pairsPath));
  const sandbox = practiceSandboxReady();
  let core: "ok" | "missing" = "missing";
  let bundle = "";
  let coreDir = "";
  let dispose = () => {};
  if (coreArchive) {
    const pin = readCorePin(readFileSync(join(tooling, "peaceai/core-pin.json"), "utf8"));
    const built = pinnedKernel(resolve(coreArchive), pin, tooling);
    if (!("error" in built)) { core = "ok"; bundle = built.bundle; coreDir = built.coreDir; dispose = built.dispose; }
    else console.log(`core ${built.error}`);
  }
  const graded: GradedRow[] = [];
  const heldScratch: { release(): void }[] = [];
  const devCache = installCache ? resolve(installCache) : join(out, "install-cache");
  let heldCache: { dir: string; release(): void } | null = null;
  try {
    const repos = new Map<string, string | null>();
    const runnable: PracticePair[] = [];
    for (const pair of pairs) {
      const scorable = targetIsScorable(pair.repo);
      if (!scorable || core !== "ok" || !sandbox) {
        const row = gradePracticeRow({
          scorable, core: scorable ? core : "ok", job: null, gatePass: false, beforeExit: null, afterExit: null,
        });
        const reason = !sandbox && scorable && core === "ok" ? "UNSAFE_ENV" : row.reason;
        const status = reason === "UNSAFE_ENV" ? "unmeasured" as const : row.status;
        for (const understanding of ["text", "test-as-spec"] as const) graded.push({ repo: pair.repo, split: pair.split, fixSha: pair.fixSha, understanding, status, reason, gap: true });
        continue;
      }
      runnable.push(pair);
      if (!repos.has(pair.repo)) {
        const opened = openPracticeClone(pair.repo, pair.split, clones, out);
        if (pair.split === "held-out") heldScratch.push(opened);
        repos.set(pair.repo, opened.dir);
      }
    }
    const locksOf = (dir: string, pair: PracticePair): LockFiles => {
      const shown = (path: string) => practiceGit(dir, ["show", `${pair.baseSha}:${path}`]);
      return {
        npm: shown("package-lock.json").ok || shown("npm-shrinkwrap.json").ok,
        pnpm: shown("pnpm-lock.yaml").ok,
        yarn: shown("yarn.lock").ok,
      };
    };
    const fingerprintOf = new Map<PracticePair, string>();
    for (const pair of runnable) {
      if (pair.split !== "held-out") continue;
      const dir = repos.get(pair.repo);
      if (!dir) continue;
      const fp = readPairFingerprint(dir, pair.baseSha, pair.toolchain, locksOf(dir, pair));
      if (fp) fingerprintOf.set(pair, fp);
    }
    const remaining = tallyFingerprints([...fingerprintOf.values()]);
    const ordered = [
      ...runnable.filter((pair) => pair.split !== "held-out"),
      ...runnable.filter((pair) => pair.split === "held-out").sort((a, b) => (fingerprintOf.get(a) ?? "").localeCompare(fingerprintOf.get(b) ?? "")),
    ];
    for (const pair of ordered) {
      const dir = repos.get(pair.repo);
      const fp = fingerprintOf.get(pair);
      if (!dir) {
        for (const understanding of ["text", "test-as-spec"] as const) graded.push({ repo: pair.repo, split: pair.split, fixSha: pair.fixSha, understanding, status: "unmeasured", reason: "NO_CLONE", gap: true });
        if (fp) finishHeldFingerprint(heldCache?.dir ?? "", fp, remaining);
        continue;
      }
      let cacheRoot = devCache;
      if (pair.split === "held-out") {
        if (!heldCache) { heldCache = practiceInstallRoot("held-out", out); heldScratch.push(heldCache); }
        cacheRoot = heldCache.dir;
      }
      try {
        const shown = (path: string) => practiceGit(dir, ["show", `${pair.baseSha}:${path}`]);
        const pkgShow = shown("package.json");
        let pkg: { packageManager?: string; dependencies?: object; devDependencies?: object } = {};
        try { pkg = JSON.parse(pkgShow.out) as typeof pkg; } catch { pkg = {}; }
        const locks = locksOf(dir, pair);
        let installed;
        try {
          installed = ensurePracticeInstall(dir, pair, cacheRoot, locks, yarnIsModern(pkg), { maxInstalls: installMax });
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          const reason = code === "ENOSPC" ? "INSTALL_SKIPPED_NO_SPACE" : "INSTALL_FAILED";
          pushInstall(graded, pair, reason, [`${(err as Error).message ?? "install"}`.slice(0, 240)]);
          continue;
        }
        if (!installed.ok || !installed.modules) {
          pushInstall(graded, pair, installed.reason ?? "INSTALL_FAILED", installed.lines);
          continue;
        }
        graded.push(replayOne(tooling, bundle, coreDir, dir, pair, installed.modules));
        graded.push(specOne(tooling, coreDir, dir, pair, installed.modules));
      } finally {
        if (fp && heldCache) finishHeldFingerprint(heldCache.dir, fp, remaining);
      }
    }
  } finally {
    dispose();
    releaseHeldPlaces(heldScratch);
  }
  const doc = replayDocument(graded);
  writePracticeOutputs(out, graded);
  console.log("experimental credit=false");
  if (graded.some((row) => row.reason === "GATE_NO_TARGET")) {
    console.log(`protectedFunction=${PROTECTED_GATE_FUNCTION} protectedFile=${PROTECTED_GATE_FILE}`);
    console.log(PROTECTED_GATE_WHY);
  }
  for (const split of ["dev", "held-out"] as const) {
    const behavior = doc.behavior[split];
    console.log(`${split} behavior strict=${behavior.verified_strict} test_only=${behavior.verified_test_only} unavailable=${behavior.diff_unavailable}`);
  }
  for (const understanding of ["text", "test-as-spec"] as const) {
    for (const split of ["dev", "held-out"] as const) {
      const bag = doc.counts[understanding][split];
      console.log(`${split} understanding=${understanding} pass=${bag.pass} fail=${bag.fail} unmeasured=${bag.unmeasured}`);
      for (const [reason, n] of Object.entries(bag.reasons).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) console.log(`${split} understanding=${understanding} reason ${n} ${reason}`);
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith("practice-replay.ts")) main();
