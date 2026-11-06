// EXPERIMENTAL learn step 3: practice each skill-tree leaf. credit is always false.
// Not wired into scoring, grading, or results.
//
// A leaf's one function is copied into a temp sandbox (never the target repo). A small break is
// injected from the existing repair mutation catalog (`mutationsIn` in editpropose.ts — the same
// templates the repair proposer undoes). The kind name is `shapeOf` from derive-practice-kinds.ts;
// the seed stream is mulberry32 / taskSeed from derive-practice.ts. No new mutation catalog.
// Held-out is sealed (sha256) before any repair attempt. Attempts go through runRepairLoop and then
// repair-retry (RETRY_MAX_ATTEMPTS), and a real node:test decides pass or fail.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { openRepo } from "./codesearch.ts";
import { shapeOf } from "./derive-practice-kinds.ts";
import { mulberry32, taskSeed } from "./derive-practice.ts";
import { mutationsIn, parseSource, repairProposer, type Mutation, type Site } from "./editpropose.ts";
import { bodies } from "./ftpairs.ts";
import type { GapNode, SkillTree } from "./learntree.ts";
import type { ProgramMap } from "./learnmap.ts";
import { retryProposer, RETRY_MAX_ATTEMPTS, type RetryFeedback } from "./repair-retry.ts";
import { buildIndex } from "./symbols.ts";
import { runRepairLoop, type Evaluation } from "./repairloop.ts";
import type { RepairContext, RepairError } from "./repair.ts";
import type { ProposeInput } from "./loop.ts";

export const LEARN_PRACTICE_SCHEMA = "peaceai-learn-practice:v1" as const;
export const NEEDS_TEACHING_SCHEMA = "peaceai-needs-teaching:v1" as const;
const MAX_PROBLEMS = 8;
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
  /** Source that passed the real test, when solved. */
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
  /** True once the held-out sha is stored and before repair attempts start. */
  sealedBeforeAttempts: true;
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

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** sha256 of held-out problem contents. Changing any held-out file changes the digest. */
export function heldOutSha(items: readonly { id: string; kind: string; broken: string; test: string }[]): string {
  const body = items.slice().sort((a, b) => byStr(a.id, b.id)).map((i) => `${i.id}\n${i.kind}\n${i.broken}\n${i.test}\n`).join("\n");
  return sha256(body);
}

function readRepo(repo: string, rel: string): string | null {
  if (!rel || rel.includes("\0") || isAbsolute(rel) || rel.split("/").includes("..")) return null;
  const root = realpathSync(resolve(repo));
  const full = resolve(root, rel);
  if (!existsSync(full)) return null;
  const real = realpathSync(full);
  if (real !== root && !real.startsWith(root + sep)) return null;
  return readFileSync(real, "utf8");
}

function leafRef(node: GapNode, repo: string): LeafRef | null {
  if (node.size !== "leaf") return null;
  if (node.id.startsWith("fn:")) {
    const rest = node.id.slice(3);
    const i = rest.lastIndexOf(":");
    if (i <= 0) return null;
    return { node, path: rest.slice(0, i), name: rest.slice(i + 1) };
  }
  if (node.id.startsWith("beh:")) {
    const parts = node.id.slice(4).split(":");
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    return { node, path: parts[0], name: parts[1] };
  }
  if (node.id.startsWith("mod:")) {
    const path = node.id.slice(4);
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

interface Param { name: string }
function paramsOf(src: string, name: string): Param[] | null {
  const sf = ts.createSourceFile("leaf.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const fn = sf.statements.find((st) => ts.isFunctionDeclaration(st) && st.name?.text === name) as ts.FunctionDeclaration | undefined;
  if (!fn) return null;
  const out: Param[] = [];
  for (const p of fn.parameters) {
    if (!ts.isIdentifier(p.name) || p.dotDotDotToken) return null;
    out.push({ name: p.name.text });
  }
  return out;
}

type Enc = { v: number | string | boolean | null } | { nan: true } | { error: string };
function sameEnc(a: Enc, b: Enc): boolean {
  if ("error" in a || "error" in b) return false;
  if ("nan" in a || "nan" in b) return "nan" in a && "nan" in b;
  return Object.is(a.v, b.v);
}
function litOf(e: Enc): string | null {
  if ("error" in e || "nan" in e) return null;
  if (typeof e.v === "number" && !Number.isFinite(e.v)) return null;
  return JSON.stringify(e.v);
}

const ORACLE_JS = `import { readFileSync, writeFileSync } from "node:fs";
const data = JSON.parse(readFileSync(new URL("./in.json", import.meta.url), "utf8"));
function enc(v) {
  if (typeof v === "number" && Number.isNaN(v)) return { nan: true };
  return { v };
}
async function column(src, tag) {
  const url = new URL(tag + ".ts", import.meta.url);
  writeFileSync(url, src);
  const m = await import(url.href);
  const f = m[data.fn];
  return data.inputs.map((args) => { try { return enc(f(...args)); } catch { return { error: "throw" }; } });
}
const out = { original: await column(data.original, "orig"), broken: [] };
for (let i = 0; i < data.broken.length; i++) out.broken.push(await column(data.broken[i], "b" + i));
process.stdout.write(JSON.stringify(out));
`;

/** Drop the parent test-runner channel so a child `node --test` is its own process. */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === "NODE_CHANNEL_FD" || key.startsWith("NODE_TEST") || key.startsWith("TEST_RUNNER")) delete env[key];
  }
  return env;
}

