// EXPERIMENTAL learn step 3: practice each skill-tree leaf. credit is always false.
// Not wired into scoring, grading, or results. Never trains or uploads.
//
// A leaf's one function is copied into a temp sandbox (never the target repo). A small break is
// injected from the existing repair mutation catalog (`mutationsIn` in editpropose.ts). The kind
// name uses `shapeOf` from derive-practice-kinds.ts; the seed stream is mulberry32 / taskSeed
// from derive-practice.ts. No new mutation catalog.
//
// One problem per break. Input-set copies of the same break are not separate held-out problems:
// LEARNED needs a pass rate >= 0.75 on at least 4 independent held-out breaks. Held-out is sealed
// (sha256) before any repair attempt, and that digest is compared again after attempts.
// Zero held-out rows is not a proof. A function whose inputs this program cannot build is
// NEEDS_TEACHING / UNSUPPORTED_INPUT, never LEARNED. Probes come from the parameter's type
// and how the body uses that parameter, not from the function's name.
// Attempts go through runRepairLoop and then repair-retry, capped at RETRY_MAX_ATTEMPTS.
// Target code runs only in a temp child with node --permission and a clean environment.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { openRepo } from "./codesearch.ts";
import { shapeOf } from "./derive-practice-kinds.ts";
import { mulberry32, taskSeed } from "./derive-practice.ts";
import { mutationsIn, parseSource, repairProposer, type Mutation, type Site } from "./editpropose.ts";
import { bodies } from "./ftpairs.ts";
import type { GapNode, SkillTree } from "./learntree.ts";
import { checkMap, type ProgramMap } from "./learnmap.ts";
import { retryProposer, RETRY_MAX_ATTEMPTS, type RetryFeedback } from "./repair-retry.ts";
import { buildIndex } from "./symbols.ts";
import { runRepairLoop, type Evaluation } from "./repairloop.ts";
import type { RepairContext, RepairError } from "./repair.ts";
import type { ProposeInput } from "./loop.ts";

export const LEARN_PRACTICE_SCHEMA = "peaceai-learn-practice:v1" as const;
export const NEEDS_TEACHING_SCHEMA = "peaceai-needs-teaching:v1" as const;
const MAX_KINDS = 8;
const MAX_MUTATIONS = 16;
const CHILD_MS = 15_000;
const INPUT_SETS: readonly (readonly number[])[] = [[0, 2, 3], [4, 5, 7], [8, 9, 10]];

export type LeafStatus = "LEARNED" | "PRACTICING" | "NEEDS_TEACHING" | "BUDGET_STOPPED";
export type HistoryFlag = "OFF" | "USED" | "HISTORY_NONE";

export class LearnRefuse extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export interface PracticeProblem {
  id: string;
  nodeId: string;
  set: "dev" | "heldout";
  kind: string;
  sourcePath: string;
  function: string;
  broken: string;
  /** Original function text. The repair loop may land on this or on another test-proven fix. */
  original: string;
  /** Source that passed an independent re-run of the real test, when solved. */
  fixed: string | null;
  test: string;
  fromHistory: boolean;
  historySha: string | null;
  solved: boolean;
  verified: boolean;
  attempts: number;
  reasonCodes: string[];
}

export interface NodeResult {
  nodeId: string;
  title: string;
  parent: string | null;
  depth: number;
  size: GapNode["size"];
  status: LeafStatus;
  dev: { problems: number; solved: number; attempts: number };
  /** problems/passed count independent breaks (one kind), not input-set copies. */
  heldout: { problems: number; passed: number; sha256: string };
  attempts: number;
  reasonCodes: string[];
}

export interface RecheckRow {
  at: string;
  nodeId: string;
  oldRate: number;
  newRate: number;
  oldSha256: string;
  newSha256: string;
  demoted: boolean;
  /** Ancestors moved off LEARNED with this leaf. Old held-out rows are not edited. */
  ancestors: string[];
}

export interface PracticeRun {
  schema: typeof LEARN_PRACTICE_SCHEMA;
  experimental: true;
  credit: false;
  seed: number;
  minutesUsed: number;
  attemptsUsed: number;
  maxMinutes: number;
  maxAttemptsTotal: number;
  history: HistoryFlag;
  budgetStopped: boolean;
  /** True only when at least one held-out row was sealed and every such digest still matches. Zero rows is not a seal. */
  sealedBeforeAttempts: boolean;
  /** True only when a leaf is LEARNED on >= 4 independent held-out breaks at rate >= 0.75. */
  heldoutProof?: boolean;
  /** False when checkMap does not trust the map. Absent on older runs. */
  mapTrusted?: boolean;
  nodes: NodeResult[];
  problems: PracticeProblem[];
  rechecks: RecheckRow[];
}

export interface GapRow {
  program: string;
  nodeId: string;
  title: string;
  reasonCodes: string[];
  testIdea: string;
  firstSeen: string;
}

export interface PracticeOptions {
  tree: SkillTree;
  map: ProgramMap;
  repoPath: string;
  seed?: number;
  maxMinutes?: number;
  maxAttemptsTotal?: number;
  fromHistory?: boolean;
  /** Output directory. Refused when it is the target repo or inside it. */
  outPath?: string;
  today?: string;
  now?: () => number;
}

interface LeafRef { node: GapNode; path: string; name: string }
interface HistFix { sha: string; pre: string; post: string }

const byStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function existingAncestor(path: string): { base: string; rest: string[] } {
  const rest: string[] = [];
  let cur = resolve(path);
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) break;
    rest.push(cur.slice(parent.length + 1));
    cur = parent;
  }
  return { base: cur, rest: rest.reverse() };
}

/** True when an existing component of `target` is a symlink. Writes must not follow one. */
export function hasSymlinkComponent(target: string): boolean {
  const parts = resolve(target).split(sep).filter((p) => p.length > 0);
  let cur: string = sep;
  for (const part of parts) {
    cur = join(cur, part);
    try {
      if (lstatSync(cur).isSymbolicLink()) return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw e;
    }
  }
  return false;
}

/** True when `target` is `root` or a path inside it (symlink-safe), same rule as learn.ts. */
export function insideRepo(root: string, target: string): boolean {
  const repo = realpathSafe(resolve(root));
  const anc = existingAncestor(target);
  const base = realpathSafe(anc.base);
  const full = anc.rest.length ? resolve(base, ...anc.rest) : base;
  const rel = relative(repo, full);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith("..") && !isAbsolute(rel));
}

function realpathSafe(p: string): string {
  return existsSync(p) ? realpathSync(p) : p;
}

/** Create `dir` and refuse when it resolves inside `repo` or a path component is a symlink. */
export function prepareOutDir(repo: string, dir: string): void {
  if (insideRepo(repo, dir) || hasSymlinkComponent(dir)) throw new LearnRefuse("WRITE_IN_TARGET");
  mkdirSync(dir, { recursive: true });
  if (insideRepo(repo, dir) || hasSymlinkComponent(dir) || lstatSync(dir).isSymbolicLink()) throw new LearnRefuse("WRITE_IN_TARGET");
}

