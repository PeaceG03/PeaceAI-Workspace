// M151 (loop v2, step 3 of the general coding-agent roadmap): what the test-and-fix loop needs to run a real repo's
// tests. Three parts, all general (nothing here names a task, a repo or a task set):
//   1. detectRunner: which runner the team's test files belong to (node:test, vitest, jest) and in which package;
//      other runners (mocha, ava, tap, ...) and suites that need an outside service (docker compose) are refused.
//   2. installDeps: the repo's dependencies, ONLY from its lockfile (npm ci / pnpm install --frozen-lockfile /
//      yarn install --frozen-lockfile), install scripts off (--ignore-scripts), as the stage-2 candidate uid with
//      `env -i` and a private HOME/cache, in a per-run staging dir (never the copy, never a shared cache), with a
//      deadline and a size cap. Package-manager config files that can redirect the registry or run code (.npmrc,
//      .yarnrc*, .pnpmfile.*, .corepack.env; corepack also gets COREPACK_ENV_FILE=0) are removed from the staging tree first, and every root lockfile is scanned first
//      (size-capped; both npm lockfiles at once refused; pnpm parsed as a plain YAML subset, yarn fields strict): every
//      package must come from https://registry.npmjs.org/ (yarn v1: or registry.yarnpkg.com) with an integrity hash
//      (git, remote-tarball, file: and outside-the-repo link entries are refused with DEPS_NONREGISTRY; workspace /
//      link entries inside the repo are allowed); a lockfile below the root, and for pnpm any pnpm-workspace.yaml key but
//      packages / catalog(s) or any `pnpm` field in a package.json, a packageManager other than name@x.y.z[+hash], and
//      for yarn v1 any manifest dependency spec without a yarn.lock header (or resolutions), is refused with DEPS_PM_CONFIG; npm also gets --allow-git/--allow-remote/--allow-file=none. The package manager itself runs here
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
export const DEPS_CODES = ["DEPS_NO_LOCKFILE", "DEPS_PM_UNSUPPORTED", "DEPS_NONREGISTRY", "DEPS_PM_CONFIG", "DEPS_INSTALL_FAILED", "DEPS_TIMEOUT", "DEPS_TOO_LARGE"] as const;
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

/** One yarn.lock v1 header line ("a@^1", a@^1.2:) -> its specs, each quoted (no backslash) or bare, comma-separated;
 * null for any other shape. */
