// PLAN-ONLY mode v2 (planner id plan-only-v2; v1 in plan.ts is unchanged and keeps its rows). Same inputs, same plan
// shape, same grader (plangrade.ts, plan-grade-v2). What changes:
// (1) Plan length scales with the task. Files are found with the M145 read-only search tools (codesearch.ts:
//     relevant, symbol, testsFor, tree) plus signals read from the request itself: the identifiers it names (the
//     defining file of each, a qualified name `A.b` resolving to A), the component the fix phrase names ("fix the
//     <words> <noun>": file stems and function names built from those words), a named pattern or regex (the file
//     that defines the matching constant is the edit; the module using it anchors the tests), and a new export from
//     the package entry (the index that re-exports the module by name). One step per distinct file, one test step
//     per distinct related test file, then run-tests. Nothing pads the plan: a file joins only with a signal of its
//     own (the grader divides by max(required, planned), so a guessed extra step costs as much as a missed one).
// (2) can-do is claimed only when an approved learned rule, re-run here on an objective built ONLY from words and
//     values the request states, edits exactly that step's file (the grader re-runs the same check), or for
//     run-tests on a targets.json repository (Job B). Every other step is `missing` with a capability from a fixed
//     vocabulary, and the plan lists the distinct missing skills.
// General by construction: no repository, organisation, task id or file name of any task set appears here; every
// signal is a property of the request text and of the repository's own files, symbols and import graph.
// Read-only: the checkout is opened through codesearch.openRepo (readdir/stat/readFile only, nothing executed).
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { openRepo, isGeneratedPath, type CodeRepo } from "./codesearch.ts";
import { clauses, classify, parseTask } from "./nlparse.ts";
import { buildIndex, type IndexFile, type RepoIndex, type SymbolDef } from "./symbols.ts";
import { applyRule, specHash, type RuleSpec } from "./learned.ts";
import { loadTargets } from "./target.ts";
import { CAPABILITIES, isTestPath as isTestPathV1, PLAN_SCHEMA, type PlanContext, type PlanStep } from "./plan.ts";

export const PLANNER_V2 = "plan-only-v2" as const;
/** v1's vocabulary plus the one step kind v2 plans that v1 never did. Fixed: a plan never carries free text here. */
export const CAPABILITIES_V2 = [...CAPABILITIES, "re-export-from-entry"] as const;
export type CapabilityV2 = (typeof CAPABILITIES_V2)[number];
/** Most source files one plan may name (a bound, not a target: files join only on their own signals). */
export const MAX_SOURCES = 8;
/** A second source file must reach this share of the top file's score (and carry a signal of its own). */
export const KEEP_RATIO = 0.6;

export interface PlanStepV2 extends Omit<PlanStep, "missing"> { missing: CapabilityV2 | null }
export interface PlanV2 {
  schema: typeof PLAN_SCHEMA;
  planner: typeof PLANNER_V2;
  taskId: string;
  understanding: { clauses: number; intents: string[]; parse: string; anchors: string[]; phrase: string[]; wantsTests: boolean; kind: "add" | "edit" };
  files: { path: string; role: "source" | "test"; reason: string }[];
  steps: PlanStepV2[];
  tests: { files: string[]; command: string | null };
  /** Distinct capabilities the `missing` steps need, in step order. */
  missingSkills: CapabilityV2[];
}

// ---- reading the request

const STOP = new Set("a an the it its this that these those of to in on for from with and or but by as at is are be been was were not no do does did can should must will would so such than then when while into onto any all both each every some other like also only just same new add adds adding fix fixes fixing make makes change test tests case cases value values key keys function functions method methods".split(" "));
/** Nouns that close a component phrase ("fix the <words> <noun>"). The noun's own stem counts as a word too. */
const COMPONENT_NOUNS = "function|method|helper|helpers|utility|utilities|util|utils|schema|driver|class|module|parser|runner|pattern|regex|regexp|expression|implementation|implementations|option|options|type|types|component|hook|plugin|adapter|dialect|compiler|serializer|validator|validation|handler|middleware|command|logic|check|detection|merge|queue|client|server|router|loader|resolver|formatter|builder|wrapper|api|error|errors|event|events|config|configuration";
const FIX_PHRASE = new RegExp(String.raw`\b(?:fix|change|update|tighten|loosen|edit|extend|modify|patch|correct|adjust|rewrite|harden|refactor)\s+(?:the|its|their|both)\s+((?:[\w$-]+\s+){0,3}(?:${COMPONENT_NOUNS}))\b`, "gi");
const PATTERN_WORDS = new Set(["pattern", "regex", "regexp", "expression"]);