/** True when opening `file` for write could follow a symlink or alter another name (a hard link). */
export function outputBlocked(repo: string, file: string): boolean {
  const full = resolve(file);
  if (insideRepo(repo, full) || insideRepo(repo, dirname(full)) || hasSymlinkComponent(full)) return true;
  try {
    const st = lstatSync(full);
    if (st.isSymbolicLink() || !st.isFile() || st.nlink > 1) return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") return true;
  }
  return false;
}

/** Write `file` without following a symlink or a hard link. Refuses a path that resolves inside `repo`. */
export function safeWriteFile(repo: string, file: string, data: string): void {
  const full = resolve(file);
  if (outputBlocked(repo, full)) throw new LearnRefuse("WRITE_IN_TARGET");
  prepareOutDir(repo, dirname(full));
  if (outputBlocked(repo, full)) throw new LearnRefuse("WRITE_IN_TARGET");
  const fd = openSync(full, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o644);
  try { writeSync(fd, data); } finally { closeSync(fd); }
}

/**
 * Publish every file or none. A destination symlink or hard link is refused before any
 * final name is replaced, so one bad path cannot leave the others written.
 */
export function publishLearnFiles(repo: string, files: readonly { path: string; data: string }[]): void {
  const specs = files.map((f) => ({ data: f.data, full: resolve(f.path) }));
  for (const s of specs) {
    if (outputBlocked(repo, s.full)) throw new LearnRefuse("WRITE_IN_TARGET");
    prepareOutDir(repo, dirname(s.full));
    if (outputBlocked(repo, s.full)) throw new LearnRefuse("WRITE_IN_TARGET");
  }
  const temps: { tmp: string; full: string }[] = [];
  try {
    for (const s of specs) {
      const tmp = join(dirname(s.full), `.${basename(s.full)}.${process.pid}.${temps.length}.tmp`);
      if (outputBlocked(repo, tmp)) throw new LearnRefuse("WRITE_IN_TARGET");
      const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
      try { writeSync(fd, s.data); } finally { closeSync(fd); }
      temps.push({ tmp, full: s.full });
    }
  } catch (e) {
    for (const t of temps) { try { unlinkSync(t.tmp); } catch { /* already gone */ } }
    throw e;
  }
  const published: string[] = [];
  try {
    for (const t of temps) {
      if (outputBlocked(repo, t.full)) throw new LearnRefuse("WRITE_IN_TARGET");
      renameSync(t.tmp, t.full);
      published.push(t.full);
    }
  } catch (e) {
    for (const t of temps) { try { unlinkSync(t.tmp); } catch { /* renamed or gone */ } }
    for (const full of published) { try { unlinkSync(full); } catch { /* best effort */ } }
    throw e;
  }
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** sha256 of held-out problem contents. Changing any held-out file changes the digest. */
export function heldOutSha(items: readonly { id: string; kind: string; broken: string; test: string }[]): string {
  const body = items.slice().sort((a, b) => byStr(a.id, b.id)).map((i) => `${i.id}\n${i.kind}\n${i.broken}\n${i.test}\n`).join("\n");
  return sha256(body);
}

/** True when the held-out digest taken before attempts still describes the held-out rows. */
export function practiceSealOk(before: readonly { id: string; kind: string; broken: string; test: string }[], after: readonly { id: string; kind: string; broken: string; test: string }[]): boolean {
  return heldOutSha(before) === heldOutSha(after);
}

function safeRel(rel: string): boolean {
  if (!rel || rel.includes("\0") || rel.includes("\\") || isAbsolute(rel)) return false;
  const parts = rel.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return false;
  return /^[A-Za-z0-9._/-]+$/.test(rel);
}

function readRepo(repo: string, rel: string): string | null {
  if (!safeRel(rel)) return null;
  let root: string;
  try { root = realpathSync(resolve(repo)); } catch { return null; }
  const full = resolve(root, rel);
  if (!existsSync(full)) return null;
  let real: string;
  try {
    const st = lstatSync(full);
    if (st.isSymbolicLink()) return null;
    real = realpathSync(full);
  } catch { return null; }
  if (real !== root && !real.startsWith(root + sep)) return null;
  return readFileSync(real, "utf8");
}

function leafRef(node: GapNode, repo: string): LeafRef | null {
  if (node.size !== "leaf") return null;
  if (node.id.startsWith("fn:")) {
    const rest = node.id.slice(3);
    const i = rest.lastIndexOf(":");
    if (i <= 0) return null;
    const path = rest.slice(0, i);
    const name = rest.slice(i + 1);
    if (!safeRel(path) || !/^[A-Za-z_$][\w$]*$/.test(name)) return null;
    return { node, path, name };
  }
  if (node.id.startsWith("beh:")) {
    const parts = node.id.slice(4).split(":");
    if (parts.length < 2 || !parts[0] || !parts[1] || !safeRel(parts[0]) || !/^[A-Za-z_$][\w$]*$/.test(parts[1])) return null;
    return { node, path: parts[0], name: parts[1] };
  }
  if (node.id.startsWith("mod:")) {
    const path = node.id.slice(4);
    if (!safeRel(path)) return null;
    const text = readRepo(repo, path);
    if (text === null) return { node, path, name: "" };
    const names = [...bodies(path, text).keys()];
    if (names.length !== 1) return { node, path, name: "" };
    return { node, path, name: names[0]! };
  }
  return null;
}

function extractFunction(path: string, content: string, name: string): string | null {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null;
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === name && st.body) {
      const text = st.getText(sf);
      return text.startsWith("export ") ? `${text}\n` : `export ${text}\n`;
    }
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || d.name.text !== name || !d.initializer) continue;
        if (!ts.isArrowFunction(d.initializer) && !ts.isFunctionExpression(d.initializer)) continue;
        const text = st.getText(sf);
        return text.startsWith("export ") ? `${text}\n` : `export ${text}\n`;
      }
    }
  }
  return null;
}

interface Param { name: string; optional: boolean; typeText: string }
type ProbeKind = "number" | "string" | "boolean" | "numArray" | "strArray";

function implementationOf(src: string, name: string): { sf: ts.SourceFile; fn: ts.SignatureDeclaration } | null {
  const sf = ts.createSourceFile("leaf.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === name && st.body) return { sf, fn: st };
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.name.text !== name || !d.initializer) continue;
      if (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) return { sf, fn: d.initializer };
    }
  }
  return null;
}

function paramsOf(src: string, name: string): Param[] | null {
  const found = implementationOf(src, name);
  if (!found) return null;
  const out: Param[] = [];
  for (const p of found.fn.parameters) {
    if (!ts.isIdentifier(p.name) || p.dotDotDotToken) return null;
    out.push({ name: p.name.text, optional: !!p.questionToken || !!p.initializer, typeText: p.type ? p.type.getText(found.sf) : "" });
  }
  return out;
}

function requiredCount(params: readonly Param[]): number {
  return params.filter((p) => !p.optional).length;
}

