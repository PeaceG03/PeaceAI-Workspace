// Mixed practice miner. credit: false.
//   tsx peaceai/bin/practice-mine.ts --manifest practice/manifest.json --out practice/pairs.jsonl --work <dir outside this repo>
// Checks the root LICENSE at the pinned commit and keeps MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, and ISC.
// A pair is a non-merge commit that changes at least one non-test source and exactly one test file,
// whose test fails at the parent with that test file applied and passes at the fix.
// Tests run inside an allowlist bubblewrap: /usr, /bin, /lib*, a minimal /etc, the node binary,
// the work tree, and a read-only node_modules. .git is not writable. If bwrap cannot build that
// sandbox, tests are not run and the report says UNSAFE_ENV. There is no unshare fallback.
// Installs may use the network and always pass --ignore-scripts. Third-party source is not committed.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ENV_ALLOW, GIT_LOCK_ARGS, currentToolchain, installArgv, isOwnerRepo, isTestFile, keptLicense, pairFiles, pairProblems, poisonStamp, practiceGit, practiceGitEnv, practiceSandboxReady, releaseWorktree, runInPracticeSandbox, scrubEnv, testCommandFor, visibleNodeBin, yarnIsModern,
  type LockFiles, type NameStatus, type PkgJson, type PracticeLicense, type PracticeManifest, type PracticePair, type PracticeRepo,
  LICENSE_FILES, MINE_REPORT_SCHEMA,
} from "../lib/practicemine.ts";

const ATTEMPTS_PER_REPO = 80;
const KEEP_PER_REPO = 20;
const KEEP_TOTAL = 100;
const TEST_MS = 45_000;
const INSTALL_MS = 180_000;

const USAGE = "usage: practice-mine.ts --manifest <file> --out <pairs.jsonl> --work <dir> [--report <file>] [--clones <dir>] [--only owner/repo] [--append]";

function flag(name: string, args: string[]): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith("--")) throw new Error(USAGE);
  return value;
}

function git(dir: string, args: string[], timeout = 60_000): { ok: boolean; out: string } {
  const ran = practiceGit(dir, args, timeout);
  return { ok: ran.ok, out: ran.out };
}

interface Candidate { fix: string; base: string; subject: string; testFile: string; files: string[] }

function candidatesOf(dir: string, pin: string): Candidate[] {
  const log = git(dir, ["log", "--no-merges", "--name-status", `--pretty=format:@@@%H%x09%s`, pin], 120_000);
  if (!log.ok) return [];
  const out: Candidate[] = [];
  let fix = "";
  let subject = "";
  let rows: NameStatus[] = [];
  const flush = () => {
    if (!fix) return;
    const picked = pairFiles(rows);
    if (picked) {
      const parent = git(dir, ["rev-parse", `${fix}^`]);
      const base = parent.ok ? parent.out.trim() : "";
      if (/^[0-9a-f]{40}$/.test(base) && base !== fix) {
        const files = [...new Set(rows.map((r) => r.path))].sort();
        out.push({ fix, base, subject: subject.replace(/\s+/g, " ").trim().slice(0, 200), testFile: picked.testFile, files });
      }
    }
    rows = [];
  };
  for (const line of log.out.split("\n")) {
    if (line.startsWith("@@@")) {
      flush();
      const rest = line.slice(3);
      const tab = rest.indexOf("\t");
      fix = tab < 0 ? rest.trim() : rest.slice(0, tab).trim();
      subject = tab < 0 ? "" : rest.slice(tab + 1);
      if (!/^[0-9a-f]{40}$/.test(fix)) fix = "";
    } else if (fix && line.includes("\t")) {
      const [status, path] = line.split("\t");
      if (status && path && /^[AMD]$/.test(status)) rows.push({ status, path });
    }
  }
  flush();
  return out;
}

function showText(dir: string, rev: string, path: string): string | null {
  const ran = git(dir, ["show", `${rev}:${path}`]);
  return ran.ok ? ran.out : null;
}

