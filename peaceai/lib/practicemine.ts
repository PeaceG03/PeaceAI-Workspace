// Mixed practice set. credit: false. Pure checks for the miner, the frozen held-out hash, and the
// training-exclusion check. Git and process spawning stay in peaceai/bin/practice-mine.ts.
// Third-party source is never written here.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statfsSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { classifyLicense, type Spdx } from "./lmcorpus.ts";

export const MANIFEST_SCHEMA = "peaceai-practice-manifest:v1";
export const PAIR_SCHEMA = "peaceai-practice-pair:v1";
export const ROOTS_SCHEMA = "peaceai-practice-corpus-roots:v1";
export const MINE_REPORT_SCHEMA = "peaceai-practice-mine-report:v1";
export const HELD_OUT_HASH_PREFIX = "peaceai-practice-heldout:v1\n";
export const HELD_OUT_PAIR_PREFIX = "peaceai-practice-heldout-pairs:v1\n";

/** Root LICENSE names, in preference order. Only a file at the repo root counts. */
export const LICENSE_FILES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING", "license", "license.md", "license.txt", "copying"] as const;

const SHA = /^[0-9a-f]{40}$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;

export function keptLicense(text: string | null): Spdx | null {
  if (text === null || text.length === 0) return null;
  return classifyLicense(text);
}

/** A test file the miner can point a single command at. Declarations and build output are not tests. */
export function isTestFile(path: string): boolean {
  if (!/\.(?:tsx?|mts|cts)$/.test(path) || path.endsWith(".d.ts")) return false;
  if (/(^|\/)(?:dist|build|coverage|node_modules)\//.test(path)) return false;
  if (/\.(?:test|spec)\.(?:tsx?|mts|cts)$/.test(path)) return true;
  return /(^|\/)(?:__tests__|tests?)\/.+\.(?:tsx?|mts|cts)$/.test(path);
}

/** A non-test TypeScript source file. */
export function isSourceFile(path: string): boolean {
  if (!/\.(?:tsx?|mts|cts)$/.test(path) || path.endsWith(".d.ts")) return false;
  if (/(^|\/)(?:dist|build|coverage|node_modules)\//.test(path)) return false;
  return !isTestFile(path);
}

export interface NameStatus { status: string; path: string }

/**
 * A candidate changes at least one non-test source and exactly one test file (added or modified).
 * One test file keeps the recorded command pointed at the file the fix actually changed.
 * Renames and deletions are not a fail-before/pass-after pair.
 */
export function pairFiles(rows: readonly NameStatus[]): { testFile: string; sources: string[] } | null {
  const tests: string[] = [];
  const sources: string[] = [];
  for (const row of rows) {
    if (row.status !== "A" && row.status !== "M") continue;
    if (isTestFile(row.path)) tests.push(row.path);
    else if (isSourceFile(row.path)) sources.push(row.path);
  }
  if (tests.length !== 1 || sources.length < 1) return null;
  return { testFile: tests[0]!, sources };
}

export interface PkgJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  packageManager?: string;
}

function hasDep(pkg: PkgJson, name: string): boolean {
  return !!pkg.dependencies?.[name] || !!pkg.devDependencies?.[name];
}

/**
 * Argv of one test file. Null when the package does not name a runner we can point at a file.
 * The caller spawns this argv and never a shell.
 */
export function testCommandFor(pkg: PkgJson, testFile: string): string[] | null {
  if (!testFile || testFile.includes("\0")) return null;
  const script = pkg.scripts?.test ?? "";
  const named = (bin: string) => hasDep(pkg, bin) || new RegExp(`\\b${bin}\\b`).test(script);
  if (/\bnode\b/.test(script) && /--test\b/.test(script)) {
    const args = ["node"];
    for (const flag of ["--experimental-transform-types", "--experimental-strip-types"]) {
      if (script.includes(flag)) args.push(flag);
    }
    args.push("--test", testFile);
    return args;
  }
  if (named("vitest")) return ["./node_modules/.bin/vitest", "run", testFile];
  if (named("jest")) return ["./node_modules/.bin/jest", "--watchAll=false", "--forceExit", testFile];
  if (named("mocha")) return ["./node_modules/.bin/mocha", testFile];
  if (named("ava")) return ["./node_modules/.bin/ava", testFile];
  if (named("tsx") || /\btsx\b/.test(script)) return ["./node_modules/.bin/tsx", "--test", testFile];
  return null;
}

export interface LockFiles { npm: boolean; pnpm: boolean; yarn: boolean }

/** Install argv. `--ignore-scripts` so a package's install hooks do not run. Null when there is nothing to install. */
export function installArgv(locks: LockFiles, hasDeps: boolean, yarnModern = false): string[] | null {
  if (!hasDeps && !locks.npm && !locks.pnpm && !locks.yarn) return null;
  if (locks.pnpm) return ["pnpm", "install", "--ignore-scripts"];
  if (locks.yarn) return yarnModern ? ["corepack", "yarn", "install", "--mode=skip-build"] : ["corepack", "yarn", "install", "--ignore-scripts"];
  if (locks.npm) return ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"];
  return ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"];
}

/** Yarn 2 and later reject `--ignore-scripts`. `packageManager: yarn@2+` selects the corepack mode that skips builds. */
export function yarnIsModern(pkg: { packageManager?: string } | null | undefined): boolean {
  const spec = pkg?.packageManager ?? "";
  const match = /^yarn@(\d+)/.exec(spec);
  return match !== null && Number(match[1]) >= 2;
}

/**
 * Env for third-party code. An allowlist, not a denylist: anything not named here is absent,
 * including tokens, cloud keys, and git identity.
 */
export const ENV_ALLOW = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE", "USER", "LOGNAME", "SHELL", "TERM", "TZ", "PWD"] as const;

export function scrubEnv(src: NodeJS.ProcessEnv, cwd: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { PWD: cwd };
  for (const key of ENV_ALLOW) {
    if (key === "PWD") continue;
    const value = src[key];
    if (typeof value === "string" && value.length > 0 && value.length < 4096 && !value.includes("\0")) out[key] = value;
  }
  if (!out.PATH) out.PATH = "/usr/local/bin:/usr/bin:/bin";
  return out;
}

/** A node binary whose directory we can mount without mounting /home or /opt. Node 22 is preferred: listhen's https tests fail on Node 24. */
export function visibleNodeBin(): string | null {
  const hidden = (path: string) => path.startsWith("/home/") || path.startsWith("/root/") || path.startsWith("/opt/") || path.startsWith("/var/");
  for (const path of ["/exec-daemon/node", process.execPath, "/usr/local/bin/node", "/usr/bin/node"]) {
    if (!path || !isAbsolute(path) || !existsSync(path) || hidden(path)) continue;
    return path;
  }
  return null;
}

let gitCover: string | null = null;
let gitFile: string | null = null;
function emptyGitCover(): string {
  if (gitCover && existsSync(gitCover)) return gitCover;
  gitCover = mkdtempSync(join(tmpdir(), "peaceai-git-cover-"));
  return gitCover;
}
function emptyGitFile(): string {
  if (gitFile && existsSync(gitFile)) return gitFile;
  gitFile = join(tmpdir(), "peaceai-git-cover-file");
  if (!existsSync(gitFile)) writeFileSync(gitFile, "");
  return gitFile;
}

function roMount(args: string[], path: string): void {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) args.push("--symlink", readlinkSync(path), path);
  else if (stat.isDirectory()) args.push("--ro-bind", path, path);
}

/**
 * Allowlist bubblewrap. The host root is not mounted. A `.git` directory is covered by an empty
 * read-only directory, and a worktree `.git` file (`gitdir: ...`) by an empty read-only file.
 * There is no unshare fallback.
 */