function bodyText(src: string, name: string): string {
  const found = implementationOf(src, name);
  const fn = found?.fn;
  if (!fn || !("body" in fn) || !fn.body) return "";
  return fn.body.getText(found.sf);
}

function isAsyncFn(src: string, name: string): boolean {
  const found = implementationOf(src, name);
  if (!found) return false;
  const mods = ts.canHaveModifiers(found.fn) ? ts.getModifiers(found.fn) ?? [] : [];
  if (mods.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) return true;
  const ret = found.fn.type?.getText(found.sf) ?? "";
  return /\bPromise\s*</.test(ret);
}

/** Probe kind from the first parameter's type, else from how the body uses that name. Not from the function name. */
function probeKind(src: string, name: string): ProbeKind | null {
  const params = paramsOf(src, name);
  if (!params || requiredCount(params) !== 1 || params.length > 4) return null;
  const first = params[0]!;
  const type = first.typeText.replace(/\s+/g, " ");
  if (/\bboolean\b/.test(type)) return "boolean";
  if (/string\s*\[\]|Array<\s*string\s*>|ReadonlyArray<\s*string/.test(type)) return "strArray";
  if (/number\s*\[\]|Array<\s*number\s*>|ReadonlyArray<\s*number|readonly\s+number\s*\[\]|readonly\s+\[number/.test(type)) return "numArray";
  if (/\bstring\b/.test(type)) return "string";
  if (/\bnumber\b/.test(type)) return "number";
  const body = bodyText(src, name);
  const id = first.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const arrayUse = new RegExp(`\\b${id}\\s*(\\.\\s*(length|map|reduce|filter|slice|forEach|some|every)|\\[)`).test(body);
  const stringUse = new RegExp(`\\b${id}\\s*\\.\\s*(toLowerCase|toUpperCase|substring|charAt|trim|replace|padStart|split|includes|startsWith|endsWith)`).test(body);
  const boolUse = new RegExp(`\\b${id}\\s*===\\s*(true|false)|\\b${id}\\s*!==\\s*(true|false)|!\\s*${id}\\b`).test(body);
  const numberUse = new RegExp(`\\b${id}\\s*[+\\-*/%]|(?:[+\\-*/%])\\s*${id}\\b`).test(body);
  if (arrayUse && !stringUse) return "numArray";
  if (stringUse) return "string";
  if (boolUse) return "boolean";
  if (numberUse) return "number";
  if (arrayUse) return "numArray";
  return null;
}

function probeValues(kind: ProbeKind): readonly unknown[] {
  if (kind === "number") return INPUT_SETS.flat();
  if (kind === "string") return ["", "a", "ab", "Hello", "x y"];
  if (kind === "boolean") return [true, false];
  if (kind === "numArray") return [[], [0], [1, 2], [4, 1, 4], [0, 0, 1]];
  return [[], ["a"], ["b", "a"], ["Hello", "x"]];
}

type Enc = { v: number | string | boolean | null } | { nan: true } | { undef: true } | { error: string };
function sameEnc(a: Enc, b: Enc): boolean {
  if ("error" in a || "error" in b) return false;
  if ("nan" in a || "nan" in b) return "nan" in a && "nan" in b;
  if ("undef" in a || "undef" in b) return "undef" in a && "undef" in b;
  if (!("v" in a) || !("v" in b)) return false;
  return Object.is(a.v, b.v);
}
function litOf(e: Enc): string | null {
  if ("error" in e || "nan" in e || "undef" in e) return null;
  if (typeof e.v === "number" && !Number.isFinite(e.v)) return null;
  if (typeof e.v === "string" || typeof e.v === "number" || typeof e.v === "boolean" || e.v === null) return JSON.stringify(e.v);
  return null;
}

const ORACLE_JS = `import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
const data = JSON.parse(readFileSync(new URL("./in.json", import.meta.url), "utf8"));
const sha = (s) => createHash("sha256").update(s).digest("hex");
function enc(v) {
  if (typeof v === "number" && Number.isNaN(v)) return { nan: true };
  if (v === undefined) return { undef: true };
  if (v && typeof v.then === "function") return { error: "promise" };
  return { v };
}
async function cell(fn, args) {
  try {
    const v = fn(...args);
    if (data.await && v && typeof v.then === "function") return enc(await v);
    return enc(v);
  } catch {
    return { error: "throw" };
  }
}
const files = [{ name: "orig.ts", src: data.original }, ...data.broken.map((src, i) => ({ name: "b" + i + ".ts", src }))];
for (const f of files) writeFileSync(new URL(f.name, import.meta.url), f.src);
const before = files.map((f) => sha(readFileSync(new URL(f.name, import.meta.url), "utf8")));
const mods = [];
for (const f of files) mods.push(await import(new URL(f.name, import.meta.url).href));
const after = files.map((f) => sha(readFileSync(new URL(f.name, import.meta.url), "utf8")));
if (before.some((h, i) => h !== after[i])) process.exit(2);
async function column(m) {
  const f = m[data.fn];
  const cells = [];
  for (const args of data.inputs) cells.push(await cell(f, args));
  return cells;
}
const out = { original: await column(mods[0]), broken: [] };
for (const m of mods.slice(1)) out.broken.push(await column(m));
writeFileSync(new URL("./out.json", import.meta.url), JSON.stringify(out));
process.exit(0);
`;

function cleanEnv(dir: string): NodeJS.ProcessEnv {
  return { PATH: "/usr/bin:/bin", TMPDIR: dir, LANG: "C", LC_ALL: "C" };
}

function sandboxed(dir: string, args: string[]): boolean {
  const r = spawnSync(process.execPath, [
    "--permission",
    `--allow-fs-read=${dir}`,
    `--allow-fs-write=${dir}`,
    "--experimental-strip-types",
    ...args,
  ], { cwd: dir, env: cleanEnv(dir), encoding: "utf8", timeout: CHILD_MS, maxBuffer: 1 << 20, killSignal: "SIGKILL" });
  return r.status === 0 && !r.error;
}

function oracleMatrix(original: string, brokenList: string[], inputs: unknown[][], fn: string, awaitResult: boolean): { original: Enc[]; broken: Enc[][] } | null {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-oracle-"));
  try {
    writeFileSync(join(dir, "in.json"), JSON.stringify({ fn, original, broken: brokenList, inputs, await: awaitResult }));
    writeFileSync(join(dir, "run.mjs"), ORACLE_JS);
    if (!sandboxed(dir, ["run.mjs"])) return null;
    return JSON.parse(readFileSync(join(dir, "out.json"), "utf8")) as { original: Enc[]; broken: Enc[][] };
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function testSource(fn: string, inputs: readonly unknown[], expected: readonly string[], mark: string): string {
  const calls = inputs.map((n, i) => `  assert.equal(${fn}(${JSON.stringify(n)}), ${expected[i]});`).join("\n");
  const note = mark.replace(/[^\t\x20-\x7E]/g, " ").slice(0, 160);
  return `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { ${fn} } from "../src/leaf.ts";\n// practice ${note}\ntest("${fn} holds", () => {\n${calls}\n});\n`;
}

function runFileTest(sandbox: string): boolean {
  return sandboxed(sandbox, ["--experimental-test-isolation=none", "--test-force-exit", "--test", "test/leaf.test.ts"]);
}

function withSandbox(src: string, test: string, fn: (dir: string, rel: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-leaf-"));
  const rel = "src/leaf.ts";
  try {
    mkdirSync(join(dir, "src"));
    mkdirSync(join(dir, "test"));
    writeFileSync(join(dir, rel), src);
    writeFileSync(join(dir, "test/leaf.test.ts"), test);
    fn(dir, rel);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function confirms(broken: string, original: string, test: string): boolean {
  let bad = true;
  let good = false;
  withSandbox(broken, test, (dir) => { bad = runFileTest(dir); });
  withSandbox(original, test, (dir) => { good = runFileTest(dir); });
  return good && !bad;
}

interface Budget {
  maxMinutes: number;
  maxAttemptsTotal: number;
  start: number;
  now: () => number;
  attemptsUsed: number;
  stopped: boolean;
}
function timeUp(b: Budget): boolean {
  return b.now() - b.start >= b.maxMinutes * 60_000;
}
function budgetHit(b: Budget): boolean {
  return b.stopped || b.attemptsUsed >= b.maxAttemptsTotal || timeUp(b);
}

function blankNode(node: GapNode, status: LeafStatus, codes: string[]): NodeResult {
  return {
    nodeId: node.id, title: node.title, parent: node.parent, depth: node.depth, size: node.size, status,
    dev: { problems: 0, solved: 0, attempts: 0 },
    heldout: { problems: 0, passed: 0, sha256: heldOutSha([]) },
    attempts: 0, reasonCodes: codes,
  };
}

function makeBreaks(src: string, name: string): { mut: Mutation; broken: string; kind: string }[] {
  const sf = parseSource("src/leaf.ts", src);
  const site: Site = { path: "src/leaf.ts", name, start: 0, end: src.length, tier: 0 };
  const params = paramsOf(src, name)?.map((p) => p.name) ?? [];
  const seen = new Set<string>();
  const out: { mut: Mutation; broken: string; kind: string }[] = [];
  for (const mut of mutationsIn(sf, site, 0, new Set())) {
    if (out.length >= MAX_MUTATIONS) break;
    const broken = src.slice(0, mut.start) + mut.text + src.slice(mut.end);
    if (broken === src || seen.has(broken)) continue;
    seen.add(broken);
    out.push({ mut, broken, kind: `${mut.template}@${mut.start}=${mut.text}|${shapeOf(mut.text, params)}` });
  }
  return out;
}

function problemsFor(nodeId: string, path: string, name: string, src: string, seed: number, history: PracticeProblem[], budget: Budget): { problems: PracticeProblem[]; emptyCode: "UNSUPPORTED_INPUT" | "NO_PRACTICE_PROBLEM" } {
  const historyRows = splitProblems(history, seed);
  const kind = probeKind(src, name);
  if (!kind) return { problems: historyRows, emptyCode: "UNSUPPORTED_INPUT" };
  if (timeUp(budget)) { budget.stopped = true; return { problems: historyRows, emptyCode: "NO_PRACTICE_PROBLEM" }; }
  const breaks = makeBreaks(src, name);
  if (breaks.length === 0) return { problems: historyRows, emptyCode: "NO_PRACTICE_PROBLEM" };
  const inputs = probeValues(kind);
  const matrix = oracleMatrix(src, breaks.map((b) => b.broken), inputs.map((n) => [n]), name, isAsyncFn(src, name));
  if (!matrix) return { problems: historyRows, emptyCode: "NO_PRACTICE_PROBLEM" };
  const made: PracticeProblem[] = [];
  for (const [bi, br] of breaks.entries()) {
    if (timeUp(budget)) { budget.stopped = true; break; }
    const use: unknown[] = [];
    const lits: string[] = [];
    let differs = false;
    inputs.forEach((n, i) => {
      const lit = litOf(matrix.original[i]!);
      if (lit === null) return;
      if (!sameEnc(matrix.original[i]!, matrix.broken[bi]![i]!)) differs = true;
      use.push(n);
      lits.push(lit);
    });
    // The test is the whole probe, not only the one input the mutation changed.
    if (!differs || use.length === 0) continue;
    const test = testSource(name, use.slice(0, 8), lits.slice(0, 8), br.kind);
    if (!confirms(br.broken, src, test)) continue;
    made.push({
      id: `${nodeId}#${br.kind}`,
      nodeId, set: "dev", kind: br.kind, sourcePath: path, function: name,
      broken: br.broken, original: src, fixed: null, test, fromHistory: false, historySha: null,
      solved: false, verified: false, attempts: 0, reasonCodes: [],
    });
    if (made.length >= MAX_KINDS) break;
  }
  const rows = splitProblems([...history, ...made].slice(0, MAX_KINDS), seed);
  return { problems: rows, emptyCode: "NO_PRACTICE_PROBLEM" };
}

/**
 * Even shuffled kinds are held-out, odd kinds are dev. One row per kind, so the seed changes
 * which breaks are held out and does not clone one break across the two sets.
 */
export function splitProblems(problems: PracticeProblem[], seed = 1): PracticeProblem[] {
  const distinct: PracticeProblem[] = [];
  const seenBroken = new Set<string>();
  for (const p of problems) {
    const key = breakKey(p);
    if (seenBroken.has(key)) continue;
    seenBroken.add(key);
    distinct.push(p);
  }
  const kinds: string[] = [];
  for (const p of distinct) {
    const k = `${p.kind}\n${p.fromHistory ? p.historySha ?? "" : ""}`;
    if (!kinds.includes(k)) kinds.push(k);
  }
  const salt = problems.reduce((n, p) => n + p.nodeId.length + p.kind.length, 0);
  const rand = mulberry32(taskSeed(seed >>> 0, salt));
  const order = kinds.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = order[i]!;
    order[i] = order[j]!;
    order[j] = t;
  }
  const setOf = new Map(order.map((k, i) => [k, i % 2 === 0 ? "heldout" as const : "dev" as const]));
  const seen = new Set<string>();
  const out: PracticeProblem[] = [];
  for (const p of distinct) {
    const k = `${p.kind}\n${p.fromHistory ? p.historySha ?? "" : ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...p, set: setOf.get(k) ?? "heldout" });
  }
  return out;
}

function attemptOne(problem: PracticeProblem, budget: Budget): PracticeProblem {
  const out: PracticeProblem = { ...problem, solved: false, verified: false, fixed: null, attempts: 0, reasonCodes: [] };
  if (budgetHit(budget)) {
    budget.stopped = true;
    out.reasonCodes = ["BUDGET_STOPPED"];
    return out;
  }
  let current = problem.broken;
  let passed = false;
  const reasons = new Set<string>();
  const rel = "src/leaf.ts";
  const charge = (): boolean => {
    if (out.attempts >= RETRY_MAX_ATTEMPTS || budgetHit(budget)) {
      if (budgetHit(budget)) budget.stopped = true;
      return false;
    }
    out.attempts++;
    budget.attemptsUsed++;
    return true;
  };
  withSandbox(problem.broken, problem.test, (dir) => {
    const index = buildIndex([{ path: rel, content: problem.broken }]);
    const ctx: RepairContext = {
      index,
      read: (p) => (p === rel ? readFileSync(join(dir, rel), "utf8") : null),
      base: () => null,
      isSource: (p) => p === rel,
      isTest: (p) => p.startsWith("test/"),
    };
    const failErr = (message: string): RepairError => ({
      source: "test", kind: "test-failure", code: "TEST_FAIL", file: rel, line: 1, col: 1, message: message.slice(0, 240),
    });
    const evalOf = (): Evaluation => {
      if (!charge()) return { typecheck: true, originalSuite: false, newTests: false, errors: [failErr("budget")] };
      passed = runFileTest(dir);
      return passed
        ? { typecheck: true, originalSuite: true, newTests: true, errors: [] }
        : { typecheck: true, originalSuite: false, newTests: false, errors: [failErr("test failed")] };
    };
    try {
      const left = Math.max(1, budget.maxMinutes * 60_000 - (budget.now() - budget.start));
      const loop = runRepairLoop({
        evaluate: evalOf,
        context: () => ctx,
        apply: (edit) => {
          if (budgetHit(budget) || edit.path !== rel) return false;
          current = edit.content;
          writeFileSync(join(dir, rel), current);
          return true;
        },
        now: budget.now,
      }, { maxRounds: 1, deadlineMs: left });
      if (loop.stop !== "GREEN" && loop.stop !== "NOT_NEEDED") reasons.add(loop.stop);
      if (loop.stop === "NOT_NEEDED") passed = false;
    } catch {
      reasons.add("REPAIR_LOOP_ERROR");
    }
    if (!passed && out.attempts < RETRY_MAX_ATTEMPTS && !budgetHit(budget)) {
      try {
        const repo = openRepo(dir);
        const proposer = retryProposer(repairProposer({ v2: true }));
        proposer.prepare?.(repo, { request: `fix \`${problem.function}\``, failing: [problem.function] });
        const feedback: RetryFeedback[] = [];
        let proposerAttempt = 1;
        while (out.attempts < RETRY_MAX_ATTEMPTS && !budgetHit(budget) && !passed) {
          const proposal = proposer.next({
            request: `fix \`${problem.function}\``,
            repo: "learn-sandbox",
            plan: {} as ProposeInput["plan"],
            files: [{ path: rel, content: problem.broken }],
            context: [],
            attempt: proposerAttempt,
            feedback,
          });
          proposerAttempt++;
          if ("refuse" in proposal) { reasons.add(proposal.refuse); break; }
          const next = proposal.edits.find((e) => e.path === rel)?.content;
          if (!next || next === current) { reasons.add("NO_EDIT"); break; }
          current = next;
          writeFileSync(join(dir, rel), current);
          if (!charge()) break;
          passed = runFileTest(dir);
          feedback.push({
            attempt: proposerAttempt - 1,
            codes: passed ? [] : ["TEST_FAIL"],
            failing: [problem.function],
            tests: { total: 1, passedByPeaceAI: passed ? 1 : 0, filledByTeam: 0 },
          });
        }
      } catch {
        reasons.add("REPAIR_LOOP_ERROR");
      }
    }
  });
  if (passed && current !== problem.broken) {
    let verified = false;
    withSandbox(current, problem.test, (dir) => { verified = runFileTest(dir); });
    out.solved = verified;
    out.verified = verified;
    out.fixed = verified ? current : null;
    if (!verified) reasons.add("VERIFY_FAILED");
  }
  if (budgetHit(budget) && !out.solved) {
    budget.stopped = true;
    reasons.add("BUDGET_STOPPED");
  }
  if (!out.solved) reasons.add("TEST_FAIL");
  if (out.attempts > RETRY_MAX_ATTEMPTS) reasons.add("ATTEMPT_CAP");
  out.reasonCodes = [...reasons].sort(byStr);
  return out;
}

