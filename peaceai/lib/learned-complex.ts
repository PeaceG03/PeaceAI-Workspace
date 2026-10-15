// M26 (bulk teaching, family `code-shape`): the ADD_COMPLEX_FUNCTION learned rule. Planner-style pure functions
// beyond ADD_FUNCTION's single `return EXPR`: a small block of statements with bounded loops. Mined from Builder's
// own exported multi-statement pure functions in public commits (shape COMPLEX_FUNCTION, peaceai/lib/minecomplex.ts).
// The edit is fixed and stricter than the evidence:
// - ONE new `export function NAME(typed params): Type { BODY }` appended at the end of an existing source module,
//   plus ONE new test file from the task's bullets (same grammar as ADD_FUNCTION).
// - BODY statements only: `const|let NAME[: T] = EXPR;`, `NAME = EXPR;` / `NAME += EXPR;` / `NAME -= EXPR;` (own `let`
//   locals only), `LOCAL.push(EXPR);` (own `const X: T[] = []` arrays only), `if (EXPR) STMT [else STMT]`,
//   `{ ... }`, `for (const X of ITER) { ... }` (ITER a parameter or a `.slice(...)` of one; never a pushed local),
//   `for (let i = INT; i < BOUND; i++) { ... }` (BOUND an integer literal <= MAX_LOOP_BOUND or PARAM.length; `i`
//   never assigned in the body), `break;`, `continue;`, `return EXPR;`.
// - EXPR: ADD_FUNCTION's pure vocabulary over parameters AND the function's own locals, plus read-only element
//   access `X[INDEX]`. No other names (no module code, no globals), no `new`, no closures, no while/do, no try,
//   no throw, no labels, no `++/--` except a counted loop's own `i++`.
// - Limits: MAX_STATEMENTS statements, MAX_LOOPS loops, nesting depth MAX_DEPTH, MAX_BODY_CHARS of body text.
//   Every loop terminates: for-of over an array the body cannot grow, counted loops with a fixed or input-length
//   bound and an untouched counter. Reads at least one parameter; the last statement is a `return`.
// - Issue cleaning strips `>`, `*`, `#` and backticks, so a body uses `<`/`<=` (swap the operands) and no `*`.
// Job B grades it like ADD_FUNCTION: the new test passes with the function, fails with the module put back to the
// task base, and fails with the body replaced by a type-default `return` (stubComplexBody). No model.
import ts from "typescript";
import { FUNCTION_TYPES, safeBody } from "./learned-function.ts";
import { buildTestEdit, parseTestTask, type TestTask } from "./learned-test.ts";
import { createHash } from "node:crypto";
import { PROTECTED_SELF } from "./selfchange.ts";

/** Off unless PEACEAI_COMPLEX_FUNCTION is exactly "true" (M26 refresh). */
export const COMPLEX_FUNCTION_FLAG = "PEACEAI_COMPLEX_FUNCTION";
export const complexFunctionEnabled = (env: Record<string, string | undefined>): boolean => env[COMPLEX_FUNCTION_FLAG] === "true";
const isProtected = (path: string) => PROTECTED_SELF.some((x) => x.pattern.test(path));

export const COMPLEX_PARAM_KEYS = ["body", "grading", "loops", "params", "placement", "returns", "test"] as const;
export const COMPLEX_VOCAB: Record<(typeof COMPLEX_PARAM_KEYS)[number], readonly string[]> = {
  body: ["bounded-block"],
  grading: ["self-fail-before-pass-after-and-stub"],
  loops: ["for-of-param", "counted-literal-or-length"],
  params: ["typed"],
  placement: ["end-of-module"],
  returns: ["annotated"],
  test: ["new-file"],
};
export const MAX_STATEMENTS = 20;
export const MAX_LOOPS = 2;
export const MAX_DEPTH = 3;
export const MAX_BODY_CHARS = 800;
export const MAX_LOOP_BOUND = 1000;
export const MAX_PARAMS = 4;
const NAME = String.raw`[A-Za-z_$][\w$]*`;
const FILE = String.raw`[\w./-]+\.ts`;
const TYPE = String.raw`(?:readonly )?(?:string|number|boolean)(?:\[\])?`;
const PARAM = String.raw`${NAME}: ?${TYPE}`;
/** Header line; the body lines follow it (each a statement), then the test bullets. */
export const COMPLEX_TRIGGER = String.raw`^add (?:a )?complex function \x60?(?<fn>${NAME}) ?\((?<sig>${PARAM}(?:, ?${PARAM}){0,${MAX_PARAMS - 1}})\) ?: ?(?<ret>${TYPE})\x60? to \x60?(?<file>${FILE})\x60? with body ?:?[ \t]*$`;
const LOCAL_TYPES = new Set(FUNCTION_TYPES as readonly string[]);
const RESERVED = /^(?:constructor|prototype|__proto__|eval|arguments|globalThis|process|require|import|Function|undefined|NaN|Infinity)$/;