/** Rough English stem for matching words to file and symbol names (runner -> run, utilities -> util). */
export function stemWord(w: string): string {
  let s = w.toLowerCase();
  for (const [re, to] of [[/ities$/, "it"], [/ity$/, "it"], [/ies$/, "y"], [/ations?$/, "ate"], [/ers?$/, ""], [/ing$/, ""], [/s$/, ""]] as [RegExp, string][]) {
    if (re.test(s) && s.replace(re, to).length >= (to === "" && re.source.startsWith("ing") ? 4 : 3)) { s = s.replace(re, to); break; }
  }
  return /([b-df-hj-np-tv-z])\1$/.test(s) ? s.slice(0, -1) : s; // runner -> runn -> run
}
/** Splits a name into lower-case word stems: cache-loader -> [cache, load], retryHelper -> [retry, help]. */
export function nameWords(name: string): string[] {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean).map(stemWord);
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** `example`: named only inside a code example while the request also names something bare (`pick`), so a usage, not the subject. */
export interface RequestIdent { name: string; qualifier: string | null; member: boolean; called: boolean; example: boolean }
export interface ReadRequest {
  idents: RequestIdent[];
  /** Each fix phrase's words, stemmed (["request", "handl"]), and its closing noun. */
  phrases: { words: string[]; noun: string }[];
  wantsTests: boolean;
  wantsNewTestFor: string | null;
  testQualifier: string | null;
  wantsEntryExport: boolean;
  kind: "add" | "edit";
  wantsPattern: boolean;
}

