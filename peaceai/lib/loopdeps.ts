// M151 (loop v2, step 3 of the general coding-agent roadmap): what the test-and-fix loop needs to run a real repo's
// tests. Three parts, all general (nothing here names a task, a repo or a task set):
//   1. detectRunner: which runner the team's test files belong to (node:test, vitest, jest) and in which package;
//      other runners (mocha, ava, tap, ...) and suites that need an outside service (docker compose) are refused.
//   2. installDeps: the repo's dependencies, ONLY from its lockfile (npm ci / pnpm install --frozen-lockfile /
//      yarn install --frozen-lockfile), install scripts off (--ignore-scripts), as the stage-2 candidate uid with
//      `env -i` and a private HOME/cache, in a per-run staging dir (never the copy, never a shared cache), with a
//      deadline and a size cap. Package-manager config files that can redirect the registry or run code (.npmrc,
//      .yarnrc*, .pnpmfile.*, .corepack.env; corepack also gets COREPACK_ENV_FILE=0) are removed from the staging tree first, and every root lockfile is scanned first
//      (size-capped; both npm lockfiles at once refused; pnpm parsed as a plain YAML subset; yarn.lock read only in the strict subset yarn's own parser reads the same way
//      (no YAML fallback), with every dependency of every block itself a locked name@range header (closure) and every
//      semver header range satisfied by its version, so yarn never re-resolves): every
//      package must come from https://registry.npmjs.org/ (yarn v1: or registry.yarnpkg.com) with an integrity hash
//      (git, remote-tarball, file: and outside-the-repo link entries are refused with DEPS_NONREGISTRY; workspace /
//      link entries inside the repo are allowed); a lockfile below the root, and for pnpm any pnpm-workspace.yaml key but
//      packages / catalog(s), the M169 inert keys and the M188 vetted settings, or a `pnpm` field outside the root
//      package.json or with an unvetted key / value, a packageManager other than name@x.y.z[+hash], a devEngines
//      manager / runtime that may download, and for yarn v1 any dependency spec in any package.json without a
//      yarn.lock header (or resolutions other than root ones pinned to locked headers), is refused with
//      DEPS_PM_CONFIG (M188: peaceai/spec/deps-pm-config-v1.md); npm also gets --allow-git/--allow-remote/--allow-file=none.
//      Of the root .npmrc only vetted layout / peer settings are written back into the staging tree (npmrcCarry). The package manager itself runs here
//      as the candidate uid WITH network (registry only by config; it runs no package code: scripts off, no
//      pnpmfile). Every candidate-uid process is killed right after the install. Tests never get network. Refusals are fixed codes (DEPS_*), never message text. Installs are cached by lockfile
//      sha256 (+ package manager, manifests, patch files and the carried .npmrc) inside one run dir only, removed with the run.
//   3. the json-runner shim: vitest / jest run inside the existing no-network isolation (loop.ts wrapper, selfpropose
//      guardedRun) through a PeaceAI-written shim that asks the runner for its JSON report (in the private TMPDIR)
//      and prints the pass / fail counts in the TAP summary form guardedRun reads (`# pass N`, `# fail N`, last).
//      A missing or unreadable report counts as a failure (fail closed). As in v1, counts are advisory (the
//      candidate shares the process); the tamper hashes and leftover kill still apply.
// Each safety guard is a single line tagged "guard:<id>"; the m151 mutation test deletes each in turn and requires a
// case to fail (M169 / M188 / M192 guards carry their own tags and mutation tests). See peaceai/spec/loop-v2.md.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { isolatedRun, type CandUid } from "./selfpropose.ts";

export const RUNNERS = ["node-test", "vitest", "jest", "mocha"] as const;
export type RunnerKind = (typeof RUNNERS)[number];
export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];
export const DEPS_CODES = ["DEPS_NO_LOCKFILE", "DEPS_PM_UNSUPPORTED", "DEPS_NONREGISTRY", "DEPS_PM_CONFIG", "DEPS_INSTALL_FAILED", "DEPS_TIMEOUT", "DEPS_TOO_LARGE"] as const;
export type DepsCode = (typeof DEPS_CODES)[number];
/**
 * M169: why an install was refused with DEPS_INSTALL_FAILED, as a fixed code only (never the package manager's output):
 * CAND_NO_ACCESS the candidate uid cannot traverse or write its staging dir (e.g. a --deps-dir under a home dir it
 * cannot enter), CHOWN_TO_CAND / CHOWN_BACK the ownership hand-over failed, KILL a candidate process survived,
 * PM_EXIT the package manager exited non-zero, NO_MODULES it exited 0 but installed nothing. Same list as
 * looprow.ts LOOP_DEPS_FAILS (m169 checks they match).
 */
export const DEPS_FAILS = ["CAND_NO_ACCESS", "CHOWN_TO_CAND", "KILL", "CHOWN_BACK", "PM_EXIT", "NO_MODULES"] as const;
export type DepsFail = (typeof DEPS_FAILS)[number];
export type DepsRefusal = { refuse: DepsCode; fail?: DepsFail };
export type RunnerRefusal = "TEST_RUNNER_UNSUPPORTED" | "TEST_NEEDS_SERVICE";

const sha256 = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");
const readJson = (p: string): Record<string, any> | null => { try { const o = JSON.parse(readFileSync(p, "utf8")); return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch { return null; } };

// ---- 1. the runner

/** Runners the loop does not drive (refused with TEST_RUNNER_UNSUPPORTED); matched as whole script words. */
export const OTHER_RUNNERS = ["ava", "tap", "tape", "uvu", "jasmine", "karma", "cypress", "playwright", "qunit", "lab", "ospec", "bun", "deno"] as const;
/** Files that mean the suite needs an outside service (a database, a broker): refused with TEST_NEEDS_SERVICE. */
export const SERVICE_FILES = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"] as const;

/** M172: `options` (mocha only) are the allowlisted mocha options read from the package's scripts (mochaOptions). */
export interface RunnerPick { runner: RunnerKind; pkgDir: string; files: string[]; hasDeps: boolean; options?: string[] }

// ---- M172: mocha (batch 11). mocha has no lockfile-free way to say "these files only, report as JSON" beyond its CLI,
// and the repo's own options (a --require of its TypeScript / Babel hook) live in the script that runs it. PeaceAI
// reads that script itself and passes on only a fixed allowlist; anything else in the mocha command, more than one
// mocha command, or a mocha config file (.mocharc.*, or a "mocha" key in package.json, which mocha would read on
// its own) is refused with TEST_RUNNER_UNSUPPORTED. The shim then runs mocha with --no-config --no-package, so no
// config file anywhere above the copy is read either. Spec: peaceai/spec/loop-runners-v3.md.

/** mocha config files mocha reads from its working dir (refused: PeaceAI would not see what they set). */
export const MOCHA_CONFIG_FILES = [".mocharc.js", ".mocharc.cjs", ".mocharc.mjs", ".mocharc.yaml", ".mocharc.yml", ".mocharc.json", ".mocharc.jsonc"] as const;
/** The mocha options passed through, each with the values it may take. Booleans take none. */
const MOCHA_VALUE_FLAGS: Readonly<Record<string, string>> = { "--require": "--require", "-r": "--require", "--ui": "--ui", "-u": "--ui", "--timeout": "--timeout", "-t": "--timeout", "--extension": "--extension" };
const MOCHA_BOOL_FLAGS: readonly string[] = ["--recursive", "--exit", "--full-trace", "--check-leaks"];
const MOCHA_UIS: readonly string[] = ["bdd", "tdd", "qunit", "exports"];
/** A --require value: a package name (optionally scoped, optionally a subpath) or a ./relative path inside the package. */
const MOCHA_REQUIRE_PKG = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:\/[\w.-]+)*$/i;
const MOCHA_REQUIRE_REL = /^\.\/(?:[\w.-]+\/)*[\w.-]+$/;

/** One mocha option value, normalised, or null when it is not on the allowlist. */
function mochaValue(root: string, pkgDir: string, flag: string, v: string): string | null {
  if (flag === "--ui") return MOCHA_UIS.includes(v) ? v : null; // m172-guard:mocha-ui
  if (flag === "--timeout") return /^\d{1,7}$/.test(v) ? v : null; // m172-guard:mocha-timeout
  if (flag === "--extension") return /^[a-z0-9]{1,8}$/i.test(v) ? v : null; // m172-guard:mocha-extension
  // --require: no absolute path and no ".." segment anywhere
  if (v.startsWith("/") || v.split("/").some((seg) => seg === "..")) return null; // m172-guard:mocha-require-dotdot
  // mocha loads a --require value as a file relative to its cwd whenever `v` or `v.js` exists there (lib/cli/
  // run-helpers.js handleRequires), with or without a leading ./ (batch 11 fix: a bare `test/x.cjs` was taken as a
  // package name and skipped this check). Any such file must be a regular file inside the package, reached through
  // no symlink (lstat of the file, and its real path equals its plain path, so no symlinked directory either).
  const base = join(root, pkgDir);
  const lexists = (c: string) => { try { lstatSync(join(base, c)); return true; } catch { return false; } };
  let local: string | null = MOCHA_REQUIRE_REL.test(v) ? v : null;
  if (local === null) local = [v, `${v}.js`].find(lexists) ?? null; // m172-guard:mocha-require-bare
  if (local !== null) {
    const full = join(base, local);
    try { if (!lstatSync(full).isFile() || realpathSync(full) !== join(realpathSync(base), local)) return null; } catch { return null; } // m172-guard:mocha-require-file
    return v;
  }
  return MOCHA_REQUIRE_PKG.test(v) && !v.startsWith(".") ? v : null; // m172-guard:mocha-require-pkg
}

/**
 * The mocha options of a package: its test script, or (one level, as scriptWords) a package script the test script
 * names, must hold exactly one command that is `mocha ...` (optionally `npx mocha ...`); its flags must all be on the
 * allowlist (see MOCHA_VALUE_FLAGS / MOCHA_BOOL_FLAGS); its other words (the spec files / globs it lists) are dropped,
 * since the loop runs the team's test files only. Returns null (refuse) for anything else.
 */
export function mochaOptions(root: string, pkgDir: string, scripts: Record<string, unknown> | undefined): string[] | null {
  const texts: string[] = [];
  const own = typeof scripts?.test === "string" ? scripts.test : "";
  texts.push(own);
  for (const w of scriptWords(scripts)) if (w !== "test" && scripts && Object.hasOwn(scripts, w) && typeof scripts[w] === "string" && !texts.includes(scripts[w] as string)) texts.push(scripts[w] as string);
  const commands = texts.flatMap((t) => t.split(/&&|\|\||[;|&]/)).map((c) => c.trim().split(/\s+/).filter(Boolean)).map((w) => (w[0] === "npx" ? w.slice(1) : w)).filter((w) => w[0] === "mocha");
  if (commands.length !== 1) return null; // m172-guard:mocha-one-command
  const words = commands[0]!.slice(1);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (!w.startsWith("-")) continue; // a spec file / glob of the script's own run: the loop names the files itself
    const eq = w.indexOf("=");
    const name = eq > 0 ? w.slice(0, eq) : w;
    if (MOCHA_BOOL_FLAGS.includes(name) && eq < 0) { out.push(name); continue; }
    const flag = MOCHA_VALUE_FLAGS[name];
    if (!flag) return null; // m172-guard:mocha-flag
    const v = eq > 0 ? w.slice(eq + 1) : words[++i];
    if (v === undefined) return null;
    const ok = mochaValue(root, pkgDir, flag, v);
    if (ok === null) return null;
    out.push(flag, ok);
  }
  return out;
}

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
 * that names another runner, or both vitest and jest, is refused; so is a repo with a compose file (outside service),
 * which is checked first (TEST_NEEDS_SERVICE wins over TEST_RUNNER_UNSUPPORTED).
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
  // batch 10: the service check comes first, so a suite that needs a database (a compose file, any runner) is
  // refused for that reason (TEST_NEEDS_SERVICE) rather than for its runner; both stay refusals
  // m172-order:service-first (batch 11: the next line must stay above guard:runner-other; m172-mutation swaps them)
  if (SERVICE_FILES.some((f) => existsSync(join(root, f)) || (pkgDir && existsSync(join(root, pkgDir, f)))) || words.includes("docker") || words.includes("docker-compose")) return { refuse: "TEST_NEEDS_SERVICE" }; // guard:service
  if (words.some((w) => (OTHER_RUNNERS as readonly string[]).includes(w))) return { refuse: "TEST_RUNNER_UNSUPPORTED" }; // guard:runner-other
  // M192 (batch 25): a refused runner (ava above all: its verdict is made in a worker the code under test owns, spec
  // loop-runners-ava-terminal-m192.md) named by path (`node_modules/.bin/ava`, `node node_modules/ava/entrypoints/cli.mjs`)
  if (words.some((w) => w.includes("/") && OTHER_RUNNERS.some((r) => w.split("/").pop() === r || w.split("/").includes("node_modules") && w.split("/")[w.split("/").indexOf("node_modules") + 1] === r))) return { refuse: "TEST_RUNNER_UNSUPPORTED" }; // m192-guard:runner-path
  const rel = (f: string) => (pkgDir ? posix.relative(pkgDir, posix.normalize(f)) : posix.normalize(f));
  const named = (["vitest", "jest", "mocha"] as const).filter((r) => words.includes(r));
  const nodeTest = typeof pkg.scripts?.test === "string" && /^(?:node|tsx)\b[^&|;]*\s--test\b/.test(pkg.scripts.test.trim());
  let runner: RunnerKind | null = null;
  if (named.length === 1) runner = named[0]!;
  else if (named.length === 0 && nodeTest) runner = "node-test";
  // M192: with no runner named, a refused runner in the dependencies is refused, not run under vitest / jest beside it
  else if (named.length === 0 && OTHER_RUNNERS.some((r) => Object.hasOwn(deps, r))) return { refuse: "TEST_RUNNER_UNSUPPORTED" }; // m192-guard:runner-dep-other
  else if (named.length === 0) { const inDeps = (["vitest", "jest"] as const).filter((r) => Object.hasOwn(deps, r)); runner = inDeps.length === 1 ? inDeps[0]! : null; }
  if (!runner) return { refuse: "TEST_RUNNER_UNSUPPORTED" };
  if (runner !== "node-test" && !Object.hasOwn(deps, runner)) return { refuse: "TEST_RUNNER_UNSUPPORTED" }; // guard:runner-dep
  if (runner === "mocha") {
    // M172: a mocha config PeaceAI does not read is refused, in the package or the repo root
    if (MOCHA_CONFIG_FILES.some((f) => existsSync(join(root, pkgDir, f)) || existsSync(join(root, f))) || Object.hasOwn(pkg, "mocha") || Object.hasOwn(rootPkg, "mocha")) return { refuse: "TEST_RUNNER_UNSUPPORTED" }; // m172-guard:mocha-config
    const options = mochaOptions(root, pkgDir, pkgDir && !pkg.scripts?.test ? rootPkg.scripts : pkg.scripts);
    if (!options) return { refuse: "TEST_RUNNER_UNSUPPORTED" }; // m172-guard:mocha-options
    return { runner, pkgDir, files: testFiles.map(rel), hasDeps, options };
  }
  return { runner, pkgDir, files: testFiles.map(rel), hasDeps };
}

// ---- 2. dependencies