/** One broken program, ignoring kind labels. A history row and a mutation of the same text are one break. */
export function breakKey(p: { broken: string }): string {
  return p.broken.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

/** Independent held-out breaks. The same broken text counts once, whatever its kind is called. */
export function scoreHeldOut(problems: readonly PracticeProblem[]): { independent: number; passed: number } {
  const groups = new Map<string, PracticeProblem[]>();
  for (const p of problems) {
    if (p.set !== "heldout") continue;
    const key = breakKey(p);
    const rows = groups.get(key) ?? [];
    rows.push(p);
    groups.set(key, rows);
  }
  let passed = 0;
  for (const rows of groups.values()) if (rows.every((p) => p.solved && p.verified)) passed++;
  return { independent: groups.size, passed };
}

/** LEARNED only at >= 0.75 on >= 4 independent held-out breaks. A short sample is not LEARNED. */
export function leafStatus(passed: number, independent: number, stopped: boolean): LeafStatus {
  if (stopped) return "BUDGET_STOPPED";
  if (independent >= 4 && passed / independent >= 0.75) return "LEARNED";
  if (independent >= 4) return "NEEDS_TEACHING";
  if (independent === 0) return "NEEDS_TEACHING";
  return "PRACTICING";
}

/** Demote only from a finished sample of at least 4 independent new held-out breaks. */
export function shouldDemote(independent: number, passed: number, stopped: boolean): boolean {
  if (stopped || independent < 4) return false;
  return passed / independent < 0.75;
}

function counts(problems: PracticeProblem[], set: "dev" | "heldout"): { problems: number; solved: number; attempts: number } {
  const rows = problems.filter((p) => p.set === set);
  return {
    problems: rows.length,
    solved: rows.filter((p) => p.solved && p.verified).length,
    attempts: rows.reduce((s, p) => s + p.attempts, 0),
  };
}

const GIT_BASE = ["--no-pager", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=", "-c", "core.sshCommand=", "-c", "core.pager=cat", "-c", "diff.external=", "-c", "alias.log=", "-c", "alias.show=", "-c", "alias.diff=", "-c", "alias.diff-tree=", "-c", "alias.rev-parse="];

function gitEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAGER: "cat",
    PAGER: "cat",
    LC_ALL: "C",
  };
}

