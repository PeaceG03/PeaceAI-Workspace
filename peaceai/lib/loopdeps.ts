// M151 (loop v2, step 3 of the general coding-agent roadmap): what the test-and-fix loop needs to run a real repo's
// tests. Three parts, all general (nothing here names a task, a repo or a task set):
//   1. detectRunner: which runner the team's test files belong to (node:test, vitest, jest) and in which package;
//      other runners (mocha, ava, tap, ...) and suites that need an outside service (docker compose) are refused.
//   2. installDeps: the repo's dependencies, ONLY from its lockfile (npm ci / pnpm install --frozen-lockfile /
//      yarn install --frozen-lockfile), install scripts off (--ignore-scripts), as the stage-2 candidate uid with
//      `env -i` and a private HOME/cache, in a per-run staging dir (never the copy, never a shared cache), with a
//      deadline and a size cap. Package-manager config files that can redirect the registry or run code (.npmrc,
//      .yarnrc*, .pnpmfile.*) are removed from the staging tree first, and the lockfile is scanned first: every
//      package must come from https://registry.npmjs.org/ with an integrity hash (git, remote-tarball, file: and
//      outside-the-repo link entries are refused with DEPS_NONREGISTRY; workspace / link entries inside the repo are
//      allowed); npm also gets --allow-git/--allow-remote/--allow-file=none. The package manager itself runs here
//      as the candidate uid WITH network (registry only by config; it runs no package code: scripts off, no
//      pnpmfile). Every candidate-uid process is killed right after the install. Tests never get network. Refusals are fixed codes (DEPS_*), never message text. Installs are cached by lockfile
//      sha256 (+ package manager and manifests) inside one run dir only, removed with the run.
//   3. the json-runner shim: vitest / jest run inside the existing no-network isolation (loop.ts wrapper, selfpropose
//      guardedRun) through a PeaceAI-written shim that asks the runner for its JSON report (in the private TMPDIR)
//      and prints the pass / fail counts in the TAP summary form guardedRun reads (`# pass N`, `# fail N`, last).
//      A missing or unreadable report counts as a failure (fail closed). As in v1, counts are advisory (the
//      candidate shares the process); the tamper hashes and leftover kill still apply.
// Each safety guard is a single line tagged "guard:<id>"; the m151 mutation test deletes each in turn and requires a
// case to fail. See peaceai/spec/loop-v2.md.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import type { CandUid } from "./selfpropose.ts";

export const RUNNERS = ["node-test", "vitest", "jest"] as const;
export type RunnerKind = (typeof RUNNERS)[number];
export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];
export const DEPS_CODES = ["DEPS_NO_LOCKFILE", "DEPS_PM_UNSUPPORTED", "DEPS_NONREGISTRY", "DEPS_INSTALL_FAILED", "DEPS_TIMEOUT", "DEPS_TOO_LARGE"] as const;
export type DepsCode = (typeof DEPS_CODES)[number];
export type RunnerRefusal = "TEST_RUNNER_UNSUPPORTED" | "TEST_NEEDS_SERVICE";