export function practiceSandboxArgv(workDir: string, opts: { nodePath?: string | null; nodeModules?: string | null } = {}): string[] | null {
  if (!isAbsolute(workDir)) return null;
  const nodePath = opts.nodePath ?? visibleNodeBin();
  if (!nodePath || !isAbsolute(nodePath) || !existsSync(nodePath)) return null;
  const args = ["bwrap"];
  roMount(args, "/usr");
  roMount(args, "/bin");
  roMount(args, "/lib");
  roMount(args, "/lib64");
  args.push("--dir", "/etc");
  for (const file of ["/etc/passwd", "/etc/group", "/etc/nsswitch.conf", "/etc/hosts", "/etc/resolv.conf"]) {
    if (existsSync(file) && lstatSync(file).isFile()) args.push("--ro-bind", file, file);
  }
  if (existsSync("/etc/ssl") && lstatSync("/etc/ssl").isDirectory()) args.push("--ro-bind", "/etc/ssl", "/etc/ssl");
  const nodeDir = dirname(nodePath);
  if (!nodeDir.startsWith("/usr/") && nodeDir !== "/usr") {
    args.push("--dir", nodeDir, "--ro-bind", nodePath, nodePath);
  }
  args.push("--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp");
  args.push("--bind", workDir, workDir);
  const gitMeta = join(workDir, ".git");
  if (existsSync(gitMeta)) {
    // A normal clone has a directory. A worktree has a file (`gitdir: ...`). Mounting a directory
    // onto that file makes bwrap fail before the test starts.
    const gitStat = lstatSync(gitMeta);
    if (gitStat.isDirectory()) args.push("--ro-bind", emptyGitCover(), gitMeta);
    else if (gitStat.isFile()) args.push("--ro-bind", emptyGitFile(), gitMeta);
  }
  const modulesLink = join(workDir, "node_modules");
  const modules = opts.nodeModules && existsSync(opts.nodeModules) ? opts.nodeModules : existsSync(modulesLink) ? modulesLink : null;
  if (modules) {
    const source = realpathSync(modules);
    const linkStat = existsSync(modulesLink) ? lstatSync(modulesLink) : null;
    if (linkStat?.isSymbolicLink()) args.push("--ro-bind", source, source);
    else args.push("--ro-bind", source, modulesLink);
    for (const cache of [".vite", ".vitest", ".cache"]) {
      const cacheDir = join(source, cache);
      mkdirSync(cacheDir, { recursive: true });
      args.push("--tmpfs", cacheDir);
    }
  }
  args.push("--unshare-net", "--unshare-pid", "--die-with-parent", "--new-session", "--chdir", workDir, "--");
  return args;
}

export function sandboxHome(workDir: string): string {
  return join(workDir, ".practice-home");
}

export const SANDBOX_RAN = ".practice-sandbox-ran";

export interface SandboxRun { unsafe: boolean; code: number | null; stdout: string }

export interface SandboxOpts { bwrap?: string; capture?: boolean; nodePath?: string | null; nodeModules?: string | null }

/** Run `cmd` inside the practice sandbox. `unsafe` means bwrap is missing or the sandbox could not be created. */
export function runInPracticeSandbox(workDir: string, cmd: readonly string[], timeoutMs: number, opts: SandboxOpts = {}): SandboxRun {
  const prefix = practiceSandboxArgv(workDir, { nodePath: opts.nodePath, nodeModules: opts.nodeModules });
  if (!prefix) return { unsafe: true, code: null, stdout: "" };
  if (opts.bwrap) prefix[0] = opts.bwrap;
  const home = sandboxHome(workDir);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(workDir, SANDBOX_RAN), "1\n");
  const nodePath = opts.nodePath ?? visibleNodeBin() ?? "/usr/bin/node";
  const env = scrubEnv(process.env, workDir);
  env.HOME = home;
  env.TMPDIR = home;
  env.TMP = home;
  env.TEMP = home;
  env.PATH = `${join(workDir, "node_modules", ".bin")}:${dirname(nodePath)}:/usr/bin:/bin`;
  const ran = spawnSync(prefix[0]!, [...prefix.slice(1), ...cmd], {
    cwd: workDir, env, timeout: timeoutMs, encoding: "utf8",
    stdio: opts.capture ? ["ignore", "pipe", "pipe"] : "ignore",
  });
  const err = ran.error as NodeJS.ErrnoException | undefined;
  if (err?.code === "ENOENT" || (ran.status === null && err && err.code !== "ETIMEDOUT")) return { unsafe: true, code: null, stdout: "" };
  const stdout = opts.capture ? `${ran.stdout ?? ""}${ran.stderr ?? ""}` : "";
  return { unsafe: false, code: err?.code === "ETIMEDOUT" ? null : ran.status, stdout };
}

/** True when bwrap can build the sandbox and run a command. Cached for the process. */
let sandboxReady: boolean | null = null;
export function practiceSandboxReady(force = false): boolean {
  if (sandboxReady !== null && !force) return sandboxReady;
  const node = visibleNodeBin();
  if (!node) { sandboxReady = false; return false; }
  const dir = mkdtempSync(join(tmpdir(), "peaceai-sandbox-probe-"));
  try {
    const ran = runInPracticeSandbox(dir, [node, "-e", "process.exit(0)"], 15_000);
    sandboxReady = !ran.unsafe && ran.code === 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return sandboxReady;
}

/** Git outside the sandbox never runs hooks or an fsmonitor, and never reads the host or repo git config. */
export const GIT_LOCK_ARGS = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"] as const;

export function practiceGitEnv(): NodeJS.ProcessEnv {
  const file = join(tmpdir(), "peaceai-practice-gitconfig");
  if (!existsSync(file)) writeFileSync(file, "");
  const env = scrubEnv(process.env, tmpdir());
  env.GIT_CONFIG_GLOBAL = file;
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_SYSTEM = "/dev/null";
  return env;
}

export function practiceGit(dir: string, args: readonly string[], timeout = 60_000): { ok: boolean; out: string; status: number | null } {
  const ran = spawnSync("git", ["-C", dir, ...GIT_LOCK_ARGS, ...args], {
    encoding: "utf8", timeout, maxBuffer: 64 << 20, env: practiceGitEnv(),
  });
  const err = ran.error as NodeJS.ErrnoException | undefined;
  return { ok: ran.status === 0 && !err, out: ran.status === 0 ? ran.stdout ?? "" : "", status: err ? null : ran.status };
}

/**
 * A solver tree is a new repository holding only `sha`, detached, with none of the clone's other
 * commits or refs. The fix commit is not reachable from it.
 */
export function materializeSolverTree(repoDir: string, sha: string, dest: string): boolean {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  if (!practiceGit(dest, ["init", "-q"]).ok) return false;
  const remote = `file://${repoDir}`;
  const fetched = spawnSync("git", ["-C", dest, ...GIT_LOCK_ARGS, "fetch", "--depth", "1", "--no-tags", remote, sha], {
    env: practiceGitEnv(), encoding: "utf8", timeout: 60_000,
  });
  if (fetched.status !== 0) return false;
  if (!practiceGit(dest, ["checkout", "--detach", "FETCH_HEAD"]).ok) return false;
  sealSolverTree(dest);
  const head = practiceGit(dest, ["rev-parse", "HEAD"]);
  return head.ok && head.out.trim() === sha;
}

/** Drop the fetch URL, remotes, reflogs, and packed remote refs so the solver cannot ask the clone for fixSha. */
function sealSolverTree(dest: string): void {
  const gitDir = join(dest, ".git");
  rmSync(join(gitDir, "FETCH_HEAD"), { force: true });
  rmSync(join(gitDir, "logs"), { recursive: true, force: true });
  rmSync(join(gitDir, "refs", "remotes"), { recursive: true, force: true });
  const packed = join(gitDir, "packed-refs");
  if (existsSync(packed)) {
    const kept = readFileSync(packed, "utf8").split("\n").filter((line) => line.startsWith("#") || (!line.includes("file://") && !line.includes("refs/remotes/")));
    writeFileSync(packed, kept.filter(Boolean).join("\n") + (kept.some(Boolean) ? "\n" : ""));
  }
  const remotes = practiceGit(dest, ["remote"]).out.split("\n").map((name) => name.trim()).filter(Boolean);
  for (const name of remotes) practiceGit(dest, ["remote", "remove", name]);
}

/** Write one blob from `sha` into `destDir`. The destination repository does not gain that commit. */
export function writeCommitFile(repoDir: string, sha: string, file: string, destDir: string): boolean {
  const ran = practiceGit(repoDir, ["show", `${sha}:${file}`]);
  if (!ran.ok) return false;
  const path = join(destDir, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, ran.out);
  return true;
}

const POISON_EXACT = new Set([".pnpmfile.cjs", ".npmrc", "package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"]);

const STAMP_MAX = 1 << 20;

function stampFile(path: string): string {
  if (!existsSync(path)) return "absent";
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return `link:${readlinkSync(path)}`;
  if (stat.isDirectory()) return "dir";
  // A fifo, socket, or device must not be read: opening it can block. It is still poison.
  if (!stat.isFile()) return "special";
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const size = Math.min(stat.size, STAMP_MAX);
    const buf = Buffer.alloc(size);
    const n = size === 0 ? 0 : readSync(fd, buf, 0, size, 0);
    return createHash("sha256").update(buf.subarray(0, n)).digest("hex");
  } finally {
    closeSync(fd);
  }
}

