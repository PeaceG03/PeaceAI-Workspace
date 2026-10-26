// M99: the DERIVE_FROM_BEHAVIOR learned rule (public-derive-from-behavior-v1). Every earlier code-writing rule takes
// the implementation from the issue text and only places it (`returning EXPR`, `with body:`, `replace statement`),
// which is not PeaceAI's own work. This rule is the opposite: the issue states only the wanted BEHAVIOR of a new
// pure function (name, module, typed signature, a plain-language description and input -> output examples), and
// PeaceAI derives the body itself with its own program search (peaceai/lib/derive.ts) and writes the test from the
// examples. The issue may not contain code: a behavior section with code or expressions is refused
// (derive_behavior_code, the anti-credit guard), and the examples are literal data only.
//
// Task shape (after issue cleaning, backticks are spaces):
//   Add a new module src/x.ts exporting name(a: number, b: string): boolean.
//   Behavior: <plain prose, no code>
//   Examples ...:
//   - 429 gives true
//   - "fetch failed", "" gives "..."
// The edit: ONE new module holding only `export function name(typed params): R { return <derived>; }` and ONE new
// test file asserting exactly the issue's examples. Job B grades it like the ADD_FUNCTION new module
// (self-fail-before-pass-after plus the type-default stub) and re-checks the derived body's grammar.
// The behavior prose only has to pass the anti-credit guard: it never reaches the search, the constants or the
// test. The program is determined by the examples alone; the header line picks the module, name and signature.
import { createHash } from "node:crypto";
import { compileProgram, deriveProgram, derivedExprProblem, farProbeTable, DERIVE_MAX_EXPR_CHARS, DERIVE_MAX_PARAMS, type DeriveExample, type DeriveParam, type DeriveQuestion, type DeriveType, type DeriveValue } from "./derive.ts";
import { allowedName, formatDeriveQuestions } from "./refusal-reason.ts";
import { NEW_MODULE_PATH, PROTECTED_MODULE, PROTECTED_NAMES, safeBody } from "./learned-function.ts";
import { importStyle } from "./learned-test.ts";
import { isExcludedSource, loadClosure, loadProblem } from "./learned-edit-existing.ts";
import { PROTECTED_SELF } from "./selfchange.ts";
import { compileStr, deriveStringProgram, lexStrValues, strExprProblem, strLit, strLitValue, strProbeTable, STR_MAX_PARAMS, type StrArg, type StrExample, type StrOut, type StrParam, type StrRet } from "./derive-string.ts";
import ts from "typescript";

export const DERIVE_PARAM_KEYS = ["ambiguity", "dsl", "examples", "grading", "placement", "test"] as const;
export const DERIVE_VOCAB: Record<(typeof DERIVE_PARAM_KEYS)[number], readonly string[]> = {
  ambiguity: ["refuse-unwitnessed"],
  // M111: typed-dsl-v2 (public-derive-from-behavior-v2) = v1 plus boolean label chains (DeriveInput.labelChains).
  dsl: ["typed-dsl-v1", "typed-dsl-v2"],
  examples: ["literal-data-only"],
  grading: ["self-fail-before-pass-after"],
  // M112: end-of-existing-module (public-derive-from-behavior-v3) = append the derived function to an existing module.
  placement: ["new-module", "end-of-existing-module"],
  test: ["new-file-examples"],
};
export function validDeriveParams(p: Record<string, unknown>, minedFrom: unknown): boolean {
  if (minedFrom !== "public" || Object.keys(p).sort().join(",") !== [...DERIVE_PARAM_KEYS].join(",")) return false;
  // M114: public-derive-from-behavior-v5 is the one pair dsl typed-dsl-v5-strings + placement
  // new-or-existing-module-v5 (never one without the other); its other params come from DERIVE_VOCAB.
  if (p.dsl === DERIVE_STRING_DSL || p.placement === DERIVE_STRING_PLACEMENT) {
    return p.dsl === DERIVE_STRING_DSL && p.placement === DERIVE_STRING_PLACEMENT && DERIVE_PARAM_KEYS.every((k) => k === "dsl" || k === "placement" || (typeof p[k] === "string" && DERIVE_VOCAB[k].includes(p[k] as string)));
  }
  return DERIVE_PARAM_KEYS.every((k) => typeof p[k] === "string" && DERIVE_VOCAB[k].includes(p[k] as string));
}

const NAME = String.raw`[A-Za-z_$][\w$]{0,63}`;
const TYPE = String.raw`(?:number|string|boolean)`;
const PARAM = String.raw`${NAME}: ?${TYPE}`;
/** The header line (the rule's trigger): Add a new module src/x.ts exporting name(a: T, b: U): R */
export const DERIVE_TRIGGER = String.raw`^add (?:a )?new module (?<file>src\/[\w./-]+\.ts) exporting (?<fn>${NAME}) ?\((?<sig>${PARAM}(?:, ?${PARAM}){0,${DERIVE_MAX_PARAMS - 1}})\) ?: ?(?<ret>${TYPE}) ?\.?$`;
/**
 * M112 (public-derive-from-behavior-v3, placement end-of-existing-module): the header line for appending the derived
 * function to a module that already exists: Append a new function name(a: T, b: U): R to the existing module src/x.ts
 */
export const DERIVE_APPEND_TRIGGER = String.raw`^append (?:a )?new function (?<fn>${NAME}) ?\((?<sig>${PARAM}(?:, ?${PARAM}){0,${DERIVE_MAX_PARAMS - 1}})\) ?: ?(?<ret>${TYPE}) to (?:the )?existing module (?<file>src\/[\w./-]+\.ts) ?\.?$`;
export { DERIVE_MAX_EXPR_CHARS } from "./derive.ts";
/**
 * M114 (public-derive-from-behavior-v5): the header line of a STRING PARSER. Its own words ("string parser"), so it
 * never matches a v1-v4 header and none of theirs matches it; the first parameter is the text (a string), at most one
 * more is a number or a string; the result is string, number, boolean or string[]:
 *   Add a new module src/x.ts exporting the string parser name(line: string): string
 *   Append a new string parser name(line: string, n: number): string to the existing module src/x.ts
 */
const SQ = String.raw`${NAME}: ?(?:number|string)`;
export const DERIVE_STRING_TRIGGER = String.raw`^(?:add (?:a )?new module (?<file>src\/[\w./-]+\.ts) exporting (?:the |a )?string parser|append (?:a )?new string parser) (?<fn>${NAME}) ?\((?<sig>${NAME}: ?string(?:, ?${SQ})?)\) ?: ?(?<ret>string\[\]|string|number|boolean)(?: to (?:the )?existing module (?<afile>src\/[\w./-]+\.ts))? ?\.?$`;
/** M114: the placement and dsl of public-derive-from-behavior-v5 (bound to DERIVE_STRING_TRIGGER in runDeriveRule). */
export const DERIVE_STRING_PLACEMENT = "new-or-existing-module-v5";
export const DERIVE_STRING_DSL = "typed-dsl-v5-strings";
const EXAMPLES_HEAD = /^examples\b[^:\n]{0,80}:$/i;
const BEHAVIOR_HEAD = /^behaviou?r:\s*/i;
const BULLET = /^[-*] /;

