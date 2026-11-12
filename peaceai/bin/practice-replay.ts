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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { classifyJobOutput } from "../lib/capabilityjob.ts";
import { GIT_LOCK_ARGS, pairProblems, poisonStamp, practiceGit, practiceGitEnv, practiceSandboxReady, releaseWorktree, runInPracticeSandbox, type PracticePair } from "../lib/practicemine.ts";
import {
  PROTECTED_GATE_FILE, PROTECTED_GATE_FUNCTION, PROTECTED_GATE_WHY, gradePracticeRow, replayDocument, targetIsScorable,
  type GradedRow, type Understanding,
} from "../lib/practicereplay.ts";
import { runTestSpec } from "../lib/testspec.ts";
import { loadTargets } from "../lib/target.ts";
import { pinnedKernel, readCorePin } from "./capability-job.ts";

const ROW_MS = 45_000;
const TEST_MS = 60_000;
const USAGE = "usage: practice-replay.ts --pairs <jsonl> --out <dir> [--core-archive <tar>] [--clones-dir <dir>]";

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

function linkModules(repoDir: string, dir: string): void {
  const modules = join(repoDir, "node_modules");
  if (existsSync(modules) && !existsSync(join(dir, "node_modules"))) spawnSync("ln", ["-s", modules, join(dir, "node_modules")], { stdio: "ignore" });
}

function runTest(dir: string, cmd: string[], nodePath: string): { code: number | null; blocked: boolean } {
  const before = poisonStamp(dir);
  const modules = existsSync(join(dir, "node_modules")) ? join(dir, "node_modules") : null;
  const ran = runInPracticeSandbox(dir, cmd, TEST_MS, { nodePath, nodeModules: modules });
  const released = releaseWorktree(dir, before);
  if (ran.unsafe || released.poison.length > 0 || !released.clean) return { code: null, blocked: true };
  return { code: ran.code, blocked: false };
}

/** Apply one candidate on a fresh base, with the recorded test file as the spec. Returns exits, or nulls when the diff does not apply. */
function gradeCandidate(repoDir: string, pair: PracticePair, diff: string): { beforeExit: number | null; afterExit: number | null } {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-practice-grade-"));
  const added = spawnSync("git", ["-C", repoDir, ...GIT_LOCK_ARGS, "worktree", "add", "--detach", "--quiet", dir, pair.baseSha], { env: practiceGitEnv(), stdio: "ignore", timeout: 60_000 });
  if (added.status !== 0) { rmSync(dir, { recursive: true, force: true }); return { beforeExit: null, afterExit: null }; }
  try {
    if (!existsSync(pair.toolchain.nodePath)) return { beforeExit: null, afterExit: null };
    linkModules(repoDir, dir);
    if (!git(dir, ["checkout", pair.fixSha, "--", pair.testFile])) return { beforeExit: null, afterExit: null };
    const before = runTest(dir, pair.testCommand, pair.toolchain.nodePath);
    if (before.blocked) return { beforeExit: before.code, afterExit: null };
    linkModules(repoDir, dir);
    if (!git(dir, ["checkout", pair.fixSha, "--", pair.testFile])) return { beforeExit: before.code, afterExit: null };
    const applied = spawnSync("git", ["-C", dir, ...GIT_LOCK_ARGS, "apply", "--whitespace=nowarn", "-"], { input: diff, encoding: "utf8", env: practiceGitEnv(), stdio: ["pipe", "ignore", "ignore"] });
    if (applied.status !== 0) return { beforeExit: before.code, afterExit: null };
    const after = runTest(dir, pair.testCommand, pair.toolchain.nodePath);
    if (after.blocked) return { beforeExit: before.code, afterExit: null };
    return { beforeExit: before.code, afterExit: after.code };
  } finally {
    spawnSync("git", ["-C", repoDir, ...GIT_LOCK_ARGS, "worktree", "remove", "--force", dir], { env: practiceGitEnv(), stdio: "ignore" });
    rmSync(dir, { recursive: true, force: true });
  }
}