export interface ComplexTask { fn: string; file: string; params: { name: string; type: string }[]; ret: string; body: string; test: TestTask }
export interface ComplexEdit { path: string; content: string; extra: { path: string; content: string; create: true }[]; selfGrade: true }

export function parseComplexTask(trigger: string, objective: string): ComplexTask | null {
  const lines = objective.split("\n").map((l) => l.trim());
  const heads = lines.map((l, i) => (new RegExp(trigger, "i").test(l) ? i : -1)).filter((i) => i >= 0);
  if (heads.length !== 1) return null;
  const at = heads[0]!;
  const g = new RegExp(trigger, "i").exec(lines[at]!)!.groups ?? {};
  if (!g.fn || !g.sig || !g.ret || !g.file) return null;
  const params: { name: string; type: string }[] = [];
  for (const part of g.sig.split(",").map((p) => p.trim())) {
    const m = new RegExp(String.raw`^(${NAME}): ?(${TYPE})$`).exec(part);
    if (!m || params.some((p) => p.name === m[1]) || RESERVED.test(m[1]!)) return null;
    params.push({ name: m[1]!, type: m[2]! });
  }
  if (!LOCAL_TYPES.has(g.ret) || params.some((p) => !LOCAL_TYPES.has(p.type))) return null;
  const bodyLines: string[] = [];
  let i = at + 1;
  for (; i < lines.length && !/^[-*] /.test(lines[i]!); i++) if (lines[i]) bodyLines.push(lines[i]!);
  const body = bodyLines.join("\n");
  if (!body || body.length > MAX_BODY_CHARS) return null;
  const bullets = lines.slice(i).filter((l) => /^[-*] /.test(l));
  const pseudo = createHash("sha256").update(`${g.file}\0${g.fn}\0${g.sig}\0${g.ret}\0${body}`).digest("hex").slice(0, 40);
  const testText = [`add a test for ${g.fn} in ${g.file}: ${g.fn} returns the expected values`, ...bullets, `Fix: ${pseudo}`].join("\n");
  const test = parseTestTask(String.raw`^add (?:a )?test for (?<symbol>${NAME}) in (?<file>${FILE})(?: ?: (?<title>[^\n]{1,120}?))?$`, testText);
  if (!test || test.symbol !== g.fn || test.file !== g.file || test.checks.length === 0 || test.checks.some((c) => c.kind === "rejects")) return null;
  return { fn: g.fn, file: g.file, params, ret: g.ret, body, test };
}

/**
 * True when every statement of the block is in the bounded grammar (see the header). `params` are read-only.
 * Returns the reason for a refusal (string) or null when the block is safe.
 */
export interface CallCtx { module: ReadonlyMap<string, ts.FunctionDeclaration | null>; stack: readonly string[]; called: Set<string> }
/** Option A (Auditor): the callable module functions: exported, top-level, one declaration with a body, not async/generator. */
export function moduleFunctions(sf: ts.SourceFile): Map<string, ts.FunctionDeclaration | null> {
  const out = new Map<string, ts.FunctionDeclaration | null>();
  for (const s of sf.statements) {
    if (!ts.isFunctionDeclaration(s) || !s.name) continue;
    const n = s.name.text;
    const ok = !!s.body && !s.asteriskToken && !s.typeParameters?.length && (ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword) && !(ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword || m.kind === ts.SyntaxKind.DefaultKeyword);
    out.set(n, out.has(n) || !ok ? null : s); // overloads / duplicates / non-exported: present but never callable
  }
  return out;
}
/** Option A: call chain depth cap (the candidate body -> f -> g; g may call nothing). */
export const MAX_CALL_DEPTH = 2;

