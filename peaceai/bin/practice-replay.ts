// Mixed practice replay. credit: false. Experimental.
//   tsx peaceai/bin/practice-replay.ts --pairs <jsonl> --out <dir outside this repo> --core-archive <tar> --clones-dir <dir>
// --core-archive is the pinned core tar capability-job.ts checks against peaceai/core-pin.json.
// --clones-dir holds one git clone per repo, named <owner>__<name>, with the recorded commits present.
// --clones is the same option.
// Each row gives Job A only the commit subject and the repo at baseSha. The diff and the fix are not shown.
// A row passes only when peaceai/bin/gate.ts prints GATE PASS and the recorded test fails before the
// candidate and passes after it. Unmeasured is never a pass.
// A repo that targets.json does not name is UNMEASURED GATE_NO_TARGET. gate.ts and scope.ts are not edited.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { classifyJobOutput } from "../lib/capabilityjob.ts";
import { pairProblems, practiceSandboxReady, runInPracticeSandbox, type PracticePair } from "../lib/practicemine.ts";
import {
  PROTECTED_GATE_FILE, PROTECTED_GATE_FUNCTION, PROTECTED_GATE_WHY, gradePracticeRow, replayDocument, targetIsScorable,
  type GradedRow,
} from "../lib/practicereplay.ts";
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
  return spawnSync("git", ["-C", dir, ...args], { stdio: "ignore", timeout }).status === 0;
}

function cloneDir(repo: string, clones: string, work: string): string | null {
  const cached = clones ? join(clones, repo.replace("/", "__")) : "";
  const dir = join(work, repo.replace("/", "__"));
  if (existsSync(join(dir, ".git"))) return dir;
  const src = cached && existsSync(join(cached, ".git")) ? cached : "";
  if (!src) return null;
  if (spawnSync("git", ["clone", "--quiet", src, dir], { stdio: "ignore", timeout: 180_000 }).status !== 0) return null;
  return dir;
}

function runTest(dir: string, cmd: string[]): number | null {
  const ran = runInPracticeSandbox(dir, cmd, TEST_MS);
  if (ran.unsafe) return null;
  return ran.code;
}

/** Apply one candidate on a fresh base, with the recorded test file as the spec. Returns exits, or nulls when the diff does not apply. */
function gradeCandidate(repoDir: string, pair: PracticePair, diff: string): { beforeExit: number | null; afterExit: number | null } {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-practice-grade-"));
  const added = spawnSync("git", ["-C", repoDir, "worktree", "add", "--detach", "--quiet", dir, pair.baseSha], { stdio: "ignore", timeout: 60_000 });
  if (added.status !== 0) { rmSync(dir, { recursive: true, force: true }); return { beforeExit: null, afterExit: null }; }
  try {
    const modules = join(repoDir, "node_modules");
    if (existsSync(modules) && !existsSync(join(dir, "node_modules"))) spawnSync("ln", ["-s", modules, join(dir, "node_modules")], { stdio: "ignore" });
    if (!git(dir, ["checkout", pair.fixSha, "--", pair.testFile])) return { beforeExit: null, afterExit: null };
    const before = runTest(dir, pair.testCommand);
    const applied = spawnSync("git", ["-C", dir, "apply", "--whitespace=nowarn", "-"], { input: diff, encoding: "utf8", stdio: ["pipe", "ignore", "ignore"] });
    if (applied.status !== 0) return { beforeExit: before, afterExit: null };
    const after = runTest(dir, pair.testCommand);
    return { beforeExit: before, afterExit: after };
  } finally {
    spawnSync("git", ["-C", repoDir, "worktree", "remove", "--force", dir], { stdio: "ignore" });
    rmSync(dir, { recursive: true, force: true });
  }
}