function oracleMatrix(original: string, brokenList: string[], inputs: number[][], fn: string): { original: Enc[]; broken: Enc[][] } | null {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-oracle-"));
  try {
    writeFileSync(join(dir, "in.json"), JSON.stringify({ fn, original, broken: brokenList, inputs }));
    writeFileSync(join(dir, "run.mjs"), ORACLE_JS);
    const r = spawnSync(process.execPath, ["--experimental-strip-types", "run.mjs"], { cwd: dir, encoding: "utf8", timeout: 15000, maxBuffer: 1 << 20, env: childEnv() });
    if (r.status !== 0) return null;
    return JSON.parse(r.stdout) as { original: Enc[]; broken: Enc[][] };
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function testSource(fn: string, inputs: readonly number[], expected: readonly string[], mark: string): string {
  const calls = inputs.map((n, i) => `  assert.equal(${fn}(${n}), ${expected[i]});`).join("\n");
  const note = mark.replace(/[\r\n]/g, " ");
  return `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { ${fn} } from "../src/leaf.ts";\n// practice ${note}\ntest("${fn} holds", () => {\n${calls}\n});\n`;
}

function runFileTest(sandbox: string): boolean {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--test", "test/leaf.test.ts"], {
    cwd: sandbox, encoding: "utf8", timeout: 15000, maxBuffer: 1 << 20, env: childEnv(),
  });
  return r.status === 0;
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
  let bad = false;
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
    const broken = src.slice(0, mut.start) + mut.text + src.slice(mut.end);
    if (broken === src || seen.has(broken)) continue;
    seen.add(broken);
    out.push({ mut, broken, kind: `${mut.template}@${mut.start}=${mut.text}|${shapeOf(mut.text, params)}` });
  }
  return out;
}

function problemsFor(nodeId: string, path: string, name: string, src: string, seed: number, history: PracticeProblem[]): PracticeProblem[] {
  const params = paramsOf(src, name);
  if (!params || params.length !== 1) return history;
  const breaks = makeBreaks(src, name);
  if (breaks.length === 0) return history;
  const inputs = INPUT_SETS.flat();
  const matrix = oracleMatrix(src, breaks.map((b) => b.broken), inputs.map((n) => [n]), name);
  if (!matrix) return history;
  const rand = mulberry32(taskSeed(seed, nodeId.length + name.length));
  const setOrder = INPUT_SETS.map((set, i) => ({ set, k: rand() + i * 0 }));
  // taskSeed already mixed into the stream; keep set order stable per seed via the shuffle below.
  for (let i = setOrder.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = setOrder[i]!;
    setOrder[i] = setOrder[j]!;
    setOrder[j] = t;
  }
  const made: PracticeProblem[] = [];
  breaks.forEach((br, bi) => {
    const group: PracticeProblem[] = [];
    setOrder.forEach((s, si) => {
      const idxs = s.set.map((n) => inputs.indexOf(n)).filter((i) => i >= 0);
      const use = idxs.filter((i) => !sameEnc(matrix.original[i]!, matrix.broken[bi]![i]!));
      const lits = use.map((i) => litOf(matrix.original[i]!));
      if (use.length === 0 || lits.some((l) => l === null)) return;
      const test = testSource(name, use.map((i) => inputs[i]!), lits as string[], br.kind);
      group.push({
        id: `${nodeId}#${br.kind}#${si}`,
        nodeId, set: "dev", kind: br.kind, sourcePath: path, function: name,
        broken: br.broken, original: src, fixed: null, test, fromHistory: false, historySha: null,
        solved: false, verified: false, attempts: 0, reasonCodes: [],
      });
    });
    // Keep the mutation only when one real test fails on the break and passes on the original.
    const sample = group[0];
    if (!sample || !confirms(sample.broken, src, sample.test)) return;
    made.push(...group);
  });
  const capped = [...history, ...made].slice(0, MAX_PROBLEMS);
  return splitProblems(capped);
}