function git(repo: string, args: string[]): string | null {
  let root: string;
  try {
    root = realpathSync(resolve(repo));
    if (!statSync(root).isDirectory()) return null;
  } catch { return null; }
  const r = spawnSync("git", ["-C", root, ...GIT_BASE, ...args], {
    encoding: "utf8", maxBuffer: 8 << 20, stdio: ["ignore", "pipe", "pipe"], env: gitEnv(), timeout: CHILD_MS, killSignal: "SIGKILL",
  });
  return r.status === 0 && !r.error ? r.stdout : null;
}

function isHex40(s: string): boolean {
  return /^[0-9a-f]{40}$/.test(s);
}

function historyFixes(repo: string, path: string, name: string): HistFix[] {
  if (!safeRel(path)) return [];
  if (git(repo, ["rev-parse", "--is-inside-work-tree"])?.trim() !== "true") return [];
  const commits = (git(repo, ["log", "--no-merges", "--format=%H", "-n", "40"]) ?? "").split("\n").map((s) => s.trim()).filter(isHex40);
  const made: HistFix[] = [];
  for (const sha of commits) {
    if (made.length >= 4) break;
    const parent = git(repo, ["rev-parse", `${sha}^`])?.trim() ?? "";
    if (!isHex40(parent)) continue;
    const num = git(repo, ["diff", "--no-ext-diff", "--no-textconv", "--numstat", parent, sha, "--", path]);
    if (!num?.trim()) continue;
    const files = git(repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", parent, sha])?.split("\n").map((s) => s.trim()).filter(Boolean) ?? [];
    if (files.length !== 1 || files[0] !== path) continue;
    const parts = num.trim().split("\n")[0]?.split("\t") ?? [];
    const added = Number(parts[0]), deleted = Number(parts[1]);
    if (!Number.isFinite(added) || !Number.isFinite(deleted) || added + deleted > 20 || added + deleted < 1) continue;
    const before = git(repo, ["show", "--no-ext-diff", "--no-textconv", `${parent}:${path}`]);
    const after = git(repo, ["show", "--no-ext-diff", "--no-textconv", `${sha}:${path}`]);
    if (before === null || after === null) continue;
    const pre = bodies(path, before), post = bodies(path, after);
    const changed = new Set<string>();
    for (const key of new Set([...pre.keys(), ...post.keys()])) if (pre.get(key) !== post.get(key)) changed.add(key);
    if (changed.size !== 1 || !changed.has(name)) continue;
    const preFn = extractFunction(path, before, name);
    const postFn = extractFunction(path, after, name);
    if (!preFn || !postFn || preFn === postFn) continue;
    made.push({ sha, pre: preFn, post: postFn });
  }
  return made;
}

function ownTest(repo: string, map: ProgramMap, path: string, name: string, pre: string, post: string, sha: string): string | null {
  const covers = map.tests.filter((t) => t.covers.includes(path) && safeRel(t.path));
  const stem = path.replace(/\.[cm]?[jt]sx?$/, "").split("/").pop() ?? "";
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const t of covers) {
    const text = readRepo(repo, t.path);
    if (!text || !text.includes(name)) continue;
    const rewritten = text.replace(new RegExp(`(["'])(\\.\\.?/[^"']*${escaped})\\1`, "g"), `"../src/leaf.ts"`);
    const marked = `${rewritten.replace(/\s*$/, "")}\n// practice history ${sha}\n`;
    if (confirms(pre, post, marked)) return marked;
  }
  return null;
}