function replayOne(tooling: string, bundle: string, coreDir: string, repoDir: string, pair: PracticePair): GradedRow {
  const scorable = targetIsScorable(pair.repo);
  if (!scorable) return { ...blank(pair), ...gradePracticeRow({ scorable: false, core: "ok", job: null, gatePass: false, beforeExit: null, afterExit: null }) };
  const outDir = mkdtempSync(join(tmpdir(), "peaceai-practice-out-"));
  const dir = mkdtempSync(join(tmpdir(), "peaceai-practice-base-"));
  try {
    const added = spawnSync("git", ["-C", repoDir, "worktree", "add", "--detach", "--quiet", dir, pair.baseSha], { stdio: "ignore", timeout: 60_000 });
    if (added.status !== 0) return { ...blank(pair), ...gradePracticeRow({ scorable: true, core: "ok", job: { status: "unmeasured", reason: "CHECKOUT_FAILED" }, gatePass: false, beforeExit: null, afterExit: null }) };
    const ran = spawnSync(join(tooling, "node_modules/.bin/tsx"), [join(tooling, "peaceai/bin/generate.ts")], {
      cwd: tooling, encoding: "utf8", timeout: ROW_MS,
      env: {
        ...process.env,
        PEACEAI_KERNEL_BUNDLE: bundle,
        PEACEAI_OUT_DIR: outDir,
        PEACEAI_WORKSPACE_DIR: dir,
        PEACEAI_TARGET: pair.repo,
        PEACEAI_TEST_EXISTING: "true",
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
    if (job.status !== "pass") return { ...blank(pair), ...gradePracticeRow({ scorable: true, core: "ok", job, gatePass: false, beforeExit: null, afterExit: null }) };
    const gated = spawnSync(join(tooling, "node_modules/.bin/tsx"), [join(tooling, "peaceai/bin/gate.ts")], {
      cwd: tooling, encoding: "utf8", timeout: 60_000,
      env: { ...process.env, PEACEAI_OUT_DIR: outDir, PEACEAI_WORKSPACE_DIR: dir, PEACEAI_CORE_DIR: coreDir, PEACEAI_TARGET: pair.repo },
    });
    const gateOut = `${gated.stdout ?? ""}\n${gated.stderr ?? ""}`;
    const gatePass = gated.status === 0 && /GATE PASS/.test(gateOut);
    if (!gatePass) return { ...blank(pair), ...gradePracticeRow({ scorable: true, core: "ok", job, gatePass: false, beforeExit: null, afterExit: null }) };
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
    return { ...blank(pair), ...gradePracticeRow({ scorable: true, core: "ok", job, gatePass: true, beforeExit, afterExit: fixed ? 0 : afterExit }) };
  } finally {
    spawnSync("git", ["-C", repoDir, "worktree", "remove", "--force", dir], { stdio: "ignore" });
    rmSync(dir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
}

function blank(pair: PracticePair): Pick<GradedRow, "repo" | "split" | "fixSha"> {
  return { repo: pair.repo, split: pair.split, fixSha: pair.fixSha };
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
        graded.push({ repo: pair.repo, split: pair.split, fixSha: pair.fixSha, status, reason, gap: true });
        continue;
      }
      if (!repos.has(pair.repo)) repos.set(pair.repo, cloneDir(pair.repo, clones, join(out, "clones")));
      const dir = repos.get(pair.repo);
      if (!dir) {
        graded.push({ repo: pair.repo, split: pair.split, fixSha: pair.fixSha, status: "unmeasured", reason: "NO_CLONE", gap: true });
        continue;
      }
      graded.push(replayOne(tooling, bundle, coreDir, dir, pair));
    }
  } finally {
    dispose();
  }
  const doc = replayDocument(graded);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "replay.json"), JSON.stringify(doc, null, 2) + "\n");
  const gaps = graded.filter((row) => row.gap).map((row) => JSON.stringify({ repo: row.repo, split: row.split, fixSha: row.fixSha, status: row.status, reason: row.reason }));
  writeFileSync(join(out, "gaps.jsonl"), gaps.join("\n") + (gaps.length ? "\n" : ""));
  console.log("experimental credit=false");
  if (graded.some((row) => row.reason === "GATE_NO_TARGET")) {
    console.log(`protectedFunction=${PROTECTED_GATE_FUNCTION} protectedFile=${PROTECTED_GATE_FILE}`);
    console.log(PROTECTED_GATE_WHY);
  }
  for (const split of ["dev", "held-out"] as const) {
    const bag = doc.counts[split];
    console.log(`${split} pass=${bag.pass} fail=${bag.fail} unmeasured=${bag.unmeasured}`);
    for (const [reason, n] of Object.entries(bag.reasons).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) console.log(`${split} reason ${n} ${reason}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith("practice-replay.ts")) main();