/** Files a sandboxed test must not leave behind for a later install or git command. */
export function poisonStamp(dir: string): Record<string, string> {
  const stamp: Record<string, string> = {};
  const add = (rel: string) => { stamp[rel] = stampFile(join(dir, rel)); };
  if (!existsSync(dir)) return stamp;
  for (const name of readdirSync(dir)) {
    if (POISON_EXACT.has(name) || name.startsWith(".yarnrc") || name.startsWith(".pnpmfile")) add(name);
  }
  for (const name of POISON_EXACT) if (!(name in stamp)) add(name);
  const git = join(dir, ".git");
  add(".git");
  add(".git/config");
  const hooks = join(git, "hooks");
  if (existsSync(hooks) && lstatSync(hooks).isDirectory()) {
    for (const name of readdirSync(hooks)) add(`.git/hooks/${name}`);
  }
  return stamp;
}

export function poisonChanges(before: Readonly<Record<string, string>>, after: Readonly<Record<string, string>>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => before[key] !== after[key]).sort();
}

/** Reset a work tree after a sandboxed test. A poison path refuses the next outside step. */
export function releaseWorktree(dir: string, before: Readonly<Record<string, string>>): { poison: string[]; clean: boolean } {
  const poison = poisonChanges(before, poisonStamp(dir));
  const clean = practiceGit(dir, ["clean", "-ffdx"]).ok;
  const checkout = practiceGit(dir, ["checkout", "-f"]).ok;
  return { poison, clean: clean && checkout };
}

export interface PracticeToolchain {
  nodePath: string;
  nodeVersion: string;
  manager: "npm" | "pnpm" | "yarn" | "none";
  managerVersion: string;
}

export function currentToolchain(manager: PracticeToolchain["manager"]): PracticeToolchain | null {
  const nodePath = visibleNodeBin();
  if (!nodePath) return null;
  const nodeVersion = spawnSync(nodePath, ["-p", "process.version"], { encoding: "utf8" }).stdout?.trim() ?? "";
  if (!/^v\d+\.\d+\.\d+/.test(nodeVersion)) return null;
  if (manager === "none") return { nodePath, nodeVersion, manager, managerVersion: "none" };
  const argv = manager === "yarn" ? ["corepack", "yarn", "--version"] : [manager, "--version"];
  const managerVersion = spawnSync(argv[0]!, argv.slice(1), { encoding: "utf8" }).stdout?.trim() ?? "";
  if (!managerVersion || managerVersion.includes("\n")) return null;
  return { nodePath, nodeVersion, manager, managerVersion };
}

const HOME_DIR = new RegExp("/" + "ho" + "me/[^/\\s]+", "g");
const USERS_DIR = new RegExp("/" + "Users/[^/\\s]+", "g");
const HOME_WORD = "/" + "ho" + "me/" + "user";
const USERS_WORD = "/" + "Users/" + "user";

/** Drop tokens, credentials, and home directories from an install log. Error lines come first. */
export function sanitizeInstallLines(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    let line = raw.replace(/\u001b\[[0-9;]*m/g, "");
    line = line.replace(HOME_DIR, HOME_WORD).replace(USERS_DIR, USERS_WORD);
    line = line.replace(/(?:ghp_|github_pat_|npm_|ghs_)[A-Za-z0-9_]+/g, "[redacted]");
    line = line.replace(/:\/\/[^/\s:@]+:[^@\s/]+@/g, "://");
    line = line.trim();
    if (!line) continue;
    lines.push(line.slice(0, 240));
    if (lines.length >= 80) break;
  }
  const urgent = /EUSAGE|ERR!|\berror\b/i;
  return [...lines.filter((line) => urgent.test(line)), ...lines.filter((line) => !urgent.test(line))].slice(0, 12);
}

export function frozenInstallArgv(manager: PracticeToolchain["manager"], locks: LockFiles, yarnModern: boolean): string[] | null {
  if (manager === "none") return null;
  if (manager === "pnpm") return ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"];
  if (manager === "yarn") return yarnModern ? ["corepack", "yarn", "install", "--immutable", "--mode=skip-build"] : ["corepack", "yarn", "install", "--frozen-lockfile", "--ignore-scripts"];
  if (locks.npm) return ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"];
  return ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"];
}

export interface PracticeInstall { ok: boolean; modules: string | null; reason: string | null; lines: string[]; fingerprint?: string }

/** One install per dependency fingerprint. Above this, the least recently used install is removed. */
export const INSTALL_MAX_ENTRIES = 12;
/** Default install timeout. A caller can override it; a hit is INSTALL_TIMEOUT, not INSTALL_FAILED. */
export const INSTALL_TIMEOUT_MS = 180_000;
/** Refuse a new install when the cache filesystem is below either of these. */
export const INSTALL_MIN_BYTES = 5 * 1024 * 1024 * 1024;
export const INSTALL_MIN_INODES = 200_000;

export function dependencyFingerprint(packageJson: string, lockfile: string, toolchain: Pick<PracticeToolchain, "manager" | "managerVersion" | "nodeVersion">): string {
  return createHash("sha256")
    .update("peaceai-practice-deps:v1\n")
    .update(toolchain.manager).update("\0")
    .update(toolchain.managerVersion).update("\0")
    .update(toolchain.nodeVersion).update("\0")
    .update(packageJson).update("\0")
    .update(lockfile)
    .digest("hex");
}

export function cacheSpace(path: string): { freeBytes: number; freeInodes: number } {
  mkdirSync(path, { recursive: true });
  const stat = statfsSync(path);
  return { freeBytes: Number(stat.bavail) * Number(stat.bsize), freeInodes: Number(stat.ffree) };
}

export function spaceAllowsInstall(space: { freeBytes: number; freeInodes: number }, minBytes = INSTALL_MIN_BYTES, minInodes = INSTALL_MIN_INODES): boolean {
  return space.freeBytes >= minBytes && space.freeInodes >= minInodes;
}

export function installEnv(nodePath: string, home: string, store: string, manager: PracticeToolchain["manager"]): NodeJS.ProcessEnv {
  mkdirSync(home, { recursive: true });
  const npmrc = join(home, "npmrc");
  if (!existsSync(npmrc)) writeFileSync(npmrc, "");
  const env = scrubEnv(process.env, home);
  env.HOME = home;
  env.TMPDIR = home;
  env.TMP = home;
  env.TEMP = home;
  env.PATH = `${dirname(nodePath)}:${env.PATH ?? "/usr/bin:/bin"}`;
  env.npm_config_userconfig = npmrc;
  env.NPM_CONFIG_USERCONFIG = npmrc;
  env.COREPACK_HOME = join(home, "corepack");
  env.GIT_CONFIG_GLOBAL = join(tmpdir(), "peaceai-practice-gitconfig");
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_SYSTEM = "/dev/null";
  env.GIT_SSH_COMMAND = "false";
  const managerStore = join(store, manager === "pnpm" ? "pnpm" : manager === "yarn" ? "yarn" : "npm");
  mkdirSync(managerStore, { recursive: true });
  if (manager === "npm") env.npm_config_cache = managerStore;
  if (manager === "pnpm") env.npm_config_store_dir = managerStore;
  if (manager === "yarn") env.YARN_CACHE_FOLDER = managerStore;
  return env;
}

function lockfileName(manager: PracticeToolchain["manager"], locks: LockFiles): string | null {
  if (manager === "pnpm" && locks.pnpm) return "pnpm-lock.yaml";
  if (manager === "yarn" && locks.yarn) return "yarn.lock";
  if (manager === "npm" && locks.npm) return "package-lock.json";
  if (locks.pnpm) return "pnpm-lock.yaml";
  if (locks.yarn) return "yarn.lock";
  if (locks.npm) return "package-lock.json";
  return null;
}