function generatedHistoryTest(name: string, pre: string, post: string, sha: string): string | null {
  const kind = probeKind(post, name);
  if (!kind) return null;
  const inputs = probeValues(kind).slice(0, 5);
  const matrix = oracleMatrix(post, [pre], inputs.map((n) => [n]), name, isAsyncFn(post, name));
  if (!matrix) return null;
  const use: unknown[] = [];
  const lits: string[] = [];
  inputs.forEach((n, i) => {
    if (sameEnc(matrix.original[i]!, matrix.broken[0]![i]!)) return;
    const lit = litOf(matrix.original[i]!);
    if (lit === null) return;
    use.push(n);
    lits.push(lit);
  });
  if (use.length === 0) return null;
  const test = testSource(name, use.slice(0, 3), lits.slice(0, 3), `history ${sha}`);
  return confirms(pre, post, test) ? test : null;
}

function historyProblems(repo: string, path: string, name: string, nodeId: string, map: ProgramMap, fixes: readonly HistFix[]): PracticeProblem[] {
  const made: PracticeProblem[] = [];
  for (const fix of fixes) {
    const own = ownTest(repo, map, path, name, fix.pre, fix.post, fix.sha);
    const generated = own ?? generatedHistoryTest(name, fix.pre, fix.post, fix.sha);
    if (!generated) continue;
    made.push({
      id: `${nodeId}#history#${fix.sha.slice(0, 10)}`,
      nodeId, set: "dev", kind: `history|${fix.sha.slice(0, 10)}`, sourcePath: path, function: name,
      broken: fix.pre, original: fix.post, fixed: null, test: generated, fromHistory: true, historySha: fix.sha,
      solved: false, verified: false, attempts: 0, reasonCodes: [],
    });
  }
  return made;
}

function finishLeaf(node: GapNode, problems: PracticeProblem[], stopped: boolean, sealedSha: string, emptyCode: "UNSUPPORTED_INPUT" | "NO_PRACTICE_PROBLEM"): NodeResult {
  const dev = counts(problems, "dev");
  const held = scoreHeldOut(problems);
  const codes = new Set<string>();
  for (const p of problems) if (p.set === "heldout" && !(p.solved && p.verified)) for (const c of p.reasonCodes) codes.add(c);
  if (problems.length === 0 && !stopped) codes.add(emptyCode);
  if (held.independent > 0 && held.independent < 4 && !stopped) codes.add("TOO_FEW_HELD_OUT");
  if (held.independent >= 4 && held.passed / held.independent < 0.75) codes.add("HELD_OUT_RATE");
  const post = heldOutSha(problems.filter((p) => p.set === "heldout"));
  if (post !== sealedSha) codes.add("SEAL_BROKEN");
  const status = post === sealedSha ? leafStatus(held.passed, held.independent, stopped) : (stopped ? "BUDGET_STOPPED" : "NEEDS_TEACHING");
  return {
    nodeId: node.id, title: node.title, parent: node.parent, depth: node.depth, size: node.size, status,
    dev: { problems: dev.problems, solved: dev.solved, attempts: dev.attempts },
    heldout: { problems: held.independent, passed: held.passed, sha256: sealedSha },
    attempts: problems.reduce((s, p) => s + p.attempts, 0),
    reasonCodes: [...codes].sort(byStr),
  };
}

function deriveParents(tree: SkillTree, nodes: NodeResult[]): void {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const order = tree.nodes.slice().sort((a, b) => b.depth - a.depth || byStr(a.id, b.id));
  for (const g of order) {
    if (g.size === "leaf") continue;
    const row = byId.get(g.id);
    if (!row) continue;
    if (g.size === "TOO_BIG_UNSPLIT") {
      row.status = "NEEDS_TEACHING";
      row.reasonCodes = g.reason ? [g.reason] : ["TOO_BIG_UNSPLIT"];
      continue;
    }
    const kids = g.children.map((id) => byId.get(id));
    if (g.children.length === 0) continue;
    if (kids.some((k) => !k)) {
      row.status = "PRACTICING";
      row.reasonCodes = ["CHILD_NOT_LEARNED"];
      continue;
    }
    const statuses = kids.map((k) => k!.status);
    if (statuses.every((s) => s === "LEARNED")) row.status = "LEARNED";
    else if (statuses.some((s) => s === "BUDGET_STOPPED")) row.status = "BUDGET_STOPPED";
    else if (statuses.some((s) => s === "NEEDS_TEACHING")) row.status = "NEEDS_TEACHING";
    else row.status = "PRACTICING";
    row.reasonCodes = row.status === "LEARNED" ? [] : ["CHILD_NOT_LEARNED"];
  }
}