/**
 * Anti-credit guard: the behavior section must be prose. Refused: operator and code punctuation (= < > ! & | ? ;
 * braces, brackets, + * % ^ ~ backslash, double quotes, slash), a call `name(`, member access `a.b`, a minus between
 * operands, quoted literals, and code keywords. Words such as "500 through 599" or "an equals sign" are fine.
 */
const BEHAVIOR_CODE: readonly RegExp[] = [
  /[=<>!&|?;{}[\]+*%^~\\"/`$]/,
  /[\w)]\(/,
  /[A-Za-z_)\]]\.[A-Za-z_]/,
  /\d\s*-\s*\d|[\w)]\s+-\s+[\w(]/,
  /(?:^|[^A-Za-z])'[^'\n]*'(?:[^A-Za-z]|$)/,
  /\b(?:[Rr]eturn|[Rr]eturning|const|let|var|typeof|instanceof|null|undefined|ternary|function body|Math|JSON|Number|String|Boolean|Array|Object|NaN|Infinity)\b/,
];
export function behaviorCodeProblem(text: string): string | null {
  for (const re of BEHAVIOR_CODE) { const m = re.exec(text); if (m) return m[0]; }
  return null;
}
/** Outside the header, behavior and examples: no strong code markers either (a route to copy code would be refused anyway). */
const STRONG_CODE = /=>|===|!==|&&|\|\||\breturn\b|\breturning\b|\bwith body:|\bMath\.|\bconst |\blet |\bfunction\s*\(|\breplace statement\b/;

export interface DeriveTask { fn: string; file: string; params: DeriveParam[]; ret: DeriveType; behavior: string; examples: DeriveExample[] }
export type DeriveParse = { task: DeriveTask } | { reason: string };

/** One literal: an integer, true / false, or a double-quoted printable-ASCII string without quotes or backslashes. */
function lexValues(text: string): { values: DeriveValue[]; out: DeriveValue } | null {
  const toks: (DeriveValue | "," | "gives")[] = [];
  let s = text.trim().replace(/\.$/, "");
  while (s.length) {
    let m: RegExpExecArray | null;
    if ((m = /^"([ !#-[\]-~]*)"/.exec(s))) toks.push(m[1]!);
    else if ((m = /^-?(?:0|[1-9]\d{0,11})(?![\w.])/.exec(s))) toks.push(Number(m[0]));
    else if ((m = /^(?:true|false)\b/.exec(s))) toks.push(m[0] === "true");
    else if ((m = /^,/.exec(s))) toks.push(",");
    else if ((m = /^gives\b/.exec(s))) toks.push("gives");
    else return null;
    s = s.slice(m[0].length).replace(/^ +/, "");
  }
  const g = toks.indexOf("gives");
  if (g < 1 || toks.lastIndexOf("gives") !== g || g !== toks.length - 2) return null;
  const out = toks[g + 1]!;
  if (out === "," || out === "gives") return null;
  const values: DeriveValue[] = [];
  for (let i = 0; i < g; i++) {
    const t = toks[i]!;
    if (i % 2 === 1) { if (t !== ",") return null; continue; }
    if (t === "," || t === "gives") return null;
    values.push(t);
  }
  return g % 2 === 1 ? { values, out } : null;
}

/**
 * Names a parameter or the function may never take (refused as derive_reserved_name): JavaScript / TypeScript
 * reserved and strict-mode words, `eval` and `arguments`, the literal names the derived body uses, and globals a
 * body could reach. A clean refusal, not a module that fails to parse or shadows something.
 */
export const DERIVE_RESERVED_NAMES: ReadonlySet<string> = new Set(
  ("break case catch class const continue debugger default delete do else enum export extends false finally for function " +
    "if import in instanceof new null return super switch this throw true try typeof var void while with " +
    "implements interface let package private protected public static yield await async of " +
    "eval arguments undefined NaN Infinity globalThis window self process require module exports " +
    "any boolean number string symbol bigint never unknown object type declare namespace abstract as is keyof readonly infer satisfies").split(" "),
);

export function parseDeriveTask(trigger: string, objective: string): DeriveParse {
  const lines = objective.split("\n").map((l) => l.trim()).filter(Boolean);
  const re = new RegExp(trigger, "i");
  const heads = lines.map((l, i) => (re.test(l) ? i : -1)).filter((i) => i >= 0);
  if (heads.length !== 1) return { reason: "derive_trigger" };
  const g = re.exec(lines[heads[0]!]!)!.groups ?? {};
  if (!g.fn || !g.file || !g.sig || !g.ret) return { reason: "derive_trigger" };
  const params: DeriveParam[] = [];
  for (const part of g.sig.split(",").map((p) => p.trim())) {
    const m = new RegExp(String.raw`^(${NAME}): ?(${TYPE})$`).exec(part);
    if (!m || params.some((p) => p.name === m[1]) || m[1] === g.fn || PROTECTED_NAMES.test(m[1]!)) return { reason: "derive_signature" };
    if (DERIVE_RESERVED_NAMES.has(m[1]!)) return { reason: "derive_reserved_name" };
    params.push({ name: m[1]!, type: m[2] as DeriveType });
  }
  if (PROTECTED_NAMES.test(g.fn)) return { reason: "derive_signature" };
  if (DERIVE_RESERVED_NAMES.has(g.fn)) return { reason: "derive_reserved_name" };
  const bIdx = lines.map((l, i) => (BEHAVIOR_HEAD.test(l) ? i : -1)).filter((i) => i >= 0);
  const eIdx = lines.map((l, i) => (EXAMPLES_HEAD.test(l) ? i : -1)).filter((i) => i >= 0);
  if (bIdx.length !== 1 || eIdx.length !== 1 || !(heads[0]! < bIdx[0]! && bIdx[0]! < eIdx[0]!)) return { reason: "derive_sections" };
  const behavior = [lines[bIdx[0]!]!.replace(BEHAVIOR_HEAD, ""), ...lines.slice(bIdx[0]! + 1, eIdx[0]!)].join(" ").trim();
  if (behavior.length < 20) return { reason: "derive_sections" };
  // Anti-credit guard: the behavior must be prose, never code or an expression.
  if (behaviorCodeProblem(behavior)) return { reason: "derive_behavior_code" };
  const examples: DeriveExample[] = [];
  let k = eIdx[0]! + 1;
  for (; k < lines.length && BULLET.test(lines[k]!); k++) {
    const v = lexValues(lines[k]!.replace(BULLET, ""));
    if (!v || v.values.length !== params.length) return { reason: "derive_examples" };
    examples.push({ args: v.values, out: v.out });
  }
  if (examples.length === 0) return { reason: "derive_examples" };
  // Every other line (title, context) carries no strong code marker, and no stray bullets follow the examples.
  const sectionEnd = k;
  for (const [i, l] of lines.entries()) {
    if (i === heads[0] || (i >= bIdx[0]! && i < sectionEnd)) continue;
    if (STRONG_CODE.test(l)) return { reason: "derive_behavior_code" };
    if (i > sectionEnd && BULLET.test(l)) return { reason: "derive_examples" };
  }
  return { task: { fn: g.fn, file: g.file, params, ret: g.ret as DeriveType, behavior, examples } };
}

const slug = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40).replace(/-$/, "") || "fn";
const lit = (v: DeriveValue) => (typeof v === "string" ? JSON.stringify(v) : String(v));

