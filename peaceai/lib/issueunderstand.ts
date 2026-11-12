// Issue and commit wording. credit: false.
// A commit subject or an issue sentence is not a PeaceAI phrase. This step reads the verbs and the
// symbols that are already written, and the one source file implied by the test path plus the
// target's sourcePattern, and either rewrites the task into a phrase the existing engines already
// run or answers "can't do yet" with a fixed reason. A missing slot is a refusal. Nothing is invented,
// and a plan that only covers part of the text is not returned.
import { clauses, isCanonical, LEARNED_KIND, widens, type Family } from "./nlparse.ts";
import { cleanIssueText } from "./taskmap.ts";

export const CANT_REASONS = [
  "CANT_DO_YET_NO_EDIT",
  "CANT_DO_YET_EDIT_UNSPECIFIED",
  "CANT_DO_YET_ADD_UNSPECIFIED",
  "CANT_DO_YET_NOT_A_FAMILY",
  "CANT_DO_YET_NO_FILE",
  "CANT_DO_YET_NAME_SHAPE",
  "CANT_DO_YET_AMBIGUOUS",
  "CANT_DO_YET_PARTIAL",
  "CANT_DO_YET_RULE_NOT_APPROVED",
] as const;
export type CantReason = (typeof CANT_REASONS)[number];

/** The three parser refusals that mean the wording was not understood. Other refusals stay as they are. */
export const UNDERSTAND_REASONS = ["NOT_SUPPORTED", "NO_FAMILY", "PARTIAL_PLAN"] as const;

const ID = String.raw`[A-Za-z_$][\w$]{0,63}`;
const FILE = String.raw`[\w./-]+\.tsx?`;
const LIT = String.raw`"(?:[^"\\\n]|\\.){0,200}"|'(?:[^'\\\n]|\\.){0,200}'|-?\d{1,15}(?:\.\d{1,15})?|true|false|null`;
const SET_LIT = String.raw`"(?:[^"\\\n]|\\.){0,200}"|'(?:[^'\\\n]|\\.){0,200}'|-?\d{1,15}(?:\.\d{1,15})?|true|false`;
const NULLISH_LIT = String.raw`\[\]|null|"(?:[^"\\\n]|\\.){0,200}"|'(?:[^'\\\n]|\\.){0,200}'|-?\d{1,15}(?:\.\d{1,15})?|true|false`;
const TYPE = String.raw`(?:${ID}(?:\[\])?|"(?:[^"\n]{0,40})"|'(?:[^'\n]{0,40})')(?: ?\| ?(?:${ID}(?:\[\])?|"(?:[^"\n]{0,40})"|'(?:[^'\n]{0,40})'))*`;
const QUOTED = String.raw`"(?:[^"\\\n]|\\.){1,200}"|'(?:[^'\\\n]|\\.){1,200}'`;

/** The guard family's own condition words. A condition outside this list is not a guard. */
const COND: Record<string, string> = {
  empty: "empty", "an empty string": "empty", "the empty string": "empty", blank: "blank", "only whitespace": "blank",
  null: "null", undefined: "undefined", missing: "missing", "not provided": "missing", "not given": "missing",
  negative: "negative", "below zero": "negative", "less than zero": "negative", "less than 0": "negative",
  zero: "zero", "0": "zero", "not finite": "not finite", infinite: "not finite", nan: "nan", "not a number": "nan",
};
const CONDS = Object.keys(COND).sort((a, b) => b.length - a.length).join("|");

const POLITE = String.raw`(?:please |can you |could you |we need to )?`;
const BUG = /\b(?:incorrectly|silently|wrongly|accidentally|unintentionally)\b/i;
const NEGATED = /\bshould not\b|\bshouldn't\b|\bmust not\b/i;
const STOP = new Set("input argument parameter value it the a an function method return returns when if so that add fix handle check guard".split(" "));

export type StepFamily = Family | "rename";
export interface UnderstandStep { family: StepFamily; text: string }
export type UnderstandResult =
  | { status: "mapped"; objective: string; steps: UnderstandStep[] }
  | { status: "cant"; reason: CantReason };

export interface UnderstandInput {
  title: string;
  body: string;
  /** The test file that specifies the task. Its path can name a source file. Its contents are not read. */
  testFile?: string;
  /** The target's sourcePattern. A file that fails it is not a source. */
  sourcePattern?: string;
  /** In-scope source paths. Used only to see which implied path exists. */
  sources?: readonly string[];
  approvedKinds?: ReadonlySet<string>;
}