/** Reads the request. Pure and deterministic; nothing here knows any repository. */
export function readRequest(request: string): ReadRequest {
  const idents = new Map<string, RequestIdent>();
  const bare = new Set<string>();
  const addId = (i: Omit<RequestIdent, "example">, inExample: boolean) => {
    const k = `${i.qualifier ?? ""}.${i.name}`;
    if (!inExample) bare.add(k);
    if (!idents.has(k)) idents.set(k, { ...i, example: false });
  };
  const spans = [...request.matchAll(/`([^`\n]{1,200})`/g)].map((m) => m[1]!);
  for (const span of spans) {
    // A bare span is a name (`pick`, `ResultAsync.fromThrowable`, `isUppercase()`); anything else is an example.
    const ex = !/^\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*(?:\(\s*\))?\s*$/.test(span);
    const code = span.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
    for (const m of code.matchAll(/(\.)?\s*([A-Za-z_$][\w$]*)((?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*(\()?/g)) {
      if (/^\d/.test(m[2]!)) continue;
      const head = m[2]!;
      const chain = (m[3] ?? "").split(".").map((s) => s.trim()).filter(Boolean);
      const isMember = !!m[1];
      if (chain.length === 0) { addId({ name: head, qualifier: null, member: isMember, called: !!m[4] }, ex); continue; }
      addId({ name: head, qualifier: null, member: isMember, called: false }, ex);
      let q = head;
      for (let i = 0; i < chain.length; i++) { addId({ name: chain[i]!, qualifier: q, member: true, called: i === chain.length - 1 && !!m[4] }, ex); q = chain[i]!; }
    }
  }
  // Code-shaped words outside backticks (camelCase, PascalCase with an inner capital, snake_case, CONSTANT_CASE).
  const prose = request.replace(/`[^`\n]*`/g, " ");
  for (const m of prose.matchAll(/(?<![\w$.\/])([A-Za-z_$][\w$]{2,63})(?![\w$])/g)) if (/[a-z][A-Z]|^[A-Z][a-z]+[A-Z]|[a-z]_[a-z]|^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(m[1]!)) addId({ name: m[1]!, qualifier: null, member: false, called: false }, false);
  if (bare.size) for (const [k, i] of idents) if (!bare.has(k)) i.example = true;
  const phrases: ReadRequest["phrases"] = [];
  for (const m of prose.matchAll(FIX_PHRASE)) {
    const words = m[1]!.split(/\s+/).filter((w) => w && !STOP.has(w.toLowerCase())).map(stemWord);
    if (words.length) phrases.push({ words, noun: words[words.length - 1]! });
  }
  const wantsTests = /\b(?:add|write|include|extend|cover|update)\b[^.]*\btests?\b|\bregression tests?\b|\btest cases?\b|\btests? (?:for|that|covering)\b/i.test(request);
  const nt = /\badd (?:a |an )?(?:new )?(?:([\w-]+) )?test (?:file )?for (?:`([^`]+)`|([A-Za-z_$][\w$]*))/i.exec(request);
  const newFor = nt ? (nt[2] ?? nt[3] ?? "").replace(/\(.*$/, "").split(".").pop()! : null;
  const qual = nt && nt[1] && !/^(?:regression|unit|new|small|simple)$/i.test(nt[1]) ? nt[1].toLowerCase() : null;
  const kind = /\b(?:add|adds|adding|introduce|new|support for|expose)\b/i.test(request.split(/[.!?]\s/)[0] ?? "") && !/\b(?:fix|bug|wrong|incorrect|instead|should not|shouldn't|doesn't|does not|ignores|drops|accepts|leaves|treats|hang|hangs|fails?)\b/i.test(request) ? "add" : "edit";
  return {
    idents: [...idents.values()],
    phrases,
    wantsTests,
    wantsNewTestFor: newFor && /^[A-Za-z_$][\w$]*$/.test(newFor) ? newFor : null,
    testQualifier: qual,
    wantsEntryExport: /\bexport(?:ed|s)?\b[^.]*\b(?:from|in)\b[^.]*\b(?:package|entry|index|barrel|main module)\b/i.test(request),
    kind,
    wantsPattern: phrases.some((p) => PATTERN_WORDS.has(p.noun)) || /\b(?:regex|regexp|regular expression|pattern)\b/i.test(request),
  };
}

// ---- repository views

const CODE_EXT = /\.(?:[cm]?tsx?)$/;
const JS_EXT = /\.(?:[cm]?jsx?)$/;
const NON_SOURCE_DIR = /(?:^|\/)(?:node_modules|dist|build|lib|out|coverage|benchmarks?|bench|docs?|examples?|scripts?|site|website|playground|fixtures?|__fixtures__|__mocks__|e2e|types?-tests?|typings)\//;
const isTest = (p: string) => isTestPathV1(p) || /(?:^|\/)tests?\//.test(p) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(p);
/** A real test of behavior: not a type-only test, a benchmark, a fixture or a shared setup file. */
const isBehaviorTest = (p: string) => isTest(p) && !/\.test-d\.|\.bench\.|(?:^|\/)(?:fixtures?|__fixtures__|helpers?|utils?|setup|types?|typings)\/|(?:^|\/)(?:test-)?(?:setup|helpers?|utils?|globals?|index\.d)\.[cm]?[jt]sx?$|\.d\.ts$|(?:^|\/)tests?\/index\.[cm]?[jt]sx?$/.test(p) && /\.[cm]?[jt]sx?$/.test(p); // a tests/index.ts without .test is the harness

interface RepoView { code: CodeRepo; files: string[]; sources: Set<string>; index: RepoIndex; tsRepo: boolean }

function viewOf(code: CodeRepo, files: readonly IndexFile[]): RepoView {
  const listed = code.tree({}).ok ? (code.tree({}) as { files: string[] }).files : files.map((f) => f.path);
  const tsRepo = listed.some((p) => CODE_EXT.test(p) && !/\.d\.[cm]?ts$/.test(p) && !isTest(p));
  const ext = tsRepo ? CODE_EXT : JS_EXT;
  const nested = listed.some((p) => p.includes("/") && ext.test(p) && !isTest(p) && !NON_SOURCE_DIR.test(p));
  const sources = new Set(listed.filter((p) => ext.test(p) && !/\.d\.[cm]?ts$/.test(p) && !isTest(p) && !isGeneratedPath(p) && !NON_SOURCE_DIR.test(p) && !/(?:^|\/)[^/]*\.config\.[cm]?[jt]s$/.test(p) && !(nested && !p.includes("/"))));
  return { code, files: listed, sources, index: buildIndex(files.filter((f) => CODE_EXT.test(f.path) || JS_EXT.test(f.path))), tsRepo };
}

const fileStem = (p: string) => posix.basename(p).replace(/\.[cm]?[jt]sx?$/, "").replace(/\.(?:test|spec)$/, "");

// ---- the planner

interface Cand { path: string; score: number; strong: string[]; weak: number; anchor: string | null; phrase: boolean }

/** Ranks source files. Every bonus is a named signal; `strong` lists the signals a non-top file needs to join. */
function rankSources(req: ReadRequest, request: string, v: RepoView): Cand[] {
  const c = new Map<string, Cand>();
  const get = (p: string) => { let x = c.get(p); if (!x) { x = { path: p, score: 0, strong: [], weak: 0, anchor: null, phrase: false }; c.set(p, x); } return x; };
  const add = (p: string, s: number, why: string | null, phrase = false) => { if (!v.sources.has(p)) return; const x = get(p); x.score += s; if (phrase) x.phrase = true; if (why) { if (!x.strong.includes(why)) x.strong.push(why); } else x.weak += s; };
  // a. the search tools' ranking (normalized to 0..5): a weak signal on its own.
  const rel = v.code.relevant({ target: request }, { limit: 30 });
  if (rel.ok) { const top = rel.files.find((f) => v.sources.has(f.path))?.score ?? 0; if (top > 0) for (const f of rel.files) add(f.path, (5 * f.score) / top, null); }
  const defsOf = (name: string) => v.index.defs.filter((d) => d.name === name && v.sources.has(d.path) && (d.scope === "module" || d.kind === "method" || d.kind === "property"));
  // b. identifiers the request names: a file named after one is its home; else its defining files (a member
  //    resolves through its qualifier when it can). A name used only inside a code example is a weak signal.
  for (const id of req.idents) {
    const w = id.example ? 3 : 8;
    const why = (t: string) => (id.example ? null : t);
    const home = [...v.sources].filter((p) => fileStem(p) !== "index" && norm(fileStem(p)) === norm(id.name));
    if (home.length === 1) { add(home[0]!, w, why(`named ${id.name}`)); continue; }
    if (id.member && id.qualifier) {
      const q = defsOf(id.qualifier).filter((d) => d.scope === "module");
      const qp = [...new Set(q.map((d) => d.path))];
      if (qp.length >= 1 && qp.length <= 3) { for (const p of qp) add(p, w / qp.length, why(`member of ${id.qualifier}`)); continue; }
    }
    const paths = [...new Set(defsOf(id.name).map((d) => d.path))];
    if (paths.length >= 1 && paths.length <= 3) for (const p of paths) add(p, (id.member ? Math.min(w, 3) : w) / paths.length, id.member ? null : why(`defines ${id.name}`));
  }
  // c. the component a fix phrase names: file stems spelled by its words ("the cache loader" ->
  //    cache-loader.ts), never by the generic noun alone ("the date parser" does not name parser.ts).
  for (const ph of req.phrases) {
    const spec = ph.words.filter((w) => w !== ph.noun);
    const need = spec.length ? spec : [ph.noun];
    const all = new Set(ph.words);
    const stems = [...v.sources].filter((p) => fileStem(p) !== "index").map((p) => ({ p, ws: nameWords(fileStem(p)) })).filter((x) => x.ws.length && x.ws.every((w) => all.has(w)) && need.every((w) => x.ws.includes(w)));
    const most = Math.max(0, ...stems.map((x) => x.ws.length)); // the file the phrase spells most fully
    for (const x of stems) if (x.ws.length === most) add(x.p, 10, `fix phrase names ${fileStem(x.p)}`, true);
    if (stems.length) continue; // a file the phrase spells is the component; its words do not also name functions
    // d. a function, method or constant the phrase spells ("the request handler" -> handle,
    //    "the retry helpers" -> retryHelper); spread over at most three files.
    //    The longest run of words wins; on a tie the run holding the head noun ("session token loader" -> load).
    const runs: { key: string; len: number; noun: boolean }[] = [];
    for (let i = 0; i < ph.words.length; i++) for (let j = i + 1; j <= ph.words.length; j++) runs.push({ key: ph.words.slice(i, j).join(""), len: j - i, noun: j === ph.words.length });
    runs.sort((a, b) => b.len - a.len || Number(b.noun) - Number(a.noun));
    const fnLike = v.index.defs.filter((d) => v.sources.has(d.path) && (d.kind === "function" || d.kind === "method" || ((d.kind === "const" || d.kind === "let") && d.scope === "module")));
    const best = runs.find((r) => fnLike.some((d) => nameWords(d.name).join("") === r.key));
    const hits = best ? fnLike.filter((d) => nameWords(d.name).join("") === best.key) : [];
    const paths = [...new Set(hits.map((d) => d.path))];
    if (paths.length >= 1 && paths.length <= 3) for (const p of paths) add(p, 10 / paths.length, `fix phrase names ${hits.find((d) => d.path === p)!.name}`, true);
  }
  let ranked = [...c.values()].sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1));
  // e. a named pattern: the constant that holds it is the edit (its file), the module that uses it anchors the tests.
  if (req.wantsPattern && ranked.length) {
    const words = new Set([...req.phrases.flatMap((p) => p.words), ...req.idents.map((i) => stemWord(i.name)), ...nameWords(fileStem(ranked[0]!.path))]);
    const pats = v.index.defs.filter((d) => d.scope === "module" && (d.kind === "const" || d.kind === "let") && v.sources.has(d.path) && /(?:regex|regexp|rx|re|pattern)$/i.test(d.name) && nameWords(d.name).some((w) => words.has(w) && !PATTERN_WORDS.has(w) && w !== "re" && w !== "rx"));
    for (const userFile of ranked.slice(0, 2).map((r) => r.path)) {
      const used = pats.filter((d) => d.path === userFile || (v.index.refs.get(d.name) ?? []).some((r) => r.path === userFile));
      if (used.length === 1 && used[0]!.path !== userFile) {
        const owner = get(used[0]!.path);
        owner.score = Math.max(owner.score, ranked[0]!.score) + 1;
        if (!owner.strong.includes(`holds ${used[0]!.name}`)) owner.strong.push(`holds ${used[0]!.name}`);
        owner.phrase = owner.phrase || c.get(userFile)!.phrase;
        owner.anchor = userFile;
        c.delete(userFile); // the user module is not edited: the pattern is
        break;
      }
    }
    ranked = [...c.values()].sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1));
  }
  return ranked;
}

function pickSources(ranked: Cand[]): Cand[] {
  if (!ranked.length || ranked[0]!.score <= 0) return [];
  // When the request names the component to fix ("fix the X"), that is where the change goes: a file reached only
  // through a name the symptom mentions (the public call that shows the bug) does not join.
  const located = ranked.some((x) => x.phrase);
  const pool = located ? ranked.filter((x) => x.phrase) : ranked;
  const out = [pool[0]!];
  for (const x of pool.slice(1)) if (out.length < MAX_SOURCES && x.strong.length > 0 && x.score >= KEEP_RATIO * pool[0]!.score) out.push(x);
  return out;
}

/** The package entry that re-exports `src` by name (an `export { x } from` list must change for a new export). */
function entryFor(v: RepoView, src: string): string | null {
  const idx = [...v.sources].filter((p) => /(?:^|\/)(?:index|main|mod)\.[cm]?[jt]sx?$/.test(p) && p !== src).sort((a, b) => a.split("/").length - b.split("/").length || a.length - b.length);
  for (const p of idx) {
    const r = v.code.read(p);
    if (!r.ok) continue;
    const rel = posix.relative(posix.dirname(p), src).replace(/\.[cm]?[jt]sx?$/, "");
    const spec = rel.startsWith(".") ? rel : `./${rel}`;
    const esc = spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(String.raw`export\s*(?:type\s*)?\{[^}]*\}\s*from\s*["']${esc}(?:\.[cm]?[jt]sx?)?["']`).test(r.text)) return p;
  }
  return null;
}