export interface DeriveEdit { path: string; content: string; create?: true; extra: { path: string; content: string; create: true }[]; selfGrade: true }
export type DeriveBuild = { edit: DeriveEdit; expr: string; size: number } | { reason: string; detail?: string; questions?: DeriveQuestion[] };

/** M112: the placement of public-derive-from-behavior-v3; its trigger is DERIVE_APPEND_TRIGGER. */
export const DERIVE_APPEND_PLACEMENT = "end-of-existing-module";

const parseClean = (path: string, content: string): ts.SourceFile | null => {
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  return (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length ? null : sf;
};

/** Every name the module text binds or mentions: any identifier anywhere (declarations, imports, exports, uses, keys). */
function moduleNames(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  const walk = (n: ts.Node): void => { if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) out.add(n.text); n.forEachChild(walk); };
  walk(sf);
  return out;
}

/**
 * M112 (public-derive-from-behavior-v3): the checks on an EXISTING module before a derived function is appended to it.
 * Null when it may take the function, else a refusal code. Fail closed:
 * - the module is a regular src/ module (not a test, .d.ts, fixture or helper, not protected) whose text parses, ends
 *   with one newline and has no carriage return, so the append changes no existing line;
 * - the new name is new: no identifier anywhere in the module (declaration, import, export, use, property) and no
 *   `export *` (it could re-export the same name) -> derive_append_name_collision;
 * - no top-level `let` / `var` (mutable state) -> derive_append_mutable_state;
 * - importing it runs nothing: its whole relative import closure passes the EXISTING_EDIT load check (only imports and
 *   declarations at top level, hermetic initializers, no package imports) -> derive_append_side_effects.
 * Imports are never changed: the derived body reads only its own parameters and literals, so it needs none.
 */
export function appendTargetProblem(path: string, content: string, fn: string, read: (rel: string) => string | null, isTest: (p: string) => boolean = (p) => /\.test\.ts$/.test(p)): string | null {
  if (!NEW_MODULE_PATH.test(path) || PROTECTED_MODULE.test(path) || isTest(path) || /\.d\.ts$/.test(path) || /\.(test|spec)\./.test(path) || isExcludedSource(path) || PROTECTED_SELF.some((p) => p.pattern.test(path))) return "derive_path";
  if (content.includes("\r") || !content.endsWith("\n") || content.endsWith("\n\n") || content.trim() === "") return "derive_append_layout";
  const sf = parseClean(path, content);
  if (!sf) return "derive_append_parse";
  if (moduleNames(sf).has(fn) || new RegExp(`(?<![\\w$])${fn.replace(/\$/g, "\\$")}(?![\\w$])`).test(content)) return "derive_append_name_collision";
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st) && (!st.exportClause || ts.isNamespaceExport(st.exportClause))) return "derive_append_name_collision";
    if (ts.isVariableStatement(st) && (st.declarationList.flags & ts.NodeFlags.BlockScoped) !== ts.NodeFlags.Const) return "derive_append_mutable_state";
    // `export default <expression>` runs that expression at import; only a plain name is inert.
    if (ts.isExportAssignment(st) && !ts.isIdentifier(st.expression)) return "derive_append_side_effects";
  }
  const c = loadClosure(path, read);
  if (typeof c === "string") return `derive_append_side_effects${allowedName(c.split(":")[0]!) ? `: ${c.split(":")[0]}` : ""}`;
  const lp = loadProblem(c, path);
  if (lp !== null) return `derive_append_side_effects${allowedName(lp.split(":")[0]!) ? `: ${lp.split(":")[0]}` : ""}`;
  return null;
}

/**
 * M112: the append itself is add-only. `after` is `before` plus "\n" plus one module that passes derivedModuleProblem
 * (one exported single-return function over its own typed parameters), and the parsed statements of `before` are
 * unchanged. Null when clean, else a reason code. Job B runs it again on the real files.
 */
export function derivedAppendProblem(before: string, after: string): string | null {
  return appendProblemWith(before, after, derivedModuleProblem);
}
function appendProblemWith(before: string, after: string, moduleProblem: (block: string) => string | null): string | null {
  if (!after.startsWith(before) || !after.slice(before.length).startsWith("\n")) return "derive_append_not_add_only";
  const block = after.slice(before.length + 1);
  const shape = moduleProblem(block);
  if (shape) return shape;
  const a = parseClean("a.ts", after), b = parseClean("b.ts", before);
  if (!a || !b || a.statements.length !== b.statements.length + 1) return "derive_append_not_add_only";
  for (const [i, st] of b.statements.entries()) if (st.getText(b) !== a.statements[i]!.getText(a)) return "derive_append_not_add_only";
  return null;
}

/**
 * `derive` is the search (deriveProgram); the parameter exists only so the emit-time checks below can be shown to
 * fire on a program the search would never produce (m99-derive-guards.test.ts). Job A never passes it.
 */