export interface LockPick { pm: PackageManager; lockfile: string; version: string | null }
const LOCKFILES: [string, PackageManager][] = [["pnpm-lock.yaml", "pnpm"], ["package-lock.json", "npm"], ["npm-shrinkwrap.json", "npm"], ["yarn.lock", "yarn"]];
/** Default package-manager versions by lockfile format, when package.json pins none. */
const PNPM_BY_LOCK: [RegExp, string][] = [[/^lockfileVersion: '?9\./m, "9.15.9"], [/^lockfileVersion: '?6\./m, "8.15.9"], [/^lockfileVersion: '?5\./m, "7.33.7"]];

/** Lockfiles larger than this are refused (DEPS_TOO_LARGE) before any is read. */
export const LOCK_MAX_BYTES = 64 * 1024 * 1024;
/** The lockfiles at the repo root (regular files only: a symlinked lockfile is not copied to the install tree). */
const presentLockfiles = (root: string): [string, PackageManager][] => LOCKFILES.filter(([f]) => existsSync(join(root, f)) && lstatSync(join(root, f)).isFile());

/** The only packageManager form accepted: name@x.y.z with an optional +algo.hexhash (no URL, range or tag). */
export const PACKAGE_MANAGER_FIELD = /^(npm|pnpm|yarn)@(\d{1,3}\.\d{1,3}\.\d{1,3})(?:\+[a-z0-9]+\.[0-9a-f]+)?$/;
/** The lockfile at the repo root and the package manager that reads it (packageManager pins the version). */
export function pickLockfile(root: string, maxBytes: number = LOCK_MAX_BYTES): LockPick | { refuse: DepsCode } {
  const present = presentLockfiles(root);
  if (!present.length) return { refuse: "DEPS_NO_LOCKFILE" }; // guard:deps-lockfile
  if (present.some(([f]) => lstatSync(join(root, f)).size > maxBytes)) return { refuse: "DEPS_TOO_LARGE" }; // guard:lock-size
  const pmField = String(readJson(join(root, "package.json"))?.packageManager ?? "");
  const m = PACKAGE_MANAGER_FIELD.exec(pmField);
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
/** yarn v1 only: the yarn mirror of the same registry is allowed too (Auditor ruling, M151 r3). */
export const YARN_REGISTRIES = [REGISTRY, "https://registry.yarnpkg.com/"] as const;
/** A yarn v1 entry: an allowed registry host, a plain tarball path, and integrity (or, without it, the #sha1 yarn checks). */
const yarnSourceOk = (resolved: unknown, integrity: unknown): boolean => {
  if (typeof resolved !== "string") return false;
  const m = /^(.*?)(?:#([0-9a-f]{40}))?$/.exec(resolved)!;
  const host = YARN_REGISTRIES.find((h) => m[1]!.startsWith(h));
  if (!host || /[\s\\?#]|\.\.|\/\//.test(m[1]!.slice(host.length))) return false;
  return integrity === undefined ? m[2] !== undefined : integrityOk(integrity);
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

// ---- pnpm-lock.yaml: a parser for the plain subset of YAML pnpm writes, then structural checks
// Block mappings and sequences with 2-space steps, one-level flow collections at depth >= 2, single-line plain /
// single-quoted / escape-free double-quoted scalars, whole-line comments. Anything else (flow at the top levels,
// nested flow, escapes, anchors / aliases / tags / merge keys, other indent steps, duplicate keys, block or
// multi-line scalars, inline comments, documents, tabs, odd line breaks) is refused: within the subset every YAML
// parser (pnpm's included) reads the same tree, so the checks below see what pnpm will install.
type YNode = string | YNode[] | { [k: string]: YNode };
const FAIL = Symbol("yaml");
const ymap = (): { [k: string]: YNode } => Object.create(null);
const isYMap = (x: unknown): x is { [k: string]: YNode } => typeof x === "object" && x !== null && !Array.isArray(x);

/** One scalar token (already cut out of its line or flow), or FAIL. */
function yScalar(t: string, flowCtx: boolean): string | typeof FAIL {
  if (!t) return FAIL;
  if (/^[&*!]/.test(t) || t === "<<") return FAIL; // guard:lock-pnpm-anchor
  if (t[0] === '"' && t.includes("\\")) return FAIL; // guard:lock-pnpm-esc
  if (t[0] === "'") return /^'(?:[^']|'')*'$/.test(t) ? t.slice(1, -1).replace(/''/g, "'") : FAIL;
  if (t[0] === '"') return /^"[^"]*"$/.test(t) ? t.slice(1, -1) : FAIL;
  if (/^[-?:](?:\s|$)|^[|>%@`{}[\],#"']/.test(t) || /:(?:\s|$)|\s#|\s$/.test(t) || (flowCtx && /[{}[\],]/.test(t))) return FAIL;
  return t;
}

/** A one-line flow collection ({a: b, c: d} / [a, b]); nesting is parsed (the subset check refuses it first). */
function yFlow(s: string): YNode | typeof FAIL {
  let i = 0;
  const ws = () => { while (s[i] === " ") i++; };
  const tok = (): string | typeof FAIL => {
    ws();
    const at = i;
    if (s[i] === "'") { for (i++; i < s.length; i++) if (s[i] === "'") { if (s[i + 1] === "'") { i++; continue; } i++; return yScalar(s.slice(at, i), true); } return FAIL; }
    if (s[i] === '"') { i = s.indexOf('"', i + 1); if (i < 0) return FAIL; i++; return yScalar(s.slice(at, i), true); }
    while (i < s.length && !/[,{}[\]]/.test(s[i]!) && !(s[i] === ":" && (s[i + 1] === " " || s[i + 1] === undefined))) i++;
    return yScalar(s.slice(at, i).trimEnd(), true);
  };
  const node = (): YNode | typeof FAIL => {
    ws();
    const open = s[i];
    if (open !== "{" && open !== "[") return tok();
    i++;
    const out: YNode = open === "{" ? ymap() : [];
    const close = open === "{" ? "}" : "]";
    ws();
    if (s[i] === close) { i++; return out; }
    for (;;) {
      if (Array.isArray(out)) { const v = node(); if (v === FAIL) return FAIL; out.push(v); }
      else {
        const k = tok(); if (k === FAIL) return FAIL;
        ws(); if (s[i] !== ":") return FAIL; i++;
        const v = node(); if (v === FAIL || Object.hasOwn(out, k)) return FAIL;
        out[k] = v;
      }
      ws();
      if (s[i] === ",") { i++; continue; }
      if (s[i] === close) { i++; return out; }
      return FAIL;
    }
  };
  const r = node();
  ws();
  return r !== FAIL && i === s.length ? r : FAIL;
}

/** pnpm-lock.yaml text -> tree, or null when the text is outside the plain subset. */
export function pnpmParse(text: string): { [k: string]: YNode } | null {
  if (/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f\u0085\u2028\u2029\ufeff]/.test(text)) return null;
  const lines = text.split(/\r?\n/);
  if (lines.some((l) => l.includes("\r"))) return null;
  const root = ymap();
  const frames: { indent: number; node: YNode[] | { [k: string]: YNode } }[] = [{ indent: 0, node: root }];
  let pending: { indent: number; map: { [k: string]: YNode }; key: string } | null = null;
  const value = (v: string, indent: number): YNode | typeof FAIL => {
    const flow = v[0] === "{" || v[0] === "[";
    if (flow && v !== "{}" && v !== "[]" && (indent < 4 || /[{[]/.test(v.slice(1)))) return FAIL; // guard:lock-pnpm-flow
    return flow ? yFlow(v) : yScalar(v, false);
  };
  for (const line of lines) {
    if (/^ *(?:#.*)?$/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    const c = line.slice(indent);
    if (pending && indent > pending.indent) {
      if (indent !== pending.indent + 2) return null; // guard:lock-pnpm-indent
      const child: YNode[] | { [k: string]: YNode } = /^-(?: |$)/.test(c) ? [] : ymap();
      pending.map[pending.key] = child;
      frames.push({ indent, node: child });
      pending = null;
    } else {
      pending = null;
      while (frames.length > 1 && frames[frames.length - 1]!.indent > indent) frames.pop();
      if (frames[frames.length - 1]!.indent !== indent) return null;
    }
    const top = frames[frames.length - 1]!.node;
    if (Array.isArray(top)) {
      const m = /^- (.+)$/.exec(c);
      if (!m) return null;
      const v = value(m[1]!.trim(), indent);
      if (v === FAIL) return null;
      top.push(v);
      continue;
    }
    const m = /^('(?:[^']|'')*'|"[^"]*"|[^'"][^:]*?):(?: +(.*))?$/.exec(c);
    if (!m) return null;
    const k = yScalar(m[1]!, false);
    if (k === FAIL) return null;
    if (Object.hasOwn(top, k)) return null; // guard:lock-pnpm-dup
    const rest = (m[2] ?? "").trim();
    if (!rest) { top[k] = ""; pending = { indent, map: top, key: k }; continue; }
    const v = value(rest, indent);
    if (v === FAIL) return null;
    top[k] = v;
  }
  return root;
}

const PNPM_URL = /:\/\/|(?:^|[\s{,'"@])(?:file|git|git\+[a-z]+|github|gitlab|bitbucket|gist|tarball):/;
/** pnpm-lock.yaml (v5 / v6 / v9): parsed (plain subset only), then every package must resolve by integrity only. */
export function pnpmLockAllowed(text: string): boolean {
  const doc = pnpmParse(text);
  if (!doc) return false;
  for (const sec of ["packages", "snapshots"]) {
    const m = doc[sec];
    if (m === undefined || m === "") continue;
    if (!isYMap(m)) return false;
    for (const [k, v] of Object.entries(m)) {
      if (k.includes(":")) return false; // guard:lock-pnpm-key
      if (sec === "snapshots") continue;
      if (!isYMap(v)) return false;
      const res = v.resolution;
      if (res === undefined) return false; // guard:lock-pnpm-missing
      const resOk = res === undefined || isYMap(res) && Object.keys(res).every((x) => x === "integrity" || x === "tarball") && integrityOk(res.integrity)
        && (res.tarball === undefined || registryOk(res.tarball, res.integrity));
      if (!resOk) return false; // guard:lock-pnpm-res
    }
  }
  // every value (never a key: a dependency name such as "simple-git" is not a source); deprecated notices are free text,
  // resolutions were checked above
  const walk = (n: YNode, path: string[]): boolean => {
    if (typeof n !== "string") return (Array.isArray(n) ? n.map((x, i) => [String(i), x] as const) : Object.entries(n)).every(([k, x]) => walk(x, [...path, k]));
    if (path[0] === "packages" && path.length >= 3 && (path[2] === "deprecated" || path[2] === "resolution")) return true; // checked above
    const importer = path[0] === "importers" ? path[1]! : ".";
    for (const m of n.matchAll(/(?:^|[\s{,'"])link:([^\s'",}]*)/g)) if (!insideRepo(importer, m[1])) return false; // guard:lock-pnpm-link
    if (PNPM_URL.test(n)) return false; // guard:lock-pnpm-url
    return true;
  };
  return walk(doc, []);
}

// ---- yarn v1 (Auditor FAILs 71fff3d and 7e7a41d). yarn 1.22's own lockfile parser (src/lockfile/parse.js) falls back
// to YAML when it throws, and its resolver re-resolves (fetches) a locked entry whose version is outside the range,
// any pattern that is not a lockfile key, and a workspace dep whose version does not match. So: a strict subset of
// the yarn format that yarn's parser reads the same way (no fallback), and a closure + semver check over it.

/** A strict semver version (node-semver `valid`, non-loose), or null. Numbers capped at 9 digits. */
type SemVer = { main: [number, number, number]; pre: (string | number)[] };
const SV_NUM = "(?:0|[1-9]\\d{0,8})";
const SV_PRE = `(?:${SV_NUM}|\\d*[A-Za-z-][0-9A-Za-z-]*)`;
const SV_RX = new RegExp(`^(${SV_NUM})\\.(${SV_NUM})\\.(${SV_NUM})(?:-(${SV_PRE}(?:\\.${SV_PRE})*))?$`);
export function semverParse(s: string): SemVer | null {
  const m = s.length <= 256 ? SV_RX.exec(s) : null;
  if (!m) return null;
  return { main: [+m[1]!, +m[2]!, +m[3]!], pre: m[4] === undefined ? [] : m[4].split(".").map((x) => /^\d+$/.test(x) ? +x : x) };
}
function semverCmp(a: SemVer, b: SemVer): number {
  for (let i = 0; i < 3; i++) if (a.main[i] !== b.main[i]) return a.main[i]! < b.main[i]! ? -1 : 1;
  if (a.pre.length && !b.pre.length) return -1;
  if (!a.pre.length && b.pre.length) return 1;
  for (let i = 0; ; i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === undefined && y === undefined) return 0;
    if (y === undefined) return 1;
    if (x === undefined) return -1;
    if (x === y) continue;
    const xn = typeof x === "number", yn = typeof y === "number";
    if (xn && !yn) return -1;
    if (yn && !xn) return 1;
    return x < y ? -1 : 1;
  }
}
type Op = "" | "<" | ">" | "<=" | ">=";
type Comparator = { op: Op; v: SemVer } | null; // null: any
const SV_PART = `(${SV_NUM}|[xX*])`;
const SV_COMP = new RegExp(`^(\\^|~|>=|<=|>|<|=)?${SV_PART}(?:\\.${SV_PART}(?:\\.${SV_PART}(?:-(${SV_PRE}(?:\\.${SV_PRE})*))?)?)?$`);
const ver = (M: number, m: number, p: number, pre = ""): SemVer => semverParse(`${M}.${m}.${p}${pre ? "-" + pre : ""}`)!;
/** One comparator token -> node-semver 5's desugaring (replaceCaret / replaceTilde / replaceXRange), or null. */
function semverComparator(tok: string): Comparator[] | null {
  const m = SV_COMP.exec(tok);
  if (!m) return null;
  const op = m[1] ?? "";
  const isX = (s: string | undefined) => s === undefined || /^[xX*]$/.test(s);
  const [sM, sm, sp, pr] = [m[2], m[3], m[4], m[5]];
  if (pr !== undefined && (isX(sM) || isX(sm) || isX(sp))) return null;
  const M = isX(sM) ? 0 : +sM!, mi = isX(sm) ? 0 : +sm!, p = isX(sp) ? 0 : +sp!;
  const range = (lo: SemVer, hi: SemVer): Comparator[] => [{ op: ">=", v: lo }, { op: "<", v: hi }];
  if (op === "^" || op === "~") {
    if (isX(sM)) return [null];
    if (isX(sm)) return range(ver(M, 0, 0), ver(M + 1, 0, 0));
    if (isX(sp)) return range(ver(M, mi, 0), op === "~" || M === 0 ? ver(M, mi + 1, 0) : ver(M + 1, 0, 0));
    const lo = ver(M, mi, p, pr);
    if (op === "~") return range(lo, ver(M, mi + 1, 0));
    return range(lo, M !== 0 ? ver(M + 1, 0, 0) : mi !== 0 ? ver(0, mi + 1, 0) : ver(0, 0, p + 1));
  }
  const xM = isX(sM), xm = xM || isX(sm), xp = xm || isX(sp);
  let g = op === "=" ? "" : op;
  if (xM) return g === ">" || g === "<" ? [{ op: "<", v: ver(0, 0, 0) }] : [null];
  if (g && xp) {
    let [a, b, c] = [M, xm ? 0 : mi, 0];
    if (g === ">") { g = ">="; if (xm) { a = M + 1; b = 0; c = 0; } else { b = mi + 1; c = 0; } }
    else if (g === "<=") { g = "<"; if (xm) a = M + 1; else b = mi + 1; }
    return [{ op: g as ">=" | "<", v: ver(a, b, c) }];
  }
  if (xm) return range(ver(M, 0, 0), ver(M + 1, 0, 0));
  if (xp) return range(ver(M, mi, 0), ver(M, mi + 1, 0));
  return [{ op: g as Op, v: ver(M, mi, p, pr) }];
}
/** A semver range in the subset yarn locks use (|| of space-separated comparators; no hyphen ranges, no build
 * metadata, no "v" prefix, no loose forms) -> comparator sets, or null for anything else. */
export function semverRange(r: string): Comparator[][] | null {
  if (r.length > 256 || !/^[0-9A-Za-z.^~<>=|*+ -]+$/.test(r) || r !== r.trim()) return null;
  const sets: Comparator[][] = [];
  for (const raw of r.split(/ *\|\| */)) {
    if (!raw) return null;
    const toks = raw.split(/ +/);
    const set: Comparator[] = [];
    for (let i = 0; i < toks.length; i++) {
      let t = toks[i]!;
      if (/^(?:>=|<=|>|<|=)$/.test(t) && i + 1 < toks.length) t += toks[++i]!;
      const c = semverComparator(t);
      if (!c) return null;
      set.push(...c);
    }
    sets.push(set);
  }
  return sets;
}
/** node-semver 5 satisfies(version, range) for a version from semverParse and a range from semverRange. */
export function semverSatisfies(v: SemVer, sets: Comparator[][]): boolean {
  const test = (c: Comparator) => { if (!c) return true; const k = semverCmp(v, c.v); return c.op === "" ? k === 0 : c.op === "<" ? k < 0 : c.op === ">" ? k > 0 : c.op === "<=" ? k <= 0 : k >= 0; };
  return sets.some((set) => set.every(test) && (!v.pre.length || set.some((c) => !!c && c.v.pre.length > 0 && c.v.main.every((x, i) => x === v.main[i]))));
}

/** An npm package name as yarn's resolvers see it (so no exotic resolver matches the pattern on the name). */
const NPM_NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[A-Za-z0-9~-][A-Za-z0-9._~-]*$/;
/** "name@range" split as yarn's normalizePattern does, with a valid name and a non-empty range; or null. */
export function yarnPattern(spec: string): { name: string; range: string } | null {
  const scoped = spec.startsWith("@");
  const at = spec.indexOf("@", scoped ? 1 : 0);
  if (at <= 0) return null;
  const name = spec.slice(0, at), range = spec.slice(at + 1);
  if (!NPM_NAME.test(name)) return null; // guard:lock-yarn-name
  return range ? { name, range } : null;
}
/** A registry range: a semver range in the subset, or an npm: alias to name@<such a range>. */
const registryRange = (r: string): boolean => {
  if (r.startsWith("npm:")) { const p = yarnPattern(r.slice(4)); return !!p && semverRange(p.range) !== null; }
  return semverRange(r) !== null;
};

/** The tokens of one yarn.lock line as yarn 1.22's tokenizer cuts them (strings, "," and ":"; spaces skipped), but
 * only for strings yarn's own writer could have written: a quoted string without a backslash, or a bare one that
 * starts with a letter, is not true / false and has no quote, backslash or bracket. Else null. */
type YarnTok = { s: string } | "," | ":";
function yarnLineTokens(line: string): YarnTok[] | null {
  if (!/^[\x20-\x7e]*$/.test(line)) return null;
  const out: YarnTok[] = [];
  for (let i = 0; i < line.length;) {
    const c = line[i]!;
    if (c === " ") { i++; continue; }
    if (c === "," || c === ":") { out.push(c); i++; continue; }
    if (c === '"') {
      const j = line.indexOf('"', i + 1);
      if (j < 0) return null;
      const s = line.slice(i + 1, j);
      if (s.includes("\\")) return null;
      out.push({ s }); i = j + 1; continue;
    }
    let j = i;
    while (j < line.length && line[j] !== " " && line[j] !== "," && line[j] !== ":") j++;
    const s = line.slice(i, j);
    if (!/^[a-zA-Z]/.test(s) || /^(?:true|false)/.test(s) || /["\\[\]]/.test(s)) return null; // guard:lock-yarn-bare
    out.push({ s }); i = j;
  }
  return out;
}
const isStr = (t: YarnTok | undefined): t is { s: string } => typeof t === "object";

/** One yarn.lock v1 header line ("a@^1", a@^1.2:) -> its specs, or null for any other shape. */
export function yarnHeaderSpecs(line: string): string[] | null {
  const t = yarnLineTokens(line);
  if (!t || t[t.length - 1] !== ":") return null;
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i += 2) {
    const s = t[i];
    if (!isStr(s) || !s.s) return null;
    if (i + 1 < t.length - 1 && t[i + 1] !== ",") return null; // guard:lock-yarn-colon
    out.push(s.s);
  }
  return out.length && t.length === out.length * 2 ? out : null;
}

type YarnBlock = { specs: string[]; fields: Map<string, string>; maps: Map<string, Map<string, string>> };
const YARN_SCALARS = new Set(["version", "resolved", "integrity"]);
const YARN_MAPS = new Set(["dependencies", "optionalDependencies"]);
/** A yarn.lock v1 in the strict subset -> its blocks; null for anything else (yarn's parser could read it differently
 * or fall back to YAML): no CR / tab / non-ASCII / BOM, only "" or "#..." lines at column 0 besides headers, fields at
 * exactly 2 spaces, dependency entries at exactly 4 under a dependency map, no duplicate field or entry. */
export function yarnLockParse(text: string): YarnBlock[] | null {
  const blocks: YarnBlock[] = [];
  let map: Map<string, string> | null = null;
  for (const line of text.split("\n")) {
    if (line === "") continue;
    // yarn throws on a "yarn lockfile vN" comment with N > 1, and then reads the file as YAML instead
    if (line.startsWith("#") && /^yarn lockfile v\d+$/.test(line.slice(1).trim()) && line.slice(1).trim() !== "yarn lockfile v1") return null; // guard:lock-yarn-comment
    if (line.startsWith("#")) continue;
    if (!line.startsWith(" ")) { const specs = yarnHeaderSpecs(line); if (!specs) return null; blocks.push({ specs, fields: new Map(), maps: new Map() }); map = null; continue; }
    const b = blocks[blocks.length - 1];
    const t = yarnLineTokens(line);
    if (!b || !t) return null;
    if (/^ {4}\S/.test(line)) {
      if (!map || t.length !== 2 || !isStr(t[0]) || !isStr(t[1]) || map.has(t[0].s)) return null;
      map.set(t[0].s, t[1].s);
      continue;
    }
    if (!isStr(t[0]) || !(isStr(t[1]) || t[1] === ":")) return null;
    if (!/^ {2}[A-Za-z]/.test(line) || t.length !== 2) return null; // guard:lock-yarn-field
    const key = t[0].s;
    if (b.fields.has(key) || b.maps.has(key)) return null; // guard:lock-yarn-dup
    if (!(t[1] === ":" ? YARN_MAPS : YARN_SCALARS).has(key)) return null; // guard:lock-yarn-key
    if (t[1] === ":") { map = new Map(); b.maps.set(key, map); } else { b.fields.set(key, (t[1] as { s: string }).s); map = null; }
  }
  return blocks;
}

/** Every spec in a yarn.lock v1's headers (name@range, as package.json writes it), or null when the lock is outside the subset. */
export function yarnLockSpecs(text: string): Set<string> | null {
  const blocks = yarnLockParse(text);
  return blocks ? new Set(blocks.flatMap((b) => b.specs)) : null;
}

/**
 * yarn.lock v1 (berry is refused earlier), in the strict subset. Every block: each header spec a valid name with a
 * registry range (semver subset or npm: alias) or an in-repo link:, a version inside every semver header range
 * (yarn re-resolves an "outdated" entry from the registry), the registry + integrity source rule. Every entry under
 * dependencies / optionalDependencies of every block (the closure yarn walks from the lock) must be a registry
 * range and a header of this lock: yarn resolves anything else afresh.
 */
export function yarnLockAllowed(text: string): boolean {
  if (/[\r\t]/.test(text) || text.startsWith("\ufeff")) return false;
  const blocks = yarnLockParse(text);
  if (!blocks) return false;
  const specs = new Set(blocks.flatMap((b) => b.specs));
  for (const b of blocks) {
    const pats = b.specs.map(yarnPattern);
    if (pats.some((p) => p === null)) return false;
    const ranges = pats.map((p) => p!.range);
    const resolved = b.fields.get("resolved");
    const links = ranges.every((r) => r.startsWith("link:") && insideRepo(".", r.slice(5)));
    if (!ranges.every((r) => registryRange(r) || (r.startsWith("link:") && insideRepo(".", r.slice(5))))) return false; // guard:lock-yarn-spec
    const v = semverParse(b.fields.get("version") ?? "");
    if (ranges.some((r) => semverRange(r) !== null && !(v && semverSatisfies(v, semverRange(r)!)))) return false; // guard:lock-yarn-outdated
    for (const deps of b.maps.values()) for (const [n, r] of deps) {
      if (!registryRange(r) || !yarnPattern(`${n}@${r}`)) return false; // guard:lock-yarn-dep-spec
      if (!specs.has(`${n}@${r}`)) return false; // guard:lock-yarn-closure
    }
    if (links && resolved === undefined) continue;
    if (!yarnSourceOk(resolved, b.fields.get("integrity"))) return false; // guard:lock-yarn
  }
  return true;
}

const scanLock = (root: string, f: string, pm: PackageManager): boolean => {
  let text: string;
  try { text = readFileSync(join(root, f), "utf8"); } catch { return false; }
  return pm === "npm" ? npmLockAllowed(text) : pm === "pnpm" ? pnpmLockAllowed(text) : yarnLockAllowed(text);
};
/**
 * Every package in the lockfile comes from the registry with an integrity hash, or is a workspace / link entry
 * inside the repo. Every other lockfile at the root is scanned too (npm also reads yarn.lock), and a repo with both
 * npm-shrinkwrap.json and package-lock.json is refused (npm ci would read the shrinkwrap; no guessing).
 */
function rootLockfilesAllowed(root: string, p: LockPick): boolean {
  const present = presentLockfiles(root);
  if (present.some(([f]) => f === "npm-shrinkwrap.json") && present.some(([f]) => f === "package-lock.json")) return false; // guard:lock-npm-both
  for (const [f, pm] of present) if (f !== p.lockfile && !scanLock(root, f, pm)) return false; // guard:lock-all
  return scanLock(root, p.lockfile, p.pm);
}

// ---- package-manager settings outside the root lockfile (Auditor FAIL 886ee29, M151 r4)
/** Lockfile names refused anywhere below the root: a package manager can be made to read a nested one (pnpm with
 * sharedWorkspaceLockfile: false installs each workspace package from its own lock), and only the root is scanned. */
export const NESTED_LOCKFILES = ["pnpm-lock.yaml", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "bun.lock", "bun.lockb"] as const;
/** The only top-level keys a pnpm-workspace.yaml may hold. Every other key is a pnpm setting (registries,
 * sharedWorkspaceLockfile, overrides, pnpmfile, configDependencies, ...) and is refused rather than judged. */
export const PNPM_WORKSPACE_KEYS = ["packages", "catalog", "catalogs"] as const;
/**
 * M169: pnpm-workspace.yaml keys that cannot change what is fetched or from where, nor run code, under the loop's
 * install (frozen lockfile, --ignore-scripts, registry pinned): which dependencies may run build scripts (scripts are
 * off anyway) and how old a version must be to be newly resolved (nothing is resolved under a frozen lockfile). Each
 * is shape-checked (pnpmInertOk); any other key is still refused.
 */
export const PNPM_WORKSPACE_INERT_KEYS = ["allowBuilds", "onlyBuiltDependencies", "neverBuiltDependencies", "ignoredBuiltDependencies", "minimumReleaseAge", "minimumReleaseAgeExclude"] as const;
const PKG_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*(?:@[A-Za-z0-9.+-]+)?$/;
/** One inert key's value has the shape pnpm documents (names, a name->boolean map, a minute count); else refused. */
export function pnpmInertOk(key: string, v: YNode | undefined): boolean {
  if (v === undefined || v === "") return true;
  const names = (x: YNode) => Array.isArray(x) && x.every((n) => typeof n === "string" && PKG_NAME.test(n));
  if (key === "allowBuilds") return isYMap(v) && Object.entries(v).every(([k, b]) => PKG_NAME.test(k) && (b === "true" || b === "false")); // m169-guard:pnpm-inert-builds
  if (key === "minimumReleaseAge") return typeof v === "string" && /^\d{1,9}$/.test(v); // m169-guard:pnpm-inert-age
  return names(v); // m169-guard:pnpm-inert-names
}
const TREE_MAX_ENTRIES = 500_000;

/** Every non-directory entry under a tree (repo-relative, symlinks not followed, .git skipped). complete: false when a
 * dir could not be read or the tree is over TREE_MAX_ENTRIES (the caller refuses: what was not seen is not vouched for). */
export function treeFiles(root: string): { files: string[]; complete: boolean } {
  const files: string[] = [];
  let n = 0;
  const walk = (rel: string): boolean => {
    let ents: string[];
    try { ents = readdirSync(join(root, rel)); } catch { return false; }
    for (const e of ents) {
      if (++n > TREE_MAX_ENTRIES) return false;
      const r = rel ? `${rel}/${e}` : e;
      let st; try { st = lstatSync(join(root, r)); } catch { return false; }
      if (!st.isDirectory()) files.push(r);
      else if (e !== ".git" && !walk(r)) return false;
    }
    return true;
  };
  const complete = walk("");
  return { files, complete };
}

/** A workspace glob of plain path segments with * and ** only: inside the repo, no "..", no leading ".", "/" or "#"
 * (a minimatch comment), no empty or "." segment and no trailing "/" (the package managers normalise those; the
 * matcher below does not), no brace / class / ? / extglob / escape syntax. */
export function plainGlob(g: string): boolean {
  if (g.split("/").some((seg) => seg === "" || seg === ".")) return false; // guard:glob-segment
  return insideRepo(".", g) && !/(?:^|\/)\.\.(?:\/|$)/.test(g) && !/^[./#]/.test(g) && !/[{}?[\]()!+@\\]/.test(g);
}
/** A plain glob -> a test over repo-relative dirs: "*" is any chars within a segment, a "**" segment any number of
 * segments (none too). Matched against "/" + dir so a "**" segment can stand for nothing. */
const globRx = (g: string): RegExp => new RegExp("^" + g.split("/").map((seg) => seg === "**" ? "(?:/.*)?" : "/" + seg.replace(/[.^$|]/g, "\\$&").replace(/\*+/g, "[^/]*")).join("") + "$");

/** A package.json as a JSON object (regular file, size-capped, a leading BOM stripped as the package managers do), or null. */
function readPkg(p: string): Record<string, unknown> | null {
  const t = smallFile(p);
  if (t === null) return null;
  try { const o = JSON.parse(t.replace(/^\ufeff/, "")); return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch { return null; }
}

/** packageManager (read by corepack and by pnpm itself) only as name@x.y.z[+hash]; a devEngines package manager /
 * runtime only with an explicit onFail that is not "download" (M188: corepack and pnpm can fetch on download). The root must be a JSON object; other package.json files are judged
 * when they parse (corepack reads the nearest one to the install dir: the root). */
export function managerFieldsOk(p: string, isRoot: boolean): boolean {
  const o = readPkg(p);
  if (!o) return !isRoot;
  if (o.packageManager !== undefined && !(typeof o.packageManager === "string" && PACKAGE_MANAGER_FIELD.test(o.packageManager))) return false;
  const de = o.devEngines;
  if (de === undefined) return true;
  if (!de || typeof de !== "object" || Array.isArray(de)) return false;
  // M188: a package manager / runtime entry only as a check that never downloads (devEnginesEntryOk); the loop's
  // install names its manager explicitly (corepack pm@x.y.z), which corepack 0.36 runs without reading devEngines
  if (!(["packageManager", "runtime"] as const).every((k) => !Object.hasOwn(de, k) || devEnginesEntryOk(k, (de as Record<string, unknown>)[k]))) return false; // m188-guard:dev-entry
  return true;
}

/** Dependency fields yarn v1 installs. peerDependencies are not installed by yarn v1 (PackageRequest/install pushDeps
 *  read only these three), so not read here; bundledDependencies must be absent or empty (guard yarn-bundled). */
export const YARN_DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"] as const;
/**
 * yarn v1 only: --frozen-lockfile does not stop yarn fetching a dependency that has no yarn.lock entry, so every
 * dependency spec in the root and in every other package.json in the tree (workspace or not) must be a `name@spec`
 * header in yarn.lock, or name a workspace package (name + strict semver version) whose version satisfies the spec
 * as a plain semver range. resolutions only at the root and only to a locked registry range (M188,
 * yarnResolutionsOk), else refused; workspaces must be
 * plain globs (an array, or {packages, nohoist}).
 */
export function yarnManifestsAllowed(root: string, files: readonly string[]): boolean {
  const lockText = smallFile(join(root, "yarn.lock"));
  const lock = lockText === null ? null : yarnLockSpecs(lockText);
  const rootPkg = readPkg(join(root, "package.json"));
  if (!lock || !rootPkg) return false;
  const ws = rootPkg.workspaces;
  const globs = ws === undefined ? [] : Array.isArray(ws) ? ws : ws && typeof ws === "object" && Object.keys(ws).every((k) => k === "packages" || k === "nohoist") ? ((ws as { packages?: unknown }).packages ?? []) : null;
  if (!Array.isArray(globs) || !globs.every((g) => typeof g === "string" && plainGlob(g))) return false; // guard:yarn-ws-glob
  const rxs = (globs as string[]).map(globRx);
  const nested = files.filter((f) => f !== "package.json" && posix.basename(f) === "package.json");
  // Workspaces, for the workspace-name rule only: a SUBSET of what yarn's glob finds (node-glob, dot: false, the
  // pattern's node_modules ignored), so a package yarn does not treat as a workspace is never counted as one here.
  const wsDirs = nested.map((f) => posix.dirname(f)).filter((d) => rxs.some((r) => r.test("/" + d)));
  let wsSure = wsDirs;
  wsSure = wsDirs.filter((d) => !d.split("/").some((seg) => seg.startsWith(".") || seg === "node_modules")); // guard:yarn-ws-dot
  // The dependency rules apply to EVERY package.json in the tree, workspace or not (Auditor FAIL e5f28a6), so no
  // difference between this matcher and yarn's can leave a package yarn installs unchecked.
  let manifests = wsDirs.map((d) => `${d}/package.json`);
  manifests = nested; // guard:yarn-all-manifests
  const pkgs = [rootPkg, ...manifests.map((f) => readPkg(join(root, f)))];
  if (pkgs.some((x) => x === null)) return false;
  // yarn ignores a workspace package without both a name and a version (it is then not a workspace at all).
  const wsVer = new Map<string, SemVer | null>();
  for (const x of wsSure.map((d) => readPkg(join(root, d, "package.json")))) if (x && typeof x.name === "string" && typeof x.version === "string" && x.name && x.version) wsVer.set(x.name, semverParse(x.version));
  for (const pkg of pkgs as Record<string, unknown>[]) {
    if (Object.hasOwn(pkg, "resolutions") && !(pkg === rootPkg && yarnResolutionsOk(pkg.resolutions, lock))) return false; // guard:yarn-resolutions
    for (const b of ["bundledDependencies", "bundleDependencies"]) if (pkg[b] !== undefined && !(Array.isArray(pkg[b]) && (pkg[b] as unknown[]).length === 0)) return false; // guard:yarn-bundled
    for (const field of YARN_DEP_FIELDS) {
      const deps = pkg[field];
      if (deps === undefined) continue;
      if (!deps || typeof deps !== "object" || Array.isArray(deps) || !Object.values(deps).every((v) => typeof v === "string")) return false; // guard:yarn-dep-shape
      for (const [n, spec] of Object.entries(deps as Record<string, string>)) {
        if (lock.has(`${n}@${spec}`)) continue;
        // Else it must name a workspace whose version is in the range (yarn: semver.satisfies, loose); otherwise yarn
        // fetches name@spec from the registry, which has no lock entry. Non-strict versions / ranges are refused.
        const v = wsVer.get(n), r = semverRange(spec);
        if (!v || !r || !semverSatisfies(v, r)) return false; // guard:yarn-dep-lock
      }
    }
  }
  return true;
}

/** A regular file under the size cap, as text; null otherwise (a symlink, a dir, unreadable, too large). */
function smallFile(p: string): string | null {
  try { const st = lstatSync(p); if (!st.isFile() || st.size > LOCK_MAX_BYTES) return null; return readFileSync(p, "utf8"); } catch { return null; }
}

/** What a pnpm setting is checked against: the repo (patch files) and the scanned root lockfile (null: none read). */
export interface PnpmCtx { root: string; files: readonly string[]; lock: { [k: string]: YNode } | null }
const NO_PNPM_CTX: PnpmCtx = { root: "", files: [], lock: null };
/** M188: a key pnpmSettingOk judges (layout / check settings, overrides, patchedDependencies, peerDependencyRules). */
const pnpmSettingKey = (k: string): boolean => (PNPM_LAYOUT_BOOLS as readonly string[]).includes(k) || Object.hasOwn(PNPM_LAYOUT_ENUMS, k) || (PNPM_LAYOUT_PATTERNS as readonly string[]).includes(k) || (PNPM_LOCKED_KEYS as readonly string[]).includes(k);
/** pnpm-workspace.yaml: the plain YAML subset (the lockfile parser), only packages / catalog / catalogs, the M169
 * inert keys and the M188 settings (each in its vetted shape; overrides / patchedDependencies only against the
 * lockfile in ctx), packages globs inside the repo, catalog entries plain version ranges (npm: aliases allowed; no
 * other protocol). Every other key (registries, packageExtensions, configDependencies, pnpmfile, ...) is refused. */
export function pnpmWorkspaceAllowed(text: string, ctx: PnpmCtx = NO_PNPM_CTX): boolean {
  const parsed = pnpmParse(text);
  if (parsed === null) return false; // guard:pnpm-ws-parse
  const doc = parsed ?? ymap();
  if (!Object.keys(doc).every((k) => (PNPM_WORKSPACE_KEYS as readonly string[]).includes(k) || (PNPM_WORKSPACE_INERT_KEYS as readonly string[]).includes(k) || pnpmSettingKey(k))) return false; // guard:pnpm-ws-key
  if (!Object.keys(doc).every((k) => !pnpmSettingKey(k) || pnpmSettingOk(k, doc[k], ctx.root, ctx.files, ctx.lock))) return false; // m188-guard:ws-setting
  if (!PNPM_WORKSPACE_INERT_KEYS.every((k) => pnpmInertOk(k, doc[k]))) return false; // m169-guard:pnpm-inert-shape
  const pk = doc.packages;
  if (pk !== undefined && pk !== "" && !(Array.isArray(pk) && pk.every((g) => typeof g === "string" && plainGlob(g.replace(/^!/, ""))))) return false; // guard:pnpm-ws-packages
  const specs = (m: YNode | undefined): boolean => m === undefined || m === "" || (isYMap(m) && Object.values(m).every((v) => typeof v === "string" && v !== "" && !v.replace(/^npm:/, "").includes(":")));
  if (!specs(doc.catalog) || !(doc.catalogs === undefined || doc.catalogs === "" || (isYMap(doc.catalogs) && Object.values(doc.catalogs).every(specs)))) return false; // guard:pnpm-ws-catalog
  return true;
}

// ---- M188 (batch 23): package-manager settings the loop vouches for instead of refusing them (DEPS_PM_CONFIG).
// Spec: peaceai/spec/deps-pm-config-v1.md. General rule: a setting is admitted only when, under the loop's install
// (frozen lockfile, scripts off, pnpmfile ignored, registry pinned), it cannot change what is fetched, from where, or
// what runs: it only lays out or checks the locked tree, or it must equal what the scanned lockfile already records
// (pnpm itself refuses a frozen install whose overrides / patches differ from the lockfile:
// ERR_PNPM_LOCKFILE_CONFIG_MISMATCH). Anything else stays DEPS_PM_CONFIG. Each guard line carries an m188 guard tag.

/** pnpm layout / check settings (pnpm-workspace.yaml keys): boolean ones. */
export const PNPM_LAYOUT_BOOLS = ["autoInstallPeers", "strictPeerDependencies", "dedupePeerDependents", "resolvePeersFromWorkspaceRoot", "shamefullyHoist", "hoist", "preferWorkspacePackages", "injectWorkspacePackages", "saveExact", "engineStrict", "excludeLinksFromLockfile", "strictDepBuilds", "ignoreWorkspaceRootCheck", "dedupeDirectDeps", "dedupeInjectedDeps", "disallowWorkspaceCycles"] as const;
/** pnpm layout settings with a fixed value set (nodeLinker: never pnp; sharedWorkspaceLockfile: only true, since
 *  false makes pnpm install each package from a lockfile the loop never scanned). */
export const PNPM_LAYOUT_ENUMS: Readonly<Record<string, readonly string[]>> = { nodeLinker: ["isolated", "hoisted"], linkWorkspacePackages: ["true", "false", "deep"], savePrefix: ["", "^", "~"], resolutionMode: ["highest", "time-based", "lowest-direct"], sharedWorkspaceLockfile: ["true"] };
/** pnpm hoisting pattern lists. */
export const PNPM_LAYOUT_PATTERNS = ["hoistPattern", "publicHoistPattern"] as const;
/** Settings that must agree with the lockfile (overrides, patchedDependencies) or only tune peer warnings. */
export const PNPM_LOCKED_KEYS = ["overrides", "patchedDependencies", "peerDependencyRules"] as const;
/** The keys a root package.json `pnpm` field may hold (pnpm reads the field from the root only). */
export const PNPM_FIELD_KEYS = [...PNPM_LOCKED_KEYS, "onlyBuiltDependencies", "neverBuiltDependencies", "ignoredBuiltDependencies", "allowBuilds", "allowedDeprecatedVersions"] as const;
const PATTERN = /^!?[A-Za-z0-9@*._~/-]{1,214}$/;
const MAX_SETTING_ENTRIES = 200;

/** A package.json value as the YAML subset's tree (booleans and numbers as their text), or null for null / other. */
export function jsonToY(v: unknown): YNode | null {
  if (typeof v === "string") return v;
  if (typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) return String(v);
  if (Array.isArray(v)) { const out: YNode[] = []; for (const x of v) { const y = jsonToY(x); if (y === null) return null; out.push(y); } return out; }
  if (v && typeof v === "object") { const out = ymap(); for (const [k, x] of Object.entries(v)) { const y = jsonToY(x); if (y === null) return null; out[k] = y; } return out; }
  return null;
}
const strMap = (v: YNode | undefined): v is { [k: string]: string } => isYMap(v) && Object.keys(v).length <= MAX_SETTING_ENTRIES && Object.values(v).every((x) => typeof x === "string");
/** "name" or "name@range" (scoped names too) -> its parts, or null. */
function nameAt(s: string): { name: string; range: string | null } | null {
  const at = s.indexOf("@", s.startsWith("@") ? 1 : 0);
  const name = at > 0 ? s.slice(0, at) : s, range = at > 0 ? s.slice(at + 1) : null;
  return NPM_NAME.test(name) && (range === null || semverRange(range) !== null) ? { name, range } : null;
}
/** An override selector: up to three name[@range] parts joined by ">" (parent>child). */
export function overrideKeyOk(k: string): boolean {
  const parts = k.split(">");
  return parts.length <= 3 && parts.every((p) => nameAt(p) !== null);
}
/** An override value: a registry range (semver subset or npm: alias) or "-" (drop the dependency). Never a
 *  protocol (link:, file:, git, a URL) and never a $reference (pnpm writes the resolved spec, not the reference). */
export const overrideValueOk = (v: string): boolean => v === "-" || registryRange(v);
/** overrides: a string map of vetted selectors -> vetted values, equal entry for entry to the lockfile's. */
export function overridesOk(cfg: YNode | undefined, lock: { [k: string]: YNode } | null): boolean {
  if (!strMap(cfg)) return false;
  if (!Object.keys(cfg).every(overrideKeyOk)) return false; // m188-guard:ovr-key
  if (!Object.values(cfg).every(overrideValueOk)) return false; // m188-guard:ovr-value
  const lo = isYMap(lock?.overrides) ? lock.overrides : ymap();
  if (!(Object.keys(lo).length === Object.keys(cfg).length && Object.entries(cfg).every(([k, v]) => lo[k] === v))) return false; // m188-guard:ovr-equal
  return true;
}
/** One path of a unified diff header: /dev/null, or an a/ b/ (or bare) path inside the patched package. */
const patchPathOk = (p: string): boolean => p === "/dev/null" || (insideRepo(".", p.replace(/^[ab]\//, "")) && !p.split("/").includes(".."));
/**
 * A patch file pnpm applies to a dependency: a plain unified (git-style) text diff whose every file path stays inside
 * the package (no absolute path, no ".." segment), no binary patch, hunks whose line counts match their headers, and
 * no other line kinds (so no reader sees a different file list than this check did).
 */
export function patchTextOk(text: string): boolean {
  if (/[\r\0]/.test(text)) return false;
  let oldLeft = 0, newLeft = 0, hunks = 0;
  for (const line of text.split("\n")) {
    if (oldLeft > 0 || newLeft > 0) {
      const c = line[0];
      if (c === " ") { oldLeft--; newLeft--; } else if (c === "-") oldLeft--; else if (c === "+") newLeft--; else if (c !== "\\") return false;
      if (oldLeft < 0 || newLeft < 0) return false;
      continue;
    }
    if (line === "" || line.startsWith("\\")) continue;
    const h = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (h) { oldLeft = h[1] === undefined ? 1 : +h[1]; newLeft = h[2] === undefined ? 1 : +h[2]; hunks++; continue; }
    const g = /^diff --git (\S+) (\S+)$/.exec(line);
    if (g && !(patchPathOk(g[1]!) && patchPathOk(g[2]!))) return false; // m188-guard:patch-git-path
    if (g) continue;
    const f = /^(?:---|\+\+\+) ([^\t]+)(?:\t.*)?$/.exec(line);
    if (f && !patchPathOk(f[1]!.trim())) return false; // m188-guard:patch-path
    if (f) continue;
    const r = /^(?:rename|copy) (?:from|to) (.+)$/.exec(line);
    if (r && !patchPathOk(r[1]!)) return false; // m188-guard:patch-rename
    if (r) continue;
    if (/^(?:index [0-9a-f]+\.\.[0-9a-f]+(?: [0-7]{6})?|(?:new file|deleted file|old|new) mode [0-7]{6}|(?:dis)?similarity index \d{1,3}%)$/.test(line)) continue;
    return false; // m188-guard:patch-line
  }
  if (oldLeft !== 0 || newLeft !== 0) return false; // m188-guard:patch-counts
  return hunks > 0;
}
/** patchedDependencies: name[@version] -> a regular patch file in the tree that passes patchTextOk, with exactly the
 *  lockfile's patched keys (pnpm compares the patch hashes itself). */
export function patchedOk(root: string, files: readonly string[], cfg: YNode | undefined, lock: { [k: string]: YNode } | null): boolean {
  if (!strMap(cfg)) return false;
  for (const [k, p] of Object.entries(cfg)) {
    if (!PKG_NAME.test(k)) return false;
    if (!insideRepo(".", p) || !files.includes(posix.normalize(p))) return false; // m188-guard:patch-file
    const t = smallFile(join(root, p));
    if (t === null || !patchTextOk(t)) return false; // m188-guard:patch-text
  }
  const lp = isYMap(lock?.patchedDependencies) ? lock.patchedDependencies : ymap();
  if (!(Object.keys(lp).length === Object.keys(cfg).length && Object.keys(cfg).every((k) => Object.hasOwn(lp, k)))) return false; // m188-guard:patch-keys
  return true;
}
/** peerDependencyRules: ignoreMissing / allowAny name patterns, allowedVersions selector -> range. They only turn peer
 *  warnings off (a frozen install resolves nothing). */
export function peerRulesOk(v: YNode | undefined): boolean {
  if (!isYMap(v)) return false;
  for (const [k, x] of Object.entries(v)) {
    if (k === "ignoreMissing" || k === "allowAny") { if (!Array.isArray(x) || x.length > MAX_SETTING_ENTRIES || !x.every((n) => typeof n === "string" && PATTERN.test(n))) return false; continue; }
    if (k === "allowedVersions") { if (!strMap(x) || !Object.entries(x).every(([s, r]) => /^[A-Za-z0-9@*._~/>-]{1,214}$/.test(s) && /^[A-Za-z0-9.^~<>=|* -]{1,64}$/.test(r))) return false; continue; }
    return false; // m188-guard:peer-key
  }
  return true;
}
/** One pnpm setting (workspace-file key, or a root `pnpm` field key) in its vetted shape. */
export function pnpmSettingOk(key: string, v: YNode | undefined, root: string, files: readonly string[], lock: { [k: string]: YNode } | null): boolean {
  const isBool = (PNPM_LAYOUT_BOOLS as readonly string[]).includes(key), isEnum = Object.hasOwn(PNPM_LAYOUT_ENUMS, key), isPat = (PNPM_LAYOUT_PATTERNS as readonly string[]).includes(key);
  if (isBool && !(v === "true" || v === "false")) return false; // m188-guard:layout-bool
  if (isEnum && !(typeof v === "string" && PNPM_LAYOUT_ENUMS[key]!.includes(v))) return false; // m188-guard:layout-enum
  if (isPat && !(Array.isArray(v) && v.every((n) => typeof n === "string" && PATTERN.test(n)))) return false; // m188-guard:layout-pattern
  if (isBool || isEnum || isPat) return true;
  if ((PNPM_WORKSPACE_INERT_KEYS as readonly string[]).includes(key)) return pnpmInertOk(key, v);
  if (key === "allowedDeprecatedVersions") return strMap(v) && Object.entries(v).every(([n, r]) => PKG_NAME.test(n) && semverRange(r) !== null);
  if (key === "overrides") return overridesOk(v, lock);
  if (key === "patchedDependencies") return patchedOk(root, files, v, lock);
  if (key === "peerDependencyRules") return peerRulesOk(v);
  return false;
}
/** The root package.json `pnpm` field: only PNPM_FIELD_KEYS, each vetted; a non-root package.json has none. */
function pnpmFieldOk(root: string, f: string, files: readonly string[], lock: { [k: string]: YNode } | null, wsKeys: readonly string[]): boolean {
  const t = smallFile(join(root, f));
  if (t === null) return false;
  let o: unknown;
  try { o = JSON.parse(t.replace(/^\ufeff/, "")); } catch { return false; }
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  if (!Object.hasOwn(o, "pnpm")) return true;
  if (f !== "package.json") return false; // m188-guard:field-root-only
  const field = jsonToY((o as Record<string, unknown>).pnpm);
  if (!isYMap(field)) return false;
  for (const [k, v] of Object.entries(field)) {
    if (!(PNPM_FIELD_KEYS as readonly string[]).includes(k)) return false; // m188-guard:field-key
    if ((PNPM_LOCKED_KEYS as readonly string[]).includes(k) && wsKeys.includes(k)) return false; // m188-guard:field-ws-both
    if (!pnpmSettingOk(k, v, root, files, lock)) return false; // m188-guard:field-value
  }
  return true;
}

/** .npmrc keys carried into the install tree (every other line of the repo's root .npmrc is dropped, as before
 *  M188): layout / peer / check settings of npm and pnpm, each with the values it may take. */
const NPMRC_BOOL = /^(?:true|false)$/;
export const NPMRC_CARRY: Readonly<Record<string, RegExp>> = {
  "auto-install-peers": NPMRC_BOOL, "strict-peer-dependencies": NPMRC_BOOL, "dedupe-peer-dependents": NPMRC_BOOL, "resolve-peers-from-workspace-root": NPMRC_BOOL,
  "shamefully-hoist": NPMRC_BOOL, hoist: NPMRC_BOOL, "prefer-workspace-packages": NPMRC_BOOL, "inject-workspace-packages": NPMRC_BOOL, "save-exact": NPMRC_BOOL,
  "engine-strict": NPMRC_BOOL, "exclude-links-from-lockfile": NPMRC_BOOL, "strict-dep-builds": NPMRC_BOOL, "ignore-workspace-root-check": NPMRC_BOOL,
  "dedupe-direct-deps": NPMRC_BOOL, "legacy-peer-deps": NPMRC_BOOL, "strict-peer-deps": NPMRC_BOOL,
  "node-linker": /^(?:isolated|hoisted)$/, "link-workspace-packages": /^(?:true|false|deep)$/, "save-prefix": /^[\^~]?$/,
  "resolution-mode": /^(?:highest|time-based|lowest-direct)$/, "shared-workspace-lockfile": /^true$/, "install-strategy": /^(?:hoisted|nested|shallow|linked)$/,
  "hoist-pattern[]": PATTERN, "public-hoist-pattern[]": PATTERN,
};
/** The root .npmrc reduced to the carried keys, as the text PeaceAI writes into the install tree ("" for none). Lines
 *  are key=value only; a value with an env reference, a quote or anything outside its shape is dropped. Last one wins
 *  (npm's ini reader); [] keys keep every value. */
export function npmrcCarry(text: string | null): string {
  if (text === null) return "";
  const one = new Map<string, string>(), many = new Map<string, string[]>();
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "").trim();
    const m = /^([a-z][a-z0-9-]*(?:\[\])?)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const k = m[1]!, v = m[2]!.trim(), rx = NPMRC_CARRY[k];
    if (!Object.hasOwn(NPMRC_CARRY, k)) continue; // m188-guard:npmrc-key
    if (rx && !rx.test(v)) continue; // m188-guard:npmrc-value
    if (k.endsWith("[]")) many.set(k, [...(many.get(k) ?? []), v]); else one.set(k, v);
  }
  const out = [...[...one].sort().map(([k, v]) => `${k}=${v}`), ...[...many].sort().flatMap(([k, vs]) => vs.map((v) => `${k}=${v}`))];
  return out.length ? out.join("\n") + "\n" : "";
}

/** devEngines.packageManager / runtime entries: an object (or a list of them) naming a supported package manager or
 *  node, an optional semver range, and an explicit onFail that never downloads (ignore / warn / error). */
export function devEnginesEntryOk(kind: "packageManager" | "runtime", v: unknown): boolean {
  const list = Array.isArray(v) ? v : [v];
  if (!list.length || list.length > 4) return false;
  return list.every((e) => {
    if (!e || typeof e !== "object" || Array.isArray(e)) return false;
    if (!Object.keys(e).every((k) => k === "name" || k === "version" || k === "onFail")) return false; // m188-guard:dev-keys
    const { name, version, onFail } = e as Record<string, unknown>;
    if (!(onFail === "ignore" || onFail === "warn" || onFail === "error")) return false; // m188-guard:dev-onfail
    if (!(kind === "runtime" ? name === "node" : (PACKAGE_MANAGERS as readonly string[]).includes(name as string))) return false; // m188-guard:dev-name
    if (version !== undefined && !(typeof version === "string" && semverRange(version) !== null)) return false; // m188-guard:dev-version
    return true;
  });
}

/** yarn v1 root resolutions: each key a selector path ending in a package name, each value a registry range whose
 *  name@value is itself a yarn.lock header (else yarn resolves it afresh from the registry). */
export function yarnResolutionsOk(res: unknown, lock: ReadonlySet<string>): boolean {
  if (!res || typeof res !== "object" || Array.isArray(res) || Object.keys(res).length > MAX_SETTING_ENTRIES) return false;
  for (const [k, v] of Object.entries(res)) {
    const segs = k.split("/");
    const parts: string[] = [];
    for (let i = 0; i < segs.length; i++) parts.push(segs[i]!.startsWith("@") ? `${segs[i]}/${segs[++i] ?? ""}` : segs[i]!);
    const last = parts[parts.length - 1]!;
    if (!parts.every((p, i) => (p === "**" && i < parts.length - 1) || (p !== "**" && NPM_NAME.test(p)))) return false; // m188-guard:res-key
    if (typeof v !== "string" || !registryRange(v)) return false; // m188-guard:res-value
    if (!lock.has(`${last}@${v}`)) return false; // m188-guard:res-locked
  }
  return true;
}

/** pnpm only: one root pnpm-workspace.yaml at most, no other manifest format, every package.json free of `pnpm`. */
function pnpmConfigAllowed(root: string, files: readonly string[], lockfile: string): boolean {
  if (files.some((f) => f !== "pnpm-workspace.yaml" && /^pnpm-workspace\.ya?ml$/.test(posix.basename(f)))) return false; // guard:pnpm-ws-other
  if (files.some((f) => /^package\.(?:json5|ya?ml)$/.test(posix.basename(f)))) return false; // guard:pnpm-manifest
  const lockText = smallFile(join(root, lockfile));
  const ctx: PnpmCtx = { root, files, lock: lockText === null ? null : pnpmParse(lockText) };
  const wsText = files.includes("pnpm-workspace.yaml") ? smallFile(join(root, "pnpm-workspace.yaml")) ?? "\t" : null;
  if (wsText !== null && !pnpmWorkspaceAllowed(wsText, ctx)) return false; // guard:pnpm-ws
  const wsKeys = wsText === null ? [] : Object.keys(pnpmParse(wsText) ?? {});
  // M188: the root package.json may hold a vetted `pnpm` field (pnpm reads it from the root only); every other
  // package.json must be free of one
  for (const f of files) if (posix.basename(f) === "package.json" && !pnpmFieldOk(root, f, files, ctx.lock, wsKeys)) return false; // guard:pnpm-field
  return true;
}

/**
 * Why the copy's dependencies may not be installed, or null: DEPS_PM_CONFIG for package-manager settings the loop
 * does not vouch for (a lockfile below the root; for pnpm, workspace settings or a `pnpm` field), else
 * DEPS_NONREGISTRY when a root lockfile has a non-registry source. .npmrc / .yarnrc* / .pnpmfile.* / bunfig.toml at
 * any depth are not judged here: they are removed from the install tree (guard:deps-config).
 */
export function depsSourceProblem(root: string, p: LockPick): "DEPS_PM_CONFIG" | "DEPS_NONREGISTRY" | null {
  const tree = treeFiles(root);
  if (!tree.complete) return "DEPS_PM_CONFIG"; // guard:pm-tree
  if (tree.files.some((f) => f.includes("/") && (NESTED_LOCKFILES as readonly string[]).includes(posix.basename(f)))) return "DEPS_PM_CONFIG"; // guard:pm-nested-lock
  if (!tree.files.every((f) => posix.basename(f) !== "package.json" || managerFieldsOk(join(root, f), f === "package.json"))) return "DEPS_PM_CONFIG"; // guard:pm-manager
  if (p.pm === "pnpm" && !pnpmConfigAllowed(root, tree.files, p.lockfile)) return "DEPS_PM_CONFIG"; // guard:pm-pnpm
  if (p.pm === "yarn" && !yarnManifestsAllowed(root, tree.files)) return "DEPS_PM_CONFIG"; // guard:pm-yarn
  return rootLockfilesAllowed(root, p) ? null : "DEPS_NONREGISTRY";
}
/** True when installDeps may run the package manager on this copy (depsSourceProblem is null). */
export const lockfileAllowed = (root: string, p: LockPick): boolean => depsSourceProblem(root, p) === null;

/** Package-manager config files that can redirect the registry or run code at install time. */
export const PM_CONFIG_FILES = [".npmrc", ".yarnrc", ".yarnrc.yml", ".pnpmfile.cjs", ".pnpmfile.mjs", "bunfig.toml", ".corepack.env"] as const;

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
  /** Tests only: a lower lockfile size cap (bytes; never above LOCK_MAX_BYTES). */
  lockMaxBytes?: number;
  /** Tests only: the argv that gives the installed tree back to the runner (default sudo -n chown -R). */
  chown?: ((owner: string, dir: string) => string[]) | null;
}
const MAX_CACHED = 2;
export const DEPS_DEFAULTS = { timeoutMs: 600_000, maxBytes: 1536 * 1024 * 1024 } as const;

/** One run's install cache: staging dirs keyed by lockfile sha256 (+ manager, version, manifests). Removed by close(). */
export interface DepsCache { dir: string; entries: Map<string, { staging: string } | DepsRefusal>; close(): void }
export function openDepsCache(base: string = tmpdir()): DepsCache {
  // --deps-dir may name a directory that does not exist yet (peace-model-v1-dev.yml passes "$RUNNER_TEMP/deps"); create it
  // first, else mkdtemp throws ENOENT and bin/loop.ts reports the whole run as TASK_FILE_INVALID (run 41473993873)
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, "peaceai-loopdeps-"));
  chmodSync(dir, 0o755);
  const entries = new Map<string, { staging: string } | DepsRefusal>();
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
export function installDeps(copyDir: string, cand: CandUid, cache: DepsCache, o: DepsOptions = {}): { pm: PackageManager } | DepsRefusal {
  const lock = pickLockfile(copyDir, Math.min(o.lockMaxBytes ?? LOCK_MAX_BYTES, LOCK_MAX_BYTES));
  if ("refuse" in lock) return lock;
  const problem = depsSourceProblem(copyDir, lock);
  if (problem) return { refuse: problem }; // guard:deps-nonregistry
  const files = listed(copyDir);
  const manifests = files.filter((f) => posix.basename(f) === "package.json" || f === "pnpm-workspace.yaml").sort();
  // M188: the carried .npmrc settings and every patch file are part of what the install depends on
  const npmrc = npmrcCarry(files.includes(".npmrc") ? smallFile(join(copyDir, ".npmrc")) : null);
  const patches = files.filter((f) => /\.(?:patch|diff)$/.test(f)).sort();
  let key = sha256([lock.pm, lock.version ?? "", ...presentLockfiles(copyDir).map(([f]) => `${f}\0${sha256(readFileSync(join(copyDir, f)))}`), ...manifests.map((f) => `${f}\0${sha256(readFileSync(join(copyDir, f)))}`)].join("\n"));
  key = sha256([key, ...patches.map((f) => `${f}\0${sha256(readFileSync(join(copyDir, f)))}`), `.npmrc\0${sha256(npmrc)}`].join("\n")); // m188-guard:key-carry
  let hit = cache.entries.get(key);
  if (!hit) {
    hit = install(copyDir, files, lock, cand, cache, key, o, npmrc);
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

function install(copyDir: string, files: readonly string[], lock: LockPick, cand: CandUid, cache: DepsCache, key: string, o: DepsOptions, npmrc = ""): { staging: string } | DepsRefusal {
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
  // M188: only the vetted layout / peer settings of the root .npmrc go back in (npmrcCarry; registry, auth, scripts,
  // proxies and every other key stay dropped)
  if (npmrc) writeFileSync(join(staging, ".npmrc"), npmrc); // m188-guard:npmrc-write
  const me = `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`;
  if (spawnSync("sudo", ["-n", "chown", "-R", `${cand.name}:`, staging, home], { stdio: "ignore" }).status !== 0) return { refuse: "DEPS_INSTALL_FAILED", fail: "CHOWN_TO_CAND" };
  // M169 pre-flight: the candidate uid must reach (every parent searchable) and write its staging dir and HOME before
  // the package manager runs, else the install fails for a reason that is not the repo's (run 41488888877: a deps dir
  // under the runner's home); refused with its own fixed subcode, nothing is run
  const access = ["sudo", "-n", "-u", cand.name, "--", "test", "-x", staging, "-a", "-w", staging, "-a", "-x", home, "-a", "-w", home];
  if (spawnSync(access[0]!, access.slice(1), { stdio: "ignore" }).status !== 0) return { refuse: "DEPS_INSTALL_FAILED", fail: "CAND_NO_ACCESS" }; // m169-guard:deps-cand-access
  const timeoutMs = o.timeoutMs ?? DEPS_DEFAULTS.timeoutMs;
  const env: Record<string, string> = {
    PATH: `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`, HOME: home, TMPDIR: home, LANG: "C.UTF-8", CI: "true",
    COREPACK_HOME: join(home, "corepack"), COREPACK_ENABLE_DOWNLOAD_PROMPT: "0", COREPACK_ENABLE_STRICT: "0",
    npm_config_cache: join(home, "npm-cache"), npm_config_store_dir: join(home, "pnpm-store"),
    npm_config_update_notifier: "false", YARN_CACHE_FOLDER: join(home, "yarn-cache"), ...o.extraEnv,
  };
  env.npm_config_registry = REGISTRY; // guard:deps-registry
  env.COREPACK_ENV_FILE = "0"; // guard:deps-corepack-env
  const argv = installArgv(lock, o.tool ?? null);
  const secs = String(Math.max(1, Math.ceil(timeoutMs / 1000)));
  const cmd = [...Object.entries(env).map(([k, v]) => `${k}=${v}`), "timeout", "-s", "KILL", secs, ...argv];
  cmd.unshift("env", "-i"); // guard:deps-env-i
  cmd.unshift("sudo", "-n", "-u", cand.name, "--"); // guard:deps-cand
  const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd: staging, stdio: "ignore", timeout: timeoutMs + 30_000, killSignal: "SIGKILL", env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } });
  // every process of the candidate uid goes before the tree changes hands (a setsid escapee would keep its network)
  if (!killCand(cand)) return { refuse: "DEPS_INSTALL_FAILED", fail: "KILL" }; // guard:deps-kill
  // back to the runner: the candidate can no longer change the installed tree; its private HOME (caches) goes
  const chown = o.chown ? o.chown(me, staging) : ["sudo", "-n", "chown", "-R", me, staging];
  const owned = spawnSync(chown[0]!, chown.slice(1), { stdio: "ignore" }).status === 0;
  spawnSync("sudo", ["-n", "rm", "-rf", "--", home], { stdio: "ignore" });
  if (!owned) return { refuse: "DEPS_INSTALL_FAILED", fail: "CHOWN_BACK" }; // guard:deps-chown
  execFileSync("chmod", ["-R", "go-w", staging], { stdio: "ignore" });
  if (r.status === 137 || r.status === 124 || r.signal) return { refuse: "DEPS_TIMEOUT" }; // guard:deps-timeout
  if (r.status !== 0) return { refuse: "DEPS_INSTALL_FAILED", fail: "PM_EXIT" };
  const bytes = moduleDirs(staging).reduce((n, d) => n + treeBytes(join(staging, d)), 0);
  if (bytes > (o.maxBytes ?? DEPS_DEFAULTS.maxBytes)) return { refuse: "DEPS_TOO_LARGE" }; // guard:deps-size
  if (!moduleDirs(staging).length) return { refuse: "DEPS_INSTALL_FAILED", fail: "NO_MODULES" };
  return { staging };
}

// ---- 3. the json-runner shim (runs INSIDE the isolation as the candidate uid; plain JS, no imports from PeaceAI)

/** Repo-relative path of the shim in the copy (under node_modules: never an edit target, tamper-hashed by guardedRun). */
export const SHIM_PATH = "node_modules/.peaceai-loop/run.mjs";
export const SHIM_SOURCE = [
  "// PeaceAI loop v2 (M151, M172): runs vitest, jest or mocha for the given test files and prints the pass / fail counts from the",
  "// runner's report as the last two lines (`# pass N`, `# fail N`). Written by peaceai/lib/loopdeps.ts.",
  "// M173 (batch 12 forging fix): the report no longer comes from a file code under test could write (TMPDIR, which it",
  "// must be able to write). The runner is started by launch.cjs beside this file with a per-run nonce on its stdin, and",
  "// PeaceAI's own reporter (vitest-reporter.mjs, jest-reporter.cjs, mocha-guard.cjs) writes the one report line on fd 3;",
  "// fd 3 must hold exactly `PEACEAI-REPORT <nonce> <json>` and nothing else, or nothing is credited (NO_REPORT).",
  "import { spawnSync } from \"node:child_process\";",
  "import { randomBytes } from \"node:crypto\";",
  "import { existsSync, readFileSync, realpathSync } from \"node:fs\";",
  "import { dirname, join, resolve } from \"node:path\";",
  "import { fileURLToPath, pathToFileURL } from \"node:url\";",
  "const [runner, pkgDir, ...rest] = process.argv.slice(2);",
  "// M172: mocha's allowlisted options (read by PeaceAI from the package's scripts) come first, ended by `--`",
  "const sep = runner === \"mocha\" ? rest.indexOf(\"--\") : -1;",
  "const opts = sep >= 0 ? rest.slice(0, sep) : [];",
  "const files = sep >= 0 ? rest.slice(sep + 1) : rest;",
  "const cwd = resolve(pkgDir || \".\");",
  "const tmp = process.env.TMPDIR || \"/nonexistent\";",
  "const here = dirname(fileURLToPath(import.meta.url));",
  "// M190 (batch 24): the line right before the counts is always the shim's own `# failed-names <hex json> | -`: the",
  "// failed tests' names from the nonce-checked report (vitest / jest reporters only) or `-` (unknown); loop.ts reads it",
  "// only when it is that line (output before it, code under test's included, can never be the line before `# pass`)",
  "const done = (pass, fail, code, names = null) => { process.stdout.write(`\\n# failed-names ${names ? Buffer.from(JSON.stringify(names)).toString(\"hex\") : \"-\"}\\n# pass ${pass}\\n# fail ${fail}\\n`); process.exit(code); };",
  "// M173: the shim's own exit codes when it made the counts up (loopdeps.ts SHIM_EXITS): no usable report, a suite that",
  "// failed to load or run, a nonzero exit with no failed test; a real failing test exits 1, all passing 0",
  "const NO_REPORT = 95, SUITE_LOAD = 94, EXIT_ONLY = 93;",
  "let pkgJson = null;",
  "for (let d = cwd; ; d = dirname(d)) { const p = join(d, \"node_modules\", runner, \"package.json\"); if (existsSync(p)) { pkgJson = realpathSync(p); break; } if (dirname(d) === d) break; }",
  "if (!pkgJson || (runner !== \"vitest\" && runner !== \"jest\" && runner !== \"mocha\")) done(0, 1, NO_REPORT);",
  "if (runner === \"mocha\" && sep < 0) done(0, 1, NO_REPORT); // m172-guard:shim-mocha-sep",
  "const meta = JSON.parse(readFileSync(pkgJson, \"utf8\"));",
  "const binRel = typeof meta.bin === \"string\" ? meta.bin : meta.bin?.[runner];",
  "if (typeof binRel !== \"string\") done(0, 1, NO_REPORT);",
  "const bin = join(dirname(pkgJson), binRel);",
  "let args = runner === \"vitest\"",
  "  ? [\"run\", `--reporter=${join(here, \"vitest-reporter.mjs\")}`, ...files]",
  "  : [\"--ci\", `--reporters=${join(here, \"jest-reporter.cjs\")}`, \"--watchman=false\", `--cacheDirectory=${join(tmp, \"jest-cache\")}`, \"--runTestsByPath\", ...files];",
  "// M172: mocha reads no config file (--no-config, --no-package: PeaceAI passed on what the script set); (M173) its",
  "// reporter is PeaceAI's (mocha-guard.cjs, which also counts as mocha's json reporter does)",
  "// batch 11 fix: PeaceAI's pending guard (mocha-guard.cjs beside this file) is required first; it finds the mocha that",
  "// runs through PEACEAI_MOCHA_LIB and fails a test that ends in a Pending this.skip() did not raise",
  "const guard = join(here, \"mocha-guard.cjs\");",
  "if (runner === \"mocha\") args = [\"--no-config\", \"--no-package\", \"--require\", guard, ...opts, \"--reporter\", guard, ...files]; // m172-guard:shim-mocha-args",
  "const runEnv = runner === \"mocha\" ? { ...process.env, PEACEAI_MOCHA_LIB: join(dirname(pkgJson), \"lib\") } : process.env;",
  "// batch 10: vitest < 2 writes its results cache into node_modules/.vitest after every run; the copy is read-only, so",
  "// that write fails (EACCES) and the run exits 1 even when every test passed. Its CLI has no flag to turn the cache",
  "// off, so for those versions the same run is started through vitest's own node API (what its CLI calls) with the",
  "// cache off and vite's cache dir in TMPDIR (launch.cjs --vitest-api). Same report, same files, same exit-code rules below.",
  "const [maj, min] = String(meta.version).split(\".\").map(Number);",
  "const nodeEntry = (() => { const e = meta.exports && meta.exports[\"./node\"]; const rel = typeof e === \"string\" ? e : e && (typeof e.import === \"string\" ? e.import : e.import && e.import.default || e.default); return typeof rel === \"string\" ? join(dirname(pkgJson), rel) : null; })();",
  "let legacy = false;",
  "if (runner === \"vitest\" && maj < 2 && nodeEntry && existsSync(nodeEntry)) legacy = true; // m170-guard:vitest-legacy-api",
  "const preload = runner === \"mocha\" ? guard : join(here, runner === \"jest\" ? \"jest-reporter.cjs\" : \"vitest-reporter.mjs\");",
  "// where the runner's own code is (the first node_modules in its real path: the copy's, or the read-only deps tree its",
  "// links point to); launch.cjs takes a reporter made by code there (or beside this file) as the runner's",
  "const real = dirname(pkgJson), at = real.indexOf(\"/node_modules/\");",
  "const depsRoot = at >= 0 ? real.slice(0, at + \"/node_modules\".length) : real;",
  "const argvFor = (extra) => [join(here, \"launch.cjs\"), depsRoot, preload, ...(legacy ? [\"--vitest-api\", pathToFileURL(nodeEntry).href, join(tmp, \"vite-cache\"), ...files] : [bin, ...args, ...extra])];",
  "// fd 3, exactly one line with this run's nonce (anything else, a poison line included, is no report)",
  "const readReport = (out, nonce) => {",
  "  const lines = String(out || \"\").split(\"\\n\");",
  "  const line = lines.find((x) => x.startsWith(\"PEACEAI-REPORT \"));",
  "  if (line === undefined) return null;",
  "  if (lines.length !== 2 || lines[0] !== line || lines[1] !== \"\") return null; // m173-forge-guard:shim-one-line",
  "  const m = /^PEACEAI-REPORT ([0-9a-f]{64}) (\\{.*\\})$/.exec(line);",
  "  if (!m) return null;",
  "  if (m[1] !== nonce) return null; // m173-forge-guard:shim-nonce",
  "  try { return JSON.parse(m[2]); } catch { return null; }",
  "};",
  "const run = (extra) => {",
  "  const nonce = randomBytes(32).toString(\"hex\");",
  "  const r = spawnSync(process.execPath, argvFor(extra), { cwd, env: runEnv, input: nonce, stdio: [\"pipe\", \"inherit\", \"inherit\", \"pipe\"], maxBuffer: 1 << 26 });",
  "  return { r, j: readReport(r.output && r.output[3], nonce) };",
  "};",
  "let { r, j } = run([]);",
  "// the copy is read-only, so vite's default config bundling (a temp file beside the config) can fail; vitest >= 3.1",
  "// can load the config in-process instead, so retry once that way when no report was written",
  "if (!j && runner === \"vitest\" && (maj > 3 || (maj === 3 && min >= 1))) ({ r, j } = run([\"--configLoader\", \"runner\"]));",
  "if (!j || typeof j !== \"object\") done(0, 1, NO_REPORT); // guard:shim-report",
  "const n = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);",
  "// M172: mocha's report keeps its counts under `stats`; a report without them is a failure",
  "if (runner === \"mocha\" && (!j.stats || typeof j.stats !== \"object\")) done(0, 1, NO_REPORT); // m172-guard:shim-mocha-stats",
  "// batch 11 fix (fail closed): a mocha run with any pending test, or whose test count is not passes + failures (a",
  "// test that ended neither way, or a hook failure), is not credited: no pass counted, at least one failure. Those",
  "// counts are made up, so (M173, batch 12 merge) the shim exits SUITE_LOAD: the suite did not run every test to a pass or a fail",
  "if (runner === \"mocha\" && n(j.stats.pending) > 0) done(0, Math.max(1, n(j.stats.failures)), SUITE_LOAD); // m172-guard:shim-mocha-pending",
  "if (runner === \"mocha\" && (!Number.isInteger(j.stats.tests) || j.stats.tests !== n(j.stats.passes) + n(j.stats.failures))) done(0, Math.max(1, n(j.stats.failures)), SUITE_LOAD); // m172-guard:shim-mocha-total",
  "const pass = runner === \"mocha\" ? n(j.stats.passes) : n(j.numPassedTests);",
  "let fail = runner === \"mocha\" ? n(j.stats.failures) : n(j.numFailedTests);",
  "const tested = fail; // the runner's own count of failed tests, before the shim adds any",
  "if (fail === 0 && n(j.numFailedTestSuites) > 0) fail = n(j.numFailedTestSuites); // guard:shim-suites",
  "// M173: a suite that failed to load or run (jest: numRuntimeErrorTestSuites; any runner: failed suites, no failed test)",
  "let synth = n(j.numRuntimeErrorTestSuites) > 0 || (tested === 0 && fail > 0) ? SUITE_LOAD : 0; // m173-loop-guard:shim-suite-load",
  "if (fail === 0 && (r.status !== 0 || j.success === false)) fail = 1; // guard:shim-exit",
  "if (synth === 0 && tested === 0 && fail > 0) synth = EXIT_ONLY; // m173-loop-guard:shim-exit-only",
  "// M190: names only for the runner's own failed tests: no made-up count, exactly one name per failed test, capped",
  "const NAMES_CAP = 100, NAME_CHARS = 200;",
  "const failedNames = (() => {",
  "  const a = j.failedNames;",
  "  if (synth !== 0 || fail !== tested) return null; // m190-guard:shim-real",
  "  if (!Array.isArray(a) || a.length !== tested || a.length > NAMES_CAP) return null; // m190-guard:shim-count",
  "  if (!a.every((x) => typeof x === \"string\")) return null;",
  "  return a.map((x) => x.replace(/[^\\x20-\\x7e]/g, \"?\").slice(0, NAME_CHARS)); // m190-guard:shim-printable",
  "})();",
  "done(pass, fail, synth || (fail ? 1 : 0), failedNames ?? null);",
  "",
].join("\n");

/** M173: the shim's own exit codes for counts it made up (SHIM_SOURCE prints `# pass 0` / `# fail 1` or adds a failure, and
 *  exits with one of these; a real failing test exits 1). loop.ts maps them to the attempt codes of looprow.ts. */
export const SHIM_EXITS = Object.freeze({ NO_REPORT: 95, SUITE_LOAD: 94, EXIT_ONLY: 93 } as const);

/** Repo-relative path of the mocha pending guard in the copy (beside the shim; read-only and tamper-hashed like it). */
export const MOCHA_GUARD_PATH = "node_modules/.peaceai-loop/mocha-guard.cjs";
/**
 * Batch 11 fix (Auditor B2): real mocha (10.8.2, lib/runnable.js) treats ANY `Pending` thrown synchronously by a test
 * as a clean finish (`if (err instanceof Pending) return done()`), and only this.skip() marks the test pending first.
 * So code under test that throws `new (require("mocha/lib/pending"))()` inside a failing test made mocha count that
 * test as passed. This file, required by the shim before the repo's own --require hooks, wraps each runnable's
 * function for the duration of its call: a Pending thrown synchronously by a runnable that this.skip()
 * did not mark pending becomes an Error, so the test (or hook) fails. A sanctioned skip stays pending, which the shim
 * then refuses to credit (guard:shim-mocha-pending). Missing mocha internals throw: mocha exits with no report (fail
 * closed). Lines tagged m172-pend-guard are mutated against real mocha by m172-real-mocha.test.ts.
 */
export const MOCHA_GUARD_SOURCE = [
  "\"use strict\";",
  "// PeaceAI loop (M172, batch 11): a Pending this.skip() did not raise fails the test. Written by peaceai/lib/loopdeps.ts.",
  "// M173 (batch 12 forging fix): also mocha's reporter for the shim (see launch.cjs), and it locks mocha's classes.",
  "const { join } = require(\"node:path\");",
  "const lib = process.env.PEACEAI_MOCHA_LIB;",
  "if (!lib) throw new Error(\"PeaceAI loop: PEACEAI_MOCHA_LIB is not set\");",
  "const Runnable = require(join(lib, \"runnable.js\"));",
  "const Pending = require(join(lib, \"pending.js\"));",
  "if (typeof Runnable !== \"function\" || typeof Runnable.prototype.run !== \"function\" || typeof Pending !== \"function\") throw new Error(\"PeaceAI loop: mocha internals not found\");",
  "const run = Runnable.prototype.run;",
  "Runnable.prototype.run = function (fn) {",
  "  const self = this, f = this.fn;",
  "  if (typeof f !== \"function\") return run.call(this, fn);",
  "  const check = (e) => {",
  "    if (e instanceof Pending && !self.pending) return new Error(\"PeaceAI loop: a Pending thrown without this.skip(); the test does not count as passed\"); // m172-pend-guard:convert",
  "    return e;",
  "  };",
  "  const g = function (...a) {",
  "    // a returned promise rejected with a Pending is already a failure in mocha (Runnable#run: done(reason)); only a",
  "    // synchronous throw is taken as a clean finish, so only that is converted",
  "    try { return f.apply(this, a); } catch (e) { throw check(e); }",
  "  };",
  "  this.fn = g; // m172-pend-guard:wrap",
  "  try { return run.call(this, fn); } finally { this.fn = f; }",
  "};",
  "// M173 (batch 12 forging fix). The report: this module is preloaded by launch.cjs (before mocha and any repo code) and",
  "// claims the one report writer; mocha then loads it again as its reporter (--reporter, the same module). Only the",
  "// reporter mocha constructs inside the CLI's Mocha#run, once, counts; a reporter constructed anywhere else (a Mocha",
  "// a spec file makes, code under test reaching this module) writes the poison line, so the shim credits nothing.",
  "const EventEmitter = require(\"node:events\");",
  "const on = EventEmitter.prototype.on, emit = EventEmitter.prototype.emit;",
  "const Runner = require(join(lib, \"runner.js\"));",
  "const Suite = require(join(lib, \"suite.js\"));",
  "const Test = require(join(lib, \"test.js\"));",
  "const Hook = require(join(lib, \"hook.js\"));",
  "const Context = require(join(lib, \"context.js\"));",
  "const Mocha = require(join(lib, \"mocha.js\"));",
  "if (![Runner, Suite, Test, Hook, Context, Mocha].every((C) => typeof C === \"function\" && C.prototype) || typeof Mocha.prototype.run !== \"function\") throw new Error(\"PeaceAI loop: mocha internals not found\");",
  "const claim = process[Symbol.for(\"peaceai.loop.claim\")];",
  "const poison = () => { if (typeof claim === \"function\") claim(); };",
  "const write = typeof claim === \"function\" ? claim() : null;",
  "// The run that counts is the one of the Mocha instance mocha's CLI drives: the first one whose files are loaded or that",
  "// is run (the CLI loads the spec files through it, so a Mocha a spec file makes and runs is never it)",
  "let cli = null, inRun = false, made = false;",
  "for (const k of [\"loadFiles\", \"loadFilesAsync\"]) {",
  "  const f = Mocha.prototype[k];",
  "  if (typeof f === \"function\") Mocha.prototype[k] = function (...a) { if (cli === null) cli = this; return f.apply(this, a); };",
  "}",
  "const mochaRun = Mocha.prototype.run;",
  "Mocha.prototype.run = function (...a) {",
  "  if (cli === null) cli = this;",
  "  let real = true;",
  "  if (this !== cli) real = false; // m173-forge-guard:mocha-cli-instance",
  "  inRun = real;",
  "  try { return mochaRun.apply(this, a); } finally { inRun = false; }",
  "};",
  "function PeaceAIMochaReporter(runner) {",
  "  if (!inRun || made || !write) { poison(); return; } // m173-forge-guard:mocha-reporter-in-run",
  "  made = true;",
  "  const s = { tests: 0, passes: 0, failures: 0, pending: 0 };",
  "  on.call(runner, \"test end\", () => { s.tests++; });",
  "  on.call(runner, \"pass\", () => { s.passes++; });",
  "  on.call(runner, \"fail\", () => { s.failures++; });",
  "  on.call(runner, \"pending\", () => { s.pending++; });",
  "  on.call(runner, \"end\", () => write(JSON.stringify({ stats: s })));",
  "}",
  "// The locks: code under test can no longer replace a method of mocha's runner classes (Runnable#run, Runner#runTest,",
  "// Runner#fail, ...) or of Mocha itself, nor add one to their prototypes (Test.prototype.run over Runnable's), nor",
  "// replace the runner's emit (pinned to EventEmitter's own) or a node:assert function, so it cannot turn a failing test",
  "// into a pass by patching them (the assignment throws, or in sloppy code is ignored: a failure or no change). A",
  "// method stays an accessor, so mocha's own per-instance assignments (a Test's skip, ...) still work.",
  "const defp = Object.defineProperty, gopd = Object.getOwnPropertyDescriptor, apply = Reflect.apply;",
  "const lockedSet = new WeakSet(), isLocked = WeakSet.prototype.has, addLocked = WeakSet.prototype.add;",
  "const lock = (o) => {",
  "  apply(addLocked, lockedSet, [o]);",
  "  for (const k of Reflect.ownKeys(o)) {",
  "    const d = gopd(o, k);",
  "    if (!d || typeof d.value !== \"function\" || k === \"constructor\" || !d.configurable) continue;",
  "    const v = d.value;",
  "    defp(o, k, { get() { return v; }, set(nv) { if (apply(isLocked, lockedSet, [this])) throw new TypeError(\"PeaceAI loop: mocha's classes are locked\"); defp(this, k, { value: nv, writable: true, enumerable: true, configurable: true }); }, enumerable: d.enumerable, configurable: false });",
  "  }",
  "  Object.preventExtensions(o);",
  "};",
  "const freezeFns = (o) => {",
  "  for (const k of Reflect.ownKeys(o)) {",
  "    const d = gopd(o, k);",
  "    if (d && typeof d.value === \"function\" && d.configurable) defp(o, k, { value: d.value, writable: false, enumerable: d.enumerable, configurable: false });",
  "  }",
  "};",
  "Object.defineProperty(Runner.prototype, \"emit\", { value: emit, writable: false, enumerable: false, configurable: false }); // m173-forge-guard:mocha-emit-pin",
  "for (const C of [Runnable, Runner, Suite, Test, Hook, Context, Mocha]) lock(C.prototype); // m173-forge-guard:mocha-lock",
  "const assert = require(\"node:assert\");",
  "for (const a of [assert, assert.strict]) freezeFns(a); // m173-forge-guard:mocha-assert-lock",
  "module.exports = PeaceAIMochaReporter;",
  "",
].join("\n");

// ---- M173 (batch 12 forging fix, Auditor): the report channel. Before it, the shim read the runner's JSON report from
// $TMPDIR/peaceai-loop-report.json, a file code under test can write (TMPDIR is the one dir it may write), so a test
// that wrote a passing report and exited 0 was credited as a pass. Now the report comes only on fd 3 of the runner,
// tagged with a per-run nonce the shim hands to launch.cjs on stdin (never in argv or env), written by PeaceAI's own
// reporter, which claims the one writer before any repo code runs. Spec: peaceai/spec/repair-v2-m173.md (forging).

/** Repo-relative path of the runner launcher in the copy (beside the shim; read-only and tamper-hashed like it). */
export const LAUNCH_PATH = "node_modules/.peaceai-loop/launch.cjs";
export const LAUNCH_SOURCE = [
  "\"use strict\";",
  "// PeaceAI loop (M173, batch 12 forging fix): starts the test runner for the shim (run.mjs beside this file) and owns the",
  "// only channel a report may come back on. Written by peaceai/lib/loopdeps.ts.",
  "// The shim gives a per-run nonce on stdin (read here, before any repo code runs; it is never put in argv or env) and",
  "// reads fd 3. PeaceAI's reporter (preloaded here, before the runner and so before the repo's config, setup or test",
  "// files) claims the one writer; a second claim, a second write or a claim without a nonce writes a poison line",
  "// instead, and the shim credits nothing unless fd 3 holds exactly one line `PEACEAI-REPORT <nonce> <json>`.",
  "const fs = require(\"node:fs\");",
  "const { pathToFileURL } = require(\"node:url\");",
  "const writeSync = fs.writeSync;",
  "let nonce = \"\";",
  "try { nonce = fs.readFileSync(0, \"utf8\"); } catch { nonce = \"\"; }",
  "const poison = () => { try { writeSync(3, \"PEACEAI-POISON\\n\"); } catch { /* no channel: nothing is credited anyway */ } };",
  "let claimed = false;",
  "const claim = () => {",
  "  if (claimed || !/^[0-9a-f]{64}$/.test(nonce)) { poison(); return null; } // m173-forge-guard:launch-claim-once",
  "  claimed = true;",
  "  let wrote = false;",
  "  return (json) => {",
  "    if (wrote || typeof json !== \"string\" || /[\\r\\n]/.test(json)) { poison(); return; } // m173-forge-guard:launch-write-once",
  "    wrote = true;",
  "    writeSync(3, `PEACEAI-REPORT ${nonce} ${json}\\n`);",
  "  };",
  "};",
  "Object.defineProperty(process, Symbol.for(\"peaceai.loop.claim\"), { value: claim });",
  "// Who constructed a reporter: the frame that called `fn` (the reporter class) must be a file under the node_modules",
  "// this file is in or the runner's deps tree the shim names (the runner's own code; read-only, so not the repo's",
  "// config, setup or test files, nor TMPDIR). Read through",
  "// V8's call sites with Error.prepareStackTrace set here for that one read (captured before any repo code runs); a",
  "// prepareStackTrace the repo locked, or no frames at all, is a no.",
  "const path = require(\"node:path\");",
  "const { fileURLToPath } = require(\"node:url\");",
  "const E = Error, cap = Error.captureStackTrace, gopd = Object.getOwnPropertyDescriptor, defp = Object.defineProperty, realpath = fs.realpathSync;",
  "const [depsRoot, preload, entry, ...rest] = process.argv.slice(2);",
  "const real = (p) => { try { return realpath(p); } catch { return null; } };",
  "const roots = [real(path.dirname(__dirname)), real(depsRoot || \"/nonexistent\")].filter((r) => r !== null);",
  "const sites = (_e, cs) => cs;",
  "const calledFromDeps = (fn) => {",
  "  if (roots.length === 0 || typeof fn !== \"function\") return false;",
  "  const savedP = gopd(E, \"prepareStackTrace\"), savedL = gopd(E, \"stackTraceLimit\");",
  "  let cs = null;",
  "  try {",
  "    E.prepareStackTrace = sites;",
  "    E.stackTraceLimit = 10;",
  "    const d = gopd(E, \"prepareStackTrace\");",
  "    if (!d || d.value !== sites) return false;",
  "    const o = {};",
  "    cap(o, fn);",
  "    cs = o.stack;",
  "  } catch { return false; } finally {",
  "    try { if (savedP) defp(E, \"prepareStackTrace\", savedP); else delete E.prepareStackTrace; } catch { /* left as is */ }",
  "    try { if (savedL) defp(E, \"stackTraceLimit\", savedL); } catch { /* left as is */ }",
  "  }",
  "  if (!Array.isArray(cs) || !cs[0] || typeof cs[0].getFileName !== \"function\") return false;",
  "  let f = cs[0].getFileName();",
  "  if (typeof f !== \"string\") return false;",
  "  try { if (f.startsWith(\"file:\")) f = fileURLToPath(f); f = realpath(f); } catch { return false; }",
  "  // never a dot dir right under node_modules but the package stores (vite bundles a config into node_modules/.vite-temp,",
  "  // a runner cache can live in one): only installed packages and this dir count",
  "  return roots.some((r) => {",
  "    if (!f.startsWith(r + path.sep)) return false;",
  "    const top = f.slice(r.length + 1).split(path.sep)[0];",
  "    if (top.startsWith(\".\") && top !== \".pnpm\" && top !== \".store\" && top !== path.basename(__dirname)) return false; // m173-forge-guard:launch-dot-dir",
  "    return true;",
  "  });",
  "};",
  "Object.defineProperty(process, Symbol.for(\"peaceai.loop.from\"), { value: calledFromDeps });",
  "(async () => {",
  "  const reporter = await import(pathToFileURL(preload).href);",
  "  if (entry === \"--vitest-api\") {",
  "    // vitest < 2: its node API (what its CLI calls) with the results cache off and vite's cache dir in TMPDIR (batch 10)",
  "    const [u, vc, ...files] = rest;",
  "    const { startVitest } = await import(u);",
  "    const ctx = await startVitest(\"test\", files, { run: true, watch: false, reporters: [new reporter.default()], cache: false }, { cacheDir: vc });",
  "    await ctx?.close();",
  "    process.exit(process.exitCode ?? 0);",
  "  }",
  "  process.argv = [process.argv[0], entry, ...rest];",
  "  await import(pathToFileURL(entry).href);",
  "})().catch((e) => { process.stderr.write(`PeaceAI loop: the runner did not start: ${e && e.message}\\n`); process.exit(1); });",
  "",
].join("\n");
/** jest's reporter for the shim (jest --reporters), beside the shim. */
export const JEST_REPORTER_PATH = "node_modules/.peaceai-loop/jest-reporter.cjs";
export const JEST_REPORTER_SOURCE = [
  "\"use strict\";",
  "// PeaceAI loop (M173, batch 12): jest's reporter for the shim. Preloaded by launch.cjs (claims the report writer before",
  "// any repo code runs); jest itself then loads this same module (--reporters) and constructs it once. Any other",
  "// construction (code under test reaching this module), or one not made by the runner's own code (a frame under",
  "// node_modules, launch.cjs checks), writes the poison line, so nothing is credited.",
  "const claim = process[Symbol.for(\"peaceai.loop.claim\")];",
  "const write = typeof claim === \"function\" ? claim() : null;",
  "const from = process[Symbol.for(\"peaceai.loop.from\")];",
  "let made = false;",
  "const n = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);",
  "class PeaceAIJestReporter {",
  "  constructor() {",
  "    this.write = null;",
  "    if (typeof from !== \"function\" || !from(PeaceAIJestReporter)) { if (write) claim(); return; } // m173-forge-guard:jest-reporter-caller",
  "    if (made || !write) { if (write) claim(); return; } // m173-forge-guard:jest-reporter-once",
  "    made = true;",
  "    this.write = write;",
  "  }",
  "  // jest sets results.success only after the reporters ran: the same rule from the counts (its exit status is checked too)",
  "  onRunComplete(_contexts, r) {",
  "    const w = this.write;",
  "    this.write = null;",
  "    if (!w) return;",
  "    // M190: each failed test's name (its describe titles and its own, joined by ' > '); the shim caps and checks them",
  "    const names = [];",
  "    for (const f of Array.isArray(r.testResults) ? r.testResults : []) for (const t of f && Array.isArray(f.testResults) ? f.testResults : []) if (t && t.status === \"failed\") names.push([...(Array.isArray(t.ancestorTitles) ? t.ancestorTitles : []), t.title].map(String).join(\" > \")); // m190-guard:jest-names",
  "    w(JSON.stringify({ failedNames: names, numPassedTests: n(r.numPassedTests), numFailedTests: n(r.numFailedTests), numFailedTestSuites: n(r.numFailedTestSuites), numRuntimeErrorTestSuites: n(r.numRuntimeErrorTestSuites), numPendingTests: n(r.numPendingTests), numTodoTests: n(r.numTodoTests), numTotalTests: n(r.numTotalTests), success: n(r.numFailedTests) === 0 && n(r.numRuntimeErrorTestSuites) === 0 && !(r.snapshot && r.snapshot.failure) && !r.runExecError }));",
  "  }",
  "  getLastError() { return undefined; }",
  "}",
  "module.exports = PeaceAIJestReporter;",
  "",
].join("\n");
/** vitest's reporter for the shim (vitest --reporter, or the node API's reporters for vitest < 2), beside the shim. */
export const VITEST_REPORTER_PATH = "node_modules/.peaceai-loop/vitest-reporter.mjs";
export const VITEST_REPORTER_SOURCE = [
  "// PeaceAI loop (M173, batch 12): vitest's reporter for the shim. Preloaded by launch.cjs (claims the report writer",
  "// before any repo code runs); vitest then loads this same module (--reporter) and constructs it once. Any other",
  "// construction, or one not made by the runner's own code (a frame under node_modules, launch.cjs checks), writes the",
  "// poison line, so nothing is credited. Counts as vitest's own json reporter does.",
  "const claim = process[Symbol.for(\"peaceai.loop.claim\")];",
  "const write = typeof claim === \"function\" ? claim() : null;",
  "const from = process[Symbol.for(\"peaceai.loop.from\")];",
  "let made = false;",
  "function walk(tasks, out) {",
  "  for (const t of tasks || []) {",
  "    if (!t || typeof t !== \"object\") continue;",
  "    if (t.type === \"suite\") { out.suites.push(t); walk(t.tasks, out); } else if (t.type === \"test\") out.tests.push(t);",
  "  }",
  "  return out;",
  "}",
  "// M190: each failed test's name (its suite names below the file, and its own, joined by ' > ')",
  "function failedNames(tasks, path, out) {",
  "  for (const t of tasks || []) {",
  "    if (!t || typeof t !== \"object\") continue;",
  "    if (t.type === \"suite\") failedNames(t.tasks, typeof t.filepath === \"string\" ? path : [...path, String(t.name)], out);",
  "    else if (t.type === \"test\" && t.result && t.result.state === \"fail\") out.push([...path, String(t.name)].join(\" > \")); // m190-guard:vitest-names",
  "  }",
  "  return out;",
  "}",
  "export default class PeaceAIVitestReporter {",
  "  constructor() {",
  "    this.write = null;",
  "    if (typeof from !== \"function\" || !from(PeaceAIVitestReporter)) { if (write) claim(); return; } // m173-forge-guard:vitest-reporter-caller",
  "    if (made || !write) { if (write) claim(); return; } // m173-forge-guard:vitest-reporter-once",
  "    made = true;",
  "    this.write = write;",
  "  }",
  "  report(files, errors) {",
  "    const w = this.write;",
  "    this.write = null;",
  "    if (!w) return;",
  "    const { suites, tests } = walk(files, { suites: [], tests: [] });",
  "    const state = (t) => t.result && t.result.state;",
  "    const numFailedTestSuites = suites.filter((s) => state(s) === \"fail\").length;",
  "    const numFailedTests = tests.filter((t) => state(t) === \"fail\").length;",
  "    const numPassedTests = tests.filter((t) => state(t) === \"pass\").length;",
  "    const numPendingTests = tests.filter((t) => t.mode === \"skip\" || t.mode === \"todo\" || state(t) === \"skip\" || state(t) === \"todo\").length;",
  "    const unhandled = Array.isArray(errors) ? errors.length : 0;",
  "    w(JSON.stringify({ failedNames: failedNames(files, [], []), numPassedTests, numFailedTests, numFailedTestSuites, numPendingTests, numTotalTests: tests.length, unhandledErrors: unhandled, success: files.length > 0 && numFailedTestSuites === 0 && numFailedTests === 0 && unhandled === 0 }));",
  "  }",
  "  // vitest >= 3 (testModules), older ones (files); vitest 3 calls both: the first one counts",
  "  onTestRunEnd(testModules, errors) { this.report((testModules || []).map((m) => m && m.task), errors); }",
  "  onFinished(files, errors) { this.report(files || [], errors); }",
  "}",
  "",
].join("\n");
/** The shim's fd 3 report line prefix (`PEACEAI-REPORT <64 hex nonce> <json>`); anything else on fd 3 is no report. */
export const REPORT_LINE_PREFIX = "PEACEAI-REPORT ";
/** The symbol (Symbol.for) on `process` under which launch.cjs keeps its one-time claim of the report writer. */
export const REPORT_CLAIM_SYMBOL = "peaceai.loop.claim";

/** Writes the shim, its launcher, the reporters and the mocha guard beside it into the copy. */
export function installShim(copyDir: string): void {
  mkdirSync(join(copyDir, dirname(SHIM_PATH)), { recursive: true });
  writeFileSync(join(copyDir, SHIM_PATH), SHIM_SOURCE);
  writeFileSync(join(copyDir, MOCHA_GUARD_PATH), MOCHA_GUARD_SOURCE);
  writeFileSync(join(copyDir, LAUNCH_PATH), LAUNCH_SOURCE);
  writeFileSync(join(copyDir, JEST_REPORTER_PATH), JEST_REPORTER_SOURCE);
  writeFileSync(join(copyDir, VITEST_REPORTER_PATH), VITEST_REPORTER_SOURCE);
}
export function shimArgs(pick: RunnerPick): string[] {
  return [SHIM_PATH, pick.runner, pick.pkgDir, ...(pick.runner === "mocha" ? [...(pick.options ?? []), "--"] : []), ...pick.files];
}

// ---- M171: the task's private work dir (spec loop-isolation-v1.md)

const candGid = (cand: CandUid): number => Number(spawnSync("id", ["-g", cand.name], { encoding: "utf8" }).stdout?.trim() ?? "");
/** M171: true when `argv` exits 0 as the candidate uid (sudo -n -u, no shell, 20 s). */
export function candCan(cand: CandUid, argv: readonly string[]): boolean {
  return spawnSync("sudo", ["-n", "-u", cand.name, "--", ...argv], { stdio: "ignore", timeout: 20_000 }).status === 0;
}

/** A task's private work dir: a fresh mktemp dir (default under os.tmpdir(), i.e. /tmp on the runner), owned by the
 *  runner, group the candidate's gid, mode 0750: only the runner and the candidate uid can enter it. Null (the task is
 *  refused ISOLATION_UNAVAILABLE / WORK_DIR) unless the candidate uid can traverse it and write a dir it owns there. */
export interface WorkDir { dir: string; close(): void }

// M173 (Auditor M171 follow-up 3): a work dir is registered for removal the moment mktemp returns, before its mode is
// set, so a process that exits or is stopped by SIGINT / SIGTERM / SIGHUP at any point after mktemp (including between
// mktemp and chmod) removes it instead of leaking an empty 0700 /tmp/peaceai-work-* dir. The signal hook removes the
// open dirs and re-raises the same signal (the process still ends by that signal). SIGKILL cannot be caught; nothing
// here claims to cover it. close() unregisters.
const openWorkDirs = new Set<string>();
const removeWorkDir = (dir: string) => { spawnSync("sudo", ["-n", "rm", "-rf", "--", dir], { stdio: "ignore" }); rmSync(dir, { recursive: true, force: true }); };
const sweepWorkDirs = () => { for (const d of [...openWorkDirs]) { openWorkDirs.delete(d); try { removeWorkDir(d); } catch { /* best effort at exit */ } } };
let workHooks = false;
/** M173: registers `dir` for removal at exit or on SIGINT / SIGTERM / SIGHUP (hooks installed once); exported for tests. */
export function trackWorkDir(dir: string): void {
  openWorkDirs.add(dir);
  if (workHooks) return;
  workHooks = true;
  process.once("exit", sweepWorkDirs);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(sig, () => { sweepWorkDirs(); process.kill(process.pid, sig); });
}
export function openWorkDir(cand: CandUid, base: string = tmpdir()): WorkDir | null {
  let dir: string;
  try { dir = mkdtempSync(join(base, "peaceai-work-")); } catch { return null; }
  trackWorkDir(dir); // m173-guard:work-track (before the chmod)
  const close = () => { openWorkDirs.delete(dir); removeWorkDir(dir); };
  const gid = candGid(cand);
  try { chmodSync(dir, 0o750); } catch { close(); return null; }
  if (!Number.isInteger(gid) || gid <= 0 || spawnSync("sudo", ["-n", "chgrp", String(gid), dir], { stdio: "ignore" }).status !== 0) { close(); return null; }
  const probe = join(dir, "probe");
  mkdirSync(probe);
  const ok = spawnSync("sudo", ["-n", "chown", `${cand.name}:`, probe], { stdio: "ignore" }).status === 0 && candCan(cand, ["sh", "-c", 'touch "$1/w" && rm "$1/w"', "sh", probe]);
  spawnSync("sudo", ["-n", "rm", "-rf", "--", probe], { stdio: "ignore" });
  if (!ok || existsSync(probe)) { close(); return null; } // m171-guard:work-probe
  return { dir, close };
}

// ---- M171 (Auditor ruling on run 41521457458, condition c): the isolation proofs, run ON CI by `bin/loop.ts proofs`
// as the first command of the model-v1 attempt job's loop step, before any attempt, INSIDE the loop's own runner
// wrapper (loop.ts runnerWrapper, passed in) as the candidate uid, started the way candidate test runs are
// (selfpropose.ts isolatedRun). The probe (PROBE_SOURCE) must find:
//   net              no TCP connect succeeds (a listener this process opens on 127.0.0.1, and two public addresses);
//   uid              process.getuid() is the candidate uid;
//   write            no file can be made outside the work dir (its parent, /var/tmp, /dev/shm, the workspace,
//                    RUNNER_TEMP, home);
//   runner-temp      RUNNER_TEMP (and the runner's home) cannot be listed;
//   git-credentials  no git credential file the runner finds (by name, plus git's fixed paths) can be read.
// It exits 64 + a bit mask of the failed proofs (64 = every proof passed, so a probe that never ran cannot pass); the
// wrapper exits 97 / 98 without namespaces / mounts. Only fixed codes are printed. Any failure refuses (fail closed);
// nothing falls back to the runner uid. Spec: peaceai/spec/loop-isolation-v1.md. Guards: `// m171-proof-guard:`.

export const PROOFS = ["net", "uid", "write", "runner-temp", "git-credentials"] as const;
export type Proof = (typeof PROOFS)[number];
export const PROOF_REFUSALS = ["CAND_NO_NAMESPACES", "CAND_NO_MOUNT", "WORK_DIR", "NO_RUNNER_TEMP", "PROOF_ERROR", "PROOF_LEFTOVERS", "PROOF_FAILED"] as const;
export type ProofRefusal = (typeof PROOF_REFUSALS)[number];
export interface ProofResult { ok: boolean; refusal: ProofRefusal | null; proofs: Partial<Record<Proof, "pass" | "fail">>; credFiles: number }

/** The probe the candidate runs (node, ESM, no imports outside node:). Arg: the JSON args file. */
export const PROBE_SOURCE = [
  'import { connect } from "node:net";',
  'import { readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";',
  'import { join } from "node:path";',
  'const a = JSON.parse(readFileSync(process.argv[2], "utf8"));',
  "let bad = 0;",
  "const reach = (host, port) => new Promise((ok) => { const s = connect({ host, port }); const t = setTimeout(() => { s.unref(); ok(false); }, 3000); s.on(\"connect\", () => { clearTimeout(t); s.end(); s.unref(); ok(true); }); s.on(\"error\", () => { clearTimeout(t); ok(false); }); });",
  "for (const [h, p] of a.net) if (await reach(h, p)) bad |= 1;", // m171-proof-guard:proof-net
  "if (process.getuid() !== a.uid) bad |= 2;", // m171-proof-guard:proof-uid
  'for (const d of a.outside) { const f = join(d, ".peaceai-proof-" + process.pid); try { writeFileSync(f, "x", { flag: "wx" }); try { unlinkSync(f); } catch {} bad |= 4; } catch {} }', // m171-proof-guard:proof-write
  "for (const d of a.temp) { try { readdirSync(d); bad |= 8; } catch {} }", // m171-proof-guard:proof-runner-temp
  "for (const f of a.creds) { try { readFileSync(f); bad |= 16; } catch {} }", // m171-proof-guard:proof-git-credentials
  "process.exit(64 + bad);",
  "",
].join("\n");

const CRED_NAME = /^(?:\.git-credentials|git-credentials.*|\.gitconfig)$/;
/** The git credential files the runner can see: by name under RUNNER_TEMP and home (depth 4), plus git's fixed paths. */
export function gitCredentialFiles(roots: readonly string[], home: string): string[] {
  const out = new Set<string>();
  const walk = (d: string, depth: number) => {
    let ents: string[];
    try { ents = readdirSync(d); } catch { return; }
    for (const e of ents) {
      const p = join(d, e);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (depth < 4 && e !== "node_modules") walk(p, depth + 1); } else if (CRED_NAME.test(e)) out.add(p);
    }
  };
  for (const r of roots) walk(r, 1);
  for (const f of [".git-credentials", ".gitconfig", ".config/git/credentials"]) if (existsSync(join(home, f))) out.add(join(home, f));
  return [...out].sort();
}

export interface ProofOptions {
  env: Record<string, string | undefined>;
  /** the workspace checkout (a write target outside the work dir) */
  root: string;
  /** where the work dir is made (default os.tmpdir()) */
  workBase?: string;
  /** tests only: the runner's home (default os.homedir()) */
  home?: string;
  /** tests only: extra TCP targets (the 127.0.0.1 listener is always tried) */
  net?: [string, number][];
  /** the program the probe starts under: loop.ts runnerWrapper (bin/loop.ts proofs); tests pass others */
  wrapper: (uid: number, gid: number) => string;
  /** tests only: the uid the probe must see (default the candidate uid) */
  expectUid?: number;
}

/** Runs the proofs as `cand` inside the runner wrapper. ok only when every proof passed; never runs anything else. */
export async function runIsolationProofs(cand: CandUid, o: ProofOptions): Promise<ProofResult> {
  const temp = o.env.RUNNER_TEMP ? resolve(o.env.RUNNER_TEMP) : "";
  const home = o.home ?? homedir();
  const res = (refusal: ProofRefusal | null, proofs: ProofResult["proofs"] = {}, credFiles = 0): ProofResult => ({ ok: refusal === null, refusal, proofs, credFiles });
  if (!temp || !existsSync(temp)) return res("NO_RUNNER_TEMP"); // m171-proof-guard:proof-temp-exists
  const work = openWorkDir(cand, o.workBase);
  if (work === null) return res("WORK_DIR"); // m171-proof-guard:proof-work
  const server = createServer((s) => s.end());
  try {
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const port = (server.address() as { port: number }).port;
    const gid = Number(spawnSync("id", ["-g", cand.name], { encoding: "utf8" }).stdout.trim());
    const copy = join(work.dir, "proof");
    mkdirSync(join(copy, "node_modules/.bin"), { recursive: true });
    writeFileSync(join(copy, "node_modules/.bin/tsx"), o.wrapper(cand.uid, gid));
    chmodSync(join(copy, "node_modules/.bin/tsx"), 0o755);
    writeFileSync(join(copy, "probe.mjs"), PROBE_SOURCE);
    const creds = gitCredentialFiles([temp, home], home);
    const args = {
      net: [["127.0.0.1", port], ["1.1.1.1", 443], ["140.82.112.3", 443], ...(o.net ?? [])],
      uid: o.expectUid ?? cand.uid,
      outside: [...new Set([dirname(work.dir), "/var/tmp", "/dev/shm", resolve(o.root), temp, home])].filter((d) => existsSync(d)),
      temp: [temp, home],
      creds,
    };
    writeFileSync(join(copy, "args.json"), JSON.stringify(args));
    const r = isolatedRun(copy, [join(copy, "probe.mjs"), join(copy, "args.json")], Date.now() + 120_000, cand);
    if (r.exitCode === 97) return res("CAND_NO_NAMESPACES", {}, creds.length); // m171-proof-guard:proof-97
    if (r.exitCode === 98) return res("CAND_NO_MOUNT", {}, creds.length); // m171-proof-guard:proof-98
    if (r.exitCode < 64 || r.exitCode > 64 + 31) return res("PROOF_ERROR", {}, creds.length); // m171-proof-guard:proof-range
    const bad = r.exitCode - 64;
    const proofs = Object.fromEntries(PROOFS.map((p, i) => [p, bad & (1 << i) ? "fail" : "pass"])) as ProofResult["proofs"];
    if (bad !== 0) return res("PROOF_FAILED", proofs, creds.length); // m171-proof-guard:proof-bad
    if (r.leftovers > 0) return res("PROOF_LEFTOVERS", proofs, creds.length); // m171-proof-guard:proof-leftovers
    return res(null, proofs, creds.length);
  } catch {
    return res("PROOF_ERROR");
  } finally {
    server.close();
    work?.close();
  }
}