export function yarnHeaderSpecs(line: string): string[] | null {
  if (!line.endsWith(":")) return null;
  const s = line.slice(0, -1);
  const out: string[] = [];
  let i = 0;
  for (;;) {
    while (s[i] === " ") i++;
    let tok: string;
    if (s[i] === '"') { const j = s.indexOf('"', i + 1); if (j < 0) return null; tok = s.slice(i + 1, j); i = j + 1; if (tok.includes("\\")) return null; }
    else { const j = s.indexOf(",", i); const end = j < 0 ? s.length : j; tok = s.slice(i, end).trimEnd(); i = end; if (/["\s]/.test(tok)) return null; }
    if (!tok) return null;
    out.push(tok);
    while (s[i] === " ") i++;
    if (i >= s.length) return out;
    if (s[i] !== ",") return null;
    i++;
  }
}
/** Every spec in a yarn.lock v1's headers (name@range, as package.json writes it), or null when a header is malformed. */
export function yarnLockSpecs(text: string): Set<string> | null {
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!/^[^\s#]/.test(line)) continue;
    const specs = yarnHeaderSpecs(line);
    if (!specs) return null;
    for (const x of specs) out.add(x);
  }
  return out;
}

/** yarn.lock v1 (berry is refused earlier): fields at 2 spaces, dependency maps at 4; no duplicate or quoted field. */
export function yarnLockAllowed(text: string): boolean {
  const blocks: { specs: string[]; fields: Map<string, string | null>; inMap: boolean }[] = [];
  const lines = text.split(/\r?\n/);
  if (lines.some((l) => /[\r\t]/.test(l))) return false;
  for (const line of lines) {
    if (!line.trim() || line.startsWith("#")) continue;
    if (/^\S/.test(line)) { const specs = yarnHeaderSpecs(line); if (!specs) return false; blocks.push({ specs, fields: new Map(), inMap: false }); continue; }
    const b = blocks[blocks.length - 1];
    if (!b) return false;
    if (/^ {4}\S/.test(line)) { if (!b.inMap || !/^ {4}("[^"\\]*"|[^\s"]+) ("[^"\\]*"|[^\s"]+)$/.test(line)) return false; continue; }
    const m = /^ {2}([A-Za-z][A-Za-z0-9]*)(?: ("[^"\\]*"|[^\s"]+)|:)$/.exec(line);
    if (!m) return false; // guard:lock-yarn-field
    if (!m) continue; // (unreachable while the guard above stands)
    if (b.fields.has(m[1]!)) return false; // guard:lock-yarn-dup
    b.fields.set(m[1]!, m[2] ?? null);
    b.inMap = m[2] === undefined;
  }
  for (const b of blocks) {
    const ranges = b.specs.map((s) => s.slice(s.indexOf("@", 1) + 1));
    const field = (name: string) => { const v = b.fields.get(name); return v === undefined || v === null ? undefined : unquote(v); };
    const resolved = field("resolved");
    const links = ranges.every((r) => r.startsWith("link:") && insideRepo(".", r.slice(5)));
    if (ranges.some((r) => r.includes(":") && !r.startsWith("npm:") && !(r.startsWith("link:") && insideRepo(".", r.slice(5))))) return false; // guard:lock-yarn-spec
    if (links && resolved === undefined) continue;
    if (!yarnSourceOk(resolved, field("integrity"))) return false; // guard:lock-yarn
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

/** A workspace glob of plain path segments with * and ** only: inside the repo, no "..", no leading "." or "/", no
 * brace / class / ? / extglob / escape syntax (so the matcher below matches at least what the package manager does). */
export function plainGlob(g: string): boolean {
  return insideRepo(".", g) && !/(?:^|\/)\.\.(?:\/|$)/.test(g) && !/^[./]/.test(g) && !/[{}?[\]()!+@\\]/.test(g);
}
/** A plain glob -> a test over repo-relative dirs: "*" is any chars within a segment, a "**" segment any number of
 * segments (none too). Matched against "/" + dir so a "**" segment can stand for nothing. */
const globRx = (g: string): RegExp => new RegExp("^" + g.replace(/\/+$/, "").split("/").map((seg) => seg === "**" ? "(?:/.*)?" : "/" + seg.replace(/[.^$|]/g, "\\$&").replace(/\*+/g, "[^/]*")).join("") + "$");

/** A package.json as a JSON object (regular file, size-capped, a leading BOM stripped as the package managers do), or null. */
function readPkg(p: string): Record<string, unknown> | null {
  const t = smallFile(p);
  if (t === null) return null;
  try { const o = JSON.parse(t.replace(/^\ufeff/, "")); return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch { return null; }
}

/** packageManager (read by corepack and by pnpm itself) only as name@x.y.z[+hash]; no devEngines package manager /
 * runtime (corepack and pnpm can fetch those). The root must be a JSON object; other package.json files are judged
 * when they parse (corepack reads the nearest one to the install dir: the root). */
export function managerFieldsOk(p: string, isRoot: boolean): boolean {
  const o = readPkg(p);
  if (!o) return !isRoot;
  if (o.packageManager !== undefined && !(typeof o.packageManager === "string" && PACKAGE_MANAGER_FIELD.test(o.packageManager))) return false;
  const de = o.devEngines;
  return de === undefined || (!!de && typeof de === "object" && !Array.isArray(de) && !Object.hasOwn(de, "packageManager") && !Object.hasOwn(de, "runtime"));
}

/** Dependency fields yarn v1 installs (peerDependencies are not installed by yarn v1, so not read here). */
export const YARN_DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"] as const;
/**
 * yarn v1 only: --frozen-lockfile does not stop yarn fetching a dependency that has no yarn.lock entry, so every
 * dependency spec in the root and in every workspace package must be a `name@spec` header in yarn.lock, or name a
 * workspace package with a protocol-free range. resolutions (anywhere) are refused outright; workspaces must be
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
  const wsDirs = files.filter((f) => posix.basename(f) === "package.json" && f.includes("/")).map((f) => posix.dirname(f)).filter((d) => rxs.some((r) => r.test("/" + d)));
  const pkgs = [rootPkg, ...wsDirs.map((d) => readPkg(join(root, d, "package.json")))];
  if (pkgs.some((x) => x === null)) return false;
  const names = new Set(pkgs.slice(1).map((x) => x!.name).filter((n): n is string => typeof n === "string"));
  for (const pkg of pkgs as Record<string, unknown>[]) {
    if (Object.hasOwn(pkg, "resolutions")) return false; // guard:yarn-resolutions
    for (const field of YARN_DEP_FIELDS) {
      const deps = pkg[field];
      if (deps === undefined) continue;
      if (!deps || typeof deps !== "object" || Array.isArray(deps) || !Object.values(deps).every((v) => typeof v === "string")) return false; // guard:yarn-dep-shape
      for (const [n, spec] of Object.entries(deps as Record<string, string>)) if (!lock.has(`${n}@${spec}`) && !(names.has(n) && !/[:/]/.test(spec))) return false; // guard:yarn-dep-lock
    }
  }
  return true;
}

/** A regular file under the size cap, as text; null otherwise (a symlink, a dir, unreadable, too large). */
function smallFile(p: string): string | null {
  try { const st = lstatSync(p); if (!st.isFile() || st.size > LOCK_MAX_BYTES) return null; return readFileSync(p, "utf8"); } catch { return null; }
}

/** pnpm-workspace.yaml: the plain YAML subset (the lockfile parser), only packages / catalog / catalogs, packages
 * globs inside the repo, catalog entries plain version ranges (npm: aliases allowed; no other protocol). */
export function pnpmWorkspaceAllowed(text: string): boolean {
  const parsed = pnpmParse(text);
  if (parsed === null) return false; // guard:pnpm-ws-parse
  const doc = parsed ?? ymap();
  if (!Object.keys(doc).every((k) => (PNPM_WORKSPACE_KEYS as readonly string[]).includes(k))) return false; // guard:pnpm-ws-key
  const pk = doc.packages;
  if (pk !== undefined && pk !== "" && !(Array.isArray(pk) && pk.every((g) => typeof g === "string" && plainGlob(g.replace(/^!/, ""))))) return false; // guard:pnpm-ws-packages
  const specs = (m: YNode | undefined): boolean => m === undefined || m === "" || (isYMap(m) && Object.values(m).every((v) => typeof v === "string" && v !== "" && !v.replace(/^npm:/, "").includes(":")));
  if (!specs(doc.catalog) || !(doc.catalogs === undefined || doc.catalogs === "" || (isYMap(doc.catalogs) && Object.values(doc.catalogs).every(specs)))) return false; // guard:pnpm-ws-catalog
  return true;
}

/** A package.json with no `pnpm` field (any `pnpm` field is refused: overrides, packageExtensions, patchedDependencies,
 * and the settings pnpm still reads there can change what is fetched or from where; none is needed to install). Not a
 * regular file, or not a JSON object (a leading BOM is stripped first, as pnpm does) -> refused too. */
export function pnpmFieldFree(p: string): boolean {
  const t = smallFile(p);
  if (t === null) return false;
  let o: unknown;
  try { o = JSON.parse(t.replace(/^\ufeff/, "")); } catch { return false; }
  return !!o && typeof o === "object" && !Array.isArray(o) && !Object.hasOwn(o, "pnpm");
}

/** pnpm only: one root pnpm-workspace.yaml at most, no other manifest format, every package.json free of `pnpm`. */
function pnpmConfigAllowed(root: string, files: readonly string[]): boolean {
  if (files.some((f) => f !== "pnpm-workspace.yaml" && /^pnpm-workspace\.ya?ml$/.test(posix.basename(f)))) return false; // guard:pnpm-ws-other
  if (files.some((f) => /^package\.(?:json5|ya?ml)$/.test(posix.basename(f)))) return false; // guard:pnpm-manifest
  if (files.includes("pnpm-workspace.yaml") && !pnpmWorkspaceAllowed(smallFile(join(root, "pnpm-workspace.yaml")) ?? "\t")) return false; // guard:pnpm-ws
  for (const f of files) if (posix.basename(f) === "package.json" && !pnpmFieldFree(join(root, f))) return false; // guard:pnpm-field
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
  if (p.pm === "pnpm" && !pnpmConfigAllowed(root, tree.files)) return "DEPS_PM_CONFIG"; // guard:pm-pnpm
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
  const lock = pickLockfile(copyDir, Math.min(o.lockMaxBytes ?? LOCK_MAX_BYTES, LOCK_MAX_BYTES));
  if ("refuse" in lock) return lock;
  const problem = depsSourceProblem(copyDir, lock);
  if (problem) return { refuse: problem }; // guard:deps-nonregistry
  const files = listed(copyDir);
  const manifests = files.filter((f) => posix.basename(f) === "package.json" || f === "pnpm-workspace.yaml").sort();
  const key = sha256([lock.pm, lock.version ?? "", ...presentLockfiles(copyDir).map(([f]) => `${f}\0${sha256(readFileSync(join(copyDir, f)))}`), ...manifests.map((f) => `${f}\0${sha256(readFileSync(join(copyDir, f)))}`)].join("\n"));
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
  env.COREPACK_ENV_FILE = "0"; // guard:deps-corepack-env
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