interface Ctx { implied: string | null; pattern: RegExp | null }

type Hit = { kind: "map"; family: StepFamily; text: string } | { kind: "cant"; reason: CantReason };

function whole(src: string): RegExp {
  return new RegExp(`^${POLITE}${src}[.!]?$`, "i");
}

function groups(re: RegExp, text: string): Record<string, string> | null {
  const m = re.exec(text);
  if (!m?.groups) return null;
  return Object.fromEntries(Object.entries(m.groups).filter(([, v]) => v !== undefined)) as Record<string, string>;
}

function ident(name: string | undefined): string | null {
  if (!name || STOP.has(name.toLowerCase())) return null;
  return name;
}

function condOf(raw: string | undefined): string | null {
  if (!raw) return null;
  return COND[raw.toLowerCase()] ?? null;
}

function guardText(fn: string, value: string, param: string, cond: string): string {
  return `Add a guard to ${fn} that returns ${value} when ${param} is ${cond}`;
}

/** A `.test` / `.spec` file, or a file under a test directory, is not a source. */
function isTestPath(path: string): boolean {
  if (/\.(?:test|spec)\.(?:tsx?|mts|cts)$/.test(path)) return true;
  return /(^|\/)(?:__tests__|tests?)\/.+\.(?:tsx?|mts|cts)$/.test(path);
}

function compilePattern(source: string | undefined): RegExp | null {
  if (!source) return null;
  try { return new RegExp(source); } catch { return null; }
}

/**
 * The one source file the test path names. The test basename, with `.test` / `.spec` removed,
 * must equal one eligible source basename. A dotted suffix (`quantity.edge.test.ts`) may name
 * `quantity` when that shorter name is the only match. A generic `test` or `spec` basename names
 * nothing. Two matches name nothing.
 */
export function impliedSourceFile(testFile: string, sourcePattern: string, sources: readonly string[]): string | null {
  if (!testFile || !sourcePattern || testFile.length > 300 || /[\0\n]/.test(testFile) || testFile.startsWith("/") || testFile.split("/").includes("..")) return null;
  const pattern = compilePattern(sourcePattern);
  if (!pattern) return null;
  const file = testFile.split("/").pop() ?? "";
  const noExt = file.replace(/\.(?:test|spec)\.(?:tsx?|mts|cts)$/, "");
  if (!noExt || noExt === file || /^(?:test|tests|spec|specs)$/i.test(noExt)) return null;
  const stems = [noExt];
  const head = noExt.split(".")[0] ?? "";
  if (head && head !== noExt && !/^(?:test|tests|spec|specs)$/i.test(head)) stems.push(head);
  const eligible = sources.filter((p) => pattern.test(p) && !isTestPath(p));
  for (const stem of stems) {
    const hits = eligible.filter((p) => {
      const base = p.split("/").pop() ?? "";
      return base.replace(/\.(?:tsx?|mts|cts)$/, "") === stem;
    });
    if (hits.length === 1) return hits[0]!;
    if (hits.length > 1) return null;
  }
  return null;
}

/** A path written in the clause, or the one implied file when the clause names no path. `"bad"` means the text named a path this target cannot use. */
function resolveFile(clause: string, ctx: Ctx): string | null | "bad" {
  const mentioned = [...new Set([...clause.matchAll(new RegExp(String.raw`\b${FILE}\b`, "g"))].map((m) => m[0]))];
  if (mentioned.length > 1) return "bad";
  if (mentioned.length === 1) {
    const file = mentioned[0]!;
    if (ctx.pattern && !ctx.pattern.test(file)) return "bad";
    return file;
  }
  return ctx.implied;
}

function guardFrom(g: Record<string, string> | null): Hit | null {
  if (!g) return null;
  const fn = ident(g.fn);
  const param = ident(g.param);
  const cond = condOf(g.cond);
  if (!fn || !param || !cond || !g.value || fn === param) return null;
  return { kind: "map", family: "guard", text: guardText(fn, g.value, param, cond) };
}