/** The best behavior test for one anchor file, or null. */
function testFor(v: RepoView, anchor: string, req: ReadRequest, relTests: Map<string, number>, fallback = true): string | null {
  const r = v.code.testsFor(anchor);
  const cand = new Map<string, number>();
  if (r.ok) for (const t of r.tests) if (isBehaviorTest(t.path)) cand.set(t.path, t.score);
  const ast = fileStem(anchor);
  for (const p of v.files) {
    if (!isBehaviorTest(p)) continue;
    const st = fileStem(p);
    if (ast !== "index" && norm(st) === norm(ast)) cand.set(p, (cand.get(p) ?? 0) + 20); // the module's own test file
    if (req.idents.some((i) => norm(i.name) === norm(st)) && cand.has(p)) cand.set(p, cand.get(p)! + 6);
  }
  for (const [p, s] of cand) cand.set(p, s + (relTests.get(p) ?? 0));
  // Nothing imports the module from a test: the search tools' best test for the request, if it is a clear first.
  if (cand.size === 0 && fallback && req.wantsTests) { const top = [...relTests.entries()].filter(([p]) => isBehaviorTest(p)).sort((a, b) => b[1] - a[1])[0]; if (top && top[1] >= 3) cand.set(top[0], top[1]); }
  const best = [...cand.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  return best && best[1] >= 3 ? best[0] : null;
}

/** Where a new test file for `name` goes: the directory most of the repo's behavior tests share, its naming style. */
function newTestPath(v: RepoView, name: string, qualifier: string | null): string | null {
  const tests = v.files.filter(isBehaviorTest).filter((p) => !qualifier || p.split("/").slice(0, -1).includes(qualifier));
  if (!tests.length) return null;
  const dirs = new Map<string, number>();
  for (const t of tests) dirs.set(posix.dirname(t), (dirs.get(posix.dirname(t)) ?? 0) + 1);
  const dir = [...dirs.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0];
  const sample = tests.filter((t) => posix.dirname(t) === dir).sort()[0]!;
  const suffix = /(\.(?:test|spec)\.[cm]?[jt]sx?)$/.exec(sample)?.[1] ?? /(\.[cm]?[jt]sx?)$/.exec(sample)![1]!;
  const st = /(?:^|[a-z])-[a-z]/.test(fileStem(sample)) ? name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase() : name;
  const p = `${dir}/${st}${suffix}`;
  return v.files.includes(p) ? null : p;
}

// ---- can-do: only an approved rule run on an objective the request fully states

/** Objectives in the approved rules' phrasing, built ONLY from names and values the request itself states. */
export function composedObjectives(request: string, fileOf: (name: string) => string | null): string[] {
  const out = new Set<string>();
  // The rules' example bullets ("- f(1) throws CODE", "- f(2) returns 3") come only from the request's own bullet lines.
  const bullets = request.split("\n").map((l) => l.trim()).filter((l) => /^[-*] /.test(l)).map((l) => l.replace(/\x60/g, ""));
  const withBullets = (head: string) => [head, ...bullets].join("\n");
  for (const s of request.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean)) out.add(s); // the request's own sentences
  const LIT = String.raw`"[^"\n]*"|'[^'\n]*'|-?\d+(?:\.\d+)?|true|false`;
  for (const m of request.matchAll(new RegExp(String.raw`\b(?:set|change|update)\s+(?:the\s+)?(?:value\s+of\s+|default\s+)?\x60?([A-Za-z_$][\w$]*)\x60?\s+to\s+\x60?(${LIT})\x60?`, "gi"))) {
    const f = fileOf(m[1]!);
    if (f) out.add(`set \`${m[1]}\` in \`${f}\` to ${m[2]}`);
  }
  for (const m of request.matchAll(/\x60?([A-Za-z_$][\w$]*)\x60?(?:\(\))?\s+(?:should|must)\s+throw\s+\x60?([A-Z][A-Z0-9_]{2,63})\x60?\s+(when|if)\s+([^.\n]{1,160})/g)) {
    const f = fileOf(m[1]!);
    if (f) out.add(withBullets(`guard \`${m[1]}\` in \`${f}\`: throw \`${m[2]}\` ${m[3]} ${m[4]!.trim()}`));
  }
  for (const m of request.matchAll(/\bin\s+\x60([A-Za-z_$][\w$]*)\x60,?\s+replace\s+(?:the\s+)?(condition|return)\s+\x60([^`\n]{1,160})\x60\s+with\s+\x60([^`\n]{1,160})\x60/gi)) {
    const f = fileOf(m[1]!);
    if (f) out.add(withBullets(`in \`${m[1]}\` in \`${f}\`: replace ${m[2]!.toLowerCase()} \`${m[3]}\` with \`${m[4]}\``));
  }
  return [...out];
}