function touchUsed(dir: string): void {
  writeFileSync(join(dir, ".practice-used"), `${Date.now()}\n`);
}

function installLock(cacheRoot: string, fingerprint: string): string {
  return join(cacheRoot, "locks", `${fingerprint}.lock`);
}

/** Drop unfinished installs, then the least recently used finished ones. A live lock is left in place. */
function pruneInstalls(cacheRoot: string, max: number): void {
  const locked = withLock(join(cacheRoot, ".practice-cache.lock"), () => {
    const root = join(cacheRoot, "installs");
    if (!existsSync(root)) return;
    const rows: { name: string; used: number }[] = [];
    for (const name of readdirSync(root)) {
      const fingerprint = name.endsWith(".partial") ? name.slice(0, -".partial".length) : name;
      const lock = installLock(cacheRoot, fingerprint);
      if (existsSync(lock) && !lockIsStale(lock)) continue;
      const dir = join(root, name);
      const finished = !name.endsWith(".partial") && existsSync(join(dir, INSTALL_COMPLETE)) && existsSync(join(dir, "node_modules"));
      if (!finished) {
        rmSync(dir, { recursive: true, force: true });
        continue;
      }
      const used = join(dir, ".practice-used");
      rows.push({ name, used: existsSync(used) ? lstatSync(used).mtimeMs : 0 });
    }
    rows.sort((a, b) => a.used - b.used);
    while (rows.length >= max) {
      const oldest = rows.shift();
      if (!oldest) break;
      rmSync(join(root, oldest.name), { recursive: true, force: true });
    }
  });
  if (isBusy(locked)) return;
}

export interface InstallCacheOptions {
  maxInstalls?: number;
  /** Override the filesystem check. Tests use this to simulate a full disk. */
  space?: () => { freeBytes: number; freeInodes: number };
  minBytes?: number;
  minInodes?: number;
  timeoutMs?: number;
}

const LOCK_STALE_MS = 30 * 60 * 1000;
/** An empty lock is busy until this long after its mtime, then it may be taken over. */
export const LOCK_EMPTY_GRACE_MS = 30_000;
const INSTALL_COMPLETE = ".practice-complete";

function lockOwnerAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Start-time token from /proc, so a recycled pid is not the lock owner. */
export function processStartId(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const end = stat.lastIndexOf(")");
    if (end < 0) return null;
    const start = stat.slice(end + 2).trim().split(/\s+/)[19];
    return start && /^\d+$/.test(start) ? start : null;
  } catch { return null; }
}

/**
 * A live owner's lock is never taken over. Age applies only after the owner is dead.
 * An empty or unwritten lock stays busy until LOCK_EMPTY_GRACE_MS after its mtime.
 */
function lockIsStale(path: string): boolean {
  try {
    const text = readFileSync(path, "utf8");
    const mtime = lstatSync(path).mtimeMs;
    const [pidText, tsText, startText] = text.trim().split(/\s+/);
    const pid = Number(pidText);
    const ts = Number(tsText);
    if (!text.trim() || !Number.isInteger(pid) || pid <= 0 || !Number.isFinite(ts)) return Date.now() - mtime > LOCK_EMPTY_GRACE_MS;
    if (lockOwnerAlive(pid)) {
      const start = processStartId(pid);
      if (!startText || !start || startText === start) return false;
    }
    return Date.now() - ts > LOCK_STALE_MS;
  } catch { return true; }
}

/** Exclusive lock. Only a dead owner's lock, and only after 30 minutes, is taken over. */
function withLock<T>(path: string, fn: () => T): T | { busy: true } {
  mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      const start = processStartId(process.pid) ?? "0";
      writeSync(fd, `${process.pid} ${Date.now()} ${start}\n`);
      closeSync(fd);
      try { return fn(); } finally { rmSync(path, { force: true }); }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (lockIsStale(path)) { rmSync(path, { force: true }); continue; }
      return { busy: true };
    }
  }
  return { busy: true };
}

function isBusy<T>(value: T | { busy: true }): value is { busy: true } {
  return !!value && typeof value === "object" && "busy" in value;
}

/**
 * Install dependencies for one fingerprint, outside any sandbox work tree.
 * Layout: `<cacheRoot>/stores/<npm|pnpm|yarn>` is the shared download store, and
 * `<cacheRoot>/installs/<fingerprint>/` holds only package.json, the lockfile, and node_modules.
 * The files come from `git archive` of the base commit, not from a later fix.
 */