function replayOne(tooling: string, bundle: string, coreDir: string, repoDir: string, pair: PracticePair): GradedRow {
  const scorable = targetIsScorable(pair.repo);
  if (!scorable) return { ...blank(pair, "text"), ...gradePracticeRow({ scorable: false, core: "ok", job: null, gatePass: false, beforeExit: null, afterExit: null }) };
  const outDir = mkdtempSync(join(tmpdir(), "peaceai-practice-out-"));
  const dir = mkdtempSync(join(tmpdir(), "peaceai-practice-base-"));
  try {
    const added = spawnSync("git", ["-C", repoDir, ...GIT_LOCK_ARGS, "worktree", "add", "--detach", "--quiet", dir, pair.baseSha], { env: practiceGitEnv(), stdio: "ignore", timeout: 60_000 });
    if (added.status !== 0) return { ...blank(pair, "text"), ...gradePracticeRow({ scorable: true, core: "ok", job: { status: "unmeasured", reason: "CHECKOUT_FAILED" }, gatePass: false, beforeExit: null, afterExit: null }) };
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
      const graded = gradeCandidate(repoDir, pair, diff);
      if (beforeExit === null) beforeExit = graded.beforeExit;
      if (graded.beforeExit !== null && graded.beforeExit !== 0 && graded.afterExit === 0) { afterExit = 0; fixed = true; break; }
      if (afterExit === null) afterExit = graded.afterExit;
    }
    if (!fixed && afterExit === null) afterExit = null;
    return { ...blank(pair, "text"), ...gradePracticeRow({ scorable: true, core: "ok", job, gatePass: true, beforeExit, afterExit: fixed ? 0 : afterExit }) };
  } finally {
    spawnSync("git", ["-C", repoDir, ...GIT_LOCK_ARGS, "worktree", "remove", "--force", dir], { env: practiceGitEnv(), stdio: "ignore" });
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
function specOne(tooling: string, coreDir: string, repoDir: string, pair: PracticePair): GradedRow {
  const form = blank(pair, "test-as-spec");
  const outDir = mkdtempSync(join(tmpdir(), "peaceai-practice-spec-"));
  const dir = mkdtempSync(join(tmpdir(), "peaceai-practice-spec-base-"));
  const unmeasured = (reason: string): GradedRow => ({ ...form, ...gradePracticeRow({ scorable: true, core: "ok", job: { status: "unmeasured", reason }, gatePass: false, beforeExit: null, afterExit: null }) });
  try {
    const added = spawnSync("git", ["-C", repoDir, ...GIT_LOCK_ARGS, "worktree", "add", "--detach", "--quiet", dir, pair.baseSha], { env: practiceGitEnv(), stdio: "ignore", timeout: 60_000 });
    if (added.status !== 0) return unmeasured("CHECKOUT_FAILED");
    if (!existsSync(pair.toolchain.nodePath)) return unmeasured("UNSAFE_ENV");
    linkModules(repoDir, dir);
    if (!git(dir, ["checkout", pair.fixSha, "--", pair.testFile])) return unmeasured("CHECKOUT_FAILED");
    const key = Object.keys(loadTargets().targets).find((name) => name.toLowerCase() === pair.repo.toLowerCase());
    const config = key ? loadTargets().targets[key] : undefined;
    if (!config) return { ...form, ...gradePracticeRow({ scorable: false, core: "ok", job: null, gatePass: false, beforeExit: null, afterExit: null }) };
    const modules = join(dir, "node_modules");
    const spec = runTestSpec({
      root: dir,
      subject: pair.subject,
      testFile: pair.testFile,
      testCommand: pair.testCommand,
      sourcePattern: config.sourcePattern,
      denyPatterns: config.denyPatterns,
      originalSuite: config.originalSuite,
      toolchain: pair.toolchain,
      nodeModules: existsSync(modules) ? modules : null,
      restoreTree: () => git(dir, ["checkout", pair.fixSha, "--", pair.testFile]),
    });
    if (spec.status === "blocked") return { ...unmeasured(spec.reason), diagnostic: spec.diagnostic };
    if (spec.status === "cant") return { ...form, ...gradePracticeRow({ scorable: true, core: "ok", job: { status: "fail", reason: spec.reason }, gatePass: false, beforeExit: null, afterExit: null }), diagnostic: spec.diagnostic };
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
    if (!gatePass) return { ...form, ...gradePracticeRow({ scorable: true, core: "ok", job: { status: "pass", reason: "JOB_A_CANDIDATES:1" }, gatePass: false, beforeExit: null, afterExit: null }) };
    const graded = gradeCandidate(repoDir, pair, spec.diff);
    return { ...form, ...gradePracticeRow({ scorable: true, core: "ok", job: { status: "pass", reason: "JOB_A_CANDIDATES:1" }, gatePass: true, beforeExit: graded.beforeExit, afterExit: graded.afterExit }) };
  } finally {
    spawnSync("git", ["-C", repoDir, ...GIT_LOCK_ARGS, "worktree", "remove", "--force", dir], { env: practiceGitEnv(), stdio: "ignore" });
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

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) { console.log(USAGE); return; }
  const pairsPath = flag("--pairs", args);
  const out = flag("--out", args);
  const coreArchive = flag("--core-archive", args);
  const clones = flag("--clones-dir", args) ?? flag("--clones", args) ?? "";
  if (!pairsPath || !out) { console.log(USAGE); process.exit(2); }
  const tooling = resolve(import.meta.dirname, "../..");
  if (insideRepo(tooling, resolve(out))) { console.log("refused WRITE_IN_TARGET"); process.exit(2); }
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
  try {
    const repos = new Map<string, string | null>();
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
      if (!repos.has(pair.repo)) repos.set(pair.repo, cloneDir(pair.repo, clones, join(out, "clones")));
      const dir = repos.get(pair.repo);
      if (!dir) {
        for (const understanding of ["text", "test-as-spec"] as const) graded.push({ repo: pair.repo, split: pair.split, fixSha: pair.fixSha, understanding, status: "unmeasured", reason: "NO_CLONE", gap: true });
        continue;
      }
      graded.push(replayOne(tooling, bundle, coreDir, dir, pair));
      graded.push(specOne(tooling, coreDir, dir, pair));
    }
  } finally {
    dispose();
  }
  const doc = replayDocument(graded);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "replay.json"), JSON.stringify(doc, null, 2) + "\n");
  const gaps = graded.filter((row) => row.gap).map((row) => JSON.stringify({
    repo: row.repo, split: row.split, fixSha: row.fixSha, understanding: row.understanding ?? "text", status: row.status, reason: row.reason,
    ...(row.diagnostic ? { diagnostic: row.diagnostic } : {}),
  }));
  writeFileSync(join(out, "gaps.jsonl"), gaps.join("\n") + (gaps.length ? "\n" : ""));
  console.log("experimental credit=false");
  if (graded.some((row) => row.reason === "GATE_NO_TARGET")) {
    console.log(`protectedFunction=${PROTECTED_GATE_FUNCTION} protectedFile=${PROTECTED_GATE_FILE}`);
    console.log(PROTECTED_GATE_WHY);
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