function pkgAt(dir: string, rev: string): PkgJson | null {
  const text = showText(dir, rev, "package.json");
  if (text === null) return null;
  try { return JSON.parse(text) as PkgJson; } catch { return null; }
}

function locksAt(dir: string, rev: string): LockFiles {
  const has = (path: string) => git(dir, ["cat-file", "-e", `${rev}:${path}`]).ok;
  return { npm: has("package-lock.json") || has("npm-shrinkwrap.json"), pnpm: has("pnpm-lock.yaml"), yarn: has("yarn.lock") };
}

function hasDeps(pkg: PkgJson): boolean {
  return Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length > 0;
}

function fingerprint(dir: string): string {
  const hash = createHash("sha256");
  for (const name of ["package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"]) {
    hash.update(name);
    hash.update(existsSync(join(dir, name)) ? readFileSync(join(dir, name)) : "");
  }
  return hash.digest("hex");
}

function checkout(dir: string, rev: string): boolean {
  return git(dir, ["-c", "advice.detachedHead=false", "checkout", "-f", "--detach", rev], 120_000).ok;
}

function applyTest(dir: string, fix: string, testFile: string): boolean {
  if (!isTestFile(testFile)) return false;
  return git(dir, ["checkout", fix, "--", testFile]).ok;
}

let installed = "";

function install(dir: string, locks: LockFiles, deps: boolean, modernYarn: boolean): boolean {
  const argv = installArgv(locks, deps, modernYarn);
  const fp = fingerprint(dir);
  if (!argv) { installed = fp; return true; }
  if (installed === fp && existsSync(join(dir, "node_modules"))) return true;
  const env = scrubEnv(process.env, dir);
  const ran = spawnSync(argv[0]!, argv.slice(1), { cwd: dir, env, timeout: INSTALL_MS, stdio: "ignore" });
  if (ran.status !== 0 && argv[0] === "npm" && argv[1] === "ci") {
    const fallback = spawnSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: dir, env, timeout: INSTALL_MS, stdio: "ignore" });
    if (fallback.status !== 0) return false;
  } else if (ran.status !== 0) return false;
  installed = fp;
  return true;
}

function runTest(dir: string, cmd: string[], nodePath: string): { code: number | null; poison: string[]; clean: boolean } {
  const before = poisonStamp(dir);
  const modules = existsSync(join(dir, "node_modules")) ? join(dir, "node_modules") : null;
  const ran = runInPracticeSandbox(dir, cmd, TEST_MS, { nodePath, nodeModules: modules });
  const released = releaseWorktree(dir, before);
  if (ran.unsafe) return { code: null, poison: released.poison, clean: released.clean };
  return { code: ran.code, poison: released.poison, clean: released.clean };
}

function licenseAt(dir: string, pin: string): { text: string; file: string } | null {
  for (const file of LICENSE_FILES) {
    const text = showText(dir, pin, file);
    if (text !== null) return { text, file };
  }
  return null;
}

function ensureClone(repo: PracticeRepo, dir: string, clones: string): boolean {
  if (existsSync(join(dir, ".git"))) return true;
  const cached = join(clones, repo.name.replace("/", "__"));
  const env = practiceGitEnv();
  if (existsSync(join(cached, ".git"))) {
    return spawnSync("git", [...GIT_LOCK_ARGS, "clone", "--quiet", cached, dir], { env, stdio: "ignore", timeout: 180_000 }).status === 0;
  }
  mkdirSync(dir, { recursive: true });
  return spawnSync("git", [...GIT_LOCK_ARGS, "clone", "--filter=blob:none", "--quiet", `https://github.com/${repo.name}.git`, dir], { env, stdio: "ignore", timeout: 300_000 }).status === 0;
}

interface RepoReport { name: string; split: string; candidates: number; attempts: number; kept: number; reason: string | null }

function readPairs(path: string): PracticePair[] {
  if (!existsSync(path)) return [];
  const rows: PracticePair[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as PracticePair;
    const problems = pairProblems(row);
    if (problems.length) throw new Error(`bad pair: ${problems.join(",")}`);
    rows.push(row);
  }
  return rows;
}