function ruleFor(ctx: PlanContext, objectives: readonly string[], file: string): { spec: RuleSpec; objective: string } | null {
  const src = ctx.files.filter((f) => CODE_EXT.test(f.path) || isTestPathV1(f.path));
  for (const objective of objectives) for (const spec of ctx.rules) {
    try {
      const edit = applyRule(spec, objective, src, isTestPathV1, ctx.repo);
      if (edit && (edit.path === file || (edit.extra ?? []).some((x) => x.path === file))) return { spec, objective };
    } catch { /* an engine error is a refusal */ }
  }
  return null;
}

/** Makes the plan. Reads only `ctx` and the read-only `code` view of the same checkout; writes nothing. */
export function planTaskV2(taskId: string, request: string, ctx: PlanContext, code: CodeRepo): PlanV2 {
  const req = readRequest(request);
  const parts = clauses(request);
  const intents = ctx.model ? parts.map((c) => { const p = classify(ctx.model!, c); return Object.entries(p).sort((a, b) => b[1] - a[1])[0]![0]; }) : [];
  const parsed = parseTask({ title: "", body: request }, { model: ctx.model, approvedKinds: new Set(ctx.rules.map((r) => r.kind as string)) });
  const v = viewOf(code, ctx.files);
  const ranked = rankSources(req, request, v);
  const chosen = pickSources(ranked);
  const files: PlanV2["files"] = [];
  const sources: { path: string; symbol: string | null; anchor: string; entry: boolean }[] = [];
  const symbolIn = (p: string) => req.idents.find((i) => v.index.defs.some((d) => d.path === p && d.name === i.name))?.name ?? null;
  for (const x of chosen) { sources.push({ path: x.path, symbol: symbolIn(x.path), anchor: x.anchor ?? x.path, entry: false }); files.push({ path: x.path, role: "source", reason: x.strong.join("; ") || "search rank" }); }
  // A new export: the entry that lists the module's exports by name must list it too.
  if (req.wantsEntryExport && sources.length) {
    const e = entryFor(v, sources[0]!.path);
    if (e && !sources.some((s) => s.path === e)) { sources.push({ path: e, symbol: null, anchor: sources[0]!.anchor, entry: true }); files.push({ path: e, role: "source", reason: "entry re-exports the module by name" }); }
  }
  // Tests: one per distinct related behavior test of each source's anchor; a new file only when the request asks for one and none exists.
  const rel = v.code.relevant({ target: request }, { limit: 30 });
  const relTests = new Map<string, number>();
  if (rel.ok) { const top = rel.tests[0]?.score ?? 0; if (top > 0) for (const t of rel.tests) relTests.set(t.path, (3 * t.score) / top); }
  const testFiles: { path: string; add: boolean }[] = [];
  // A new test file only when the request asks for a test of a name it states, no test file carries that name and
  // no existing test reaches the module.
  let newTest: string | null = null;
  const nf = req.wantsNewTestFor;
  if (req.wantsTests && nf && req.idents.some((i) => i.name === nf) && !v.files.some((p) => isBehaviorTest(p) && norm(fileStem(p)) === norm(nf)) && sources.length && sources.every((s) => s.entry || !testFor(v, s.anchor, req, relTests, false))) newTest = newTestPath(v, nf, req.testQualifier);
  for (const id of req.idents) {
    if (id.example) continue;
    const byName = v.files.filter((p) => isBehaviorTest(p) && norm(fileStem(p)) === norm(id.name));
    if (byName.length === 1 && !testFiles.some((x) => x.path === byName[0]) && req.wantsTests) { testFiles.push({ path: byName[0]!, add: false }); files.push({ path: byName[0]!, role: "test", reason: `named ${id.name}` }); }
  }
  for (const s of sources) {
    if (s.entry) continue;
    const t = testFor(v, s.anchor, req, relTests, newTest === null && testFiles.length === 0);
    if (t && !testFiles.some((x) => x.path === t)) { testFiles.push({ path: t, add: false }); files.push({ path: t, role: "test", reason: `tests ${s.anchor}` }); }
  }
  if (newTest) { testFiles.push({ path: newTest, add: true }); files.push({ path: newTest, role: "test", reason: `new test for ${nf}` }); }
  // Steps.
  const fileOf = (name: string) => { const d = v.index.defs.filter((x) => x.name === name && v.sources.has(x.path) && x.scope === "module"); return new Set(d.map((x) => x.path)).size === 1 ? d[0]!.path : null; };
  const objectives = composedObjectives(request, fileOf);
  const steps: PlanStepV2[] = [];
  const push = (s: Omit<PlanStepV2, "n">) => steps.push({ n: steps.length + 1, ...s });
  if (sources.length === 0) push({ action: "edit-source", file: null, symbol: null, status: "missing", rule: null, objective: null, missing: req.idents.length || req.phrases.length ? "locate-code" : "understand-request" });
  for (const s of sources) {
    const hit = ruleFor(ctx, objectives, s.path);
    const isConst = s.symbol !== null && v.index.defs.some((d) => d.path === s.path && d.name === s.symbol && d.kind === "const" && /^[A-Z][A-Z0-9_]+$|(?:Rx|Regex|RE|Pattern)$/.test(d.name));
    const missing: CapabilityV2 = s.entry ? "re-export-from-entry" : req.kind === "add" ? "add-function-or-member" : isConst || (req.wantsPattern && s.anchor !== s.path) ? "edit-constant" : "edit-existing-function";
    push(hit ? { action: "edit-source", file: s.path, symbol: s.symbol, status: "can-do", rule: `${hit.spec.id}@${specHash(hit.spec)}`, objective: hit.objective, missing: null }
      : { action: "edit-source", file: s.path, symbol: s.symbol, status: "missing", rule: null, objective: null, missing });
  }
  if (testFiles.length === 0 && req.wantsTests) push({ action: "add-test", file: null, symbol: null, status: "missing", rule: null, objective: null, missing: "add-test-file" });
  for (const t of testFiles) {
    const hit = ruleFor(ctx, objectives, t.path);
    const action = t.add ? "add-test" : "edit-test";
    push(hit ? { action, file: t.path, symbol: null, status: "can-do", rule: `${hit.spec.id}@${specHash(hit.spec)}`, objective: hit.objective, missing: null }
      : { action, file: t.path, symbol: null, status: "missing", rule: null, objective: null, missing: t.add ? "add-test-file" : "extend-existing-test" });
  }
  const runnable = Object.prototype.hasOwnProperty.call(loadTargets().targets, ctx.repo);
  push(runnable ? { action: "run-tests", file: null, symbol: null, status: "can-do", rule: "pipeline:job-b-tests", objective: null, missing: null }
    : { action: "run-tests", file: null, symbol: null, status: "missing", rule: null, objective: null, missing: "run-target-tests" });
  const missingSkills = [...new Set(steps.map((s) => s.missing).filter((m): m is CapabilityV2 => m !== null))];
  return {
    schema: PLAN_SCHEMA, planner: PLANNER_V2, taskId,
    understanding: { clauses: parts.length, intents, parse: parsed.status === "unsure" ? `unsure:${parsed.reason}` : parsed.status, anchors: req.idents.map((i) => i.name).slice(0, 8), phrase: req.phrases.map((p) => p.words.join(" ")).slice(0, 4), wantsTests: req.wantsTests, kind: req.kind },
    files, steps, tests: { files: testFiles.map((t) => t.path), command: ctx.testCommand }, missingSkills,
  };
}

/** A read-only search view over files held in memory (a fixture checkout): written once to a temp dir, removed by close. */
export function repoFromFiles(files: readonly { path: string; content: string }[]): { code: CodeRepo; close(): void } {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-plan2-"));
  try {
    for (const f of files) {
      if (!/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[\w@+.\/-]{1,300}$/.test(f.path)) continue;
      mkdirSync(dirname(join(dir, f.path)), { recursive: true });
      writeFileSync(join(dir, f.path), f.content);
    }
    return { code: openRepo(dir), close: () => rmSync(dir, { recursive: true, force: true }) };
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e; }
}
