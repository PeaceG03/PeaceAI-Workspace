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
import ts from "typescript";

export const DERIVE_PARAM_KEYS = ["ambiguity", "dsl", "examples", "grading", "placement", "test"] as const;
export const DERIVE_VOCAB: Record<(typeof DERIVE_PARAM_KEYS)[number], readonly string[]> = {
  ambiguity: ["refuse-unwitnessed"],
  dsl: ["typed-dsl-v1"],
  examples: ["literal-data-only"],
  grading: ["self-fail-before-pass-after"],
  placement: ["new-module"],
  test: ["new-file-examples"],
};
export function validDeriveParams(p: Record<string, unknown>, minedFrom: unknown): boolean {
  if (minedFrom !== "public" || Object.keys(p).sort().join(",") !== [...DERIVE_PARAM_KEYS].join(",")) return false;
  return DERIVE_PARAM_KEYS.every((k) => typeof p[k] === "string" && DERIVE_VOCAB[k].includes(p[k] as string));
}

const NAME = String.raw`[A-Za-z_$][\w$]{0,63}`;
const TYPE = String.raw`(?:number|string|boolean)`;
const PARAM = String.raw`${NAME}: ?${TYPE}`;
/** The header line (the rule's trigger): Add a new module src/x.ts exporting name(a: T, b: U): R */
export const DERIVE_TRIGGER = String.raw`^add (?:a )?new module (?<file>src\/[\w./-]+\.ts) exporting (?<fn>${NAME}) ?\((?<sig>${PARAM}(?:, ?${PARAM}){0,${DERIVE_MAX_PARAMS - 1}})\) ?: ?(?<ret>${TYPE}) ?\.?$`;
export { DERIVE_MAX_EXPR_CHARS } from "./derive.ts";
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

export interface DeriveEdit { path: string; content: string; create: true; extra: { path: string; content: string; create: true }[]; selfGrade: true }
export type DeriveBuild = { edit: DeriveEdit; expr: string; size: number } | { reason: string; detail?: string; questions?: DeriveQuestion[] };

/**
 * `derive` is the search (deriveProgram); the parameter exists only so the emit-time checks below can be shown to
 * fire on a program the search would never produce (m99-derive-guards.test.ts). Job A never passes it.
 */
export function buildDeriveEdit(params: Record<string, unknown>, task: DeriveTask, files: readonly { path: string; content: string }[], isTest: (p: string) => boolean = (p) => /\.test\.ts$/.test(p), derive: typeof deriveProgram = deriveProgram): DeriveBuild {
  for (const k of DERIVE_PARAM_KEYS) if (typeof params[k] !== "string" || !DERIVE_VOCAB[k].includes(params[k] as string)) return { reason: "derive_params" };
  const path = task.file;
  if (!NEW_MODULE_PATH.test(path) || PROTECTED_MODULE.test(path) || isTest(path) || /\.d\.ts$/.test(path) || /\.(test|spec)\./.test(path)) return { reason: "derive_path" };
  const dir = path.slice(0, path.lastIndexOf("/") + 1);
  if (!files.some((f) => f.path.startsWith(dir) && !f.path.slice(dir.length).includes("/") && /\.ts$/.test(f.path) && !isTest(f.path))) return { reason: "derive_path" };
  if (files.some((f) => f.path.toLowerCase() === path.toLowerCase())) return { reason: "derive_module_exists" };
  // PeaceAI's own search writes the body from the examples alone; nothing in the issue is copied into it and the
  // behavior prose is not an input.
  const r = derive({ params: task.params, ret: task.ret, examples: task.examples });
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
  const content = `export function ${task.fn}(${sig}): ${task.ret} {\n  return ${expr};\n}\n`;
  if ((ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true) as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) return { reason: "derive_expr_parse" };
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
  return { edit: { path, content, create: true, extra: [{ path: testPath, content: test, create: true }], selfGrade: true }, expr, size: r.fit.size };
}

/** Job A entry: refusal code in `why.reason`; null when there is no candidate. */
export function runDeriveRule(trigger: string, params: Record<string, unknown>, objective: string, files: readonly { path: string; content: string }[], isTest?: (p: string) => boolean, why?: { reason?: string; questions?: string }): DeriveEdit | null {
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
  const mods = files.filter((f) => !/\.test\.ts$/.test(f.path));
  if (tests.length !== 1 || mods.length !== 1 || derivedModuleProblem(mods[0]!.content) !== null) return null;
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
  const r = derive({ params, ret, examples });
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
  note: (diff: string) => string | null = (d) => deriveReviewNote(d),
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