function matchers(clause: string, ctx: Ctx): Hit[] {
  const hits: Hit[] = [];
  const push = (hit: Hit | null) => { if (hit) hits.push(hit); };

  push(guardFrom(groups(whole(String.raw`(?:fix|correct|handle) (?:the )?(?:function |method )?(?<fn>${ID}) so (?:that )?it returns (?<value>${LIT}) (?:when|if) (?:the )?(?:parameter |argument |input )?(?<param>${ID}) is (?<cond>${CONDS})`), clause)));
  push(guardFrom(groups(whole(String.raw`(?:fix|correct|handle) (?:the )?(?:function |method )?(?<fn>${ID}) when (?:the )?(?:parameter |argument |input )?(?<param>${ID}) is (?<cond>${CONDS}) so (?:that )?it returns (?<value>${LIT})`), clause)));
  push(guardFrom(groups(whole(String.raw`handle (?:the )?edge case (?:where|when) (?:the )?(?:parameter |argument |input )?(?<param>${ID}) is (?<cond>${CONDS}) (?:in|for|of) (?:the )?(?:function |method )?(?<fn>${ID}) (?:by |and )return(?:s|ing)? (?<value>${LIT})`), clause)));
  push(guardFrom(groups(whole(String.raw`wrong return (?:for|on) (?:an? |the )?(?<cond>${CONDS}) (?<param>${ID}): (?:the )?(?:function |method )?(?<fn>${ID}) should return (?<value>${LIT})`), clause)));
  push(guardFrom(groups(whole(String.raw`add (?:a |the )?missing (?:check|guard)(?: clause)? (?:so |to )?(?:the )?(?:function |method )?(?<fn>${ID}) returns? (?<value>${LIT}) (?:when|if) (?:the )?(?:parameter |argument |input )?(?<param>${ID}) is (?<cond>${CONDS})`), clause)));

  const tried = groups(whole(String.raw`(?:fix|handle) (?:the )?(?:function |method )?(?<fn>${ID}) so (?:a |an )?(?:thrown )?(?:error|exception|failure) returns (?<value>${LIT})`), clause)
    ?? groups(whole(String.raw`when (?:the )?(?:function |method )?(?<fn>${ID}) throws, return (?<value>${LIT})`), clause);
  const tryFn = ident(tried?.fn);
  if (tryFn && tried?.value) push({ kind: "map", family: "try-catch", text: `Wrap the body of ${tryFn} in try/catch that returns ${tried.value} on error` });

  const array = groups(whole(String.raw`fix (?:the )?(?:array |list )(?<name>${ID}) to include (?<value>${LIT})`), clause)
    ?? groups(whole(String.raw`add (?:the )?missing (?:value |item )?(?<value>${LIT}) to (?:the )?(?:array |list )(?<name>${ID})`), clause);
  if (array?.name && array.value && ident(array.name)) push({ kind: "map", family: "array-item", text: `Add ${array.value} to the array ${array.name}` });

  const prop = groups(whole(String.raw`add (?:the )?missing (?:property|key|entry) (?<key>${ID}) with value (?<value>${LIT}) on (?:the )?(?:object )?(?<name>${ID})`), clause);
  if (prop && ident(prop.key) && ident(prop.name) && prop.value) push({ kind: "map", family: "object-property", text: `Add property ${prop.key} with value ${prop.value} to object ${prop.name}` });

  const union = groups(whole(String.raw`add (?:the )?missing (?:member|value) (?<value>${LIT}) to (?:the )?union(?: type)? (?<name>${ID})`), clause);
  if (union && ident(union.name) && union.value && /^["']/.test(union.value)) push({ kind: "map", family: "union-member", text: `Add ${union.value} to the union type ${union.name}` });

  const field = groups(whole(String.raw`add (?:the )?missing (?:field|property) (?<field>${ID}) of type (?<type>${TYPE}) to (?:the )?type (?<name>${ID})`), clause);
  if (field && ident(field.field) && ident(field.name) && field.type) push({ kind: "map", family: "type-field", text: `Add a field ${field.field} of type ${field.type} to type ${field.name}` });

  const set = groups(whole(String.raw`fix (?:the )?value of (?<name>${ID})(?: in ${FILE})? to (?<value>${SET_LIT})`), clause)
    ?? groups(whole(String.raw`wrong value (?:of |for )(?<name>${ID})(?: in ${FILE})?: it should be (?<value>${SET_LIT})`), clause);
  if (set && ident(set.name) && set.value) {
    const file = resolveFile(clause, ctx);
    if (file === "bad") push({ kind: "cant", reason: "CANT_DO_YET_NO_FILE" });
    else push({ kind: "map", family: "set-literal", text: file ? `set ${set.name} in ${file} to ${set.value}` : `set ${set.name} to ${set.value}` });
  }

  const sw = groups(whole(String.raw`fix (?:the )?switch in (?<fn>${ID}) so (?:the )?case (?<label>${QUOTED}) returns (?<value>${LIT})`), clause);
  if (sw && ident(sw.fn) && sw.label && sw.value) push({ kind: "map", family: "switch-case", text: `add case ${sw.label} returning ${sw.value} to the switch in ${sw.fn}` });

  const nil = groups(whole(String.raw`when (?<expr>${ID}(?:\.${ID})+) is missing, (?<fn>${ID}) should use (?<value>${NULLISH_LIT})`), clause)
    ?? groups(whole(String.raw`(?<fn>${ID}) should default (?<expr>${ID}(?:\.${ID})+) to (?<value>${NULLISH_LIT})`), clause);
  if (nil && ident(nil.fn) && nil.expr && nil.value) push({ kind: "map", family: "nullish-default", text: `default ${nil.expr} to ${nil.value} in ${nil.fn}` });

  const constant = groups(whole(String.raw`add (?:the )?missing (?:exported )?constant (?<name>${ID}) (?:=|with value) (?<value>${LIT})(?: (?:to|in) ${FILE})?`), clause);
  if (constant && ident(constant.name) && constant.value) {
    const file = resolveFile(clause, ctx);
    if (file === "bad" || !file) push({ kind: "cant", reason: "CANT_DO_YET_NO_FILE" });
    else push({ kind: "map", family: "exported-constant", text: `Add an exported constant ${constant.name} with value ${constant.value} to ${file}` });
  }

  const renamed = groups(whole(String.raw`rename (?:the )?(?:existing )?(?<kind>function |method |symbol |const(?:ant)? |type )?(?<from>${ID}(?:\.${ID})*)(?:\(\))? (?:to|into) (?<to>${ID}(?:\.${ID})*)(?:\(\))?`), clause);
  if (renamed?.from && renamed.to) {
    const plain = new RegExp(`^${ID}$`);
    if (!plain.test(renamed.from) || !plain.test(renamed.to)) push({ kind: "cant", reason: "CANT_DO_YET_NAME_SHAPE" });
    else {
      const kind = /^function|^method/i.test(renamed.kind ?? "") ? "function" : /^type/i.test(renamed.kind ?? "") ? "type" : /^const/i.test(renamed.kind ?? "") ? "constant" : "symbol";
      push({ kind: "map", family: "rename", text: `rename the ${kind} ${renamed.from} to ${renamed.to}` });
    }
  }

  return hits;
}

const TEST_ONLY = /^(?:then |and |also |finally )?(?:add|write|include) (?:a |an |some |focused |unit )*tests?\b[^.]*$/i;
const FIX_VERB = new RegExp(`^${POLITE}(?:fix|handle|correct)\\b`, "i");
const ADD_VERB = new RegExp(`^${POLITE}add\\b`, "i");
const RENAME_VERB = new RegExp(`^${POLITE}rename\\b`, "i");
const ACTION_VERB = new RegExp(`^${POLITE}(?:fix|handle|correct|add|rename|remove|set|change|update|implement|require|improve|give|make|move|bump|upgrade|refactor|delete|wrap|default)\\b`, "i");
const HAS_NAME = new RegExp(String.raw`\b${ID}\b`);

/** What one clause is, before the plan is assembled. A test-only line is not an edit. */
function classifyClause(clause: string, ctx: Ctx): Hit | "test" {
  if (TEST_ONLY.test(clause)) return "test";
  if (BUG.test(clause) || NEGATED.test(clause)) return hole(clause);
  const hits = matchers(clause, ctx);
  const maps = hits.filter((h): h is { kind: "map"; family: StepFamily; text: string } => h.kind === "map");
  const cants = hits.filter((h): h is { kind: "cant"; reason: CantReason } => h.kind === "cant");
  if (maps.length > 0 && cants.length > 0) return { kind: "cant", reason: "CANT_DO_YET_AMBIGUOUS" };
  const texts = new Set(maps.map((h) => h.text));
  if (texts.size > 1) return { kind: "cant", reason: "CANT_DO_YET_AMBIGUOUS" };
  if (maps.length >= 1) return maps[0]!;
  if (cants.length === 1) return cants[0]!;
  if (cants.length > 1) return { kind: "cant", reason: sameReason(cants) };
  return hole(clause);
}

/** A shape we recognize but cannot fill. The reason names the hole. It does not pick an edit. */
function hole(clause: string): Hit {
  if (RENAME_VERB.test(clause)) return { kind: "cant", reason: /\b(?:to|into)\b/i.test(clause) ? "CANT_DO_YET_NAME_SHAPE" : "CANT_DO_YET_NOT_A_FAMILY" };
  if (ADD_VERB.test(clause) && HAS_NAME.test(clause)) return { kind: "cant", reason: "CANT_DO_YET_ADD_UNSPECIFIED" };
  if (FIX_VERB.test(clause)) return { kind: "cant", reason: "CANT_DO_YET_EDIT_UNSPECIFIED" };
  if (ACTION_VERB.test(clause)) return { kind: "cant", reason: "CANT_DO_YET_NOT_A_FAMILY" };
  return { kind: "cant", reason: "CANT_DO_YET_NO_EDIT" };
}

function taskSource(input: UnderstandInput): string {
  const title = cleanIssueText({ title: input.title, body: "" });
  const body = cleanIssueText({ title: "", body: input.body });
  const source = (body.trim() || title)
    .replace(/^\s*\[test\][^\n]*?(?::|\n|$)/i, (m) => (body.trim() ? m : ""))
    .replace(/^\s*\[test\]\s*/i, "")
    .trim();
  const prefixed = source.replace(/^(?:fix|feat|chore|docs|refactor|test|perf|style)(?:\([^)\n]{0,40}\))?:\s+/i, (m) => /^fix/i.test(m) ? "fix " : "");
  return prefixed.replace(/\s*\(#\d+\)/g, "").replace(/\s+#\d+\b/g, "").trim();
}

function sameReason(items: { kind: "cant"; reason: CantReason }[]): CantReason {
  const reasons = new Set(items.map((c) => c.reason));
  return reasons.size === 1 ? items[0]!.reason : "CANT_DO_YET_PARTIAL";
}

/**
 * Map one issue or commit text onto phrases the existing engines already run.
 * Uncertain text returns a can't-do-yet reason and no plan.
 */
export function understandIssue(input: UnderstandInput): UnderstandResult {
  const source = taskSource(input);
  if (!source) return { status: "cant", reason: "CANT_DO_YET_NO_EDIT" };
  const pattern = compilePattern(input.sourcePattern);
  const implied = input.testFile && input.sourcePattern
    ? impliedSourceFile(input.testFile, input.sourcePattern, input.sources ?? [])
    : null;
  const ctx: Ctx = { implied, pattern };
  const parts = clauses(source);
  if (parts.length === 0) return { status: "cant", reason: "CANT_DO_YET_NO_EDIT" };
  const results = parts.map((part) => classifyClause(part, ctx));
  const edits = results.filter((r): r is Hit => r !== "test");
  if (edits.length === 0) return { status: "cant", reason: "CANT_DO_YET_NOT_A_FAMILY" };
  const maps = edits.filter((r): r is { kind: "map"; family: StepFamily; text: string } => r.kind === "map");
  const cants = edits.filter((r): r is { kind: "cant"; reason: CantReason } => r.kind === "cant");
  if (cants.length > 0) return { status: "cant", reason: maps.length > 0 ? "CANT_DO_YET_PARTIAL" : sameReason(cants) };

  const wantsTest = results.some((r) => r === "test");
  const learned = maps.filter((m) => m.family !== "rename" && LEARNED_KIND[m.family]);
  if ((maps.length > 1 || wantsTest) && learned.length > 0) return { status: "cant", reason: "CANT_DO_YET_PARTIAL" };
  const approved = input.approvedKinds ?? new Set<string>();
  if (learned.some((m) => m.family !== "rename" && !approved.has(LEARNED_KIND[m.family]!))) return { status: "cant", reason: "CANT_DO_YET_RULE_NOT_APPROVED" };

  const lines = maps.map((m) => m.text);
  let objective: string;
  if (lines.length === 1 && !wantsTest) objective = lines[0]!;
  else if (lines.length === 1 && wantsTest) objective = `${lines[0]}, with focused tests.`;
  else objective = [...lines, ...(wantsTest ? ["add a test"] : [])].map((line, i) => `Step ${i + 1}: ${line}`).join("\n");

  if (!isCanonical(objective)) return { status: "cant", reason: "CANT_DO_YET_NOT_A_FAMILY" };
  const extra = implied && !source.includes(implied) ? implied : null;
  const comparable = extra ? objective.replaceAll(extra, " ") : objective;
  if (maps.some((m) => m.family !== "rename") && widens(source, comparable)) return { status: "cant", reason: "CANT_DO_YET_NOT_A_FAMILY" };
  return { status: "mapped", objective, steps: maps.map((m) => ({ family: m.family, text: m.text })) };
}
