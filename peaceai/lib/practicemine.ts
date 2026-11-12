// Mixed practice set. credit: false. Pure checks for the miner, the frozen held-out hash, and the
// training-exclusion check. Git and process spawning stay in peaceai/bin/practice-mine.ts.
// Third-party source is never written here.
import { createHash } from "node:crypto";
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
export function installArgv(locks: LockFiles, hasDeps: boolean): string[] | null {
  if (!hasDeps && !locks.npm && !locks.pnpm && !locks.yarn) return null;
  if (locks.pnpm) return ["pnpm", "install", "--ignore-scripts"];
  if (locks.yarn) return ["yarn", "install", "--ignore-scripts"];
  if (locks.npm) return ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"];
  return ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"];
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

/**
 * `unshare -n` when that call works. Without CAP_NET_ADMIN the same network namespace is
 * `unshare --user --map-root-user -n`. If neither works, null: the miner must not run tests.
 */
export function isolationArgv(plainOk: boolean, userOk: boolean): string[] | null {
  if (plainOk) return ["unshare", "-n", "--"];
  if (userOk) return ["unshare", "--user", "--map-root-user", "-n", "--"];
  return null;
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
}

export interface PracticeManifest {
  schema: typeof MANIFEST_SCHEMA;
  credit: false;
  heldOutHash: string;
  repos: PracticeRepo[];
}

/** Canonical held-out list. Name, pin, root commit, license, and license file. Order is by name. */
export function heldOutCanonical(repos: readonly PracticeRepo[]): string {
  const lines = repos
    .filter((r) => r.split === "held-out")
    .map((r) => [r.name, r.commit, r.root, r.license ?? "", r.licenseFile ?? ""].join("\t"))
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