/** Even break-groups (by kind) are held-out, odd groups are dev. Seal happens on the result. */
export function splitProblems(problems: PracticeProblem[]): PracticeProblem[] {
  const kinds: string[] = [];
  for (const p of problems) if (!kinds.includes(p.kind + (p.fromHistory ? p.historySha ?? "" : ""))) kinds.push(p.kind + (p.fromHistory ? p.historySha ?? "" : ""));
  const setOf = new Map(kinds.map((k, i) => [k, i % 2 === 0 ? "heldout" as const : "dev" as const]));
  return problems.map((p) => ({ ...p, set: setOf.get(p.kind + (p.fromHistory ? p.historySha ?? "" : "")) ?? "heldout" }));
}

function attemptOne(problem: PracticeProblem, budget: Budget): PracticeProblem {
  const out: PracticeProblem = { ...problem, reasonCodes: [] };
  if (budgetHit(budget)) {
    budget.stopped = true;
    out.reasonCodes = ["BUDGET_STOPPED"];
    return out;
  }
  let current = problem.broken;
  let passed = false;
  const reasons = new Set<string>();
  const rel = "src/leaf.ts";
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
      if (budgetHit(budget) || out.attempts >= RETRY_MAX_ATTEMPTS) {
        budget.stopped = budgetHit(budget);
        return { typecheck: true, originalSuite: false, newTests: false, errors: [failErr("budget")] };
      }
      out.attempts++;
      budget.attemptsUsed++;
      passed = runFileTest(dir);
      return passed
        ? { typecheck: true, originalSuite: true, newTests: true, errors: [] }
        : { typecheck: true, originalSuite: false, newTests: false, errors: [failErr("test failed")] };
    };
    let loopStop = "";
    try {
      const loop = runRepairLoop({
        evaluate: evalOf,
        context: () => ctx,
        apply: (edit) => {
          if (edit.path !== rel) return false;
          current = edit.content;
          writeFileSync(join(dir, rel), current);
          return true;
        },
        now: budget.now,
      }, { maxRounds: 1, deadlineMs: Math.max(1, budget.maxMinutes * 60_000) });
      loopStop = loop.stop;
      if (loop.stop !== "GREEN" && loop.stop !== "NOT_NEEDED") reasons.add(loop.stop);
    } catch {
      reasons.add("REPAIR_LOOP_ERROR");
    }
    if (!passed && out.attempts < RETRY_MAX_ATTEMPTS && !budgetHit(budget)) {
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
        if (!next) { reasons.add("NO_EDIT"); break; }
        current = next;
        writeFileSync(join(dir, rel), current);
        out.attempts++;
        budget.attemptsUsed++;
        passed = runFileTest(dir);
        feedback.push({
          attempt: proposerAttempt - 1,
          codes: passed ? [] : ["TEST_FAIL"],
          failing: [problem.function],
          tests: { total: 1, passedByPeaceAI: passed ? 1 : 0, filledByTeam: 0 },
        });
      }
    }
    if (budgetHit(budget) && !passed) {
      budget.stopped = true;
      reasons.add("BUDGET_STOPPED");
    }
    if (!passed) reasons.add("TEST_FAIL");
    void loopStop;
  });
  out.solved = passed;
  out.verified = passed;
  out.fixed = passed ? current : null;
  out.reasonCodes = [...reasons].sort(byStr);
  return out;
}

function counts(problems: PracticeProblem[], set: "dev" | "heldout"): { problems: number; solved: number; attempts: number } {
  const rows = problems.filter((p) => p.set === set);
  return {
    problems: rows.length,
    solved: rows.filter((p) => p.solved).length,
    attempts: rows.reduce((s, p) => s + p.attempts, 0),
  };
}