export function ensurePracticeInstall(
  repoDir: string,
  pair: Pick<PracticePair, "repo" | "baseSha" | "toolchain">,
  cacheRoot: string,
  locks: LockFiles,
  yarnModern: boolean,
  opts: InstallCacheOptions = {},
): PracticeInstall {
  try {
    if (!existsSync(pair.toolchain.nodePath)) return { ok: false, modules: null, reason: "TOOLCHAIN_MISSING", lines: [] };
    const pinned = practiceGit(repoDir, ["rev-parse", "--verify", `${pair.baseSha}^{commit}`]);
    if (!pinned.ok || pinned.out.trim() !== pair.baseSha) return { ok: false, modules: null, reason: "INSTALL_FAILED", lines: ["base commit is not in the clone"] };
    const lock = lockfileName(pair.toolchain.manager, locks);
    const paths = ["package.json", ...(lock ? [lock] : [])];
    const scratch = mkdtempSync(join(tmpdir(), "peaceai-deps-"));
    try {
      const archived = spawnSync("git", ["-C", repoDir, ...GIT_LOCK_ARGS, "archive", "--format=tar", pair.baseSha, "--", ...paths], {
        env: practiceGitEnv(), maxBuffer: 64 << 20, timeout: 60_000,
      });
      if (archived.status !== 0 || !archived.stdout) return { ok: false, modules: null, reason: "INSTALL_FAILED", lines: sanitizeInstallLines(`${archived.stderr ?? ""}`) };
      if (spawnSync("tar", ["-x", "-C", scratch], { input: archived.stdout, timeout: 60_000 }).status !== 0) return { ok: false, modules: null, reason: "INSTALL_FAILED", lines: ["could not extract package.json and the lockfile"] };
      const packageJson = readFileSync(join(scratch, "package.json"), "utf8");
      const lockText = lock && existsSync(join(scratch, lock)) ? readFileSync(join(scratch, lock), "utf8") : "";
      const fingerprint = dependencyFingerprint(packageJson, lockText, pair.toolchain);
      const dest = join(cacheRoot, "installs", fingerprint);
      const modules = join(dest, "node_modules");
      const ready = (): PracticeInstall | null => {
        if (existsSync(join(dest, SANDBOX_RAN))) return { ok: false, modules: null, reason: "SANDBOX_POISON", lines: ["install dir was used by a sandboxed test"], fingerprint };
        if (existsSync(join(dest, INSTALL_COMPLETE)) && existsSync(modules)) {
          touchUsed(dest);
          return { ok: true, modules, reason: null, lines: [], fingerprint };
        }
        return null;
      };
      const reuse = ready();
      if (reuse) return reuse;
      const space = (opts.space ?? (() => cacheSpace(cacheRoot)))();
      if (!spaceAllowsInstall(space, opts.minBytes, opts.minInodes)) return { ok: false, modules: null, reason: "INSTALL_SKIPPED_NO_SPACE", lines: [`free bytes ${space.freeBytes}`, `free inodes ${space.freeInodes}`], fingerprint };
      const held = withLock(installLock(cacheRoot, fingerprint), () => {
        const again = ready();
        if (again) return again;
        if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
        pruneInstalls(cacheRoot, opts.maxInstalls ?? INSTALL_MAX_ENTRIES);
        const partial = `${dest}.partial`;
        rmSync(partial, { recursive: true, force: true });
        mkdirSync(partial, { recursive: true });
        writeFileSync(join(partial, "package.json"), packageJson);
        if (lock && lockText) writeFileSync(join(partial, lock), lockText);
        const argv = frozenInstallArgv(pair.toolchain.manager, locks, yarnModern);
        const finish = (): PracticeInstall => {
          writeFileSync(join(partial, INSTALL_COMPLETE), `${fingerprint}\n`);
          touchUsed(partial);
          renameSync(partial, dest);
          return { ok: true, modules: join(dest, "node_modules"), reason: null, lines: [], fingerprint };
        };
        if (!argv) {
          mkdirSync(join(partial, "node_modules"), { recursive: true });
          return finish();
        }
        const store = join(cacheRoot, "stores");
        const managerStore = join(store, pair.toolchain.manager === "pnpm" ? "pnpm" : pair.toolchain.manager === "yarn" ? "yarn" : "npm");
        const withStore = pair.toolchain.manager === "npm" ? [...argv, "--cache", managerStore]
          : pair.toolchain.manager === "pnpm" ? [...argv, "--store-dir", managerStore]
          : pair.toolchain.manager === "yarn" ? [...argv, "--cache-folder", managerStore]
          : argv;
        const home = mkdtempSync(join(tmpdir(), "peaceai-install-home-"));
        try {
          const ran = spawnSync(withStore[0]!, withStore.slice(1), {
            cwd: partial, env: installEnv(pair.toolchain.nodePath, home, store, pair.toolchain.manager), encoding: "utf8", timeout: opts.timeoutMs ?? INSTALL_TIMEOUT_MS, maxBuffer: 8 << 20,
          });
          const output = `${ran.error?.message ?? ""}\n${ran.stdout ?? ""}\n${ran.stderr ?? ""}`;
          if (ran.error && (ran.error as NodeJS.ErrnoException).code === "ETIMEDOUT") return { ok: false, modules: null, reason: "INSTALL_TIMEOUT", lines: sanitizeInstallLines(output), fingerprint };
          if (ran.error && (ran.error as NodeJS.ErrnoException).code === "ENOSPC") return { ok: false, modules: null, reason: "INSTALL_SKIPPED_NO_SPACE", lines: ["no space left on the install cache"], fingerprint };
          if (/git\+ssh:|ssh:\/\/|Could not read from remote repository|Permission denied \(publickey\)/i.test(output)) return { ok: false, modules: null, reason: "network_required", lines: sanitizeInstallLines(output), fingerprint };
          if (ran.status !== 0) {
            const reason = /EUSAGE/.test(output) ? "BASE_NOT_FROZEN_INSTALLABLE" : "INSTALL_FAILED";
            return { ok: false, modules: null, reason, lines: sanitizeInstallLines(output), fingerprint };
          }
        } finally {
          rmSync(home, { recursive: true, force: true });
        }
        if (!existsSync(join(partial, "node_modules"))) return { ok: false, modules: null, reason: "INSTALL_FAILED", lines: ["install produced no node_modules"], fingerprint };
        return finish();
      });
      if (isBusy(held)) return { ok: false, modules: null, reason: "INSTALL_FAILED", lines: ["install lock is busy"], fingerprint };
      if (!held.ok) rmSync(`${dest}.partial`, { recursive: true, force: true });
      return held;
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOSPC") return { ok: false, modules: null, reason: "INSTALL_SKIPPED_NO_SPACE", lines: ["no space left on the install cache"] };
    return { ok: false, modules: null, reason: "INSTALL_FAILED", lines: sanitizeInstallLines((err as Error).message ?? "") };
  }
}

export function toolchainProblems(value: unknown): string[] {
  if (!value || typeof value !== "object") return ["pair_toolchain"];
  const tool = value as Partial<PracticeToolchain>;
  const problems: string[] = [];
  if (typeof tool.nodePath !== "string" || !isAbsolute(tool.nodePath) || /[\0\n]/.test(tool.nodePath)) problems.push("pair_node_path");
  if (typeof tool.nodeVersion !== "string" || !/^v\d+\.\d+\.\d+/.test(tool.nodeVersion)) problems.push("pair_node_version");
  if (tool.manager !== "npm" && tool.manager !== "pnpm" && tool.manager !== "yarn" && tool.manager !== "none") problems.push("pair_manager");
  if (typeof tool.managerVersion !== "string" || tool.managerVersion.length < 1 || tool.managerVersion.includes("\n")) problems.push("pair_manager_version");
  return problems;
}

export interface RemoteIdentity {
  remoteUrl: string | null;
  /** The sole root commit, when the history has one. Null when there are several; see `roots`. */
  root: string | null;
  /** Every root commit (`git rev-list --max-parents=0 HEAD`), sorted. */
  roots?: readonly string[];
  parent: string | null;
  source: string | null;
  upstreamRoot: string | null;
  upstreamRoots?: readonly string[];
}

export function repoFromRemote(url: string): string | null {
  const match = url.trim().replace(/\.git$/, "").match(/github\.com[:/]([\w.-]+\/[\w.-]+)$/i);
  return match ? match[1]! : null;
}

function commitList(text: string): string[] {
  return [...new Set(text.split("\n").map((line) => line.trim()).filter((line) => /^[0-9a-f]{40}$/.test(line)))].sort();
}

/** Root commits of HEAD. A later tip is not a root. Several roots are all returned. */
export function rootCommits(dir: string, rev = "HEAD"): string[] {
  const ran = practiceGit(dir, ["rev-list", "--max-parents=0", rev]);
  return ran.ok ? commitList(ran.out) : [];
}

/** Remote and root commits of one local clone. The tip commit is not the root. */
export function readCloneIdentity(dir: string): RemoteIdentity | null {
  if (!existsSync(join(dir, ".git"))) return null;
  const remote = practiceGit(dir, ["remote", "get-url", "origin"]);
  const remoteUrl = remote.ok ? remote.out.trim() : null;
  const roots = rootCommits(dir);
  const root = roots.length === 1 ? roots[0]! : null;
  const upstreamUrl = practiceGit(dir, ["remote", "get-url", "upstream"]);
  const parent = upstreamUrl.ok ? repoFromRemote(upstreamUrl.out.trim()) : null;
  let upstreamRoots: string[] = [];
  if (parent && practiceGit(dir, ["rev-parse", "--verify", "--quiet", "refs/remotes/upstream/HEAD"]).ok) {
    upstreamRoots = rootCommits(dir, "refs/remotes/upstream/HEAD");
  }
  const upstreamRoot = upstreamRoots.length === 1 ? upstreamRoots[0]! : null;
  if (!remoteUrl && roots.length === 0) return null;
  return { remoteUrl, root, roots, parent, source: parent, upstreamRoot, ...(upstreamRoots.length ? { upstreamRoots } : {}) };
}

/** One identity per recorded root. A missing clone is null, which falseRootProblems reports as CLONE_UNVERIFIED. */
export function identitiesForRoots(recorded: Readonly<Record<string, string | null>>, clonesDir: string): Record<string, RemoteIdentity | null> {
  const out: Record<string, RemoteIdentity | null> = {};
  for (const name of Object.keys(recorded)) out[name] = readCloneIdentity(join(clonesDir, name.replaceAll("/", "__")));
  return out;
}

/**
 * Repos a practice replay must identify: the practice manifest, plus any corpus root that
 * shares a name or a root commit with one of them. Other corpus repos are not checked.
 */
export function replayCloneRecord(
  practice: readonly { name: string; root: string; split: string }[],
  corpus: Readonly<Record<string, string | null>>,
): Record<string, string | null> {
  const names = new Set(practice.map((repo) => repo.name.toLowerCase()));
  const roots = new Set(practice.map((repo) => repo.root));
  const out: Record<string, string | null> = {};
  for (const repo of practice) out[repo.name] = repo.root;
  for (const [name, root] of Object.entries(corpus)) {
    if (names.has(name.toLowerCase()) || (typeof root === "string" && roots.has(root))) out[name] = root;
  }
  return out;
}

function identityRoots(id: RemoteIdentity): string[] {
  if (id.roots && id.roots.length) return [...id.roots];
  return id.root ? [id.root] : [];
}

/** Clone check for the recorded set. A missing or empty clones directory fails closed. */
export function cloneCheckProblems(
  heldOut: readonly { name: string; root: string; upstreams?: readonly string[] }[],
  recorded: Readonly<Record<string, string | null>>,
  clonesDir: string,
): string[] {
  if (!clonesDir || !existsSync(clonesDir)) return Object.keys(recorded).map((name) => `CLONE_UNVERIFIED:${name}`).sort();
  let names: string[] = [];
  try { names = readdirSync(clonesDir); } catch { return Object.keys(recorded).map((name) => `CLONE_UNVERIFIED:${name}`).sort(); }
  if (names.length === 0) return Object.keys(recorded).map((name) => `CLONE_UNVERIFIED:${name}`).sort();
  return heldOutWatchProblems(heldOut, [], recorded, {}, identitiesForRoots(recorded, clonesDir));
}

/**
 * A corpus root is trusted only when a clone's remote and root agree with it.
 * A renamed fork whose recorded root is not the clone's root fails closed, as does a missing clone.
 */
export function falseRootProblems(
  heldOut: readonly { name: string; root: string }[],
  recorded: Readonly<Record<string, string | null>>,
  identities: Readonly<Record<string, RemoteIdentity | null>>,
): string[] {
  const problems: string[] = [];
  for (const [name, recordedRoot] of Object.entries(recorded)) {
    const id = Object.prototype.hasOwnProperty.call(identities, name) ? identities[name] : undefined;
    const roots = id ? identityRoots(id) : [];
    if (id === undefined || !id || !id.remoteUrl || roots.length === 0) { problems.push(`CLONE_UNVERIFIED:${name}`); continue; }
    const remote = repoFromRemote(id.remoteUrl);
    if (!remote) { problems.push(`REMOTE_UNPARSED:${name}`); continue; }
    // A recorded parent does not excuse a remote URL that names a different repository.
    if (remote.toLowerCase() !== name.toLowerCase()) problems.push(`REMOTE_NAME:${name}`);
    const upstream = id.source ?? id.parent;
    if (typeof recordedRoot === "string" && !roots.includes(recordedRoot)) {
      if (heldOut.some((held) => roots.includes(held.root) && held.name.toLowerCase() !== name.toLowerCase())) problems.push(`FORK_FALSE_ROOT:${name}`);
      else problems.push(`ROOT_MISMATCH:${name}`);
    }
    if (upstream && upstream.toLowerCase() !== name.toLowerCase()) {
      const ups = id.upstreamRoots?.length ? [...id.upstreamRoots] : (id.upstreamRoot ? [id.upstreamRoot] : []);
      if (!ups.length) problems.push(`UPSTREAM_ROOT_UNVERIFIED:${name}`);
      else if (ups.some((sha) => !roots.includes(sha))) problems.push(`FORK_ROOT:${name}`);
    }
  }
  return [...new Set(problems)].sort();
}

export type Split = "dev" | "held-out";
/** Peace's own repositories are not gated on a root LICENSE file. The recorded license is this word. */
export type PracticeLicense = Spdx | "owner";

export const DEP_PATHS = new Set(["package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"]);

function depBase(name: string): string {
  const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  return slash < 0 ? name : name.slice(slash + 1);
}

/** A fix that edits package.json, a lockfile, or package-manager config is not admitted. Nested paths count. */
export function diffChangesDeps(names: readonly string[]): boolean {
  return names.some((name) => {
    const base = depBase(name);
    return DEP_PATHS.has(base) || base === ".npmrc" || base.startsWith(".yarnrc") || base.startsWith(".pnpmfile");
  });
}

export function isOwnerRepo(name: string): boolean {
  return /^PeaceG03\//i.test(name);
}

export function isSpdx(value: unknown): value is Spdx {
  return value === "MIT" || value === "Apache-2.0" || value === "BSD-2-Clause" || value === "BSD-3-Clause" || value === "ISC";
}

export interface PracticeRepo {
  name: string;
  commit: string;
  root: string;
  license: PracticeLicense | null;
  licenseFile: string | null;
  split: Split;
  /** Origin projects this held-out repo continues. Empty when it has no upstream. */
  upstreams?: readonly string[];
}

export interface PracticeManifest {
  schema: typeof MANIFEST_SCHEMA;
  credit: false;
  heldOutHash: string;
  repos: PracticeRepo[];
}

/** Canonical held-out list. Name, pin, root, license, license file, and sorted upstreams. Order is by name. */
export function heldOutCanonical(repos: readonly PracticeRepo[]): string {
  const lines = repos
    .filter((r) => r.split === "held-out")
    .map((r) => [r.name, r.commit, r.root, r.license ?? "", r.licenseFile ?? "", [...(r.upstreams ?? [])].sort().join(",")].join("\t"))
    .sort();
  return lines.join("\n") + (lines.length ? "\n" : "");
}

export function heldOutHash(repos: readonly PracticeRepo[]): string {
  return createHash("sha256").update(HELD_OUT_HASH_PREFIX).update(heldOutCanonical(repos)).digest("hex");
}

/** Held-out pairs only. This is not part of heldOutHash, which stays the repository list. */
export function heldOutPairCanonical(pairs: readonly Pick<PracticePair, "repo" | "split" | "baseSha" | "fixSha" | "testFile">[]): string {
  const lines = pairs
    .filter((pair) => pair.split === "held-out")
    .map((pair) => [pair.repo, pair.baseSha, pair.fixSha, pair.testFile].join("\t"))
    .sort();
  return lines.join("\n") + (lines.length ? "\n" : "");
}

export function heldOutPairHash(pairs: readonly Pick<PracticePair, "repo" | "split" | "baseSha" | "fixSha" | "testFile">[]): string {
  return createHash("sha256").update(HELD_OUT_PAIR_PREFIX).update(heldOutPairCanonical(pairs)).digest("hex");
}

export function manifestProblems(value: unknown): string[] {
  const problems: string[] = [];
  if (!value || typeof value !== "object") return ["manifest_not_object"];
  const m = value as Partial<PracticeManifest>;
  if (m.schema !== MANIFEST_SCHEMA) problems.push("manifest_schema");
  if (m.credit !== false) problems.push("credit_not_false");
  if (!Array.isArray(m.repos) || m.repos.length < 1) return [...problems, "manifest_repos"];
  const names = new Set<string>();
  let held = 0;
  let stocks: Split | null = null;
  for (const repo of m.repos) {
    if (!repo || typeof repo !== "object") { problems.push("repo_shape"); continue; }
    if (!REPO.test(repo.name)) problems.push(`repo_name:${repo.name}`);
    if (names.has(repo.name.toLowerCase())) problems.push(`repo_dup:${repo.name}`);
    names.add(repo.name.toLowerCase());
    if (!SHA.test(repo.commit)) problems.push(`repo_pin:${repo.name}`);
    if (!SHA.test(repo.root)) problems.push(`repo_root:${repo.name}`);
    if (repo.split !== "dev" && repo.split !== "held-out") problems.push(`repo_split:${repo.name}`);
    if (repo.split === "held-out") held++;
    if (repo.name === "PeaceG03/PeaceSTOCKS") stocks = repo.split;
    if (isOwnerRepo(repo.name)) {
      if (repo.license !== "owner") problems.push(`repo_license:${repo.name}`);
    } else if (!isSpdx(repo.license)) problems.push(`repo_license:${repo.name}`);
    else if (typeof repo.licenseFile !== "string" || !repo.licenseFile) problems.push(`license_file:${repo.name}`);
    if (repo.split === "held-out") {
      if (!Array.isArray(repo.upstreams)) problems.push(`repo_upstreams:${repo.name}`);
      else for (const upstream of repo.upstreams) if (typeof upstream !== "string" || !REPO.test(upstream)) problems.push(`repo_upstream:${repo.name}`);
    }
  }
  if (held < 2) problems.push("heldout_count");
  if (stocks !== "dev") problems.push("peacestocks_not_dev");
  if (typeof m.heldOutHash !== "string" || !/^[0-9a-f]{64}$/.test(m.heldOutHash)) problems.push("heldout_hash_shape");
  else if (m.heldOutHash !== heldOutHash(m.repos)) problems.push("heldout_hash_mismatch");
  return problems;
}

export interface PracticePair {
  schema: typeof PAIR_SCHEMA;
  credit: false;
  repo: string;
  license: PracticeLicense;
  split: Split;
  baseSha: string;
  fixSha: string;
  testFile: string;
  testCommand: string[];
  beforeExit: number;
  afterExit: number;
  files: string[];
  subject: string;
  toolchain: PracticeToolchain;
}

export function pairProblems(value: unknown): string[] {
  const problems: string[] = [];
  if (!value || typeof value !== "object") return ["pair_not_object"];
  const p = value as Partial<PracticePair>;
  if (p.schema !== PAIR_SCHEMA) problems.push("pair_schema");
  if (p.credit !== false) problems.push("credit_not_false");
  if (typeof p.repo !== "string" || !REPO.test(p.repo)) problems.push("pair_repo");
  const ownerPair = typeof p.repo === "string" && isOwnerRepo(p.repo) && p.license === "owner";
  if (!ownerPair && !isSpdx(p.license)) problems.push("pair_license");
  if (p.split !== "dev" && p.split !== "held-out") problems.push("pair_split");
  if (typeof p.baseSha !== "string" || !SHA.test(p.baseSha)) problems.push("pair_base");
  if (typeof p.fixSha !== "string" || !SHA.test(p.fixSha)) problems.push("pair_fix");
  if (p.baseSha === p.fixSha) problems.push("pair_same_sha");
  if (typeof p.testFile !== "string" || !isTestFile(p.testFile)) problems.push("pair_test_file");
  if (!Array.isArray(p.testCommand) || p.testCommand.length < 1 || p.testCommand.some((c) => typeof c !== "string" || c.length === 0 || /[\0\n]/.test(c))) problems.push("pair_command");
  if (p.beforeExit === 0 || typeof p.beforeExit !== "number") problems.push("pair_before");
  if (p.afterExit !== 0) problems.push("pair_after");
  if (!Array.isArray(p.files) || p.files.length < 2 || p.files.some((f) => typeof f !== "string")) problems.push("pair_files");
  if (typeof p.subject !== "string" || p.subject.length < 1 || p.subject.length > 200 || p.subject.includes("\n")) problems.push("pair_subject");
  problems.push(...toolchainProblems(p.toolchain));
  return problems;
}

/**
 * Where LM training corpus repos and bug-to-fix pair repos are listed.
 * These files are read, not edited. A workflow is included only for the fine-tune clone loop
 * that names PeaceG03 repos; result-store clones are not corpus sources.
 */
export const CORPUS_SOURCE_FILES = [
  "peaceai/model/sources.json",
  "peaceai/model/ext-corpus.json",
  "peaceai/model/lm-public-allow.json",
  "peaceai/model/lm-retrain.json",
  "peaceai/model/lb-corpus2.json",
] as const;

export const PAIR_SOURCE_FILES = [
  "peaceai/model/nl-pairs.json",
  "peaceai/model/lm-retrain.json",
  "peaceai/model/ext-train-m49.json",
  "peaceai/model/ft-corefree.json",
  ".github/workflows/peace-lm-train-m49.yml",
] as const;

export interface TrainingSource { name: string; file: string; kind: "corpus" | "pairs" }

function addRepo(out: TrainingSource[], name: unknown, file: string, kind: TrainingSource["kind"]): void {
  if (typeof name === "string" && REPO.test(name)) out.push({ name, file, kind });
}

/** Repo names named by one source file. Unknown shapes add nothing (the caller fails closed on a missing file). */
export function reposInSource(file: string, text: string, kind: TrainingSource["kind"]): TrainingSource[] {
  const out: TrainingSource[] = [];
  if (file.endsWith(".yml")) {
    if (/PeaceG03\/\$r/.test(text)) {
      for (const match of text.matchAll(/for r in ([A-Za-z0-9_. \n-]+?);/g)) {
        for (const name of match[1]!.split(/\s+/)) if (name) addRepo(out, `PeaceG03/${name}`, file, kind);
      }
    }
    return out;
  }
  let json: unknown;
  try { json = JSON.parse(text); } catch { return out; }
  const obj = json as Record<string, any>;
  if (file.endsWith("sources.json")) {
    for (const row of [...(obj.owner ?? []), ...(obj.permissive ?? [])]) addRepo(out, row?.name, file, kind);
  } else if (file.endsWith("ext-corpus.json")) {
    for (const row of [...(obj.owner ?? []), ...(obj.repos ?? [])]) addRepo(out, row?.name, file, kind);
  } else if (file.endsWith("lm-public-allow.json")) {
    for (const name of Object.keys(obj.sources ?? {})) addRepo(out, name, file, kind);
  } else if (file.endsWith("lm-retrain.json")) {
    for (const name of Object.keys(obj.list?.repos ?? {})) addRepo(out, name, file, kind);
    addRepo(out, obj.replay?.source?.repo, file, kind);
  } else if (file.endsWith("lb-corpus2.json")) {
    addRepo(out, obj.sources?.repo, file, kind);
  } else if (file.endsWith("nl-pairs.json")) {
    for (const row of obj.repos ?? []) addRepo(out, row?.name, file, kind);
  } else if (file.endsWith("ext-train-m49.json")) {
    for (const name of obj.finetune?.repos ?? []) addRepo(out, name, file, kind);
  } else if (file.endsWith("ft-corefree.json")) {
    for (const row of obj.repos ?? []) addRepo(out, row?.repo, file, kind);
  }
  return out;
}

export function trainingSources(read: (path: string) => string | null): TrainingSource[] | { error: string } {
  const out: TrainingSource[] = [];
  for (const file of CORPUS_SOURCE_FILES) {
    const text = read(file);
    if (text === null) return { error: `SOURCE_UNREADABLE:${file}` };
    const rows = reposInSource(file, text, "corpus");
    if (rows.length === 0) return { error: `SOURCE_EMPTY:${file}` };
    out.push(...rows);
  }
  for (const file of PAIR_SOURCE_FILES) {
    const text = read(file);
    if (text === null) return { error: `SOURCE_UNREADABLE:${file}` };
    const rows = reposInSource(file, text, "pairs");
    if (rows.length === 0) return { error: `SOURCE_EMPTY:${file}` };
    out.push(...rows);
  }
  return out;
}

/** Private owner repo whose root commit is not readable from this public checkout. Name-checked only. */
export const ROOT_UNKNOWN_ALLOWED = ["PeaceG03/PeaceAI"] as const;

export interface CorpusRoots { schema: typeof ROOTS_SCHEMA; credit: false; roots: Record<string, string | null> }

export function rootProblems(sources: readonly TrainingSource[], roots: CorpusRoots | null): string[] {
  if (!roots || roots.schema !== ROOTS_SCHEMA || roots.credit !== false || !roots.roots) return ["roots_file"];
  const problems: string[] = [];
  const names = [...new Set(sources.map((s) => s.name))].sort();
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(roots.roots, name)) problems.push(`ROOT_MISSING:${name}`);
    else {
      const root = roots.roots[name];
      if (root === null) {
        if (!(ROOT_UNKNOWN_ALLOWED as readonly string[]).includes(name)) problems.push(`ROOT_UNKNOWN:${name}`);
      } else if (typeof root !== "string" || !SHA.test(root)) problems.push(`ROOT_BAD:${name}`);
    }
  }
  return problems;
}