export function blockRefusal(block: ts.Block, params: ReadonlySet<string>, sf: ts.SourceFile, ctx: CallCtx = { module: moduleFunctions(sf), stack: [], called: new Set() }): string | null {
  let callRefusal: string | null = null;
  const callee = (name: string): boolean => {
    if (ctx.stack.includes(name)) { callRefusal = `recursive call to ${name}`; return false; }
    if (ctx.stack.length >= MAX_CALL_DEPTH) { callRefusal = `call depth over ${MAX_CALL_DEPTH}`; return false; }
    const f = ctx.module.get(name);
    if (!f || !f.body) { callRefusal = `${name} is not an exported same-file function`; return false; }
    const ps = new Set<string>();
    for (const x of f.parameters) { if (!ts.isIdentifier(x.name) || !x.type || x.dotDotDotToken || x.initializer || x.questionToken) { callRefusal = `${name} has untyped/destructured/optional parameters`; return false; } ps.add(x.name.text); }
    const r = blockRefusal(f.body, ps, sf, { module: ctx.module, stack: [...ctx.stack, name], called: ctx.called });
    if (r) { callRefusal = `${name}: ${r}`; return false; }
    ctx.called.add(name);
    return true;
  };
  const locals = new Map<string, { kind: "const" | "let"; pushable: boolean }>();
  const iterated = new Set<string>();
  const counters = new Set<string>();
  let statements = 0;
  let loops = 0;
  let usesParam = false;
  const names = () => new Set([...params, ...locals.keys(), ...counters]);
  const expr = (e: ts.Expression): boolean => {
    // Read-only element access X[INDEX] is allowed on top of ADD_FUNCTION's vocabulary: check it by rewriting.
    let okAccess = true;
    const visit = (n: ts.Node): void => {
      if (ts.isElementAccessExpression(n)) { if (n.questionDotToken || !ts.isIdentifier(n.expression) || !names().has(n.expression.text)) okAccess = false; }
      if (ts.isIdentifier(n) && params.has(n.text)) usesParam = true;
      ts.forEachChild(n, visit);
    };
    visit(e);
    if (!okAccess) return false;
    const own = names();
    let callsOk = true;
    const calls = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && !own.has(n.expression.text) && ctx.module.has(n.expression.text)) {
        if (n.questionDotToken || n.typeArguments || n.arguments.some(ts.isSpreadElement) || !callee(n.expression.text)) callsOk = false;
      }
      ts.forEachChild(n, calls);
    };
    calls(e);
    if (!callsOk) return false;
    const rewritten = rewriteIndex(e, sf, (n) => !own.has(n) && ctx.module.has(n));
    if (rewritten === null) return false;
    const re = ts.createSourceFile("e.ts", `(${rewritten});`, ts.ScriptTarget.Latest, true);
    const st = re.statements[0];
    if (re.statements.length !== 1 || !st || !ts.isExpressionStatement(st) || !ts.isParenthesizedExpression(st.expression) || (re as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) return false;
    return safeBodyNoParam(st.expression.expression, names());
  };
  const safeBodyNoParam = (e: ts.Expression, ns: Set<string>) => {
    // safeBody requires reading a parameter; locals-only expressions are fine inside a block (usesParam is tracked here).
    const dummy = "__p";
    const wrapped = ts.createSourceFile("e.ts", `((${e.getText()}) === ${dummy} || ${dummy});`, ts.ScriptTarget.Latest, true);
    const st = wrapped.statements[0] as ts.ExpressionStatement;
    return safeBody((st.expression as ts.ParenthesizedExpression).expression, new Set([...ns, dummy]));
  };
  const local = (n: string) => !params.has(n) && !locals.has(n) && !counters.has(n) && !RESERVED.test(n);
  const stmt = (s: ts.Statement, depth: number, inLoop: boolean): string | null => {
    if (++statements > MAX_STATEMENTS) return "too many statements";
    if (depth > MAX_DEPTH) return "nested too deep";
    if (ts.isBlock(s)) { statements--; for (const x of s.statements) { const r = stmt(x, depth, inLoop); if (r) return r; } return null; }
    if (ts.isVariableStatement(s)) {
      const fl = s.declarationList.flags;
      const kind = fl & ts.NodeFlags.Const ? "const" : fl & ts.NodeFlags.Let ? "let" : null;
      if (!kind || s.declarationList.declarations.length !== 1 || ts.getModifiers(s)?.length) return "only one const/let per statement";
      const d = s.declarationList.declarations[0]!;
      if (!ts.isIdentifier(d.name) || !local(d.name.text) || !d.initializer) return "bad declaration";
      if (d.type && !LOCAL_TYPES.has(d.type.getText(sf))) return "local type outside the vocabulary";
      const emptyArray = ts.isArrayLiteralExpression(d.initializer) && d.initializer.elements.length === 0;
      if (emptyArray && (!d.type || !/\[\]$/.test(d.type.getText(sf)))) return "an empty array needs an array type";
      if (!emptyArray && !expr(d.initializer)) return callRefusal ?? "initializer outside the vocabulary";
      locals.set(d.name.text, { kind, pushable: kind === "const" && emptyArray });
      return null;
    }
    if (ts.isExpressionStatement(s)) {
      const e = s.expression;
      if (ts.isBinaryExpression(e) && [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken].includes(e.operatorToken.kind)) {
        if (!ts.isIdentifier(e.left) || locals.get(e.left.text)?.kind !== "let") return "assignment only to own let locals";
        return expr(e.right) ? null : "assigned value outside the vocabulary";
      }
      if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && ts.isIdentifier(e.expression.expression) && e.expression.name.text === "push") {
        const arr = e.expression.expression.text;
        if (!locals.get(arr)?.pushable || iterated.has(arr) || e.arguments.length !== 1 || ts.isSpreadElement(e.arguments[0]!)) return "push only one value onto an own empty-initialized array";
        return expr(e.arguments[0]!) ? null : "pushed value outside the vocabulary";
      }
      return "expression statement not allowed";
    }
    if (ts.isIfStatement(s)) {
      // Option A: the only throw is a one-line guard `if (COND) throw new Error("literal");` (no else).
      const th = ts.isBlock(s.thenStatement) && s.thenStatement.statements.length === 1 ? s.thenStatement.statements[0]! : s.thenStatement;
      if (ts.isThrowStatement(th)) {
        const x = th.expression;
        const oneLine = sf.getLineAndCharacterOfPosition(s.getStart(sf)).line === sf.getLineAndCharacterOfPosition(s.getEnd()).line;
        if (s.elseStatement || !oneLine || !ts.isNewExpression(x) || !ts.isIdentifier(x.expression) || x.expression.text !== "Error" || x.arguments?.length !== 1 || !(ts.isStringLiteral(x.arguments[0]!) || ts.isNoSubstitutionTemplateLiteral(x.arguments[0]!))) return "throw only as a one-line guard if (COND) throw new Error(\"literal\")";
        return expr(s.expression) ? null : "condition outside the vocabulary";
      }
      if (!expr(s.expression)) return "condition outside the vocabulary";
      return stmt(s.thenStatement, depth + 1, inLoop) ?? (s.elseStatement ? stmt(s.elseStatement, depth + 1, inLoop) : null);
    }
    if (ts.isReturnStatement(s)) return s.expression && expr(s.expression) ? null : callRefusal ?? "return value outside the vocabulary";
    if (ts.isBreakStatement(s) || ts.isContinueStatement(s)) return !s.label && inLoop ? null : "break/continue only unlabeled, inside a loop";
    if (ts.isForOfStatement(s)) {
      if (++loops > MAX_LOOPS) return "too many loops";
      if (s.awaitModifier) return "for await";
      const init = s.initializer;
      if (!ts.isVariableDeclarationList(init) || !(init.flags & ts.NodeFlags.Const) || init.declarations.length !== 1 || !ts.isIdentifier(init.declarations[0]!.name)) return "for-of needs one const binding";
      const it = s.expression;
      const src = ts.isIdentifier(it) ? it : ts.isCallExpression(it) && ts.isPropertyAccessExpression(it.expression) && it.expression.name.text === "slice" && ts.isIdentifier(it.expression.expression) ? it.expression.expression : null;
      if (!src || !(params.has(src.text) || (locals.has(src.text) && !locals.get(src.text)!.pushable)) || !expr(it)) return "for-of only over a parameter, a non-growing local, or a slice of one";
      const v = init.declarations[0]!.name.text;
      if (!local(v)) return "loop variable shadows";
      iterated.add(src.text);
      locals.set(v, { kind: "const", pushable: false });
      const r = stmt(s.statement, depth + 1, true);
      locals.delete(v);
      return r;
    }
    if (ts.isForStatement(s)) {
      if (++loops > MAX_LOOPS) return "too many loops";
      const init = s.initializer;
      if (!init || !ts.isVariableDeclarationList(init) || !(init.flags & ts.NodeFlags.Let) || init.declarations.length !== 1) return "counted loop needs one let counter";
      const d = init.declarations[0]!;
      if (!ts.isIdentifier(d.name) || !local(d.name.text) || !d.initializer || !ts.isNumericLiteral(d.initializer) || !/^\d+$/.test(d.initializer.text)) return "counter starts at an integer literal";
      const i = d.name.text;
      const c = s.condition;
      if (!c || !ts.isBinaryExpression(c) || ![ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken].includes(c.operatorToken.kind) || !ts.isIdentifier(c.left) || c.left.text !== i) return "condition must be i < BOUND or i <= BOUND";
      const b = c.right;
      const literal = ts.isNumericLiteral(b) && /^\d+$/.test(b.text) && Number(b.text) <= MAX_LOOP_BOUND;
      const length = ts.isPropertyAccessExpression(b) && b.name.text === "length" && ts.isIdentifier(b.expression) && params.has(b.expression.text);
      if (!literal && !length) return `bound must be an integer literal <= ${MAX_LOOP_BOUND} or PARAM.length`;
      const inc = s.incrementor;
      if (!inc || !ts.isPostfixUnaryExpression(inc) || inc.operator !== ts.SyntaxKind.PlusPlusToken || !ts.isIdentifier(inc.operand) || inc.operand.text !== i) return "incrementor must be i++";
      counters.add(i);
      const r = stmt(s.statement, depth + 1, true);
      counters.delete(i);
      return r;
    }
    return `${ts.SyntaxKind[s.kind]} not allowed`;
  };
  const st = block.statements;
  if (st.length === 0 || !ts.isReturnStatement(st[st.length - 1]!)) return "the last statement must be a return";
  for (const s of st) { const r = stmt(s, 1, false); if (r) return r; }
  return usesParam ? null : "the body never reads a parameter";
}

