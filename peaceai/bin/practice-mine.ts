// Mixed practice miner. credit: false.
//   tsx peaceai/bin/practice-mine.ts --manifest practice/manifest.json --out practice/pairs.jsonl --work <dir outside this repo>
// Checks the root LICENSE at the pinned commit and keeps MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, and ISC.
// A pair is a non-merge commit that changes at least one non-test source and exactly one test file,
// whose test fails at the parent with that test file applied and passes at the fix.
// Tests run with an allowlisted env and no network (unshare -n, or unshare --user --map-root-user -n).
// If neither namespace works, tests are not run and the report says UNSAFE_ENV.
// Installs may use the network and always pass --ignore-scripts. Third-party source is not committed.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ENV_ALLOW, installArgv, isolationArgv, isTestFile, keptLicense, pairFiles, pairProblems, scrubEnv, testCommandFor,
  type LockFiles, type NameStatus, type PkgJson, type PracticeManifest, type PracticePair, type PracticeRepo,
  LICENSE_FILES, MINE_REPORT_SCHEMA,
} from "../lib/practicemine.ts";

const ATTEMPTS_PER_REPO = 80;
const KEEP_PER_REPO = 20;
const KEEP_TOTAL = 100;
const TEST_MS = 45_000;
const INSTALL_MS = 180_000;

const USAGE = "usage: practice-mine.ts --manifest <file> --out <pairs.jsonl> --work <dir> [--report <file>] [--clones <dir>]";

function flag(name: string, args: string[]): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith("--")) throw new Error(USAGE);
  return value;
}

function git(dir: string, args: string[], timeout = 60_000): { ok: boolean; out: string } {
  const ran = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", timeout, maxBuffer: 64 << 20 });
  return { ok: ran.status === 0, out: ran.status === 0 ? ran.stdout : "" };
}

function probe(argv: string[]): boolean {
  const ran = spawnSync(argv[0]!, argv.slice(1), { stdio: "ignore", timeout: 10_000 });
  return ran.status === 0;
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

function install(dir: string, locks: LockFiles, deps: boolean): boolean {
  const argv = installArgv(locks, deps);
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

function runTest(dir: string, cmd: string[], prefix: string[]): number | null {
  const ran = spawnSync(prefix[0]!, [...prefix.slice(1), ...cmd], {
    cwd: dir, env: scrubEnv(process.env, dir), timeout: TEST_MS, stdio: "ignore",
  });
  if (ran.error && (ran.error as NodeJS.ErrnoException).code === "ETIMEDOUT") return null;
  return ran.status;
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
  if (existsSync(join(cached, ".git"))) {
    return spawnSync("git", ["clone", "--quiet", cached, dir], { stdio: "ignore", timeout: 180_000 }).status === 0;
  }
  mkdirSync(dir, { recursive: true });
  return spawnSync("git", ["clone", "--filter=blob:none", "--quiet", `https://github.com/${repo.name}.git`, dir], { stdio: "ignore", timeout: 300_000 }).status === 0;
}

interface RepoReport { name: string; split: string; candidates: number; attempts: number; kept: number; reason: string | null }

function mineRepo(repo: PracticeRepo, dir: string, prefix: string[] | null, pairs: PracticePair[], totalCap: { n: number }): RepoReport {
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
  const file = licenseAt(dir, repo.commit);
  const spdx = keptLicense(file?.text ?? null);
  if (spdx === null || spdx !== repo.license || file?.file !== repo.licenseFile) {
    report.reason = spdx === null ? "LICENSE_MISSING" : "LICENSE_MISMATCH";
    return report;
  }
  if (!prefix) { report.reason = "UNSAFE_ENV"; return report; }
  installed = "";
  for (const candidate of found) {
    if (report.kept >= KEEP_PER_REPO || report.attempts >= ATTEMPTS_PER_REPO || totalCap.n >= KEEP_TOTAL) break;
    if (!candidate.subject) continue;
    const pkg = pkgAt(dir, candidate.fix);
    if (!pkg) continue;
    const command = testCommandFor(pkg, candidate.testFile);
    if (!command) continue;
    const locks = locksAt(dir, candidate.fix);
    report.attempts++;
    if (!checkout(dir, candidate.fix)) continue;
    if (!install(dir, locks, hasDeps(pkg))) continue;
    const after = runTest(dir, command, prefix);
    if (after !== 0) continue;
    const baseLocks = locksAt(dir, candidate.base);
    const basePkg = pkgAt(dir, candidate.base);
    if (!checkout(dir, candidate.base)) continue;
    if (!applyTest(dir, candidate.fix, candidate.testFile)) continue;
    if (!install(dir, baseLocks, basePkg ? hasDeps(basePkg) : true)) continue;
    const before = runTest(dir, command, prefix);
    if (before === null || before === 0) continue;
    const pair: PracticePair = {
      schema: "peaceai-practice-pair:v1", credit: false, repo: repo.name, license: spdx, split: repo.split,
      baseSha: candidate.base, fixSha: candidate.fix, testFile: candidate.testFile, testCommand: command,
      beforeExit: before, afterExit: after, files: candidate.files, subject: candidate.subject,
    };
    if (pairProblems(pair).length) continue;
    pairs.push(pair);
    report.kept++;
    totalCap.n++;
    console.log(`kept ${repo.name} ${candidate.fix} before=${before} after=${after}`);
  }
  return report;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) { console.log(USAGE); return; }
  const manifestPath = flag("--manifest", args);
  const outPath = flag("--out", args);
  const work = flag("--work", args);
  const reportPath = flag("--report", args);
  const clones = flag("--clones", args) ?? "";
  if (!manifestPath || !outPath || !work) { console.log(USAGE); process.exit(2); }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PracticeManifest;
  const plain = probe(["unshare", "-n", "true"]);
  const user = plain ? false : probe(["unshare", "--user", "--map-root-user", "-n", "true"]);
  const prefix = isolationArgv(plain, user);
  if (!prefix) console.log("UNSAFE_ENV");
  else console.log(`isolation ${prefix.join(" ")}`);
  console.log(`env_allow ${ENV_ALLOW.join(",")}`);
  mkdirSync(work, { recursive: true });
  const pairs: PracticePair[] = [];
  const reports: RepoReport[] = [];
  const total = { n: 0 };
  for (const repo of manifest.repos) {
    const dir = join(work, repo.name.replace("/", "__"));
    if (!ensureClone(repo, dir, clones)) {
      reports.push({ name: repo.name, split: repo.split, candidates: 0, attempts: 0, kept: 0, reason: "CLONE_FAILED" });
      console.log(`skip ${repo.name} CLONE_FAILED`);
      continue;
    }
    const report = mineRepo(repo, dir, prefix, pairs, total);
    reports.push(report);
    console.log(`repo ${repo.name} split=${repo.split} candidates=${report.candidates} attempts=${report.attempts} kept=${report.kept} reason=${report.reason ?? "ok"}`);
  }
  writeFileSync(outPath, pairs.map((p) => JSON.stringify(p)).join("\n") + (pairs.length ? "\n" : ""));
  const report = { schema: MINE_REPORT_SCHEMA, credit: false as const, isolation: prefix ? prefix.join(" ") : "UNSAFE_ENV", repos: reports, kept: pairs.length };
  if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`credit=false kept=${pairs.length}`);
}

if (process.argv[1] && process.argv[1].endsWith("practice-mine.ts")) main();