function statusOf(heldPassed: number, heldTotal: number, codes: string[], stopped: boolean): LeafStatus {
  if (stopped) return "BUDGET_STOPPED";
  if (heldTotal >= 4 && heldPassed / heldTotal >= 0.75) return "LEARNED";
  if (heldTotal >= 4) return "NEEDS_TEACHING";
  if (heldTotal === 0) return "NEEDS_TEACHING";
  return "PRACTICING";
}

function git(repo: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 8 << 20, stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return null;
  }
}

function historyProblems(repo: string, path: string, name: string, nodeId: string, map: ProgramMap): { problems: PracticeProblem[]; flag: HistoryFlag } {
  if (git(repo, ["rev-parse", "--is-inside-work-tree"])?.trim() !== "true") return { problems: [], flag: "HISTORY_NONE" };
  const commits = (git(repo, ["log", "--no-merges", "--format=%H", "-n", "40"]) ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  const made: PracticeProblem[] = [];
  for (const sha of commits) {
    if (made.length >= 4) break;
    const parent = git(repo, ["rev-parse", `${sha}^`])?.trim();
    if (!parent) continue;
    const num = git(repo, ["diff", "--numstat", parent, sha, "--", path]);
    if (!num?.trim()) continue;
    const files = git(repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", parent, sha])?.split("\n").map((s) => s.trim()).filter(Boolean) ?? [];
    if (files.length !== 1 || files[0] !== path) continue;
    const parts = num.trim().split("\n")[0]?.split("\t") ?? [];
    const added = Number(parts[0]), deleted = Number(parts[1]);
    if (!Number.isFinite(added) || !Number.isFinite(deleted) || added + deleted > 20 || added + deleted < 1) continue;
    const before = git(repo, ["show", `${parent}:${path}`]);
    const after = git(repo, ["show", `${sha}:${path}`]);
    if (before === null || after === null) continue;
    const pre = bodies(path, before), post = bodies(path, after);
    const changed = new Set<string>();
    for (const key of new Set([...pre.keys(), ...post.keys()])) if (pre.get(key) !== post.get(key)) changed.add(key);
    if (changed.size !== 1 || !changed.has(name)) continue;
    const preFn = extractFunction(path, before, name);
    const postFn = extractFunction(path, after, name);
    if (!preFn || !postFn || preFn === postFn) continue;
    const own = ownTest(repo, map, path, name, preFn, postFn, sha);
    const generated = own ?? generatedHistoryTest(name, preFn, postFn, sha);
    if (!generated) continue;
    made.push({
      id: `${nodeId}#history#${sha.slice(0, 10)}`,
      nodeId, set: "dev", kind: `history|${sha.slice(0, 10)}`, sourcePath: path, function: name,
      broken: preFn, original: postFn, fixed: null, test: generated, fromHistory: true, historySha: sha,
      solved: false, verified: false, attempts: 0, reasonCodes: [],
    });
  }
  return { problems: made, flag: made.length ? "USED" : "HISTORY_NONE" };
}

function ownTest(repo: string, map: ProgramMap, path: string, name: string, pre: string, post: string, sha: string): string | null {
  const covers = map.tests.filter((t) => t.covers.includes(path));
  for (const t of covers) {
    const text = readRepo(repo, t.path);
    if (!text || !text.includes(name)) continue;
    const stem = path.replace(/\.[cm]?[jt]sx?$/, "").split("/").pop() ?? "";
    const rewritten = text.replace(new RegExp(`(["'])(\\.\\.?/[^"']*${stem})\\1`, "g"), `"../src/leaf.ts"`);
    const marked = `${rewritten.replace(/\s*$/, "")}\n// practice history ${sha}\n`;
    if (confirms(pre, post, marked)) return marked;
  }
  return null;
}

function generatedHistoryTest(name: string, pre: string, post: string, sha: string): string | null {
  if (paramsOf(post, name)?.length !== 1) return null;
  const inputs = [0, 1, 2, 3, 4];
  const matrix = oracleMatrix(post, [pre], inputs.map((n) => [n]), name);
  if (!matrix) return null;
  const use: number[] = [];
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

function finishLeaf(node: GapNode, problems: PracticeProblem[], stopped: boolean): NodeResult {
  const dev = counts(problems, "dev");
  const heldRows = problems.filter((p) => p.set === "heldout");
  const heldPassed = heldRows.filter((p) => p.solved).length;
  const codes = new Set<string>();
  for (const p of heldRows) if (!p.solved) for (const c of p.reasonCodes) codes.add(c);
  if (problems.length === 0 && !stopped) codes.add("NO_PRACTICE_PROBLEM");
  if (heldRows.length > 0 && heldRows.length < 4 && !stopped) codes.add("TOO_FEW_HELD_OUT");
  if (heldRows.length >= 4 && heldPassed / heldRows.length < 0.75) codes.add("HELD_OUT_RATE");
  const status = statusOf(heldPassed, heldRows.length, [...codes], stopped);
  return {
    nodeId: node.id, title: node.title, parent: node.parent, depth: node.depth, size: node.size, status,
    dev: { problems: dev.problems, solved: dev.solved, attempts: dev.attempts },
    heldout: { problems: heldRows.length, passed: heldPassed, sha256: heldOutSha(heldRows) },
    attempts: problems.reduce((s, p) => s + p.attempts, 0),
    reasonCodes: [...codes].sort(byStr),
  };
}

function deriveParents(tree: SkillTree, nodes: NodeResult[]): void {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const gap = new Map(tree.nodes.map((n) => [n.id, n]));
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
    const kids = g.children.map((id) => byId.get(id)?.status).filter((s): s is LeafStatus => !!s);
    if (kids.length === 0) continue;
    if (kids.every((s) => s === "LEARNED")) row.status = "LEARNED";
    else if (kids.some((s) => s === "BUDGET_STOPPED")) row.status = "BUDGET_STOPPED";
    else if (kids.some((s) => s === "NEEDS_TEACHING")) row.status = "NEEDS_TEACHING";
    else row.status = "PRACTICING";
    row.reasonCodes = row.status === "LEARNED" ? [] : [`CHILD_NOT_LEARNED`];
    void gap;
  }
}

/**
 * Practice every leaf, children before parents (leaves first, then parent status).
 * Stops cleanly on the attempt or minute cap. Unfinished leaves are BUDGET_STOPPED, never dropped.
 */
export function practiceProgram(opts: PracticeOptions): PracticeRun {
  const seed = opts.seed ?? 1;
  const maxMinutes = opts.maxMinutes ?? 30;
  const maxAttemptsTotal = opts.maxAttemptsTotal ?? 200;
  const now = opts.now ?? Date.now;
  if (opts.outPath && insideRepo(opts.repoPath, opts.outPath)) throw new LearnRefuse("WRITE_IN_TARGET");
  const budget: Budget = { maxMinutes, maxAttemptsTotal, start: now(), now, attemptsUsed: 0, stopped: false };
  const problems: PracticeProblem[] = [];
  const nodes: NodeResult[] = [];
  let history: HistoryFlag = opts.fromHistory ? "HISTORY_NONE" : "OFF";
  const leaves = opts.tree.nodes.filter((n) => n.size === "leaf").slice().sort((a, b) => b.depth - a.depth || byStr(a.id, b.id));
  // Build and seal every leaf that the budget still allows, then attempt. Sha is fixed before attempts.
  const sealed: { node: GapNode; problems: PracticeProblem[] }[] = [];
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
      const row = blankNode(node, "NEEDS_TEACHING", ["NO_FUNCTION"]);
      nodes.push(row);
      continue;
    }
    let hist: PracticeProblem[] = [];
    if (opts.fromHistory) {
      const h = historyProblems(opts.repoPath, ref.path, ref.name, node.id, opts.map);
      hist = h.problems;
      if (h.flag === "USED") history = "USED";
    }
    const built = problemsFor(node.id, ref.path, ref.name, src, seed, hist);
    // Seal before attempts: sha is a pure function of the held-out files.
    const sha = heldOutSha(built.filter((p) => p.set === "heldout"));
    void sha;
    sealed.push({ node, problems: built });
  }
  for (const item of sealed) {
    const done: PracticeProblem[] = [];
    for (const p of item.problems) {
      if (budgetHit(budget)) {
        budget.stopped = true;
        done.push({ ...p, reasonCodes: ["BUDGET_STOPPED"] });
        continue;
      }
      done.push(attemptOne(p, budget));
    }
    problems.push(...done);
    const unfinished = done.some((p) => p.reasonCodes.includes("BUDGET_STOPPED") && !p.solved);
    nodes.push(finishLeaf(item.node, done, unfinished));
  }
  for (const g of opts.tree.nodes) {
    if (g.size === "leaf") continue;
    if (!nodes.some((n) => n.nodeId === g.id)) nodes.push(blankNode(g, g.size === "TOO_BIG_UNSPLIT" ? "NEEDS_TEACHING" : "PRACTICING", []));
  }
  deriveParents(opts.tree, nodes);
  nodes.sort((a, b) => byStr(a.nodeId, b.nodeId));
  problems.sort((a, b) => byStr(a.id, b.id));
  const minutesUsed = Math.round(((now() - budget.start) / 60_000) * 1000) / 1000;
  return {
    schema: LEARN_PRACTICE_SCHEMA,
    experimental: true,
    credit: false,
    seed,
    minutesUsed,
    attemptsUsed: budget.attemptsUsed,
    maxMinutes,
    maxAttemptsTotal,
    history,
    budgetStopped: budget.stopped,
    sealedBeforeAttempts: true,
    nodes,
    problems,
    rechecks: [],
  };
}