function mineRepo(repo: PracticeRepo, dir: string, sandbox: boolean, pairs: PracticePair[], seen: Set<string>, totalCap: { n: number }, flush: () => void): RepoReport {
  const report: RepoReport = { name: repo.name, split: repo.split, candidates: 0, attempts: 0, kept: 0, reason: null };
  const head = git(dir, ["rev-parse", repo.commit]);
  if (!head.ok || head.out.trim() !== repo.commit) {
    const fetched = git(dir, ["fetch", "--quiet", "origin", repo.commit], 180_000);
    if (!fetched.ok || !git(dir, ["cat-file", "-e", `${repo.commit}^{commit}`]).ok) {
      report.reason = "PIN_MISSING";
      return report;
    }
  }
  const root = git(dir, ["rev-list", "--max-parents=0", repo.commit]);
  const roots = root.ok ? root.out.trim().split("\n").filter(Boolean) : [];
  if (roots.length !== 1 || roots[0] !== repo.root) { report.reason = "ROOT_MISMATCH"; return report; }
  const found = candidatesOf(dir, repo.commit);
  report.candidates = found.length;
  let license: PracticeLicense;
  if (isOwnerRepo(repo.name)) {
    if (repo.license !== "owner") { report.reason = "LICENSE_MISMATCH"; return report; }
    license = "owner";
  } else {
    const file = licenseAt(dir, repo.commit);
    const spdx = keptLicense(file?.text ?? null);
    if (spdx === null || spdx !== repo.license || file?.file !== repo.licenseFile) {
      report.reason = spdx === null ? "LICENSE_MISSING" : "LICENSE_MISMATCH";
      return report;
    }
    license = spdx;
  }
  if (!sandbox) { report.reason = "UNSAFE_ENV"; return report; }
  const nodePath = visibleNodeBin();
  if (!nodePath) { report.reason = "TOOLCHAIN_MISSING"; return report; }
  installed = "";
  for (const candidate of found) {
    if (report.kept >= KEEP_PER_REPO || report.attempts >= ATTEMPTS_PER_REPO || totalCap.n >= KEEP_TOTAL) break;
    if (!candidate.subject) continue;
    if (seen.has(`${repo.name}\t${candidate.fix}`)) continue;
    const pkg = pkgAt(dir, candidate.fix);
    if (!pkg) continue;
    const command = testCommandFor(pkg, candidate.testFile);
    if (!command) continue;
    const locks = locksAt(dir, candidate.fix);
    const manager = locks.pnpm ? "pnpm" : locks.yarn ? "yarn" : locks.npm || hasDeps(pkg) ? "npm" : "none";
    const toolchain = currentToolchain(manager);
    if (!toolchain || toolchain.nodePath !== nodePath) continue;
    report.attempts++;
    if (!checkout(dir, candidate.fix)) continue;
    if (!install(dir, locks, hasDeps(pkg), yarnIsModern(pkg))) continue;
    const after = runTest(dir, command, nodePath);
    if (!after.clean) { report.reason = "SANDBOX_CLEAN_FAILED"; return report; }
    if (after.poison.length) { console.log(`poison ${repo.name} ${after.poison[0]}`); continue; }
    if (after.code !== 0) continue;
    const baseLocks = locksAt(dir, candidate.base);
    const basePkg = pkgAt(dir, candidate.base);
    if (!checkout(dir, candidate.base)) continue;
    if (!applyTest(dir, candidate.fix, candidate.testFile)) continue;
    if (!install(dir, baseLocks, basePkg ? hasDeps(basePkg) : true, yarnIsModern(basePkg))) continue;
    const before = runTest(dir, command, nodePath);
    if (!before.clean) { report.reason = "SANDBOX_CLEAN_FAILED"; return report; }
    if (before.poison.length) { console.log(`poison ${repo.name} ${before.poison[0]}`); continue; }
    if (before.code === null || before.code === 0) continue;
    const pair: PracticePair = {
      schema: "peaceai-practice-pair:v1", credit: false, repo: repo.name, license, split: repo.split,
      baseSha: candidate.base, fixSha: candidate.fix, testFile: candidate.testFile, testCommand: command,
      beforeExit: before.code, afterExit: after.code, files: candidate.files, subject: candidate.subject, toolchain,
    };
    if (pairProblems(pair).length) continue;
    pairs.push(pair);
    seen.add(`${repo.name}\t${candidate.fix}`);
    report.kept++;
    totalCap.n++;
    flush();
    console.log(`kept ${repo.name} ${candidate.fix} before=${before} after=${after}`);
  }
  return report;
}