/** Rewrites read-only `X[INDEX]` to `X.at(INDEX)` so ADD_FUNCTION's expression checker can vet it (at is pure). */
function rewriteIndex(e: ts.Expression, sf: ts.SourceFile, isModuleCall: (name: string) => boolean = () => false): string | null {
  const text = e.getText(sf);
  const start = e.getStart(sf);
  const edits: { at: number; end: number; repl: string }[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isElementAccessExpression(n)) {
      const open = n.argumentExpression.getStart(sf) - 1;
      const close = n.getEnd() - 1;
      edits.push({ at: open - start, end: open - start + 1, repl: ".at(" }, { at: close - start, end: close - start + 1, repl: ")" });
    }
    // Option A: a vetted same-file call `f(a, b)` is checked as `[a, b].length` (its arguments stay checked).
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && isModuleCall(n.expression.text)) {
      const c0 = n.expression.getStart(sf);
      const open = n.arguments.pos - 1;
      const close = n.getEnd() - 1;
      edits.push({ at: c0 - start, end: open - start + 1, repl: "[" }, { at: close - start, end: close - start + 1, repl: "].length" });
    }
    ts.forEachChild(n, visit);
  };
  visit(e);
  let out = text;
  for (const ed of edits.sort((a, b) => b.at - a.at)) {
    const want = ed.repl === ")" ? "]" : ed.repl === ".at(" ? "[" : ed.repl === "].length" ? ")" : null;
    if (want !== null ? out.slice(ed.at, ed.end) !== want : !/^[A-Za-z_$][\w$]*\s*\($/.test(out.slice(ed.at, ed.end))) return null;
    out = out.slice(0, ed.at) + ed.repl + out.slice(ed.end);
  }
  return out;
}