const sha256 = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");
const readJson = (p: string): Record<string, any> | null => { try { const o = JSON.parse(readFileSync(p, "utf8")); return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch { return null; } };

// ---- 1. the runner

/** Runners the loop does not drive (refused with TEST_RUNNER_UNSUPPORTED); matched as whole script words. */
export const OTHER_RUNNERS = ["mocha", "ava", "tap", "tape", "uvu", "jasmine", "karma", "cypress", "playwright", "qunit", "lab", "ospec", "bun", "deno"] as const;
/** Files that mean the suite needs an outside service (a database, a broker): refused with TEST_NEEDS_SERVICE. */
export const SERVICE_FILES = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"] as const;

export interface RunnerPick { runner: RunnerKind; pkgDir: string; files: string[]; hasDeps: boolean }

/** Words of a package's test script, plus (one level) the words of the package scripts it names. */
export function scriptWords(scripts: Record<string, unknown> | undefined, name = "test"): string[] {
  const words = (s: unknown): string[] => (typeof s === "string" ? s.split(/[\s;&|()<>"'`=]+/).filter(Boolean) : []);
  const own = words(scripts?.[name]);
  const out = [...own];
  for (const w of own) if (w !== name && scripts && Object.hasOwn(scripts, w)) out.push(...words(scripts[w]));
  return out;
}

/** Nearest package dir (repo-relative, "" = root) holding a package.json above a repo-relative file. */
function packageDirOf(root: string, file: string): string {
  let d = posix.dirname(posix.normalize(file));
  for (;;) {
    if (d === "." || d === "") return "";
    if (existsSync(join(root, d, "package.json"))) return d;
    d = posix.dirname(d);
  }
}

/**
 * Picks the runner for the team's test files. All files must sit in one package. The package's test script decides
 * (vitest / jest / node --test); when it names neither, its dependencies do (exactly one of vitest / jest). A script
 * that names another runner, or both vitest and jest, is refused; so is a repo with a compose file (outside service).
 */
export function detectRunner(root: string, testFiles: readonly string[]): RunnerPick | { refuse: RunnerRefusal } {
  if (!testFiles.length) return { refuse: "TEST_RUNNER_UNSUPPORTED" };
  const dirs = [...new Set(testFiles.map((f) => packageDirOf(root, f)))];
  if (dirs.length !== 1) return { refuse: "TEST_RUNNER_UNSUPPORTED" };
  const pkgDir = dirs[0]!;
  const pkg = readJson(join(root, pkgDir, "package.json")) ?? {};
  const rootPkg = pkgDir ? readJson(join(root, "package.json")) ?? {} : pkg;
  const deps = { ...rootPkg.dependencies, ...rootPkg.devDependencies, ...pkg.dependencies, ...pkg.devDependencies };
  const hasDeps = Object.keys(deps).length > 0;
  const words = [...scriptWords(pkg.scripts), ...(pkgDir && !pkg.scripts?.test ? scriptWords(rootPkg.scripts) : [])];
  if (words.some((w) => (OTHER_RUNNERS as readonly string[]).includes(w))) return { refuse: "TEST_RUNNER_UNSUPPORTED" }; // guard:runner-other
  if (SERVICE_FILES.some((f) => existsSync(join(root, f)) || (pkgDir && existsSync(join(root, pkgDir, f)))) || words.includes("docker") || words.includes("docker-compose")) return { refuse: "TEST_NEEDS_SERVICE" }; // guard:service
  const rel = (f: string) => (pkgDir ? posix.relative(pkgDir, posix.normalize(f)) : posix.normalize(f));
  const named = (["vitest", "jest"] as const).filter((r) => words.includes(r));
  const nodeTest = typeof pkg.scripts?.test === "string" && /^(?:node|tsx)\b[^&|;]*\s--test\b/.test(pkg.scripts.test.trim());
  let runner: RunnerKind | null = null;
  if (named.length === 1) runner = named[0]!;
  else if (named.length === 0 && nodeTest) runner = "node-test";
  else if (named.length === 0) { const inDeps = (["vitest", "jest"] as const).filter((r) => Object.hasOwn(deps, r)); runner = inDeps.length === 1 ? inDeps[0]! : null; }
  if (!runner) return { refuse: "TEST_RUNNER_UNSUPPORTED" };
  if (runner !== "node-test" && !Object.hasOwn(deps, runner)) return { refuse: "TEST_RUNNER_UNSUPPORTED" }; // guard:runner-dep
  return { runner, pkgDir, files: testFiles.map(rel), hasDeps };
}

// ---- 2. dependencies

export interface LockPick { pm: PackageManager; lockfile: string; version: string | null }
const LOCKFILES: [string, PackageManager][] = [["pnpm-lock.yaml", "pnpm"], ["package-lock.json", "npm"], ["npm-shrinkwrap.json", "npm"], ["yarn.lock", "yarn"]];
/** Default package-manager versions by lockfile format, when package.json pins none. */
const PNPM_BY_LOCK: [RegExp, string][] = [[/^lockfileVersion: '?9\./m, "9.15.9"], [/^lockfileVersion: '?6\./m, "8.15.9"], [/^lockfileVersion: '?5\./m, "7.33.7"]];

/** The lockfile at the repo root and the package manager that reads it (packageManager pins the version). */
export function pickLockfile(root: string): LockPick | { refuse: DepsCode } {
  const present = LOCKFILES.filter(([f]) => existsSync(join(root, f)) && lstatSync(join(root, f)).isFile());
  if (!present.length) return { refuse: "DEPS_NO_LOCKFILE" }; // guard:deps-lockfile
  const pmField = String(readJson(join(root, "package.json"))?.packageManager ?? "");
  const m = /^(npm|pnpm|yarn)@(\d{1,3}\.\d{1,3}\.\d{1,3})(?:\+[a-z0-9]+\.[0-9a-f]+)?$/.exec(pmField);
  const [lockfile, pm] = (m && present.find(([, pm]) => pm === m[1])) || present[0] || ["package-lock.json", "npm" as const];
  let text = "";
  try { text = readFileSync(join(root, lockfile), "utf8"); } catch { text = ""; }
  if (pm === "yarn" && /^__metadata:/m.test(text)) return { refuse: "DEPS_PM_UNSUPPORTED" }; // yarn berry (plugins run code)
  let version = m && m[1] === pm ? m[2]! : null;
  if (pm === "yarn" && version && !version.startsWith("1.")) return { refuse: "DEPS_PM_UNSUPPORTED" };
  if (!version && pm === "pnpm") version = PNPM_BY_LOCK.find(([rx]) => rx.test(text))?.[1] ?? null;
  if (!version && pm === "pnpm") return { refuse: "DEPS_PM_UNSUPPORTED" };
  if (!version && pm === "yarn") version = "1.22.22";
  return { pm, lockfile, version };
}

/** The install command (argv) for a lockfile: frozen, scripts off. `tool` replaces the real package manager in tests. */
export function installArgv(p: LockPick, tool: ((pm: PackageManager, version: string | null) => string[]) | null): string[] {
  const base = tool ? tool(p.pm, p.version) : p.pm === "npm" ? ["npm"] : ["corepack", `${p.pm}@${p.version}`];
  const argv = [...base, ...(p.pm === "npm" ? ["ci", "--no-audit", "--no-fund"] : ["install", ...(p.pm === "yarn" ? ["--non-interactive"] : [])])];
  if (p.pm === "npm") argv.push("--allow-git=none", "--allow-remote=none", "--allow-file=none"); // guard:deps-npm-allow
  if (p.pm === "pnpm") argv.push("--ignore-pnpmfile"); // guard:deps-pnpmfile
  if (p.pm !== "npm") argv.push("--frozen-lockfile"); // guard:deps-frozen
  argv.push("--ignore-scripts"); // guard:deps-ignore-scripts
  return argv;
}

/** The only registry a lockfile entry may come from (the install env pins the same one). */
export const REGISTRY = "https://registry.npmjs.org/";
const INTEGRITY = /^sha(?:1|256|384|512)-[A-Za-z0-9+/]+={0,2}$/;
const integrityOk = (i: unknown): boolean => typeof i === "string" && i.trim().split(/\s+/).every((x) => INTEGRITY.test(x));
const registryOk = (resolved: unknown, integrity: unknown): boolean => {
  if (typeof resolved !== "string") return false;
  const u = resolved.replace(/#[0-9a-f]{40}$/, ""); // yarn v1 appends the tarball sha1
  return u.startsWith(REGISTRY) && !/[\s\\?#]|\.\.|\/\//.test(u.slice(REGISTRY.length)) && integrityOk(integrity);
};
/** A repo-relative path (from `base`, repo-relative) that stays inside the repo. */
export function insideRepo(base: string, rel: unknown): boolean {
  if (typeof rel !== "string" || !rel || rel.includes("\0") || rel.includes("\\") || posix.isAbsolute(rel)) return false;
  const n = posix.normalize(posix.join(base || ".", rel));
  return n !== ".." && !n.startsWith("../") && !posix.isAbsolute(n);
}

/** npm package-lock.json / npm-shrinkwrap.json (v1 `dependencies`, v2/v3 `packages`; both are read when present). */
export function npmLockAllowed(text: string): boolean {
  let o: any;
  try { o = JSON.parse(text); } catch { return false; }
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  for (const [k, v] of Object.entries((o.packages ?? {}) as Record<string, any>)) {
    if (k === "") continue;
    if (!v || typeof v !== "object") return false;
    if (!insideRepo(".", k)) return false; // guard:lock-npm-key
    const nm = /(?:^|\/)node_modules\//.test(k);
    if (v.link === true) { if (!insideRepo(".", v.resolved)) return false; continue; } // guard:lock-link
    if (!nm || v.inBundle === true) { if ("resolved" in v) return false; continue; } // a workspace package dir, or bundled in its parent's tarball
    if (!registryOk(v.resolved, v.integrity)) return false; // guard:lock-npm
  }
  const walk = (deps: unknown): boolean => {
    if (deps === undefined) return true;
    if (!deps || typeof deps !== "object") return false;
    for (const v of Object.values(deps as Record<string, any>)) {
      if (!v || typeof v !== "object") return false;
      const ver = String(v.version ?? "");
      const ok = ver.startsWith("file:") ? insideRepo(".", ver.slice(5)) && !/\.(?:tgz|tar|tar\.gz)$/i.test(ver) && !("resolved" in v)
        : v.bundled === true ? !("resolved" in v) : !/:/.test(ver.replace(/^npm:/, "").replace(/^@?[^@]*@/, "")) && registryOk(v.resolved, v.integrity);
      if (!ok) return false; // guard:lock-npm-v1
      if (!walk(v.dependencies)) return false;
    }
    return true;
  };
  return walk(o.dependencies);
}

const unquote = (s: string): string => s.trim().replace(/^(['"])(.*)\1$/, "$2");
const PNPM_RES = /^\s+resolution: \{integrity: sha(?:1|256|384|512)-[A-Za-z0-9+/]+={0,2}(?:, tarball: https:\/\/registry\.npmjs\.org\/[^\s,{}]+)?\}\s*$/;
/** pnpm-lock.yaml (v5 / v6 / v9), read line by line in the fixed layout pnpm writes; anything unexpected is refused. */
export function pnpmLockAllowed(text: string): boolean {
  let section = "";
  let importer = ".";
  let entry: string | null = null;
  let res = 0;
  const entryOk = () => section !== "packages" || entry === null || res === 1;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line) && !line.startsWith("#")) {
      if (!entryOk()) return false;
      section = /^([A-Za-z]+):/.exec(line)?.[1] ?? "?";
      entry = null; importer = ".";
      continue;
    }
    const key = /^ {2}('[^']*'|"[^"]*"|[^\s'"#][^:]*?):(?:\s|$)/.exec(line)?.[1];
    if (key !== undefined && section === "importers") importer = unquote(key);
    if (key !== undefined && (section === "packages" || section === "snapshots") && unquote(key).includes(":")) return false; // guard:lock-pnpm-key
    if (key !== undefined && section === "packages") {
      if (!entryOk()) return false; // guard:lock-pnpm-missing
      entry = unquote(key); res = 0;
    }
    if (section === "packages" && /^\s+resolution:/.test(line)) {
      res++;
      if (!PNPM_RES.test(line)) return false; // guard:lock-pnpm-res
      continue;
    }
    if (section === "packages" && /^ {4}deprecated: /.test(line)) continue; // free text (a notice), never read as a source
    // values only (a dependency name such as "simple-git" is a key, never a source)
    const kv = /^\s*(?:-\s+)?('[^']*'|"[^"]*"|[^\s'"][^:]*?):(?:\s+(.*))?$/.exec(line);
    const val = kv ? kv[2] ?? "" : line;
    for (const m of val.matchAll(/(?:^|[\s{,'"])link:([^\s'",}]*)/g)) if (!insideRepo(importer, m[1])) return false; // guard:lock-pnpm-link
    if (/:\/\/|(?:^|[\s{,'"@])(?:file|git|git\+[a-z]+|github|gitlab|bitbucket|gist|tarball):/.test(val)) return false; // guard:lock-pnpm-url
  }
  return entryOk();
}

/** yarn.lock v1 (berry is refused earlier). */
export function yarnLockAllowed(text: string): boolean {
  const blocks: { specs: string[]; fields: string[] }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    if (/^\S/.test(line)) { if (!line.endsWith(":")) return false; blocks.push({ specs: line.slice(0, -1).split(/,\s*/).map(unquote), fields: [] }); continue; }
    if (!blocks.length) return false;
    blocks[blocks.length - 1]!.fields.push(line);
  }
  for (const b of blocks) {
    const ranges = b.specs.map((s) => s.slice(s.indexOf("@", 1) + 1));
    const field = (name: string) => b.fields.find((f) => f.startsWith(`  ${name} `))?.slice(name.length + 3);
    const resolved = field("resolved");
    const links = ranges.every((r) => r.startsWith("link:") && insideRepo(".", r.slice(5)));
    if (ranges.some((r) => r.includes(":") && !r.startsWith("npm:") && !(r.startsWith("link:") && insideRepo(".", r.slice(5))))) return false; // guard:lock-yarn-spec
    if (links && resolved === undefined) continue;
    if (!registryOk(resolved === undefined ? undefined : unquote(resolved), field("integrity"))) return false; // guard:lock-yarn
  }
  return true;
}

/** Every package in the lockfile comes from the registry with an integrity hash, or is a workspace / link entry inside the repo. */
export function lockfileAllowed(root: string, p: LockPick): boolean {
  let text: string;
  try { text = readFileSync(join(root, p.lockfile), "utf8"); } catch { return false; }
  return p.pm === "npm" ? npmLockAllowed(text) : p.pm === "pnpm" ? pnpmLockAllowed(text) : yarnLockAllowed(text);
}

/** Package-manager config files that can redirect the registry or run code at install time. */
export const PM_CONFIG_FILES = [".npmrc", ".yarnrc", ".yarnrc.yml", ".pnpmfile.cjs", ".pnpmfile.mjs", "bunfig.toml"] as const;

export interface DepsOptions {
  /** Install deadline (ms). */
  timeoutMs?: number;
  /** Size cap for all installed node_modules (bytes). */
  maxBytes?: number;
  /** Tests only: the package-manager argv prefix (a vendored stub). */
  tool?: ((pm: PackageManager, version: string | null) => string[]) | null;
  /** Tests only: called once per real install (not on a cache hit). */
  onInstall?: (key: string) => void;
  /** Extra variables for the install env (tests only; still under env -i). */
  extraEnv?: Record<string, string>;
  /** Tests only: the argv that gives the installed tree back to the runner (default sudo -n chown -R). */
  chown?: ((owner: string, dir: string) => string[]) | null;
}
const MAX_CACHED = 2;
export const DEPS_DEFAULTS = { timeoutMs: 600_000, maxBytes: 1536 * 1024 * 1024 } as const;

/** One run's install cache: staging dirs keyed by lockfile sha256 (+ manager, version, manifests). Removed by close(). */
export interface DepsCache { dir: string; entries: Map<string, { staging: string } | { refuse: DepsCode }>; close(): void }
export function openDepsCache(base: string = tmpdir()): DepsCache {
  const dir = mkdtempSync(join(base, "peaceai-loopdeps-"));
  chmodSync(dir, 0o755);
  const entries = new Map<string, { staging: string } | { refuse: DepsCode }>();
  return { dir, entries, close: () => { spawnSync("sudo", ["-n", "rm", "-rf", "--", dir], { stdio: "ignore" }); rmSync(dir, { recursive: true, force: true }); } };
}

const listed = (root: string): string[] => execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean);
/** node_modules dirs under a tree (not nested in another node_modules), repo-relative. */
function moduleDirs(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string, depth: number) => {
    if (depth > 8) return;
    let ents: string[];
    try { ents = readdirSync(join(root, rel)); } catch { return; }
    for (const e of ents) {
      const r = rel ? `${rel}/${e}` : e;
      let st; try { st = lstatSync(join(root, r)); } catch { continue; }
      if (!st.isDirectory()) continue;
      if (e === "node_modules") out.push(r); else if (e !== ".git") walk(r, depth + 1);
    }
  };
  walk("", 0);
  return out.sort();
}
/** Bytes under a tree, each inode once, symlinks not followed. */
export function treeBytes(p: string): number {
  const seen = new Set<string>();
  let n = 0;
  const walk = (q: string) => {
    let st; try { st = lstatSync(q); } catch { return; }
    const id = `${st.dev}:${st.ino}`;
    if (seen.has(id)) return;
    seen.add(id);
    n += st.size;
    if (st.isDirectory()) for (const e of readdirSync(q)) walk(join(q, e));
  };
  walk(p);
  return n;
}

/**
 * Installs the copy's dependencies from its lockfile into a staging tree of the run's cache (as the candidate uid,
 * env -i, scripts off), then links the copy's node_modules dirs to it (the staging tree is owned by the runner and
 * read-only to the candidate; the isolation also mounts /tmp read-only). Returns null on success or a fixed DEPS_* code.
 */
export function installDeps(copyDir: string, cand: CandUid, cache: DepsCache, o: DepsOptions = {}): { pm: PackageManager } | { refuse: DepsCode } {
  const lock = pickLockfile(copyDir);
  if ("refuse" in lock) return lock;
  if (!lockfileAllowed(copyDir, lock)) return { refuse: "DEPS_NONREGISTRY" }; // guard:deps-nonregistry
  const files = listed(copyDir);
  const manifests = files.filter((f) => posix.basename(f) === "package.json" || f === "pnpm-workspace.yaml").sort();
  const key = sha256([lock.pm, lock.version ?? "", sha256(readFileSync(join(copyDir, lock.lockfile))), ...manifests.map((f) => `${f}\0${sha256(readFileSync(join(copyDir, f)))}`)].join("\n"));
  let hit = cache.entries.get(key);
  if (!hit) {
    hit = install(copyDir, files, lock, cand, cache, key, o);
    cache.entries.set(key, hit);
    // keep the newest MAX_CACHED installs only (disk / inodes); an evicted install is removed, never reused
    for (const [k, v] of [...cache.entries].slice(0, Math.max(0, cache.entries.size - MAX_CACHED))) {
      cache.entries.delete(k);
      if ("staging" in v) rmSync(v.staging, { recursive: true, force: true });
    }
  }
  if ("refuse" in hit) return hit;
  for (const d of moduleDirs(hit.staging)) {
    mkdirSync(dirname(join(copyDir, d)), { recursive: true });
    rmSync(join(copyDir, d), { recursive: true, force: true });
    // a real dir of per-entry links (never the dir itself, so writes into the copy's node_modules, e.g. the runner
    // wrapper, cannot reach the shared staging tree); .bin is not linked (runners start from their package bin)
    mkdirSync(join(copyDir, d));
    for (const e of readdirSync(join(hit.staging, d))) if (e !== ".bin") symlinkSync(join(hit.staging, d, e), join(copyDir, d, e));
  }
  return { pm: lock.pm };
}

/** Kills every process of the candidate uid (a few rounds, then checks none is left). False: not sure they are gone. */
export function killCand(cand: CandUid): boolean {
  for (let i = 0; i < 5; i++) {
    const k = spawnSync("sudo", ["-n", "pkill", "-KILL", "-u", cand.name], { stdio: "ignore" }).status;
    if (k !== 0 && k !== 1) return false; // 1: nothing matched
    if (spawnSync("pgrep", ["-u", cand.name], { stdio: "ignore" }).status === 1) return true;
    spawnSync("sleep", ["0.2"]);
  }
  return false;
}

function install(copyDir: string, files: readonly string[], lock: LockPick, cand: CandUid, cache: DepsCache, key: string, o: DepsOptions): { staging: string } | { refuse: DepsCode } {
  o.onInstall?.(key);
  const staging = join(cache.dir, `deps-${key.slice(0, 16)}`);
  const home = join(cache.dir, `home-${key.slice(0, 16)}`);
  mkdirSync(staging, { recursive: true });
  mkdirSync(home, { recursive: true });
  // the tracked tree at the pinned commit (no team tests, no edits), minus package-manager config files
  for (const f of files) {
    const src = join(copyDir, f);
    let st; try { st = lstatSync(src); } catch { continue; }
    if (!st.isFile()) continue;
    mkdirSync(dirname(join(staging, f)), { recursive: true });
    writeFileSync(join(staging, f), readFileSync(src));
  }
  for (const f of files) if ((PM_CONFIG_FILES as readonly string[]).includes(posix.basename(f))) rmSync(join(staging, f), { force: true }); // guard:deps-config
  const me = `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`;
  if (spawnSync("sudo", ["-n", "chown", "-R", `${cand.name}:`, staging, home], { stdio: "ignore" }).status !== 0) return { refuse: "DEPS_INSTALL_FAILED" };
  const timeoutMs = o.timeoutMs ?? DEPS_DEFAULTS.timeoutMs;
  const env: Record<string, string> = {
    PATH: `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`, HOME: home, TMPDIR: home, LANG: "C.UTF-8", CI: "true",
    COREPACK_HOME: join(home, "corepack"), COREPACK_ENABLE_DOWNLOAD_PROMPT: "0", COREPACK_ENABLE_STRICT: "0",
    npm_config_cache: join(home, "npm-cache"), npm_config_store_dir: join(home, "pnpm-store"),
    npm_config_update_notifier: "false", YARN_CACHE_FOLDER: join(home, "yarn-cache"), ...o.extraEnv,
  };
  env.npm_config_registry = REGISTRY; // guard:deps-registry
  const argv = installArgv(lock, o.tool ?? null);
  const secs = String(Math.max(1, Math.ceil(timeoutMs / 1000)));
  const cmd = [...Object.entries(env).map(([k, v]) => `${k}=${v}`), "timeout", "-s", "KILL", secs, ...argv];
  cmd.unshift("env", "-i"); // guard:deps-env-i
  cmd.unshift("sudo", "-n", "-u", cand.name, "--"); // guard:deps-cand
  const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd: staging, stdio: "ignore", timeout: timeoutMs + 30_000, killSignal: "SIGKILL", env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } });
  // every process of the candidate uid goes before the tree changes hands (a setsid escapee would keep its network)
  if (!killCand(cand)) return { refuse: "DEPS_INSTALL_FAILED" }; // guard:deps-kill
  // back to the runner: the candidate can no longer change the installed tree; its private HOME (caches) goes
  const chown = o.chown ? o.chown(me, staging) : ["sudo", "-n", "chown", "-R", me, staging];
  const owned = spawnSync(chown[0]!, chown.slice(1), { stdio: "ignore" }).status === 0;
  spawnSync("sudo", ["-n", "rm", "-rf", "--", home], { stdio: "ignore" });
  if (!owned) return { refuse: "DEPS_INSTALL_FAILED" }; // guard:deps-chown
  execFileSync("chmod", ["-R", "go-w", staging], { stdio: "ignore" });
  if (r.status === 137 || r.status === 124 || r.signal) return { refuse: "DEPS_TIMEOUT" }; // guard:deps-timeout
  if (r.status !== 0) return { refuse: "DEPS_INSTALL_FAILED" };
  const bytes = moduleDirs(staging).reduce((n, d) => n + treeBytes(join(staging, d)), 0);
  if (bytes > (o.maxBytes ?? DEPS_DEFAULTS.maxBytes)) return { refuse: "DEPS_TOO_LARGE" }; // guard:deps-size
  if (!moduleDirs(staging).length) return { refuse: "DEPS_INSTALL_FAILED" };
  return { staging };
}

// ---- 3. the json-runner shim (runs INSIDE the isolation as the candidate uid; plain JS, no imports from PeaceAI)

/** Repo-relative path of the shim in the copy (under node_modules: never an edit target, tamper-hashed by guardedRun). */
export const SHIM_PATH = "node_modules/.peaceai-loop/run.mjs";
export const SHIM_SOURCE = [
  "// PeaceAI loop v2 (M151): runs vitest or jest for the given test files and prints the pass / fail counts from the",
  "// runner's JSON report as the last two lines (`# pass N`, `# fail N`). Written by peaceai/lib/loopdeps.ts.",
  'import { spawnSync } from "node:child_process";',
  'import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";',
  'import { dirname, join, resolve } from "node:path";',
  "const [runner, pkgDir, ...files] = process.argv.slice(2);",
  "const cwd = resolve(pkgDir || \".\");",
  "const tmp = process.env.TMPDIR || \"/nonexistent\";",
  "const report = join(tmp, \"peaceai-loop-report.json\");",
  "const done = (pass, fail, code) => { process.stdout.write(`\\n# pass ${pass}\\n# fail ${fail}\\n`); process.exit(code); };",
  "let pkgJson = null;",
  "for (let d = cwd; ; d = dirname(d)) { const p = join(d, \"node_modules\", runner, \"package.json\"); if (existsSync(p)) { pkgJson = realpathSync(p); break; } if (dirname(d) === d) break; }",
  "if (!pkgJson || (runner !== \"vitest\" && runner !== \"jest\")) done(0, 1, 1);",
  "const meta = JSON.parse(readFileSync(pkgJson, \"utf8\"));",
  "const binRel = typeof meta.bin === \"string\" ? meta.bin : meta.bin?.[runner];",
  "if (typeof binRel !== \"string\") done(0, 1, 1);",
  "const bin = join(dirname(pkgJson), binRel);",
  "const args = runner === \"vitest\"",
  "  ? [\"run\", \"--reporter=json\", `--outputFile=${report}`, ...files]",
  "  : [\"--ci\", \"--json\", `--outputFile=${report}`, \"--watchman=false\", `--cacheDirectory=${join(tmp, \"jest-cache\")}`, \"--runTestsByPath\", ...files];",
  "const run = (extra) => { rmSync(report, { force: true }); const r = spawnSync(process.execPath, [bin, ...args, ...extra], { cwd, stdio: [\"ignore\", \"inherit\", \"inherit\"] }); let j = null; try { j = JSON.parse(readFileSync(report, \"utf8\")); } catch { j = null; } return { r, j }; };",
  "let { r, j } = run([]);",
  "// the copy is read-only, so vite's default config bundling (a temp file beside the config) can fail; vitest >= 3.1",
  "// can load the config in-process instead, so retry once that way when no report was written",
  "const [maj, min] = String(meta.version).split(\".\").map(Number);",
  "if (!j && runner === \"vitest\" && (maj > 3 || (maj === 3 && min >= 1))) ({ r, j } = run([\"--configLoader\", \"runner\"]));",
  "if (!j || typeof j !== \"object\") done(0, 1, r.status || 1); // guard:shim-report",
  "const n = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);",
  "const pass = n(j.numPassedTests);",
  "let fail = n(j.numFailedTests);",
  "if (fail === 0 && n(j.numFailedTestSuites) > 0) fail = n(j.numFailedTestSuites); // guard:shim-suites",
  "if (fail === 0 && (r.status !== 0 || j.success === false)) fail = 1; // guard:shim-exit",
  "done(pass, fail, fail ? (r.status || 1) : 0);",
  "",
].join("\n");

/** Writes the shim into the copy; returns the argv that guardedRun passes to the wrapper's node. */
export function installShim(copyDir: string): void {
  mkdirSync(join(copyDir, dirname(SHIM_PATH)), { recursive: true });
  writeFileSync(join(copyDir, SHIM_PATH), SHIM_SOURCE);
}
export function shimArgs(pick: RunnerPick): string[] {
  return [SHIM_PATH, pick.runner, pick.pkgDir, ...pick.files];
}