export interface ExclusionHit { heldOut: string; source: string; file: string; kind: TrainingSource["kind"]; why: "name" | "root" }

/** Held-out repos (and forks: same root commit, any name) must not be corpus or pair sources. Dev repos are not checked. */
export function exclusionHits(
  heldOut: readonly { name: string; root: string }[],
  sources: readonly TrainingSource[],
  roots: Readonly<Record<string, string | null>>,
): ExclusionHit[] {
  const hits: ExclusionHit[] = [];
  const seen = new Set<string>();
  for (const held of heldOut) {
    for (const source of sources) {
      const sameName = source.name.toLowerCase() === held.name.toLowerCase();
      const sourceRoot = roots[source.name];
      const sameRoot = typeof sourceRoot === "string" && sourceRoot === held.root && !sameName;
      if (!sameName && !sameRoot) continue;
      const why = sameName ? "name" : "root";
      const key = `${held.name}\0${source.name}\0${source.file}\0${why}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ heldOut: held.name, source: source.name, file: source.file, kind: source.kind, why });
    }
  }
  return hits.sort((a, b) => a.heldOut.localeCompare(b.heldOut) || a.file.localeCompare(b.file) || a.why.localeCompare(b.why));
}

const REPO_TOKEN = /^[\w.-]+\/[\w.-]+$/;

/**
 * A repository reference. A GitHub URL is the owner/repo it names, not something to skip.
 * Anything that looks like a repository but is not `owner/repo` is rejected.
 */
export function parseRepoToken(raw: string): { name: string } | { bad: string } | null {
  const trimmed = raw.trim().replace(/\.git$/i, "");
  if (!trimmed || trimmed.includes("$")) return null;
  const body = trimmed
    .replace(/^git\+/i, "")
    .replace(/^ssh:\/\/git@github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, "")
    .replace(/^(?:www\.)?github\.com[:/]/i, "")
    .split(/[?#]/)[0]!;
  const parts = body.split("/").filter(Boolean);
  if (parts.length >= 2) {
    const name = `${parts[0]}/${parts[1]}`;
    return REPO_TOKEN.test(name) && !parts[1]!.startsWith(".") ? { name } : { bad: trimmed.slice(0, 160) };
  }
  if (/github\.com|@github\.com/i.test(trimmed)) return { bad: trimmed.slice(0, 160) };
  if (REPO_TOKEN.test(trimmed)) return { name: trimmed };
  if (trimmed.includes("/")) return { bad: trimmed.slice(0, 160) };
  return null;
}

export interface CloneMeta { root: string | null; upstream: string | null; upstreamRoot: string | null }

/** A missing clone, a root that is not the clone's root, or an upstream we cannot read fails closed. */
export function cloneRootProblems(name: string, recorded: string, meta: CloneMeta | null): string[] {
  if (!meta || meta.root === null) return [`CLONE_UNVERIFIED:${name}`];
  const problems: string[] = [];
  if (meta.root !== recorded) problems.push(`ROOT_MISMATCH:${name}`);
  if (meta.upstream && meta.upstream.toLowerCase() !== name.toLowerCase()) {
    if (meta.upstreamRoot === null) problems.push(`UPSTREAM_ROOT_UNVERIFIED:${name}`);
    else if (meta.upstreamRoot !== meta.root) problems.push(`FORK_ROOT:${name}`);
  }
  return problems;
}

function takeRepo(raw: string, names: string[], bad: string[]): void {
  const parsed = parseRepoToken(raw);
  if (!parsed) return;
  if ("bad" in parsed) bad.push(parsed.bad);
  else names.push(parsed.name);
}

/** Repo references in one watched file. URL forms are kept. A malformed repository entry is `bad`. */
export function refsInPracticeFile(path: string, text: string): { names: string[]; bad: string[] } {
  const names: string[] = [];
  const bad: string[] = [];
  for (const match of text.matchAll(/github\.com[:/][^\s"'`<>)]+/gi)) takeRepo(match[0]!, names, bad);
  if (path.endsWith(".json") || path.endsWith(".jsonl")) {
    for (const match of text.matchAll(/"(?:repo|name|full_name)"\s*:\s*"([^"]*)"/g)) takeRepo(match[1]!, names, bad);
    for (const match of text.matchAll(/"repos"\s*:\s*\[(.*?)\]/g)) {
      for (const item of match[1]!.matchAll(/"([^"]*)"/g)) takeRepo(item[1]!, names, bad);
    }
  }
  if (path.endsWith("corpus-roots.json")) {
    try {
      const roots = JSON.parse(text) as { roots?: Record<string, unknown> };
      for (const key of Object.keys(roots.roots ?? {})) takeRepo(key, names, bad);
    } catch { bad.push("corpus-roots"); }
  }
  return { names, bad };
}