function rate(passed: number, total: number): number {
  return total === 0 ? 0 : passed / total;
}

/**
 * Fresh held-out sample (seed + 1) for leaves already LEARNED.
 * Old held-out rows are not edited. A rate under 0.75 demotes the leaf and its ancestors.
 */
export function recheckPractice(prior: PracticeRun, opts: PracticeOptions): PracticeRun {
  const next: PracticeRun = structuredClone(prior);
  const seed = (opts.seed ?? prior.seed) + 1;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const now = opts.now ?? Date.now;
  const budget: Budget = {
    maxMinutes: opts.maxMinutes ?? prior.maxMinutes,
    maxAttemptsTotal: opts.maxAttemptsTotal ?? prior.maxAttemptsTotal,
    start: now(), now, attemptsUsed: 0, stopped: false,
  };
  const byId = new Map(next.nodes.map((n) => [n.nodeId, n]));
  for (const node of opts.tree.nodes.filter((n) => n.size === "leaf").sort((a, b) => byStr(a.id, b.id))) {
    const row = byId.get(node.id);
    if (!row || row.status !== "LEARNED") continue;
    const ref = leafRef(node, opts.repoPath);
    const text = ref ? readRepo(opts.repoPath, ref.path) : null;
    const src = ref && text !== null && ref.name ? extractFunction(ref.path, text, ref.name) : null;
    let sample: PracticeProblem[] = [];
    if (src && ref) sample = problemsFor(node.id, ref.path, ref.name, src, seed, []).filter((p) => p.set === "heldout");
    const tried: PracticeProblem[] = [];
    for (const p of sample) {
      if (budgetHit(budget)) { budget.stopped = true; break; }
      tried.push(attemptOne(p, budget));
    }
    const passed = tried.filter((p) => p.solved).length;
    const newRate = rate(passed, tried.length);
    const oldRate = rate(row.heldout.passed, row.heldout.problems);
    const demoted = newRate < 0.75;
    next.rechecks.push({
      at: today, nodeId: node.id, oldRate, newRate,
      oldSha256: row.heldout.sha256,
      newSha256: heldOutSha(tried),
      demoted,
    });
    if (demoted) {
      row.status = "PRACTICING";
      let parent = row.parent;
      while (parent) {
        const anc = byId.get(parent);
        if (!anc) break;
        if (anc.status === "LEARNED") anc.status = "PRACTICING";
        parent = anc.parent;
      }
    }
  }
  next.attemptsUsed += budget.attemptsUsed;
  next.minutesUsed = Math.round((next.minutesUsed + (now() - budget.start) / 60_000) * 1000) / 1000;
  next.rechecks.sort((a, b) => byStr(a.nodeId, b.nodeId) || byStr(a.at, b.at));
  return next;
}

export function renderProgress(run: PracticeRun): string {
  const lines = [
    `EXPERIMENTAL credit=false schema=${run.schema}`,
    `seed=${run.seed} minutes=${run.minutesUsed} attempts=${run.attemptsUsed} budgetStopped=${run.budgetStopped} history=${run.history}`,
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
 */
export function gapRows(run: PracticeRun, tree: SkillTree, program: string, today: string): GapRow[] {
  const rows: GapRow[] = [];
  const byGap = new Map(tree.nodes.map((n) => [n.id, n]));
  for (const n of run.nodes) {
    const gap = byGap.get(n.nodeId);
    const tooBig = gap?.size === "TOO_BIG_UNSPLIT";
    if (n.status !== "NEEDS_TEACHING" && !tooBig) continue;
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