function declared(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  const v = (n: ts.Node) => { const nm = (n as { name?: ts.Node }).name; if (nm && ts.isIdentifier(nm)) out.add(nm.text); ts.forEachChild(n, v); };
  v(sf);
  return out;
}

export function buildComplexEdit(params: Record<string, string | string[]>, task: ComplexTask, files: readonly { path: string; content: string }[], isTest: (p: string) => boolean = (p) => /\.test\.ts$/.test(p)): ComplexEdit | null {
  for (const k of COMPLEX_PARAM_KEYS) {
    const v = params[k];
    if (k === "loops") { if (!Array.isArray(v) || v.length === 0 || !v.every((x) => COMPLEX_VOCAB.loops.includes(x))) return null; continue; }
    if (typeof v !== "string" || !COMPLEX_VOCAB[k].includes(v)) return null;
  }
  if (isProtected(task.file)) return null;
  const target = files.find((f) => f.path === task.file);
  if (!target || isTest(target.path) || !/\.ts$/.test(target.path) || /\.d\.ts$/.test(target.path)) return null;
  const sf = ts.createSourceFile(target.path, target.content, ts.ScriptTarget.Latest, true);
  if ((sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length) return null;
  if (declared(sf).has(task.fn) || new RegExp(String.raw`\b${task.fn.replace(/\$/g, "\\$")}\b`).test(target.content) || RESERVED.test(task.fn)) return null;
  const names = new Set(task.params.map((p) => p.name));
  if (names.has(task.fn)) return null;
  const sig = task.params.map((p) => `${p.name}: ${p.type}`).join(", ");
  const fnText = `export function ${task.fn}(${sig}): ${task.ret} {\n${task.body.split("\n").map((l) => `  ${l}`).join("\n")}\n}\n`;
  const fsf = ts.createSourceFile("f.ts", fnText, ts.ScriptTarget.Latest, true);
  if ((fsf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length || fsf.statements.length !== 1) return null;
  const fd = fsf.statements[0]!;
  if (!ts.isFunctionDeclaration(fd) || !fd.body) return null;
  const allowedLoops = new Set(params.loops as string[]);
  if (!allowedLoops.has("for-of-param") && /\bfor \(const /.test(task.body)) return null;
  if (!allowedLoops.has("counted-literal-or-length") && /\bfor \(let /.test(task.body)) return null;
  if (blockRefusal(fd.body, names, fsf)) return null;
  const base = target.content.endsWith("\n") ? target.content : `${target.content}\n`;
  const content = `${base}\n${fnText}`;
  const withFn = files.map((f) => (f.path === target.path ? { path: f.path, content } : f));
  const testParams = { assert: "node:assert/strict-default", checks: ["equal", "deepEqual", "throws"], framework: "node:test-default", grading: "fail-before-pass-after", matcher: "regex", maxLines: "12", placement: "new-file" };
  const test = buildTestEdit(testParams, task.test, withFn, isTest);
  if (!test) return null;
  return { path: target.path, content, extra: [{ path: test.path, content: test.content, create: true }], selfGrade: true };
}

export function applyComplexRule(trigger: string, params: Record<string, string | string[]>, objective: string, files: readonly { path: string; content: string }[], isTest?: (p: string) => boolean, env: Record<string, string | undefined> = process.env): ComplexEdit | null {
  if (!complexFunctionEnabled(env)) return null;
  const task = parseComplexTask(trigger, objective);
  return task ? buildComplexEdit(params, task, files, isTest) : null;
}

/** Job B's stub: the function's whole body replaced by a type-default return (types are always in the vocabulary). */
export function stubComplexBody(content: string, fn: string): string | null {
  const sf = ts.createSourceFile("m.ts", content, ts.ScriptTarget.Latest, true);
  const hits = sf.statements.filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === fn);
  if (hits.length !== 1 || !hits[0]!.body || !hits[0]!.type) return null;
  const t = hits[0]!.type.getText(sf).replace(/^readonly /, "");
  const d = t === "string" ? '""' : t === "number" ? "0" : t === "boolean" ? "false" : /\[\]$/.test(t) ? "[]" : null;
  if (!d) return null;
  return content.slice(0, hits[0]!.body.getStart(sf)) + `{ return ${d}; }` + content.slice(hits[0]!.body.getEnd());
}

/** Option A: the same-file functions a body calls (transitively, vetted). Null when the body is refused. */
export function calledFunctions(block: ts.Block, params: ReadonlySet<string>, sf: ts.SourceFile): string[] | null {
  const ctx: CallCtx = { module: moduleFunctions(sf), stack: [], called: new Set() };
  return blockRefusal(block, params, sf, ctx) === null ? [...ctx.called].sort() : null;
}

/**
 * Option A grading: stub `fn` AND every function it calls that the candidate added (`added`), so a test cannot pass
 * through a helper the candidate also wrote. Null (fail closed) when any of them cannot be stubbed.
 */
export function stubForGrading(content: string, fn: string, added: readonly string[]): string | null {
  const sf = ts.createSourceFile("m.ts", content, ts.ScriptTarget.Latest, true);
  const f = moduleFunctions(sf).get(fn);
  if (!f?.body) return null;
  const ps = new Set(f.parameters.map((x) => (ts.isIdentifier(x.name) ? x.name.text : "")));
  const called = calledFunctions(f.body, ps, sf);
  if (called === null) return null;
  let cur: string | null = content;
  for (const n of [fn, ...called.filter((c) => added.includes(c))]) { cur = stubComplexBody(cur, n); if (cur === null) return null; }
  return cur;
}
