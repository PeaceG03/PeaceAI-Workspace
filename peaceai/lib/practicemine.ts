// Mixed practice set. credit: false. Pure checks for the miner, the frozen held-out hash, and the
// training-exclusion check. Git and process spawning stay in peaceai/bin/practice-mine.ts.
// Third-party source is never written here.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { classifyLicense, type Spdx } from "./lmcorpus.ts";

export const MANIFEST_SCHEMA = "peaceai-practice-manifest:v1";
export const PAIR_SCHEMA = "peaceai-practice-pair:v1";
export const ROOTS_SCHEMA = "peaceai-practice-corpus-roots:v1";
export const MINE_REPORT_SCHEMA = "peaceai-practice-mine-report:v1";
export const HELD_OUT_HASH_PREFIX = "peaceai-practice-heldout:v1\n";

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

export interface SandboxRun { unsafe: boolean; code: number | null; stdout: string }

export interface SandboxOpts { bwrap?: string; capture?: boolean; nodePath?: string | null; nodeModules?: string | null }

/** Run `cmd` inside the practice sandbox. `unsafe` means bwrap is missing or the sandbox could not be created. */
export function runInPracticeSandbox(workDir: string, cmd: readonly string[], timeoutMs: number, opts: SandboxOpts = {}): SandboxRun {
  const prefix = practiceSandboxArgv(workDir, { nodePath: opts.nodePath, nodeModules: opts.nodeModules });
  if (!prefix) return { unsafe: true, code: null, stdout: "" };
  if (opts.bwrap) prefix[0] = opts.bwrap;
  const home = sandboxHome(workDir);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(workDir, ".practice-sandbox-ran"), "1\n");
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

const POISON_EXACT = new Set([".pnpmfile.cjs", ".npmrc", "package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"]);