/** Parent rows after the child-status rule. A listed child with no row blocks LEARNED. */
export function withParentStatus(tree: SkillTree, nodes: readonly NodeResult[]): NodeResult[] {
  const copy = structuredClone(nodes) as NodeResult[];
  deriveParents(tree, copy);
  return copy;
}

function budgets(maxMinutes: number, maxAttemptsTotal: number): { maxMinutes: number; maxAttemptsTotal: number } {
  if (!Number.isFinite(maxMinutes) || maxMinutes < 0 || !Number.isFinite(maxAttemptsTotal) || maxAttemptsTotal < 0) throw new LearnRefuse("BAD_BUDGET");
  return { maxMinutes, maxAttemptsTotal: Math.floor(maxAttemptsTotal) };
}

/**
 * Practice every leaf, children before parents (leaves first, then parent status).
 * Stops cleanly on the attempt or minute cap. Unfinished leaves are BUDGET_STOPPED, never dropped.
 */
export function practiceProgram(opts: PracticeOptions): PracticeRun {
  const seed = Number.isFinite(opts.seed) ? Math.floor(opts.seed ?? 1) : 1;
  const caps = budgets(opts.maxMinutes ?? 30, opts.maxAttemptsTotal ?? 200);
  const now = opts.now ?? Date.now;
  if (opts.outPath && insideRepo(opts.repoPath, opts.outPath)) throw new LearnRefuse("WRITE_IN_TARGET");
  const budget: Budget = { ...caps, start: now(), now, attemptsUsed: 0, stopped: false };
  const problems: PracticeProblem[] = [];
  const nodes: NodeResult[] = [];
  let history: HistoryFlag = opts.fromHistory ? "HISTORY_NONE" : "OFF";
  const leaves = opts.tree.nodes.filter((n) => n.size === "leaf").slice().sort((a, b) => b.depth - a.depth || byStr(a.id, b.id));
  const fixes = new Map<string, HistFix[]>();
  if (opts.fromHistory) {
    const work = git(opts.repoPath, ["rev-parse", "--is-inside-work-tree"])?.trim() === "true";
    history = "HISTORY_NONE";
    if (work) {
      for (const node of leaves) {
        const ref = leafRef(node, opts.repoPath);
        if (!ref?.name) continue;
        const found = historyFixes(opts.repoPath, ref.path, ref.name);
        fixes.set(node.id, found);
        if (found.length) history = "USED";
      }
    }
  }
  let sealedOk = true;
  for (const node of leaves) {
    if (budgetHit(budget)) {
      budget.stopped = true;
      nodes.push(blankNode(node, "BUDGET_STOPPED", ["BUDGET_STOPPED"]));
      continue;
    }
    const ref = leafRef(node, opts.repoPath);
    const text = ref ? readRepo(opts.repoPath, ref.path) : null;
    const src = ref && text !== null && ref.name ? extractFunction(ref.path, text, ref.name) : null;
    if (!ref || !src) {
      nodes.push(blankNode(node, "NEEDS_TEACHING", ["NO_FUNCTION"]));
      continue;
    }
    const hist = opts.fromHistory ? historyProblems(opts.repoPath, ref.path, ref.name, node.id, opts.map, fixes.get(node.id) ?? []) : [];
    const builtPack = problemsFor(node.id, ref.path, ref.name, src, seed, hist, budget);
    const built = builtPack.problems;
    const sealedSha = heldOutSha(built.filter((p) => p.set === "heldout"));
    const done: PracticeProblem[] = [];
    for (const p of built) {
      if (budgetHit(budget)) {
        budget.stopped = true;
        done.push({ ...p, reasonCodes: ["BUDGET_STOPPED"] });
        continue;
      }
      done.push(attemptOne(p, budget));
    }
    const postSha = heldOutSha(done.filter((p) => p.set === "heldout"));
    if (!practiceSealOk(built.filter((p) => p.set === "heldout"), done.filter((p) => p.set === "heldout")) || postSha !== sealedSha) sealedOk = false;
    problems.push(...done);
    const unfinished = done.some((p) => p.reasonCodes.includes("BUDGET_STOPPED") && !p.solved);
    nodes.push(finishLeaf(node, done, unfinished, sealedSha, builtPack.emptyCode));
  }
  for (const g of opts.tree.nodes) {
    if (g.size === "leaf") continue;
    if (!nodes.some((n) => n.nodeId === g.id)) nodes.push(blankNode(g, g.size === "TOO_BIG_UNSPLIT" ? "NEEDS_TEACHING" : "PRACTICING", []));
  }
  deriveParents(opts.tree, nodes);
  nodes.sort((a, b) => byStr(a.nodeId, b.nodeId));
  problems.sort((a, b) => byStr(a.id, b.id));
  const minutesUsed = Math.round(((now() - budget.start) / 60_000) * 1000) / 1000;
  const anyHeld = problems.some((p) => p.set === "heldout");
  let mapTrusted = false;
  try {
    const checked = checkMap(opts.map, opts.repoPath);
    mapTrusted = checked.wrong.length === 0 && checked.asked > 0;
  } catch {
    mapTrusted = false;
  }
  return {
    schema: LEARN_PRACTICE_SCHEMA,
    experimental: true,
    credit: false,
    seed,
    minutesUsed,
    attemptsUsed: budget.attemptsUsed,
    maxMinutes: caps.maxMinutes,
    maxAttemptsTotal: caps.maxAttemptsTotal,
    history,
    budgetStopped: budget.stopped,
    sealedBeforeAttempts: anyHeld && sealedOk,
    heldoutProof: heldoutProofOf(nodes),
    mapTrusted,
    nodes,
    problems,
    rechecks: [],
  };
}

function heldoutProofOf(nodes: readonly NodeResult[]): boolean {
  return nodes.some((n) => n.size === "leaf" && n.status === "LEARNED" && n.heldout.problems >= 4 && n.heldout.passed / n.heldout.problems >= 0.75);
}

function rate(passed: number, total: number): number {
  return total === 0 ? 0 : passed / total;
}

function heldIdentity(p: PracticeProblem): string {
  return `${p.kind}\n${p.broken}\n${p.test}`;
}

/**
 * Fresh held-out sample (seed + 1), excluding breaks already sealed as held-out.
 * Old held-out rows are not edited. A finished sample under 0.75 demotes the leaf and its LEARNED ancestors.
 * A sample of fewer than 4 independent breaks does not demote.
 */