export function buildDeriveEdit(params: Record<string, unknown>, task: DeriveTask, files: readonly { path: string; content: string }[], isTest: (p: string) => boolean = (p) => /\.test\.ts$/.test(p), derive: typeof deriveProgram = deriveProgram): DeriveBuild {
  for (const k of DERIVE_PARAM_KEYS) if (typeof params[k] !== "string" || !DERIVE_VOCAB[k].includes(params[k] as string)) return { reason: "derive_params" };
  const path = task.file;
  const append = params.placement === DERIVE_APPEND_PLACEMENT;
  const dir = path.slice(0, path.lastIndexOf("/") + 1);
  let target: { path: string; content: string } | undefined;
  if (append) {
    // M112: the module must already exist, exactly as named (a near-miss in case is not it), and may take the function.
    if (!NEW_MODULE_PATH.test(path) || PROTECTED_MODULE.test(path) || isTest(path) || /\.d\.ts$/.test(path) || /\.(test|spec)\./.test(path)) return { reason: "derive_path" };
    target = files.find((f) => f.path === path);
    if (!target) return { reason: "target_file_not_found" };
    const read = (rel: string): string | null => { const f = files.find((x) => x.path === rel); return f && !isTest(rel) && !isExcludedSource(rel) ? f.content : null; };
    const problem = appendTargetProblem(path, target.content, task.fn, read, isTest);
    if (problem) return { reason: problem };
  } else {
    if (!NEW_MODULE_PATH.test(path) || PROTECTED_MODULE.test(path) || isTest(path) || /\.d\.ts$/.test(path) || /\.(test|spec)\./.test(path)) return { reason: "derive_path" };
    if (!files.some((f) => f.path.startsWith(dir) && !f.path.slice(dir.length).includes("/") && /\.ts$/.test(f.path) && !isTest(f.path))) return { reason: "derive_path" };
    if (files.some((f) => f.path.toLowerCase() === path.toLowerCase())) return { reason: "derive_module_exists" };
  }
  // PeaceAI's own search writes the body from the examples alone; nothing in the issue is copied into it and the
  // behavior prose is not an input.
  const base = { params: task.params, ret: task.ret, examples: task.examples };
  // M111 (decision #466: an approved version never widens; a widening is a new version): typed-dsl-v2 answers only
  // tasks v1 does not; a task v1 already derives is not_needed here, so the two rules never both answer one task.
  // M112: an append (v3) has its own trigger, so no new-module rule answers its task: it searches v1 first and, with
  // typed-dsl-v2, falls back to the boolean label chains, exactly as the review note does.
  const v2 = params.dsl === "typed-dsl-v2";
  let r: ReturnType<typeof deriveProgram>;
  if (append) { r = derive(base); if (!r.ok && v2) r = derive({ ...base, labelChains: true }); }
  else {
    if (v2 && derive(base).ok) return { reason: "not_needed" };
    r = derive(v2 ? { ...base, labelChains: true } : base);
  }
  if (!r.ok) {
    // derive_under_specified names the gate and, when it passes the refusal-line allowlist, the parameter: e.g.
    // `derive_under_specified_far: status` (the full sentence, with the edge to add, is in `detail`).
    // Round 3 (Peace): the refusal also asks, at the inputs where programs fitting every example disagree.
    const qs = r.questions?.length ? { questions: r.questions } : {};
    // Round 3 (Auditor): a form with fewer than DERIVE_FORM_BAR replaying upstream examples names the form(s), e.g.
    // `derive_unevidenced_form: eq,or` (form names are lowercase words, so they pass the refusal-line allowlist).
    if (r.reason === "derive_unevidenced_form") return { reason: `derive_unevidenced_form${r.forms?.length && r.forms.every(allowedName) ? `: ${r.forms.join(",")}` : ""}`, ...(r.detail ? { detail: r.detail } : {}), ...qs };
    if (r.reason === "derive_under_specified") return { reason: `derive_under_specified_${r.gate}${r.param && allowedName(r.param) ? `: ${r.param}` : ""}`, detail: r.detail, ...qs };
    return { reason: r.reason, ...(r.detail ? { detail: r.detail } : {}), ...qs };
  }
  const names = task.params.map((p) => p.name);
  const expr = compileProgram(r.fit.program, names);
  // Emit-time checks, in this order, each with its own code (a removed layer changes the code; see the guards test):
  // the size cap before anything parses the text, then the shared body vocabulary, then the strict DSL allowlist.
  if (expr.length > DERIVE_MAX_EXPR_CHARS) return { reason: "derive_emit_size" };
  const parsed = ts.createSourceFile("e.ts", `(${expr});`, ts.ScriptTarget.Latest, true);
  const st = parsed.statements[0];
  const e = parsed.statements.length === 1 && st && ts.isExpressionStatement(st) && ts.isParenthesizedExpression(st.expression) ? st.expression.expression : null;
  if (!e || !safeBody(e, new Set(names))) return { reason: "derive_expr_vocab" };
  const exprProblem = derivedExprProblem(expr, names);
  if (exprProblem) return { reason: exprProblem };
  const sig = task.params.map((p) => `${p.name}: ${p.type}`).join(", ");
  const fnText = `export function ${task.fn}(${sig}): ${task.ret} {\n  return ${expr};\n}\n`;
  if ((ts.createSourceFile(path, fnText, ts.ScriptTarget.Latest, true) as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) return { reason: "derive_expr_parse" };
  // M112: appended after one blank line at the very end; no existing line changes.
  const content = target ? `${target.content}\n${fnText}` : fnText;
  if (target) { const p = derivedAppendProblem(target.content, content); if (p) return { reason: p }; }
  // The test: the issue's examples, exactly.
  const call = (args: readonly DeriveValue[]) => `${task.fn}(${args.map(lit).join(", ")})`;
  const exampleLines = task.examples.map((ex) => `  assert.equal(${call(ex.args)}, ${lit(ex.out)});`);
  const stem = path.slice(dir.length).replace(/\.ts$/, "");
  const id7 = createHash("sha256").update(JSON.stringify([task.file, task.fn, sig, task.ret, task.examples])).digest("hex").slice(0, 7);
  const testPath = `${dir}${stem}.${slug(task.fn)}-${id7}.test.ts`;
  if (files.some((f) => f.path.toLowerCase() === testPath.toLowerCase())) return { reason: "new_test_path_exists" };
  const spec = `./${stem}${importStyle(files, isTest) === "ts" ? ".ts" : ""}`;
  const test = [
    'import assert from "node:assert/strict";',
    'import test from "node:test";',
    `import { ${task.fn} } from ${JSON.stringify(spec)};`,
    "",
    `test(${JSON.stringify(`${task.fn}: the examples from the issue`)}, () => {`,
    ...exampleLines,
    "});",
    "",
  ].join("\n");
  const extra = [{ path: testPath, content: test, create: true as const }];
  return { edit: target ? { path, content, extra, selfGrade: true } : { path, content, create: true, extra, selfGrade: true }, expr, size: r.fit.size };
}

/** Job A entry: refusal code in `why.reason`; null when there is no candidate. */
export function runDeriveRule(trigger: string, params: Record<string, unknown>, objective: string, files: readonly { path: string; content: string }[], isTest?: (p: string) => boolean, why?: { reason?: string; questions?: string }): DeriveEdit | null {
  // M114: a v5 (string parser) spec has its own trigger, placement and dsl, all three together; nothing below sees one.
  if (trigger === DERIVE_STRING_TRIGGER || params.placement === DERIVE_STRING_PLACEMENT || params.dsl === DERIVE_STRING_DSL) return runDeriveStringRule(trigger, params, objective, files, isTest, why);
  // M112: the placement and the trigger go together (new-module: DERIVE_TRIGGER; end-of-existing-module:
  // DERIVE_APPEND_TRIGGER), so a spec can never point one placement's engine at the other's phrasing.
  if ((params.placement === DERIVE_APPEND_PLACEMENT) !== (trigger === DERIVE_APPEND_TRIGGER) || (params.placement !== DERIVE_APPEND_PLACEMENT && trigger !== DERIVE_TRIGGER)) { if (why) why.reason = "derive_params"; return null; }
  const parsed = parseDeriveTask(trigger, objective);
  if ("reason" in parsed) { if (why && parsed.reason !== "derive_trigger") why.reason = parsed.reason; return null; }
  const built = buildDeriveEdit(params, parsed.task, files, isTest);
  if ("reason" in built) {
    if (why) { why.reason = built.reason; const q = formatDeriveQuestions(parsed.task.fn, built.questions ?? []); if (q) why.questions = q; }
    return null;
  }
  return built.edit;
}

/**
 * Job B re-check of a DERIVE candidate's new module: exactly one exported function with a single `return` whose
 * expression passes derivedExprProblem over its own parameters. Null when clean, else a reason code.
 */
export function derivedModuleProblem(content: string): string | null {
  const sf = ts.createSourceFile("m.ts", content, ts.ScriptTarget.Latest, true);
  if ((sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length || sf.statements.length !== 1) return "derive_module_shape";
  const f = sf.statements[0]!;
  if (!ts.isFunctionDeclaration(f) || !f.name || !f.body || f.asteriskToken || (ts.getModifiers(f) ?? []).map((m) => m.kind).join(",") !== String(ts.SyntaxKind.ExportKeyword)) return "derive_module_shape";
  const st = f.body.statements;
  if (st.length !== 1 || !ts.isReturnStatement(st[0]!) || !st[0]!.expression) return "derive_module_shape";
  const names: string[] = [];
  for (const p of f.parameters) {
    if (!ts.isIdentifier(p.name) || p.initializer || p.dotDotDotToken || p.questionToken || !p.type || !/^(?:number|string|boolean)$/.test(p.type.getText(sf))) return "derive_module_shape";
    names.push(p.name.text);
  }
  if (!f.type || !/^(?:number|string|boolean)$/.test(f.type.getText(sf))) return "derive_module_shape";
  return derivedExprProblem(st[0]!.expression.getText(sf), names);
}

/**
 * Anti-credit guard on the RAW issue body (before cleaning drops them): a fenced code block, an HTML comment or a
 * multi-line backtick span could carry an implementation the cleaned text no longer shows. Any of them is refused.
 */
export function rawIssueProblem(body: string): string | null {
  if (/```|~~~/.test(body)) return "derive_behavior_code";
  if (/<!--/.test(body)) return "derive_behavior_code";
  if (/^(?: {4}|\t)\S/m.test(body)) return "derive_behavior_code";
  return null;
}

/** Rows of the far-probe table shown in a DERIVE candidate's review note. */
export const DERIVE_NOTE_ROWS = 24;

/** The files a unified diff creates (`new file mode`), with their full content. */
function createdFiles(diff: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  for (const part of diff.split(/^diff --git /m).slice(1)) {
    if (!/^new file mode /m.test(part)) continue;
    const path = /^\+\+\+ b\/(.+)$/m.exec(part)?.[1];
    const hunk = part.indexOf("\n@@ ");
    if (!path || hunk < 0) continue;
    const body = part.slice(part.indexOf("\n", hunk + 1) + 1).split("\n").filter((l) => l.startsWith("+")).map((l) => l.slice(1));
    out.push({ path, content: `${body.join("\n")}\n` });
  }
  return out;
}

/**
 * M112: the function block a unified diff appends to an existing file, when that is all the file's diff does: one
 * hunk, no removed line, the added lines last with no context after them (so they end the file), opening with one
 * blank line. The block is returned without that blank line. Files whose diff does anything else are left out.
 */
function appendedBlocks(diff: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  for (const part of diff.split(/^diff --git /m).slice(1)) {
    if (/^(?:new|deleted) file mode /m.test(part) || /^(?:rename|copy) (?:from|to) /m.test(part)) continue;
    const path = /^\+\+\+ b\/(.+)$/m.exec(part)?.[1];
    const lines = part.split("\n");
    const hunks = lines.filter((l) => l.startsWith("@@ "));
    if (!path || hunks.length !== 1) continue;
    const body = lines.slice(lines.indexOf(hunks[0]!) + 1);
    if (body.at(-1) === "") body.pop();
    const first = body.findIndex((l) => l.startsWith("+"));
    if (first < 0 || body.slice(0, first).some((l) => !l.startsWith(" ")) || body.slice(first).some((l) => !l.startsWith("+"))) continue;
    const added = body.slice(first).map((l) => l.slice(1));
    if (added[0] !== "" || added.length < 2) continue;
    out.push({ path, content: `${added.slice(1).join("\n")}\n` });
  }
  return out;
}

/** A literal argument or expected value as written by buildDeriveEdit (number, -number, string, boolean), else undefined. */
function litValue(e: ts.Expression): DeriveValue | undefined {
  if (ts.isNumericLiteral(e)) return Number(e.text);
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(e.operand)) return -Number(e.operand.text);
  if (ts.isStringLiteral(e)) return e.text;
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

/**
 * Auditor #491 (B1): the review note of a DERIVE candidate, rebuilt from its diff alone. The diff must create exactly
 * one module that passes derivedModuleProblem and one test made only of literal `assert.equal(fn(...), value)` lines;
 * PeaceAI derives again from those examples and shows the note only when it gets the module's exact expression. The
 * note gives that expression and the program's output on the far probes (past every edge the examples show), so a
 * reviewer sees what the candidate does where the issue gave no example. Null for anything else.
 */
export function deriveReviewNote(diff: string, derive: typeof deriveProgram = deriveProgram): string | null {
  const files = createdFiles(diff);
  const tests = files.filter((f) => /\.test\.ts$/.test(f.path));
  // M112: the module is either created (v1, v2) or is the block appended to an existing module (v3).
  const mods = [...files.filter((f) => !/\.test\.ts$/.test(f.path)), ...appendedBlocks(diff).filter((f) => !/\.test\.ts$/.test(f.path))];
  if (diff.split(/^diff --git /m).length - 1 !== 2 || tests.length !== 1 || mods.length !== 1 || derivedModuleProblem(mods[0]!.content) !== null) return null;
  const sf = ts.createSourceFile("m.ts", mods[0]!.content, ts.ScriptTarget.Latest, true);
  const f = sf.statements[0] as ts.FunctionDeclaration;
  const fn = f.name!.text;
  const params: DeriveParam[] = f.parameters.map((p) => ({ name: (p.name as ts.Identifier).text, type: p.type!.getText(sf) as DeriveType }));
  const ret = f.type!.getText(sf) as DeriveType;
  const expr = ((f.body!.statements[0] as ts.ReturnStatement).expression!).getText(sf);
  const examples: DeriveExample[] = [];
  for (const line of tests[0]!.content.split("\n")) {
    if (!/^\s*assert\.equal\(/.test(line)) continue;
    const t = ts.createSourceFile("t.ts", line, ts.ScriptTarget.Latest, true);
    const st = t.statements[0];
    if (t.statements.length !== 1 || !st || !ts.isExpressionStatement(st) || !ts.isCallExpression(st.expression)) return null;
    const [call, want, ...rest] = st.expression.arguments;
    if (st.expression.expression.getText(t) !== "assert.equal" || !call || !want || rest.length || !ts.isCallExpression(call) || call.expression.getText(t) !== fn || call.arguments.length !== params.length) return null;
    const args = call.arguments.map(litValue);
    const out = litValue(want);
    if (out === undefined || args.some((a, i) => a === undefined || typeof a !== params[i]!.type)) return null;
    examples.push({ args: args as DeriveValue[], out });
  }
  if (!examples.length) return null;
  // M111: as Job A, v1 first, then v2 (typed-dsl-v2: boolean label chains) only for examples v1 does not derive.
  const v1 = derive({ params, ret, examples });
  const r = v1.ok ? v1 : derive({ params, ret, examples, labelChains: true });
  if (!r.ok || compileProgram(r.fit.program, params.map((p) => p.name)) !== expr) return null;
  const rows = farProbeTable(r.fit.program, params, examples, DERIVE_NOTE_ROWS).map((row) => `${fn}(${row.args.map(lit).join(", ")}) = ${row.out === undefined ? "(error)" : lit(row.out)}`);
  return [`Derived by PeaceAI from the ${examples.length} examples (DERIVE_FROM_BEHAVIOR). Expression and far probes (inputs past every edge the examples show):`, "", "```text", `return ${expr};`, "", ...rows, "```"].join("\n");
}

/** The transformation tag every DERIVE_FROM_BEHAVIOR candidate carries (`LEARNED_${kind}` in generate.ts). */
export const DERIVE_TRANSFORMATION = "LEARNED_DERIVE_FROM_BEHAVIOR";

/**
 * Auditor #491 round 2 (B3): the review note is the backstop for /verdict, so the review job fails closed. Every
 * DERIVE candidate gets its note, rebuilt from its diff; it is an error (the review comment is not built) when a
 * DERIVE candidate already has another note (a placeholder repair would hide it) or its note cannot be rebuilt.
 * Other candidates get no derive note. Returns the ids that carry one.
 */
export function attachDeriveNotes(
  candidates: readonly { id: string; transformations: readonly string[] }[],
  diffs: ReadonlyMap<string, string>,
  notes: Map<string, string>,
  note: (diff: string) => string | null = (d) => deriveReviewNote(d) ?? deriveStringReviewNote(d),
): string[] {
  const ids: string[] = [];
  for (const c of candidates) {
    if (!c.transformations.includes(DERIVE_TRANSFORMATION)) continue;
    if (notes.has(c.id)) throw new Error(`${c.id}: a DERIVE candidate already has a note (${JSON.stringify(notes.get(c.id))}); its derive note would be left out, so the review is not built`);
    const n = note(diffs.get(c.id) ?? "");
    if (!n) throw new Error(`${c.id}: the DERIVE review note (expression and far probes) could not be rebuilt from the candidate's diff; the review is not built`);
    notes.set(c.id, n);
    ids.push(c.id);
  }
  return ids;
}

/** Every presented DERIVE candidate's note is in the built body, under its own heading, before its diff; else it throws. */
export function assertDeriveNotesShown(body: string, presentation: readonly { label: string; id: string }[], notes: ReadonlyMap<string, string>, deriveIds: readonly string[]): void {
  for (const p of presentation) {
    if (!deriveIds.includes(p.id)) continue;
    const want = `### Candidate ${p.label}\n\n${notes.get(p.id)}\n\n<details>`;
    if (!notes.get(p.id) || !body.includes(want)) throw new Error(`${p.id}: the DERIVE review note is not shown on candidate ${p.label}; the review is not built`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// M114: public-derive-from-behavior-v5, string parsers (peaceai/lib/derive-string.ts holds the search).

export interface DeriveStringTask { fn: string; file: string; append: boolean; params: StrParam[]; ret: StrRet; behavior: string; examples: StrExample[] }

/** The v5 task: the header (DERIVE_STRING_TRIGGER), the Behavior: prose and the Examples: bullets. */
export function parseDeriveStringTask(objective: string): { task: DeriveStringTask } | { reason: string } {
  const lines = objective.split("\n").map((l) => l.trim()).filter(Boolean);
  const re = new RegExp(DERIVE_STRING_TRIGGER, "i");
  const heads = lines.map((l, i) => (re.test(l) ? i : -1)).filter((i) => i >= 0);
  if (heads.length !== 1) return { reason: "derive_trigger" };
  const head = lines[heads[0]!]!;
  const g = re.exec(head)!.groups ?? {};
  const append = /^append\b/i.test(head);
  if (!g.fn || !g.sig || !g.ret || (append ? !g.afile || !!g.file : !g.file || !!g.afile)) return { reason: "derive_trigger" };
  const file = (append ? g.afile : g.file)!;
  const params: StrParam[] = [];
  for (const part of g.sig.split(",").map((p) => p.trim())) {
    const m = new RegExp(String.raw`^(${NAME}): ?(number|string)$`).exec(part);
    if (!m || params.some((p) => p.name === m[1]) || m[1] === g.fn || PROTECTED_NAMES.test(m[1]!) || m[1] === "v") return { reason: m && m[1] === "v" ? "derive_reserved_name" : "derive_signature" };
    if (DERIVE_RESERVED_NAMES.has(m[1]!)) return { reason: "derive_reserved_name" };
    params.push({ name: m[1]!, type: m[2] as "number" | "string" });
  }
  if (params.length > STR_MAX_PARAMS || params[0]?.type !== "string") return { reason: "derive_signature" };
  if (PROTECTED_NAMES.test(g.fn)) return { reason: "derive_signature" };
  if (DERIVE_RESERVED_NAMES.has(g.fn) || g.fn === "v") return { reason: "derive_reserved_name" };
  const bIdx = lines.map((l, i) => (BEHAVIOR_HEAD.test(l) ? i : -1)).filter((i) => i >= 0);
  const eIdx = lines.map((l, i) => (EXAMPLES_HEAD.test(l) ? i : -1)).filter((i) => i >= 0);
  if (bIdx.length !== 1 || eIdx.length !== 1 || !(heads[0]! < bIdx[0]! && bIdx[0]! < eIdx[0]!)) return { reason: "derive_sections" };
  const behavior = [lines[bIdx[0]!]!.replace(BEHAVIOR_HEAD, ""), ...lines.slice(bIdx[0]! + 1, eIdx[0]!)].join(" ").trim();
  if (behavior.length < 20) return { reason: "derive_sections" };
  if (behaviorCodeProblem(behavior)) return { reason: "derive_behavior_code" };
  const examples: StrExample[] = [];
  let k = eIdx[0]! + 1;
  for (; k < lines.length && BULLET.test(lines[k]!); k++) {
    const v = lexStrValues(lines[k]!.replace(BULLET, ""));
    if (!v || v.values.length !== params.length) return { reason: "derive_examples" };
    examples.push({ args: v.values, out: v.out });
  }
  if (examples.length === 0) return { reason: "derive_examples" };
  const sectionEnd = k;
  for (const [i, l] of lines.entries()) {
    if (i === heads[0] || (i >= bIdx[0]! && i < sectionEnd)) continue;
    if (STRONG_CODE.test(l)) return { reason: "derive_behavior_code" };
    if (i > sectionEnd && BULLET.test(l)) return { reason: "derive_examples" };
  }
  return { task: { fn: g.fn, file, append, params, ret: g.ret as StrRet, behavior, examples } };
}

/** The v5 edit: the same placement checks as v1 (new module) or v3 (append), the string search, the emit checks. */
export function buildDeriveStringEdit(params: Record<string, unknown>, task: DeriveStringTask, files: readonly { path: string; content: string }[], isTest: (p: string) => boolean = (p) => /\.test\.ts$/.test(p), derive: typeof deriveStringProgram = deriveStringProgram): DeriveBuild {
  if (params.dsl !== DERIVE_STRING_DSL || params.placement !== DERIVE_STRING_PLACEMENT || !validDeriveParams(params, "public")) return { reason: "derive_params" };
  const path = task.file;
  const dir = path.slice(0, path.lastIndexOf("/") + 1);
  if (!NEW_MODULE_PATH.test(path) || PROTECTED_MODULE.test(path) || isTest(path) || /\.d\.ts$/.test(path) || /\.(test|spec)\./.test(path)) return { reason: "derive_path" };
  let target: { path: string; content: string } | undefined;
  if (task.append) {
    target = files.find((f) => f.path === path);
    if (!target) return { reason: "target_file_not_found" };
    const read = (rel: string): string | null => { const f = files.find((x) => x.path === rel); return f && !isTest(rel) && !isExcludedSource(rel) ? f.content : null; };
    const problem = appendTargetProblem(path, target.content, task.fn, read, isTest);
    if (problem) return { reason: problem };
  } else {
    if (!files.some((f) => f.path.startsWith(dir) && !f.path.slice(dir.length).includes("/") && /\.ts$/.test(f.path) && !isTest(f.path))) return { reason: "derive_path" };
    if (files.some((f) => f.path.toLowerCase() === path.toLowerCase())) return { reason: "derive_module_exists" };
  }
  // PeaceAI's own string search writes the body from the examples alone (the behavior prose is not an input).
  const r = derive({ params: task.params, ret: task.ret, examples: task.examples });
  if (!r.ok) {
    // String-valued questions do not fit the scalar question line (refusal-reason.ts); they stay in `detail`.
    const asks = r.questions?.length ? ` Asked: ${r.questions.map((q) => `${task.fn}(${q.at.map((a) => strLit(a)).join(", ")}) gives ${q.answers.map((a) => strLit(a)).join(" or ")}?`).join(" ")}` : "";
    if (r.reason === "derive_under_specified") return { reason: `derive_under_specified_${r.gate}`, detail: r.detail + asks };
    return { reason: r.reason, detail: r.detail + asks };
  }
  const names = task.params.map((p) => p.name);
  const expr = compileStr(r.program, names);
  if (expr.length > DERIVE_MAX_EXPR_CHARS) return { reason: "derive_emit_size" };
  const exprProblem = strExprProblem(expr, task.params, task.ret);
  if (exprProblem) return { reason: exprProblem };
  const sig = task.params.map((p) => `${p.name}: ${p.type}`).join(", ");
  const fnText = `export function ${task.fn}(${sig}): ${task.ret} {\n  return ${expr};\n}\n`;
  if (derivedStringModuleProblem(fnText)) return { reason: "derive_expr_parse" };
  const content = target ? `${target.content}\n${fnText}` : fnText;
  if (target) { const p = derivedStringAppendProblem(target.content, content); if (p) return { reason: p }; }
  const call = (args: readonly StrArg[]) => `${task.fn}(${args.map((a) => strLit(a)).join(", ")})`;
  const assertFn = task.ret === "string[]" ? "assert.deepEqual" : "assert.equal";
  const exampleLines = task.examples.map((ex) => `  ${assertFn}(${call(ex.args)}, ${strLit(ex.out)});`);
  const stem = path.slice(dir.length).replace(/\.ts$/, "");
  const id7 = createHash("sha256").update(JSON.stringify([task.file, task.fn, sig, task.ret, task.examples])).digest("hex").slice(0, 7);
  const testPath = `${dir}${stem}.${slug(task.fn)}-${id7}.test.ts`;
  if (files.some((f) => f.path.toLowerCase() === testPath.toLowerCase())) return { reason: "new_test_path_exists" };
  const spec = `./${stem}${importStyle(files, isTest) === "ts" ? ".ts" : ""}`;
  const test = [
    'import assert from "node:assert/strict";',
    'import test from "node:test";',
    `import { ${task.fn} } from ${JSON.stringify(spec)};`,
    "",
    `test(${JSON.stringify(`${task.fn}: the examples from the issue`)}, () => {`,
    ...exampleLines,
    "});",
    "",
  ].join("\n");
  const extra = [{ path: testPath, content: test, create: true as const }];
  return { edit: target ? { path, content, extra, selfGrade: true } : { path, content, create: true, extra, selfGrade: true }, expr, size: r.size };
}

/** Job A entry for v5: the trigger, placement and dsl must be the v5 triple; refusal code in `why.reason`. */
export function runDeriveStringRule(trigger: string, params: Record<string, unknown>, objective: string, files: readonly { path: string; content: string }[], isTest?: (p: string) => boolean, why?: { reason?: string; questions?: string }): DeriveEdit | null {
  if (trigger !== DERIVE_STRING_TRIGGER || params.placement !== DERIVE_STRING_PLACEMENT || params.dsl !== DERIVE_STRING_DSL) { if (why) why.reason = "derive_params"; return null; }
  const parsed = parseDeriveStringTask(objective);
  if ("reason" in parsed) { if (why && parsed.reason !== "derive_trigger") why.reason = parsed.reason; return null; }
  const built = buildDeriveStringEdit(params, parsed.task, files, isTest);
  if ("reason" in built) { if (why) why.reason = built.reason; return null; }
  return built.edit;
}

/** The v5 function's signature read back from its declaration (exact spelling), or null. */
function stringSignature(f: ts.FunctionDeclaration, sf: ts.SourceFile): { params: StrParam[]; ret: StrRet } | null {
  const params: StrParam[] = [];
  for (const p of f.parameters) {
    if (!ts.isIdentifier(p.name) || p.initializer || p.dotDotDotToken || p.questionToken || !p.type) return null;
    const t = p.type.getText(sf);
    if (t !== "string" && t !== "number") return null;
    params.push({ name: p.name.text, type: t });
  }
  const rt = f.type?.getText(sf);
  if (rt !== "string" && rt !== "number" && rt !== "boolean" && rt !== "string[]") return null;
  if (params.length < 1 || params.length > STR_MAX_PARAMS || params[0]!.type !== "string") return null;
  return { params, ret: rt };
}

/**
 * Job B re-check of a v5 module: exactly one exported function with a single `return` whose signature is a v5
 * signature and whose expression passes strExprProblem (re-enumerated to the identical text). Null when clean.
 */
export function derivedStringModuleProblem(content: string): string | null {
  const sf = ts.createSourceFile("m.ts", content, ts.ScriptTarget.Latest, true);
  if ((sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length || sf.statements.length !== 1) return "derive_module_shape";
  const f = sf.statements[0]!;
  if (!ts.isFunctionDeclaration(f) || !f.name || !f.body || f.asteriskToken || f.typeParameters || (ts.getModifiers(f) ?? []).map((m) => m.kind).join(",") !== String(ts.SyntaxKind.ExportKeyword)) return "derive_module_shape";
  const st = f.body.statements;
  if (st.length !== 1 || !ts.isReturnStatement(st[0]!) || !st[0]!.expression) return "derive_module_shape";
  const sig = stringSignature(f, sf);
  if (!sig) return "derive_module_shape";
  const names = [f.name.text, ...sig.params.map((x) => x.name)];
  if (names.some((n) => DERIVE_RESERVED_NAMES.has(n) || PROTECTED_NAMES.test(n) || n === "v")) return "derive_reserved_name";
  const expr = st[0]!.expression.getText(sf);
  if (expr.length > DERIVE_MAX_EXPR_CHARS) return "derive_emit_size";
  return strExprProblem(expr, sig.params, sig.ret);
}
/** M114: the v5 append is add-only, exactly as v3's (derivedAppendProblem), with a v5 module as the block. */
export function derivedStringAppendProblem(before: string, after: string): string | null {
  return appendProblemWith(before, after, derivedStringModuleProblem);
}

/** The v5 rule's operation id prefix (`learned:<rule id>@<spec sha>`). */
export const DERIVE_STRING_OPERATION = "learned:public-derive-from-behavior-v5@";
/**
 * Job B's re-check of a derive candidate's module, keyed on the candidate's rule id (Auditor #523 lesson). A v5
 * candidate is re-checked as a v5 string module only; every other derive candidate (v1, v2, v3) exactly as before.
 */
export function deriveModuleRecheck(operationId: unknown, real: string): string | null {
  return typeof operationId === "string" && operationId.startsWith(DERIVE_STRING_OPERATION) ? derivedStringModuleProblem(real) : derivedModuleProblem(real);
}
/** The same for an append (v3 / v5): add-only, the block re-checked by the candidate's own rule. */
export function deriveAppendRecheck(operationId: unknown, before: string, after: string): string | null {
  return typeof operationId === "string" && operationId.startsWith(DERIVE_STRING_OPERATION) ? derivedStringAppendProblem(before, after) : derivedAppendProblem(before, after);
}

/**
 * The v5 review note, rebuilt from the diff alone (as deriveReviewNote): one created or appended module that passes
 * derivedStringModuleProblem and one test of literal assert lines; PeaceAI derives again and shows the note only
 * for the exact expression, with the program's result on probe inputs the examples do not show.
 */
export function deriveStringReviewNote(diff: string, derive: typeof deriveStringProgram = deriveStringProgram): string | null {
  const files = createdFiles(diff);
  const tests = files.filter((f) => /\.test\.ts$/.test(f.path));
  const mods = [...files.filter((f) => !/\.test\.ts$/.test(f.path)), ...appendedBlocks(diff).filter((f) => !/\.test\.ts$/.test(f.path))];
  if (diff.split(/^diff --git /m).length - 1 !== 2 || tests.length !== 1 || mods.length !== 1 || derivedStringModuleProblem(mods[0]!.content) !== null) return null;
  const sf = ts.createSourceFile("m.ts", mods[0]!.content, ts.ScriptTarget.Latest, true);
  const f = sf.statements[0] as ts.FunctionDeclaration;
  const fn = f.name!.text;
  const sig = stringSignature(f, sf)!;
  const expr = ((f.body!.statements[0] as ts.ReturnStatement).expression!).getText(sf);
  const want = sig.ret === "string[]" ? "assert.deepEqual" : "assert.equal";
  const examples: StrExample[] = [];
  for (const line of tests[0]!.content.split("\n")) {
    if (!/^\s*assert\.(?:deepEqual|equal)\(/.test(line)) continue;
    const t = ts.createSourceFile("t.ts", line, ts.ScriptTarget.Latest, true);
    const st = t.statements[0];
    if (t.statements.length !== 1 || !st || !ts.isExpressionStatement(st) || !ts.isCallExpression(st.expression)) return null;
    const [call, wantV, ...rest] = st.expression.arguments;
    if (st.expression.expression.getText(t) !== want || !call || !wantV || rest.length || !ts.isCallExpression(call) || call.expression.getText(t) !== fn || call.arguments.length !== sig.params.length) return null;
    const args = call.arguments.map(strLitValue);
    const out = strLitValue(wantV);
    if (out === undefined || args.some((a, i) => typeof a !== sig.params[i]!.type)) return null;
    examples.push({ args: args as StrArg[], out: out as StrOut });
  }
  if (!examples.length) return null;
  const input = { params: sig.params, ret: sig.ret, examples };
  const r = derive(input);
  if (!r.ok || compileStr(r.program, sig.params.map((p) => p.name)) !== expr) return null;
  const rows = strProbeTable(r.program, input, DERIVE_NOTE_ROWS).map((row) => `${fn}(${row.args.map((a) => strLit(a)).join(", ")}) = ${strLit(row.out)}`);
  return [`Derived by PeaceAI from the ${examples.length} examples (DERIVE_FROM_BEHAVIOR v5, string parser). Expression and probe inputs the examples do not show:`, "", "```text", `return ${expr};`, "", ...rows, "```"].join("\n");
}