function stampFile(path: string): string {
  if (!existsSync(path)) return "absent";
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return `link:${readlinkSync(path)}`;
  if (stat.isDirectory()) return "dir";
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Files a sandboxed test must not leave behind for a later install or git command. */
export function poisonStamp(dir: string): Record<string, string> {
  const stamp: Record<string, string> = {};
  const add = (rel: string) => { stamp[rel] = stampFile(join(dir, rel)); };
  if (!existsSync(dir)) return stamp;
  for (const name of readdirSync(dir)) {
    if (POISON_EXACT.has(name) || name.startsWith(".yarnrc")) add(name);
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

export const SANDBOX_RAN = ".practice-sandbox-ran";

const POISON_INSTALL = [".pnpmfile.cjs", ".npmrc", ".yarnrc", ".yarnrc.yml"];

/** Drop tokens, credentials, and home directories from an install log. */
export function sanitizeInstallLines(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    let line = raw.replace(/\u001b\[[0-9;]*m/g, "");
    line = line.replace(/\/home\/[^/\s]+/g, "/home/user").replace(/\/Users\/[^/\s]+/g, "/Users/user");
    line = line.replace(/(?:ghp_|github_pat_|npm_|ghs_)[A-Za-z0-9_]+/g, "[redacted]");
    line = line.replace(/:\/\/[^/\s:@]+:[^@\s/]+@/g, "://");
    line = line.trim();
    if (!line) continue;
    lines.push(line.slice(0, 240));
    if (lines.length >= 12) break;
  }
  return lines;
}

export function frozenInstallArgv(manager: PracticeToolchain["manager"], locks: LockFiles, yarnModern: boolean): string[] | null {
  if (manager === "none") return null;
  if (manager === "pnpm") return ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"];
  if (manager === "yarn") return yarnModern ? ["corepack", "yarn", "install", "--immutable", "--mode=skip-build"] : ["corepack", "yarn", "install", "--frozen-lockfile", "--ignore-scripts"];
  if (locks.npm) return ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"];
  return ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"];
}

export interface PracticeInstall { ok: boolean; modules: string | null; reason: string | null; lines: string[] }

function installEnv(nodePath: string, home: string): NodeJS.ProcessEnv {
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
  return env;
}

/**
 * Install one pair's dependencies from its pinned base commit, outside any sandbox work tree.
 * The cache is `<cacheRoot>/<owner>__<name>/<baseSha>/`. A directory a sandboxed test has
 * written is refused. The lockfile is the one `git archive` extracted from baseSha.
 */
export function ensurePracticeInstall(repoDir: string, pair: Pick<PracticePair, "repo" | "baseSha" | "toolchain">, cacheRoot: string, locks: LockFiles, yarnModern: boolean): PracticeInstall {
  if (!existsSync(pair.toolchain.nodePath)) return { ok: false, modules: null, reason: "TOOLCHAIN_MISSING", lines: [] };
  const dest = join(cacheRoot, pair.repo.replace("/", "__"), pair.baseSha);
  const modules = join(dest, "node_modules");
  const stamp = join(dest, ".practice-base");
  if (existsSync(modules) && existsSync(stamp) && readFileSync(stamp, "utf8").trim() === pair.baseSha) return { ok: true, modules, reason: null, lines: [] };
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  if (existsSync(join(dest, SANDBOX_RAN))) return { ok: false, modules: null, reason: "SANDBOX_POISON", lines: ["install dir was used by a sandboxed test"] };
  const pinned = practiceGit(repoDir, ["rev-parse", "--verify", `${pair.baseSha}^{commit}`]);
  if (!pinned.ok || pinned.out.trim() !== pair.baseSha) return { ok: false, modules: null, reason: "INSTALL_FAILED", lines: ["base commit is not in the clone"] };
  const archived = spawnSync("git", ["-C", repoDir, ...GIT_LOCK_ARGS, "archive", "--format=tar", pair.baseSha], {
    env: practiceGitEnv(), maxBuffer: 256 << 20, timeout: 120_000,
  });
  if (archived.status !== 0 || !archived.stdout) return { ok: false, modules: null, reason: "INSTALL_FAILED", lines: sanitizeInstallLines(`${archived.stderr ?? ""}`) };
  const extracted = spawnSync("tar", ["-x", "-C", dest], { input: archived.stdout, timeout: 120_000 });
  if (extracted.status !== 0) return { ok: false, modules: null, reason: "INSTALL_FAILED", lines: ["could not extract the base commit"] };
  for (const name of readdirSync(dest)) {
    if (!POISON_INSTALL.includes(name) && !name.startsWith(".yarnrc")) continue;
    const recorded = practiceGit(repoDir, ["cat-file", "-e", `${pair.baseSha}:${name}`]);
    if (!recorded.ok) return { ok: false, modules: null, reason: "SANDBOX_POISON", lines: [`${name} is not in the base commit`] };
  }
  const argv = frozenInstallArgv(pair.toolchain.manager, locks, yarnModern);
  if (!argv) {
    writeFileSync(stamp, `${pair.baseSha}\n`);
    mkdirSync(modules, { recursive: true });
    return { ok: true, modules, reason: null, lines: [] };
  }
  const home = mkdtempSync(join(tmpdir(), "peaceai-install-home-"));
  const ran = spawnSync(argv[0]!, argv.slice(1), {
    cwd: dest, env: installEnv(pair.toolchain.nodePath, home), encoding: "utf8", timeout: 180_000, maxBuffer: 8 << 20,
  });
  rmSync(home, { recursive: true, force: true });
  if (ran.status !== 0) return { ok: false, modules: null, reason: "INSTALL_FAILED", lines: sanitizeInstallLines(`${ran.error?.message ?? ""}\n${ran.stdout ?? ""}\n${ran.stderr ?? ""}`) };
  writeFileSync(stamp, `${pair.baseSha}\n`);
  return { ok: true, modules: existsSync(modules) ? modules : null, reason: existsSync(modules) ? null : "INSTALL_FAILED", lines: existsSync(modules) ? [] : ["install produced no node_modules"] };
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
  root: string | null;
  parent: string | null;
  source: string | null;
  upstreamRoot: string | null;
}

export function repoFromRemote(url: string): string | null {
  const match = url.trim().replace(/\.git$/, "").match(/github\.com[:/]([\w.-]+\/[\w.-]+)$/i);
  return match ? match[1]! : null;
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
    if (id === undefined) continue;
    if (!id || !id.remoteUrl || !id.root) { problems.push(`CLONE_UNVERIFIED:${name}`); continue; }
    const remote = repoFromRemote(id.remoteUrl);
    if (!remote) { problems.push(`REMOTE_UNPARSED:${name}`); continue; }
    const upstream = id.source ?? id.parent;
    if (remote.toLowerCase() !== name.toLowerCase() && !(upstream && upstream.toLowerCase() !== name.toLowerCase())) problems.push(`REMOTE_NAME:${name}`);
    if (typeof recordedRoot === "string" && recordedRoot !== id.root) problems.push(`ROOT_MISMATCH:${name}`);
    if (upstream && upstream.toLowerCase() !== name.toLowerCase()) {
      if (!id.upstreamRoot) problems.push(`UPSTREAM_ROOT_UNVERIFIED:${name}`);
      else if (heldOut.some((held) => held.name.toLowerCase() === upstream.toLowerCase() && held.root === id.root && recordedRoot !== id.root)) problems.push(`FORK_FALSE_ROOT:${name}`);
    }
    if (heldOut.some((held) => held.root === id.root && held.name.toLowerCase() !== name.toLowerCase() && recordedRoot !== id.root)) problems.push(`FORK_FALSE_ROOT:${name}`);
  }
  return [...new Set(problems)].sort();
}

export type Split = "dev" | "held-out";
/** Peace's own repositories are not gated on a root LICENSE file. The recorded license is this word. */
export type PracticeLicense = Spdx | "owner";

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
  return [...new Set(problems)].sort();
}