function mentionsBare(text: string, bare: string): boolean {
  const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9_.-])${escaped}(?:$|[^A-Za-z0-9_.-])`, "i").test(text);
}

export interface PracticeWatch { path: string; text: string }

/** Files the held-out list must stay out of, plus the corpus and pair source lists. */
export function practiceWatchFiles(root: string): PracticeWatch[] {
  const rels = new Set<string>([...CORPUS_SOURCE_FILES, ...PAIR_SOURCE_FILES, "practice/corpus-roots.json", "practice/pairs.jsonl"]);
  const addDir = (dir: string, pred: (name: string) => boolean) => {
    const abs = join(root, dir);
    if (!existsSync(abs)) return;
    for (const name of readdirSync(abs)) if (pred(name)) rels.add(`${dir}/${name}`);
  };
  addDir("peaceai/rules/learned", (name) => name.endsWith(".json"));
  addDir("peaceai/plan", (name) => name.startsWith("tasks-") && name.endsWith(".json") || /runs.*\.jsonl$/.test(name));
  addDir("peaceai/spec", (name) => name.endsWith(".md"));
  addDir("docs", (name) => name.endsWith(".md"));
  addDir("peaceai/docs", (name) => name.endsWith(".md"));
  addDir("peaceai/model/ext-manifest", (name) => /^part-\d+\.jsonl$/.test(name));
  return [...rels].sort().map((path) => ({ path, text: readFileSync(join(root, path), "utf8") }));
}

const EXT_MANIFEST = /^peaceai\/model\/ext-manifest\/part-\d+\.jsonl$/;

/**
 * Exact `repo` values in one LM manifest part. A path such as `side-effects-pattern` is not a repo.
 * Lines with no `repo` field (the part header) are skipped. A line that does not parse fails closed.
 */
export function extManifestProblems(path: string, text: string, heldOut: readonly { name: string; upstreams?: readonly string[] }[]): string[] {
  const wanted = new Map<string, string>();
  for (const held of heldOut) {
    wanted.set(held.name.toLowerCase(), held.name);
    for (const upstream of held.upstreams ?? []) wanted.set(upstream.toLowerCase(), `${held.name} upstream ${upstream}`);
  }
  const problems: string[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let row: { repo?: unknown };
    try { row = JSON.parse(line) as { repo?: unknown }; } catch { problems.push(`EXT_MANIFEST_BAD:${path}`); continue; }
    if (!Object.prototype.hasOwnProperty.call(row, "repo")) continue;
    if (typeof row.repo !== "string") { problems.push(`EXT_MANIFEST_BAD:${path}`); continue; }
    const label = wanted.get(row.repo.toLowerCase());
    if (label) problems.push(`HELD_OUT_MANIFEST:${path}:${label}`);
  }
  return [...new Set(problems)];
}

/**
 * Why a held-out repo is not cleanly absent from the watched files.
 * Dev rows of practice/pairs.jsonl count. A fork whose recorded root is not the clone's root fails closed.
 */
export function heldOutWatchProblems(
  heldOut: readonly { name: string; root: string; upstreams?: readonly string[] }[],
  files: readonly PracticeWatch[],
  roots: Readonly<Record<string, string | null>>,
  clones: Readonly<Record<string, CloneMeta | null>> = {},
  identities: Readonly<Record<string, RemoteIdentity | null>> = {},
): string[] {
  const problems: string[] = [];
  const sources: TrainingSource[] = [];
  for (const file of files) {
    if (EXT_MANIFEST.test(file.path)) {
      problems.push(...extManifestProblems(file.path, file.text, heldOut));
      continue;
    }
    const devText = file.path.endsWith("pairs.jsonl")
      ? file.text.split("\n").filter((line) => { try { return JSON.parse(line).split === "dev"; } catch { return line.trim().length > 0; } }).join("\n")
      : file.text;
    const refs = refsInPracticeFile(file.path, devText);
    for (const bad of refs.bad) problems.push(`BAD_REPO_FORM:${file.path}:${bad}`);
    for (const name of refs.names) sources.push({ name, file: file.path, kind: "corpus" });
    for (const held of heldOut) {
      const names = [held.name, ...(held.upstreams ?? [])];
      for (const name of names) {
        const bare = name.split("/")[1] ?? "";
        const label = name === held.name ? held.name : `${held.name} upstream ${name}`;
        if (devText.toLowerCase().includes(name.toLowerCase())) problems.push(`HELD_OUT_MENTION:${file.path}:${label}`);
        else if (bare && mentionsBare(devText, bare)) problems.push(`HELD_OUT_BARE:${file.path}:${label}`);
      }
    }
  }
  for (const hit of exclusionHits(heldOut, sources, roots)) problems.push(`HELD_OUT_${hit.why.toUpperCase()}:${hit.file}:${hit.heldOut}`);
  const upstreams = heldOut.flatMap((held) => (held.upstreams ?? []).map((name) => ({ name, root: "0".repeat(40) })));
  for (const hit of exclusionHits(upstreams, sources, roots)) problems.push(`HELD_OUT_UPSTREAM:${hit.file}:${hit.source}`);
  for (const held of heldOut) {
    if (Object.prototype.hasOwnProperty.call(clones, held.name)) problems.push(...cloneRootProblems(held.name, held.root, clones[held.name] ?? null));
  }
  problems.push(...falseRootProblems(heldOut, roots, identities));
  return [...new Set(problems)].sort();
}