export function recheckPractice(prior: PracticeRun, opts: PracticeOptions): PracticeRun {
  const next: PracticeRun = structuredClone(prior);
  next.credit = false;
  next.experimental = true;
  next.schema = LEARN_PRACTICE_SCHEMA;
  const seed = (Number.isFinite(opts.seed) ? Math.floor(opts.seed ?? prior.seed) : prior.seed) + 1;
  const caps = budgets(opts.maxMinutes ?? prior.maxMinutes, opts.maxAttemptsTotal ?? prior.maxAttemptsTotal);
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const now = opts.now ?? Date.now;
  const budget: Budget = { ...caps, start: now(), now, attemptsUsed: 0, stopped: false };
  const byId = new Map(next.nodes.map((n) => [n.nodeId, n]));
  const priorProblems = prior.problems.slice();
  for (const node of opts.tree.nodes.filter((n) => n.size === "leaf").sort((a, b) => byStr(a.id, b.id))) {
    const row = byId.get(node.id);
    if (!row || row.status !== "LEARNED") continue;
    const oldHeld = priorProblems.filter((p) => p.nodeId === node.id && p.set === "heldout");
    const oldIds = new Set(oldHeld.map(heldIdentity));
    const ref = leafRef(node, opts.repoPath);
    const text = ref ? readRepo(opts.repoPath, ref.path) : null;
    const src = ref && text !== null && ref.name ? extractFunction(ref.path, text, ref.name) : null;
    let sample: PracticeProblem[] = [];
    if (src && ref) {
      sample = problemsFor(node.id, ref.path, ref.name, src, seed, [], budget).problems
        .filter((p) => p.set === "heldout" && !oldIds.has(heldIdentity(p)));
    }
    const tried: PracticeProblem[] = [];
    let stopped = false;
    for (const p of sample) {
      if (budgetHit(budget)) { budget.stopped = true; stopped = true; break; }
      tried.push(attemptOne(p, budget));
      if (budget.stopped) { stopped = true; break; }
    }
    const scored = scoreHeldOut(tried.map((p) => ({ ...p, set: "heldout" as const })));
    const newRate = rate(scored.passed, scored.independent);
    const oldRate = rate(row.heldout.passed, row.heldout.problems);
    const demoted = shouldDemote(scored.independent, scored.passed, stopped || budget.stopped);
    const ancestors: string[] = [];
    if (demoted) {
      row.status = "PRACTICING";
      let parent = row.parent;
      while (parent) {
        const anc = byId.get(parent);
        if (!anc) break;
        if (anc.status === "LEARNED") {
          anc.status = "PRACTICING";
          ancestors.push(anc.nodeId);
        }
        parent = anc.parent;
      }
    }
    next.rechecks.push({
      at: today, nodeId: node.id, oldRate, newRate,
      oldSha256: row.heldout.sha256,
      newSha256: heldOutSha(tried),
      demoted,
      ancestors,
    });
  }
  const sameProblems = JSON.stringify(next.problems) === JSON.stringify(priorProblems);
  for (const row of next.nodes) {
    const old = prior.nodes.find((n) => n.nodeId === row.nodeId);
    if (old && row.heldout.sha256 !== old.heldout.sha256) row.heldout.sha256 = old.heldout.sha256;
  }
  next.sealedBeforeAttempts = sameProblems && prior.sealedBeforeAttempts === true && next.problems.some((p) => p.set === "heldout");
  next.heldoutProof = heldoutProofOf(next.nodes);
  next.attemptsUsed += budget.attemptsUsed;
  next.minutesUsed = Math.round((next.minutesUsed + (now() - budget.start) / 60_000) * 1000) / 1000;
  next.budgetStopped = prior.budgetStopped || budget.stopped;
  next.rechecks.sort((a, b) => byStr(a.at, b.at) || byStr(a.nodeId, b.nodeId));
  return next;
}

export function renderProgress(run: PracticeRun): string {
  const lines = [
    `EXPERIMENTAL credit=false schema=${run.schema}`,
    `seed=${run.seed} minutes=${run.minutesUsed} attempts=${run.attemptsUsed} budgetStopped=${run.budgetStopped} history=${run.history} sealed=${run.sealedBeforeAttempts} heldoutProof=${run.heldoutProof === true} mapTrusted=${run.mapTrusted === true}`,
  ];
  for (const n of run.nodes) {
    lines.push(`- [${n.status}] ${n.title} dev=${n.dev.solved}/${n.dev.problems} heldout=${n.heldout.passed}/${n.heldout.problems} sha=${n.heldout.sha256.slice(0, 12)} attempts=${n.attempts}${n.reasonCodes.length ? ` (${n.reasonCodes.join(",")})` : ""}`);
  }
  for (const r of run.rechecks) lines.push(`recheck ${r.at} ${r.nodeId} old=${r.oldRate} new=${r.newRate} demoted=${r.demoted}`);
  return `${lines.join("\n")}\n`;
}

/**
 * One gap list. No workflow-learner / builder-log row has this shape (gaps.md is a markdown
 * table; tasks.jsonl is a different schema), so this is the list: needs-teaching.jsonl.
 * Rows are NEEDS_TEACHING leaves and TOO_BIG_UNSPLIT nodes, one per node.
 */
export function gapRows(run: PracticeRun, tree: SkillTree, program: string, today: string): GapRow[] {
  const rows: GapRow[] = [];
  const byGap = new Map(tree.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  for (const n of run.nodes) {
    const gap = byGap.get(n.nodeId);
    const tooBig = gap?.size === "TOO_BIG_UNSPLIT";
    const leafNeeds = n.size === "leaf" && n.status === "NEEDS_TEACHING";
    if (!leafNeeds && !tooBig) continue;
    if (seen.has(n.nodeId)) continue;
    seen.add(n.nodeId);
    rows.push({
      program,
      nodeId: n.nodeId,
      title: n.title,
      reasonCodes: n.reasonCodes.length ? n.reasonCodes.slice().sort(byStr) : tooBig && gap?.reason ? [gap.reason] : ["NEEDS_TEACHING"],
      testIdea: gap?.testIdea ?? "",
      firstSeen: today,
    });
  }
  rows.sort((a, b) => byStr(a.program, b.program) || byStr(a.nodeId, b.nodeId));
  return rows;
}

/** Keep the first row for each program+nodeId. A re-run does not add a duplicate or rewrite firstSeen. */
export function mergeNeedsTeaching(prev: string, rows: readonly GapRow[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const line of prev.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as GapRow;
      const key = `${row.program}\n${row.nodeId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(JSON.stringify(row));
    } catch { /* skip a corrupt line rather than duplicating the gap */ }
  }
  for (const row of rows) {
    const key = `${row.program}\n${row.nodeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(JSON.stringify({
      program: row.program, nodeId: row.nodeId, title: row.title,
      reasonCodes: row.reasonCodes, testIdea: row.testIdea, firstSeen: row.firstSeen,
    }));
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}

export function programName(repoPath: string): string {
  const base = repoPath.replace(/\/+$/, "").split("/").pop() ?? "program";
  return base || "program";
}