function reverifyRepo(repo: PracticeRepo, dir: string, rows: PracticePair[]): { kept: PracticePair[]; dropped: number; reason: string | null } {
  const kept: PracticePair[] = [];
  let dropped = 0;
  installed = "";
  for (const pair of rows) {
    const pkg = pkgAt(dir, pair.fixSha);
    if (!pkg) { dropped++; console.log(`drop ${pair.repo} ${pair.fixSha} NO_PKG`); continue; }
    const locks = locksAt(dir, pair.fixSha);
    const manager = locks.pnpm ? "pnpm" as const : locks.yarn ? "yarn" as const : locks.npm || hasDeps(pkg) ? "npm" as const : "none" as const;
    const toolchain = currentToolchain(manager);
    if (!toolchain) { dropped++; console.log(`drop ${pair.repo} ${pair.fixSha} TOOLCHAIN_MISSING`); continue; }
    if (!checkout(dir, pair.fixSha)) { dropped++; console.log(`drop ${pair.repo} ${pair.fixSha} CHECKOUT`); continue; }
    if (!install(dir, locks, hasDeps(pkg), yarnIsModern(pkg))) { dropped++; console.log(`drop ${pair.repo} ${pair.fixSha} INSTALL`); continue; }
    const after = runTest(dir, pair.testCommand, toolchain.nodePath);
    if (!after.clean) return { kept, dropped, reason: "SANDBOX_CLEAN_FAILED" };
    if (after.poison.length || after.code !== 0) { dropped++; console.log(`drop ${pair.repo} ${pair.fixSha} after=${after.code} poison=${after.poison.join(",")}`); continue; }
    const basePkg = pkgAt(dir, pair.baseSha);
    const baseLocks = locksAt(dir, pair.baseSha);
    if (!checkout(dir, pair.baseSha) || !applyTest(dir, pair.fixSha, pair.testFile)) { dropped++; console.log(`drop ${pair.repo} ${pair.fixSha} BASE`); continue; }
    if (!install(dir, baseLocks, basePkg ? hasDeps(basePkg) : true, yarnIsModern(basePkg))) { dropped++; console.log(`drop ${pair.repo} ${pair.fixSha} BASE_INSTALL`); continue; }
    const before = runTest(dir, pair.testCommand, toolchain.nodePath);
    if (!before.clean) return { kept, dropped, reason: "SANDBOX_CLEAN_FAILED" };
    if (before.poison.length || before.code === null || before.code === 0) { dropped++; console.log(`drop ${pair.repo} ${pair.fixSha} before=${before.code} poison=${before.poison.join(",")}`); continue; }
    const next: PracticePair = { ...pair, beforeExit: before.code, afterExit: 0, toolchain };
    if (pairProblems(next).length) { dropped++; continue; }
    kept.push(next);
    console.log(`kept ${pair.repo} ${pair.fixSha} before=${before.code} after=0`);
  }
  return { kept, dropped, reason: null };
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) { console.log(USAGE); return; }
  if (args.includes("--reverify")) {
    const manifestPath = flag("--manifest", args);
    const outPath = flag("--out", args);
    const work = flag("--work", args);
    const reportPath = flag("--report", args);
    if (!manifestPath || !outPath || !work) { console.log(USAGE); process.exit(2); }
    if (!practiceSandboxReady()) { console.log("UNSAFE_ENV"); process.exit(1); }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PracticeManifest;
    const byRepo = new Map<string, PracticePair[]>();
    for (const line of readFileSync(outPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const pair = JSON.parse(line) as PracticePair;
      const list = byRepo.get(pair.repo) ?? [];
      list.push(pair);
      byRepo.set(pair.repo, list);
    }
    const kept: PracticePair[] = [];
    const reports: RepoReport[] = [];
    for (const repo of manifest.repos) {
      const rows = byRepo.get(repo.name) ?? [];
      const dir = join(work, repo.name.replace("/", "__"));
      if (!rows.length) continue;
      if (!ensureClone(repo, dir, "")) {
        reports.push({ name: repo.name, split: repo.split, candidates: rows.length, attempts: rows.length, kept: 0, reason: "CLONE_FAILED" });
        continue;
      }
      const result = reverifyRepo(repo, dir, rows);
      kept.push(...result.kept);
      reports.push({ name: repo.name, split: repo.split, candidates: rows.length, attempts: rows.length, kept: result.kept.length, reason: result.reason ?? (result.dropped ? "DROPPED" : null) });
      console.log(`repo ${repo.name} was=${rows.length} kept=${result.kept.length} reason=${result.reason ?? "ok"}`);
      if (result.reason) break;
    }
    writeFileSync(outPath, kept.map((pair) => JSON.stringify(pair)).join("\n") + (kept.length ? "\n" : ""));
    if (reportPath) writeFileSync(reportPath, JSON.stringify({ schema: MINE_REPORT_SCHEMA, credit: false, isolation: "bwrap", repos: reports, kept: kept.length }, null, 2) + "\n");
    console.log(`credit=false kept=${kept.length}`);
    return;
  }
  const manifestPath = flag("--manifest", args);
  const outPath = flag("--out", args);
  const work = flag("--work", args);
  const reportPath = flag("--report", args);
  const clones = flag("--clones", args) ?? "";
  const only = flag("--only", args);
  const append = args.includes("--append");
  if (!manifestPath || !outPath || !work) { console.log(USAGE); process.exit(2); }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PracticeManifest;
  if (only && !manifest.repos.some((repo) => repo.name === only)) { console.log(USAGE); process.exit(2); }
  const sandbox = practiceSandboxReady();
  if (!sandbox) console.log("UNSAFE_ENV");
  else console.log("isolation bwrap");
  console.log(`env_allow ${ENV_ALLOW.join(",")}`);
  mkdirSync(work, { recursive: true });
  const pairs: PracticePair[] = append ? readPairs(outPath) : [];
  const seen = new Set(pairs.map((pair) => `${pair.repo}\t${pair.fixSha}`));
  const reports: RepoReport[] = [];
  const total = { n: 0 };
  const flush = () => writeFileSync(outPath, pairs.map((p) => JSON.stringify(p)).join("\n") + (pairs.length ? "\n" : ""));
  for (const repo of manifest.repos) {
    if (only && repo.name !== only) continue;
    const dir = join(work, repo.name.replace("/", "__"));
    if (!ensureClone(repo, dir, clones)) {
      reports.push({ name: repo.name, split: repo.split, candidates: 0, attempts: 0, kept: 0, reason: "CLONE_FAILED" });
      console.log(`skip ${repo.name} CLONE_FAILED`);
      continue;
    }
    const report = mineRepo(repo, dir, sandbox, pairs, seen, total, flush);
    reports.push(report);
    console.log(`repo ${repo.name} split=${repo.split} candidates=${report.candidates} attempts=${report.attempts} kept=${report.kept} reason=${report.reason ?? "ok"}`);
  }
  flush();
  let repoReports = reports;
  if (append && reportPath && existsSync(reportPath)) {
    const prev = JSON.parse(readFileSync(reportPath, "utf8")) as { repos?: RepoReport[] };
    const byName = new Map((prev.repos ?? []).map((row) => [row.name, row]));
    for (const row of reports) byName.set(row.name, row);
    repoReports = [...byName.values()];
  }
  const report = { schema: MINE_REPORT_SCHEMA, credit: false as const, isolation: sandbox ? "bwrap" : "UNSAFE_ENV", repos: repoReports, kept: pairs.length };
  if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`credit=false kept=${pairs.length}`);
}

if (process.argv[1] && process.argv[1].endsWith("practice-mine.ts")) main();
